import { SlashCommandBuilder } from 'discord.js';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { EmbedBuilder } from 'discord.js';
import { createEAClientFromEnv, Stage } from './ea_client.js';
import { getMessageForWeek } from './madden_utils.js';
import { YEAR } from './ea_constants.js';
import { resolveLeagueIdWithConfig } from './madden_data.js';
import { loadTokens as loadTokensDb } from './madden_db.js';
import { SnallabotProvider } from './providers/SnallabotProvider.js';
import { getGuildEATokens, saveGuildEATokens } from './ea_guild_auth.js';
import { stablePlayerKey } from './player_identity.js';
import {
  getMaddenDataFilePath,
  getMaddenLeagueSnapshotPath,
  getMaddenLeaguesDir,
} from '../leaguebuddy/paths.js';
import {
  findSyncByRequestId,
  loadSyncSnapshot,
  persistSyncHistory,
  validateFranchiseSnapshot,
} from './madden_sync_history.js';
import { isSoloModeEnabled } from '../leaguebuddy/solo_mode.js';
import { getMaddenChannelId } from '../shared/madden_metadata.js';
import { getMaddenStatValue } from './madden_stat_fields.js';

const leagueDir = getMaddenLeaguesDir();
const prevDir = path.join(leagueDir, 'previous');
const tokenFile = getMaddenDataFilePath('tokens.json');
const snapshotsDir = leagueDir;
const useSnallabot = (process.env.MADDEN_SYNC_USE_SNALLABOT ?? 'true').toLowerCase() !== 'false';
const activeSyncRequests = new Map();

const data = new SlashCommandBuilder()
  .setName('sync')
  .setDescription('Pull this server\'s connected Madden league data and save locally.');

async function emitProgress(options, phase, detail) {
  if (typeof options?.onProgress !== 'function') return;
  try {
    await options.onProgress(phase, detail);
  } catch {
    // ignore progress update errors
  }
}

async function postDataImportSummary(client, guildId, summary) {
  const channelId = getMaddenChannelId('Data Imports', guildId);
  if (!channelId) return { posted: false, reason: 'Data Imports channel is not configured.' };
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased()) throw new Error('Configured Data Imports channel is unavailable or not text-based.');
  const missingBuckets = summary.coverage?.missingBuckets || [];
  const warningText = missingBuckets.length
    ? missingBuckets.slice(0, 5).map((bucket) => `${bucket.stage === 2 ? 'postseason' : 'regular season'} week ${Number(bucket.weekIndex) + 1}`).join(', ')
    : 'None';
  const embed = new EmbedBuilder()
    .setTitle('Madden Data Import')
    .setColor(missingBuckets.length ? 0xf1c40f : 0x2ecc71)
    .setDescription(`Sync \`${summary.syncId}\` completed for league \`${summary.leagueId}\`.`)
    .addFields(
      { name: 'Teams / Rosters', value: `${summary.teamsCount} teams / ${summary.rosterCount} roster teams`, inline: true },
      { name: 'Standings / Games', value: `${summary.standingsCount} standings / ${summary.gamesCount} games`, inline: true },
      { name: 'Stat Weeks / Free Agents', value: `${summary.statsWeeks} weeks / ${summary.coverage?.freeAgents ?? 0} free agents`, inline: true },
      { name: 'Import warnings', value: warningText, inline: false },
    )
    .setTimestamp(new Date(summary.syncedAt));
  await channel.send({ embeds: [embed] });
  return { posted: true, channelId };
}

async function ensureDir() {
  await fs.mkdir(leagueDir, { recursive: true });
  await fs.mkdir(prevDir, { recursive: true });
}

// Aggregate per-player totals across all stat buckets for a single week.
// This mirrors the shape used by awards/top100 so downstream consumers can rely
// on a single rolled-up object per player.
function buildPlayerTotals(week) {
  const agg = new Map();
  const add = (list, fields) => {
    (list || []).forEach(p => {
      const id = stablePlayerKey(p);
      if (!id) return;
      const cur = agg.get(id) || {
        rosterId: p.rosterId,
        teamId: p.teamId,
        fullName: p.fullName,
        position: p.position,
        scheduleId: p.scheduleId,
        weekIndex: p.weekIndex,
        seasonIndex: p.seasonIndex,
        stageIndex: p.stageIndex,
        totals: {},
      };
      fields.forEach(f => {
        const val = Number(getMaddenStatValue(p, f) ?? 0);
        cur.totals[f] = (cur.totals[f] || 0) + (Number.isFinite(val) ? val : 0);
      });
      agg.set(id, cur);
    });
  };
  add(week?.passing?.playerPassingStatInfoList, ['passAtt', 'passComp', 'passYds', 'passTDs', 'passInts', 'passSacks']);
  add(week?.rushing?.playerRushingStatInfoList, ['rushAtt', 'rushYds', 'rushTDs', 'fumbles']);
  add(week?.receiving?.playerReceivingStatInfoList, ['recCatches', 'recYds', 'recTDs']);
  add(week?.defense?.playerDefensiveStatInfoList, [
    'defTotalTackles', 'defSoloTackles', 'defSacks', 'defTacklesForLoss', 'defInts',
    'defForcedFumbles', 'defRecoveredFumbles', 'defPassDeflections', 'defTDs'
  ]);
  add(week?.kicking?.playerKickingStatInfoList, ['fgMade', 'fgAtt', 'xpMade', 'xpAtt', 'kickPts']);
  add(week?.punting?.playerPuntingStatInfoList, ['pntAtt', 'pntYds', 'pntInside20']);
  return Array.from(agg.values());
}

async function loadTokens(guildId = null) {
  if (guildId) {
    const guildTokens = getGuildEATokens(guildId);
    if (guildTokens?.accessToken && guildTokens?.refreshToken) return guildTokens;
    const dbTokens = loadTokensDb();
    if (dbTokens && dbTokens.accessToken && dbTokens.refreshToken) {
      try { saveGuildEATokens(guildId, dbTokens); } catch {}
      return dbTokens;
    }
    try {
      const txt = await fs.readFile(tokenFile, 'utf-8');
      const parsed = JSON.parse(txt);
      if (parsed?.gameYear && `${parsed.gameYear}` !== `${YEAR}`) {
        console.warn(`[madden-sync] Ignoring cached tokens from year ${parsed.gameYear}, current YEAR=${YEAR}`);
        try { await fs.unlink(tokenFile); } catch {}
        return null;
      }
      if (parsed?.accessToken && parsed?.refreshToken) {
        try { saveGuildEATokens(guildId, parsed); } catch {}
        return parsed;
      }
    } catch {
      // ignore
    }
    return null;
  }
  const dbTokens = loadTokensDb();
  if (dbTokens && dbTokens.accessToken && dbTokens.refreshToken) return dbTokens;
  try {
    const txt = await fs.readFile(tokenFile, 'utf-8');
    const parsed = JSON.parse(txt);
    if (parsed?.gameYear && `${parsed.gameYear}` !== `${YEAR}`) {
      console.warn(`[madden-sync] Ignoring cached tokens from year ${parsed.gameYear}, current YEAR=${YEAR}`);
      try { await fs.unlink(tokenFile); } catch {}
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function runSyncInternal(leagueId, provider, options = {}) {
  const weekOverride = options.week ? Number(options.week) : null;
  const notifyChannelId = options.notifyChannelId;
  const notifyClient = options.client;
  const notify = async (title, description) => {
    if (!notifyClient || !notifyChannelId) return;
    try {
      const channel = await notifyClient.channels.fetch(notifyChannelId);
      if (!channel?.isTextBased()) return;
      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(0xff5555)
        .setTimestamp(new Date());
      await channel.send({ embeds: [embed] });
    } catch (e) {
      console.warn('[madden-sync] notify failed:', e?.message || e);
    }
  };
  try {
    const previousRequest = await findSyncByRequestId(leagueId, options.requestId);
    if (previousRequest) return previousRequest;
    await emitProgress(options, 'Preparing sync', 'Setting up storage and loading any existing snapshot.');
    await ensureDir();
    // Load existing snapshot (if any) so we can merge/retain weekly stats
    let existingSnapshot = null;
    const outPath = getMaddenLeagueSnapshotPath(leagueId);
    try {
      const existing = await fs.readFile(outPath, 'utf-8');
      existingSnapshot = JSON.parse(existing);
    } catch { /* no prior snapshot */ }

    await emitProgress(options, 'Checking account connection', 'Loading the saved league connection for this server.');
    const tokens = await loadTokens(options.guildId);
    if (!tokens || !tokens.accessToken || !tokens.refreshToken) {
      throw new Error('No EA connection was found for this server. Run `/setup` and reconnect EA, then retry.');
    }
    await emitProgress(options, 'Opening league session', 'Refreshing the saved connection and opening the Madden session.');
    const client = await createEAClientFromEnv({ ...process.env, EA_ACCESS_TOKEN: tokens.accessToken, EA_REFRESH_TOKEN: tokens.refreshToken, EA_ACCESS_TOKEN_EXPIRES_AT: tokens.expiry, EA_CONSOLE: tokens.console, EA_BLAZE_ID: tokens.blazeId, EA_GAME_YEAR: tokens.gameYear }, {
      persistTokenUpdate: options.guildId ? (updatedTokens) => saveGuildEATokens(options.guildId, updatedTokens) : undefined,
    });
    let info = null;
    let seasonInfo = null;
    let currentWeek = null;
    let stage = Stage.SEASON;
    if (provider) {
      try {
        const wk = await provider.getCurrentWeek(String(leagueId));
        currentWeek = wk.week;
        seasonInfo = wk.seasonInfo || seasonInfo;
        stage = wk.stage === 'preseason' ? Stage.PRESEASON : Stage.SEASON;
      } catch (e) {
        console.warn('[madden-sync] provider getCurrentWeek failed, falling back to EA hub:', e?.message || e);
      }
    }
    if (!info || currentWeek === null || currentWeek === undefined || currentWeek <= 0) {
      info = await client.getLeagueInfo(Number(leagueId));
      seasonInfo = seasonInfo || info?.careerHubInfo?.seasonInfo || {};
      const infoDisplayWeek = seasonInfo.displayWeek;
      const infoWeek = seasonInfo.seasonWeek;
      // Madden hub appears to store seasonWeek as 0-based; displayWeek is already 1-based.
      const normalizedInfoWeek = Number.isInteger(infoDisplayWeek) && infoDisplayWeek > 0
        ? infoDisplayWeek
        : Number.isInteger(infoWeek)
          ? infoWeek + 1
          : null;
      if (normalizedInfoWeek) currentWeek = normalizedInfoWeek;
      const infoStage = seasonInfo.seasonWeekType ?? seasonInfo.seasonStage;
      stage = infoStage === 0 ? Stage.PRESEASON : Stage.SEASON;
    }
    if (!seasonInfo) seasonInfo = {};
    // Fallback: parse from getLeagues seasonText if still unset/zero.
    if (currentWeek === null || currentWeek === undefined || currentWeek <= 0) {
      try {
        const leagues = await client.getLeagues();
        const found = leagues.find(l => String(l.leagueId) === String(leagueId));
        const text = found?.seasonText || '';
        // e.g., "Season 2025 PRE Wk 1" or "Season 2025 REG Wk 2"
        const match = /wk\s+(\d+)/i.exec(text);
        if (match) currentWeek = Number(match[1]) || currentWeek || 0;
        if (text.toLowerCase().includes('pre')) stage = Stage.PRESEASON;
      } catch (e) {
        console.warn('[madden-sync] getLeagues fallback failed:', e?.message || e);
      }
    }
    if (currentWeek === null || currentWeek === undefined) currentWeek = 0;
    if (weekOverride) currentWeek = weekOverride;

    await emitProgress(options, 'Loading league overview', 'Fetching teams, standings, and current league context.');
    const [teams, standings] = await Promise.all([
      client.getTeams(Number(leagueId)),
      client.getStandings(Number(leagueId)),
    ]);

    // Schedule fetch: try provider first, then EA across all relevant weeks.
    await emitProgress(options, 'Loading schedule', 'Pulling the full schedule for the connected league.');
    let schedule = { schedules: [] };
    if (provider) {
      try {
        schedule = await provider.getFullSchedule(String(leagueId));
      } catch (e) {
        console.warn('[madden-sync] provider getFullSchedule failed, falling back to EA:', e?.message || e);
      }
    }
    // If preseason or early regular season and provider data looks stale (seasonIndex<=0 or missing week0 stage1),
    // force an EA refetch of the schedule to capture the new year.
    const seasonWeekType = seasonInfo?.seasonWeekType ?? 1; // 0=preseason, 1=regular
    const seasonIdx = seasonInfo?.seasonIndex ?? 1;
    const schedSeasons = (schedule?.schedules || []).map(g => Number(g.seasonIndex ?? g.seasonId ?? g.seasonYear ?? 0));
    const maxSchedSeason = schedSeasons.length ? Math.max(...schedSeasons) : -1;
    const hasWeek0Reg = (schedule?.schedules || []).some(g => Number(g.stageIndex ?? g.stage ?? 1) === 1 && Number(g.weekIndex ?? g.week ?? 0) === 0);
    const scheduleLooksStale = (!schedSeasons.length) || (maxSchedSeason < seasonIdx) || (!hasWeek0Reg && seasonWeekType <= 1);
    if (scheduleLooksStale && seasonWeekType <= 1) {
      schedule = { schedules: [] };
    }
    const weekBuckets = {
      preseason: [0, 1, 2, 3],
      season: Array.from({ length: 23 }, (_, i) => i).filter(i => i !== 21), // 0-22 skip 21 (Pro Bowl)
    };
    if (!schedule?.schedules?.length) {
      const allSchedules = [];
      const seen = new Set();
      const collectSchedule = async (wk, stg) => {
        try {
          const res = await client.getSchedules(Number(leagueId), stg, wk);
          const list = res?.gameScheduleInfoList || res?.schedules || [];
          for (const g of list) {
            const key = [
              g?.seasonIndex ?? g?.seasonId ?? seasonIdx ?? '',
              g?.stageIndex ?? g?.stage ?? stg,
              g?.weekIndex ?? wk,
              g?.scheduleId ?? `${g?.homeTeamId}-${g?.awayTeamId}`,
            ].join(':');
            if (seen.has(key)) continue;
            seen.add(key);
            allSchedules.push(g);
          }
        } catch (e) {
          console.warn(`[madden-sync] schedule fetch failed for week=${wk} stage=${stg}: ${e?.message || e}`);
        }
      };
      for (const wk of weekBuckets.preseason) await collectSchedule(wk, Stage.PRESEASON);
      for (const wk of weekBuckets.season) {
        await collectSchedule(wk, Stage.SEASON);
        // Playoffs can be exposed as a different stage; try stage 2 (and 0 as a fallback) for postseason weeks (19+)
        if (wk >= 19) {
          await collectSchedule(wk, 2);
          await collectSchedule(wk, Stage.PRESEASON); // some exports mark playoff games as stage 0
        }
      }
      schedule = { schedules: allSchedules };
    }

    // Fetch rosters (all teams + free agents)
    await emitProgress(options, 'Loading rosters', 'Fetching team rosters and free agents.');
    const rosters = {};
    const teamList = teams?.leagueTeamInfoList || [];
    await Promise.all(teamList.map(async (team, idx) => {
      try {
        const roster = await client.getTeamRoster(Number(leagueId), team.teamId, idx);
        rosters[team.teamId] = roster;
      } catch (e) {
        console.warn(`[madden-sync] roster fetch failed for teamId=${team?.teamId}: ${e?.message || e}`);
      }
    }));
    let freeAgents = [];
    try {
      freeAgents = await client.getFreeAgents(Number(leagueId));
    } catch (e) {
      console.warn('[madden-sync] free agents fetch failed:', e?.message || e);
    }

    // Fetch weekly stats for all weeks up to currentWeek (season) and preseason weeks 0-3
    await emitProgress(options, 'Loading weekly stats', 'Pulling weekly stat buckets and merging them into the current snapshot.');
    const weeklyStats = [];
    const maxSeasonWeek = Math.max(1, currentWeek ?? 1);
    const isWeekComplete = (entry) => {
      const buckets = [
        entry?.passing?.playerPassingStatInfoList,
        entry?.rushing?.playerRushingStatInfoList,
        entry?.receiving?.playerReceivingStatInfoList,
        entry?.defense?.playerDefensiveStatInfoList,
        entry?.kicking?.playerKickingStatInfoList,
      ];
      return buckets.some(b => Array.isArray(b) && b.length > 0);
    };
    const countPlayers = (entry) => {
      const buckets = [
        entry?.passing?.playerPassingStatInfoList,
        entry?.rushing?.playerRushingStatInfoList,
        entry?.receiving?.playerReceivingStatInfoList,
        entry?.defense?.playerDefensiveStatInfoList,
        entry?.kicking?.playerKickingStatInfoList,
      ];
      return buckets.reduce((acc, b) => acc + (Array.isArray(b) ? b.length : 0), 0);
    };

    const mergeWeekEntries = (a, b) => {
      if (!a) return b;
      if (!b) return a;
      const merged = { ...a, ...b };
      const mergeList = (key) => {
        const listA = (a[key] && a[key].playerPassingStatInfoList) || (a[key] && a[key].playerRushingStatInfoList) || (a[key] && a[key].playerReceivingStatInfoList) || (a[key] && a[key].playerDefensiveStatInfoList) || (a[key] && a[key].playerKickingStatInfoList) || [];
        const listB = (b[key] && b[key].playerPassingStatInfoList) || (b[key] && b[key].playerRushingStatInfoList) || (b[key] && b[key].playerReceivingStatInfoList) || (b[key] && b[key].playerDefensiveStatInfoList) || (b[key] && b[key].playerKickingStatInfoList) || [];
        const combined = [...listA, ...listB];
        // If both are empty, keep structure from b if present
        if (!combined.length) return b[key] ?? a[key];
        // Rebuild the container with combined list under the detected list name
        if (b[key]?.playerPassingStatInfoList || a[key]?.playerPassingStatInfoList) return { ...(b[key] || a[key]), playerPassingStatInfoList: combined };
        if (b[key]?.playerRushingStatInfoList || a[key]?.playerRushingStatInfoList) return { ...(b[key] || a[key]), playerRushingStatInfoList: combined };
        if (b[key]?.playerReceivingStatInfoList || a[key]?.playerReceivingStatInfoList) return { ...(b[key] || a[key]), playerReceivingStatInfoList: combined };
        if (b[key]?.playerDefensiveStatInfoList || a[key]?.playerDefensiveStatInfoList) return { ...(b[key] || a[key]), playerDefensiveStatInfoList: combined };
        if (b[key]?.playerKickingStatInfoList || a[key]?.playerKickingStatInfoList) return { ...(b[key] || a[key]), playerKickingStatInfoList: combined };
        return b[key] ?? a[key];
      };
      merged.passing = mergeList('passing');
      merged.rushing = mergeList('rushing');
      merged.receiving = mergeList('receiving');
      merged.defense = mergeList('defense');
      merged.kicking = mergeList('kicking');
      merged.teamstats = b.teamstats || a.teamstats;
      merged.isIncomplete = !isWeekComplete(merged);
      merged.playerCount = countPlayers(merged);
      return merged;
    };

    const collectedByKey = new Map();
    const collectWeek = async (wk, stg) => {
      const entry = { weekIndex: wk, stage: stg };
      try { entry.rushing = await client.getRushingStats(Number(leagueId), stg, wk); } catch (e) { entry.rushingError = e?.message || String(e); }
      try { entry.teamstats = await client.getTeamStats(Number(leagueId), stg, wk); } catch (e) { entry.teamstatsError = e?.message || String(e); }
      try { entry.punting = await client.getPuntingStats(Number(leagueId), stg, wk); } catch (e) { entry.puntingError = e?.message || String(e); }
      try { entry.receiving = await client.getReceivingStats(Number(leagueId), stg, wk); } catch (e) { entry.receivingError = e?.message || String(e); }
      try { entry.defense = await client.getDefensiveStats(Number(leagueId), stg, wk); } catch (e) { entry.defenseError = e?.message || String(e); }
      try { entry.kicking = await client.getKickingStats(Number(leagueId), stg, wk); } catch (e) { entry.kickingError = e?.message || String(e); }
      try { entry.passing = await client.getPassingStats(Number(leagueId), stg, wk); } catch (e) { entry.passingError = e?.message || String(e); }
      entry.isIncomplete = !isWeekComplete(entry);
      entry.playerCount = countPlayers(entry);
      const key = `${stg}-${wk}`;
      const prev = collectedByKey.get(key);
      const merged = mergeWeekEntries(prev, entry);
      collectedByKey.set(key, merged);
    };
    // Preseason weeks (0-3)
    for (let wk = 0; wk < 4; wk++) {
      await collectWeek(wk, Stage.PRESEASON);
    }
    // Regular season weeks up to currentWeek (inclusive, cap at 22 for playoffs)
    const maxWeekToFetch = Math.min(22, maxSeasonWeek);
    for (let wk = 0; wk <= maxWeekToFetch; wk++) {
      await collectWeek(wk, Stage.SEASON);
      // Also pull potential playoff stats that may be exposed as stage 2 or stage 0 (fallback)
      if (wk >= 19) {
        await collectWeek(wk, 2);
        await collectWeek(wk, Stage.PRESEASON);
      }
    }

    // Retry up to 2 additional times for weeks with zero players
    for (let attempt = 1; attempt <= 2; attempt++) {
      const missing = Array.from(collectedByKey.values()).filter(e => (e.playerCount ?? 0) === 0);
      if (!missing.length) break;
      for (const m of missing) {
        await collectWeek(m.weekIndex, m.stage);
      }
    }
    // Debug: log collected week counts
    try {
      const collectedSummary = Array.from(collectedByKey.values()).map(e => ({
        weekIndex: e.weekIndex,
        stage: e.stage,
        playerCount: e.playerCount ?? countPlayers(e),
      }));
      console.log('[sync] collected weeks summary', collectedSummary);
    } catch {}

    // If schedule fetch returned empty, fall back to previous snapshot schedule if available from file
    let finalSchedule = schedule;

    const hasStage1Week0Stats = Array.from(collectedByKey.values()).some((entry) =>
      Number(entry?.stage ?? entry?.stageIndex ?? -1) === Stage.SEASON &&
      Number(entry?.weekIndex ?? -1) === 0 &&
      Number(entry?.playerCount ?? countPlayers(entry) ?? 0) > 0
    );
    // If this looks like the first week of a new regular season, discard old weekly stats to avoid cross-season bleed
    if (
      (seasonInfo?.seasonWeekType === 1) &&
      (seasonInfo?.seasonWeek === 1 || currentWeek === 1) &&
      hasStage1Week0Stats &&
      !weekOverride
    ) {
      existingSnapshot = existingSnapshot || {};
      existingSnapshot.weeklyStats = [];
    }

    // Merge collected weeks with existing weekly stats, picking the richer entry per week/stage
    const mergedWeekly = (() => {
      const byKey = new Map();
      const addEntry = (e) => {
        if (!e) return;
        const key = `${e.stage}-${e.weekIndex}`;
        const prev = byKey.get(key);
        if (!prev) {
          byKey.set(key, e);
          return;
        }
        // prefer entry with more players; if tie, prefer the new one
        const prevCount = prev.playerCount ?? 0;
        const newCount = e.playerCount ?? countPlayers(e);
        if (newCount > prevCount) {
          byKey.set(key, e);
        }
      };

      // existing
      (existingSnapshot?.weeklyStats || []).forEach(w => {
        w.playerCount = w.playerCount ?? countPlayers(w);
        w.isIncomplete = w.isIncomplete ?? !isWeekComplete(w);
        addEntry(w);
      });
      // newly collected
      Array.from(collectedByKey.values()).forEach(addEntry);

      return Array.from(byKey.values()).map(w => {
        // update completeness flag using current data
        const complete = isWeekComplete(w);
        return {
          ...w,
          isIncomplete: !complete,
          playerCount: countPlayers(w),
          playerTotals: buildPlayerTotals(w),
        };
      }).sort((a, b) => (a.stage - b.stage) || (a.weekIndex - b.weekIndex));
    })();

    const seasonInfoFinal = info?.careerHubInfo?.seasonInfo || existingSnapshot?.info?.careerHubInfo?.seasonInfo || {};
    const syncedAt = new Date().toISOString();
    const snapshot = {
      syncId: randomUUID(),
      syncedAt,
      fetchedAt: new Date().toISOString(),
      leagueId,
      stage,
      currentWeek,
      info,
      teams,
      standings,
      schedule: finalSchedule,
      rosters: {
        teams: rosters,
        freeAgents,
      },
      weeklyStats: mergedWeekly,
    };
    snapshot.season = seasonInfoFinal.seasonNumber ?? seasonInfoFinal.seasonIndex ?? null;
    snapshot.week = currentWeek;
    const validation = validateFranchiseSnapshot(snapshot, leagueId);
    if (!validation.valid) {
      throw new Error(`Madden sync returned an invalid franchise snapshot: ${validation.issues.join(', ')}`);
    }
    if (isSoloModeEnabled() && (!validation.has32Teams || validation.rosterTeamCount !== 32)) {
      throw new Error(
        `Solo sync requires all 32 teams and rosters; received ${validation.teamCount} teams and ${validation.rosterTeamCount} team rosters.`,
      );
    }

    const incompleteWeeks = mergedWeekly.filter(w => w.isIncomplete || (w.playerCount ?? 0) === 0);
    const coverage = {
      teams: (teams?.leagueTeamInfoList?.length ?? 0) > 0,
      standings: (standings?.teamStandingInfoList?.length ?? 0) > 0,
      scheduleWeeks: new Set((finalSchedule?.schedules || []).map((game) => `${game.stageIndex ?? game.stage ?? ''}:${game.weekIndex ?? ''}`)).size,
      rosterTeams: Object.keys(rosters).length,
      freeAgents: Array.isArray(freeAgents?.rosterInfoList)
        ? freeAgents.rosterInfoList.length
        : Array.isArray(freeAgents)
          ? freeAgents.length
          : 0,
      weeklyStatBuckets: mergedWeekly.length,
      missingBuckets: incompleteWeeks.map(w => ({
        stage: w.stage ?? w.stageIndex ?? 0,
        weekIndex: w.weekIndex,
        playerCount: w.playerCount ?? 0,
      })),
    };
    snapshot.syncCoverage = coverage;

    await emitProgress(options, 'Saving snapshot', 'Writing the updated league snapshot to disk.');
    const prevPath = path.join(prevDir, `${leagueId}.json`);
    // Save previous snapshot for diffing (transactions, etc.)
    try {
      const existing = await fs.readFile(outPath, 'utf-8');
      await fs.writeFile(prevPath, existing, 'utf-8');
    } catch { /* no previous snapshot */ }
    const temporarySnapshotPath = `${outPath}.${process.pid}.${snapshot.syncId}.tmp`;
    await fs.writeFile(temporarySnapshotPath, JSON.stringify(snapshot, null, 2), 'utf-8');
    await fs.rename(temporarySnapshotPath, outPath);

    // Cleanup: keep only snapshots for this league to avoid accumulating old leagues.
    try {
      const files = await fs.readdir(snapshotsDir);
      await Promise.all(files.map(async f => {
        if (!f.endsWith('.json')) return;
        if (f === `${leagueId}.json`) return;
        try {
          await fs.unlink(path.join(snapshotsDir, f));
        } catch {}
      }));
    } catch (e) {
      console.warn('[madden-sync] cleanup skipped:', e?.message || e);
    }

    const summary = {
      leagueId,
      syncId: snapshot.syncId,
      syncedAt,
      currentWeek,
      stage,
      teamsCount: teams?.leagueTeamInfoList?.length ?? 0,
      standingsCount: standings?.teamStandingInfoList?.length ?? 0,
      gamesCount: finalSchedule?.schedules?.length ?? 0,
      rosterCount: Object.keys(rosters).length,
      hasFreeAgents: coverage.freeAgents > 0,
      statsWeeks: mergedWeekly?.length ?? 0,
      missingWeeks: coverage.missingBuckets,
      coverage,
      outPath,
      offSeasonStage: seasonInfoFinal.offSeasonStage ?? 0,
    };
    const duplicate = await persistSyncHistory({
      leagueId,
      requestId: options.requestId,
      snapshot,
      summary,
    });
    const result = duplicate || { ...summary, validation };
    if (!duplicate && isSoloModeEnabled() && options.requestId && options.client && options.guildId) {
      try {
        const { publishSoloSyncReports } = await import('./solo_reports.js');
        const archivedSnapshot = await loadSyncSnapshot(leagueId, snapshot.syncId);
        result.soloReports = await publishSoloSyncReports({
          client: options.client,
          guildId: options.guildId,
          snapshot: archivedSnapshot,
        });
      } catch (error) {
        result.soloReports = { published: false, error: error?.message || String(error) };
        console.error('[solo-reports] failed to publish sync reports', error);
      }
    }
    if (!duplicate && isSoloModeEnabled() && options.requestId && options.client && options.guildId) {
      try {
        const { publishProgressionReports } = await import('./progression.js');
        const archivedSnapshot = await loadSyncSnapshot(leagueId, snapshot.syncId);
        result.progression = await publishProgressionReports({
          client: options.client,
          guildId: options.guildId,
          snapshot: archivedSnapshot,
        });
      } catch (error) {
        result.progression = { published: false, error: error?.message || String(error) };
        console.error('[progression] failed to publish sync recommendations', error);
      }
      try {
        result.dataImportSummary = await postDataImportSummary(options.client, options.guildId, summary);
      } catch (error) {
        result.dataImportSummary = { posted: false, error: error?.message || String(error) };
        console.error('[madden-sync] failed to post data import summary', error);
      }
    }
    if (!duplicate && options.client && options.guildId) {
      try {
        const { isDraftReadyForGrades, maybePostDraftGrades } = await import('./draft_grades_auto.js');
        result.draftGrades = isDraftReadyForGrades(snapshot)
          ? await maybePostDraftGrades(options.client, leagueId, options.guildId)
          : { posted: false, reason: 'No completed draft rookies are present in team rosters.' };
      } catch (error) {
        result.draftGrades = { posted: false, error: error?.message || String(error) };
        console.error('[draft-grades-auto] sync-triggered grade check failed', error);
      }
    }
    if (!duplicate && isSoloModeEnabled() && options.requestId && options.client && options.guildId) {
      try {
        const { publishWeeklyMockDraft } = await import('./weekly_mock_draft.js');
        result.weeklyMockDraft = await publishWeeklyMockDraft({
          client: options.client,
          guildId: options.guildId,
          snapshot,
          previousSnapshot: existingSnapshot,
        });
      } catch (error) {
        result.weeklyMockDraft = { posted: false, error: error?.message || String(error) };
        console.error('[weekly-mock-draft] failed to publish', error);
      }
    }
    return result;
  } catch (err) {
    console.error('❌ Madden sync failed:', err);
    const msg = err?.message || String(err);
    const lower = msg.toLowerCase();
    if (lower.includes('no local ea tokens') ||
        lower.includes('please re-auth') ||
        lower.includes('invalid_grant') ||
        lower.includes('token')) {
      await notify('Madden EA reconnect needed', `${msg}\nRun /setup and reconnect EA, then rerun the command.`);
    }
    throw err;
  }
}

export async function runSync(leagueId, provider, options = {}) {
  const requestId = options.requestId ? `${String(options.guildId || '')}:${String(options.requestId)}` : null;
  if (!requestId) return runSyncInternal(leagueId, provider, options);
  const existing = activeSyncRequests.get(requestId);
  if (existing) return existing;

  const pending = runSyncInternal(leagueId, provider, options);
  activeSyncRequests.set(requestId, pending);
  try {
    return await pending;
  } finally {
    if (activeSyncRequests.get(requestId) === pending) activeSyncRequests.delete(requestId);
  }
}

async function execute(interaction) {
  const leagueId = resolveLeagueIdWithConfig(interaction.guildId);
  await interaction.deferReply({ ephemeral: true });

  const renderProgressEmbed = (phase, detail) => new EmbedBuilder()
    .setTitle('League Sync')
    .setColor(0x5865f2)
    .setDescription(`**${phase}**\n${detail}`);

  try {
    if (!leagueId) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('Madden Sync')
            .setDescription('No league is connected to this server yet. Run `/setup` and press Open Setup Dashboard.')
            .setColor(0xffcc00)
        ]
      });
      return;
    }
    const provider = useSnallabot ? new SnallabotProvider() : null;
    await interaction.editReply({ embeds: [renderProgressEmbed('Preparing sync', 'Starting the league sync for this server.')] });
    const summary = await runSync(leagueId, provider, {
      guildId: interaction.guildId,
      requestId: interaction.id,
      client: interaction.client,
      notifyChannelId: '1460287771838255350',
      onProgress: async (phase, detail) => {
        await interaction.editReply({ embeds: [renderProgressEmbed(phase, detail)] });
      },
    });
    const weekLabel = summary.currentWeek === null || summary.currentWeek === undefined
      ? 'unknown'
      : getMessageForWeek(summary.currentWeek);
    const soloReportStatus = summary.soloReports
      ? summary.soloReports.playerOverallsPosted
        ? `Player rankings posted${summary.soloReports.teamOverallsPosted ? '; team ratings updated' : ''}`
        : summary.soloReports.error || summary.soloReports.errorMessage || 'Reports were not posted'
      : null;
    const weeklyMockStatus = summary.weeklyMockDraft
      ? summary.weeklyMockDraft.posted
        ? `Posted for week ${summary.weeklyMockDraft.weekNumber}`
        : summary.weeklyMockDraft.reason || summary.weeklyMockDraft.error || 'Not posted'
      : null;
    const progressionStatus = summary.progression
      ? summary.progression.published
        ? `${summary.progression.recommendationCount} recommendation(s) posted to team threads`
        : summary.progression.error || summary.progression.reason || 'No recommendations met evidence thresholds'
      : null;
    const draftGradesStatus = summary.draftGrades
      ? summary.draftGrades.posted
        ? 'Draft grades posted in Draft Results'
        : summary.draftGrades.error || summary.draftGrades.reason || 'Draft grades were not posted'
      : null;
    const importSummaryStatus = summary.dataImportSummary
      ? summary.dataImportSummary.posted
        ? 'Posted in Data Imports'
        : summary.dataImportSummary.error || summary.dataImportSummary.reason || 'Not posted'
      : null;
    const embed = new EmbedBuilder()
      .setTitle('Madden Sync')
      .setColor(0x00cc66)
      .addFields(
        { name: 'League', value: String(summary.leagueId), inline: true },
        { name: 'Week', value: weekLabel, inline: true },
        { name: 'Teams', value: String(summary.teamsCount), inline: true },
        { name: 'Standings', value: String(summary.standingsCount), inline: true },
        { name: 'Games', value: String(summary.gamesCount), inline: true },
        { name: 'Rosters', value: `${summary.rosterCount} teams${summary.hasFreeAgents ? ' + FA' : ''}`, inline: true },
        { name: 'Stats Weeks', value: String(summary.statsWeeks), inline: true },
        { name: 'Coverage', value: `Schedule weeks: ${summary.coverage?.scheduleWeeks ?? 0}\nMissing stat buckets: ${summary.coverage?.missingBuckets?.length ?? 0}`, inline: true },
        ...(soloReportStatus ? [{ name: 'Solo reports', value: soloReportStatus, inline: false }] : []),
        ...(draftGradesStatus ? [{ name: 'Draft grades', value: draftGradesStatus, inline: false }] : []),
        ...(progressionStatus ? [{ name: 'Player progression', value: progressionStatus, inline: false }] : []),
        ...(importSummaryStatus ? [{ name: 'Data import summary', value: importSummaryStatus, inline: false }] : []),
        ...(weeklyMockStatus ? [{ name: 'Weekly mock draft', value: weeklyMockStatus, inline: false }] : []),
        { name: 'Saved', value: summary.outPath, inline: false },
        { name: 'Next', value: 'Return to `/setup` and press Check Again.', inline: false }
      );

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    const msg = typeof err?.message === 'string' ? err.message : 'Unknown error';
    const lower = msg.toLowerCase();
    let guidance = 'Try again shortly.';
    if (lower.includes('no local ea tokens')) {
      guidance = 'Run `/setup` and reconnect EA, then rerun the sync.';
    } else if (lower.includes('no sessionkey') || lower.includes('auth_err_invalid_token') || lower.includes('server information was not found')) {
      guidance = 'The saved EA session looks stale. Return to `/setup` and reconnect EA, then rerun the sync.';
    } else if (lower.includes('deleted') || lower.includes('league')) {
      guidance = 'Reconnect the league from `/setup`, then rerun the sync.';
    }
    const shortMsg = msg.length > 3000 ? `${msg.slice(0, 2997)}...` : msg;
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Madden Sync Failed')
          .setDescription(`${shortMsg}\n(See server logs for full details)`)
          .addFields({ name: 'Next steps', value: guidance })
          .setColor(0xcc0000)
      ]
    });
  }
}

export default { data, execute };
