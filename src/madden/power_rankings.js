import fs from 'fs';
import path from 'path';
import { EmbedBuilder } from 'discord.js';
import { getFullTeamName } from '../shared/madden_team_names.js';
import { loadMaddenChannelMap } from '../shared/madden_metadata.js';
import { getMaddenDataFilePath, getMaddenLeagueSnapshotPath } from '../leaguebuddy/paths.js';
import { renderLeagueBoardImage } from '../shared/madden_board_renderer.js';
import { getLeagueBuddyLogoEmoji } from '../shared/application_emojis.js';
import { ensureBoardPinMessage } from './board_pin_utils.js';
import { getMessageForWeek } from './madden_utils.js';

const RANKS_FILE = getMaddenDataFilePath('power_ranks.json');
function loadSnapshot(leagueId) {
  const file = getMaddenLeagueSnapshotPath(leagueId);
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

function loadJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function loadChannelMap(guildId = null) {
  return loadMaddenChannelMap(guildId);
}

function teamNameMap(snapshot) {
  const map = {};
  const list = snapshot?.teams?.leagueTeamInfoList || [];
  list.forEach(t => {
    if (!t.teamId) return;
    const name = getFullTeamName(t, `Team ${t.teamId}`);
    map[t.teamId] = name || `Team ${t.teamId}`;
  });
  return map;
}

function formatRecord(s) {
  const w = s?.totalWins ?? 0;
  const l = s?.totalLosses ?? 0;
  const t = s?.totalTies ?? 0;
  return t ? `${w}-${l}-${t}` : `${w}-${l}`;
}

function completedRegularGames(snapshot) {
  return (snapshot?.schedule?.schedules || []).filter((game) => {
    const stage = Number(game?.stageIndex ?? game?.stage ?? -1);
    const status = Number(game?.status ?? 0);
    const awayScore = Number(game?.awayScore ?? 0);
    const homeScore = Number(game?.homeScore ?? 0);
    return stage === 1 && (status >= 2 || awayScore > 0 || homeScore > 0);
  });
}

function average(values = []) {
  const nums = values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (!nums.length) return 0;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function clamp(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.min(max, num));
}

function perGame(total, games) {
  return Number(total || 0) / Math.max(1, Number(games || 0));
}

function scheduleMetricsMap(snapshot) {
  const games = completedRegularGames(snapshot)
    .sort((a, b) => Number(a.weekIndex ?? 0) - Number(b.weekIndex ?? 0));
  const metrics = new Map();
  const ensure = (teamId) => {
    if (!metrics.has(teamId)) {
      metrics.set(teamId, {
        games: 0,
        wins: 0,
        losses: 0,
        margin: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        results: [],
      });
    }
    return metrics.get(teamId);
  };
  for (const game of games) {
    const homeTeamId = Number(game.homeTeamId);
    const awayTeamId = Number(game.awayTeamId);
    const homeScore = Number(game.homeScore || 0);
    const awayScore = Number(game.awayScore || 0);
    const home = ensure(homeTeamId);
    const away = ensure(awayTeamId);
    home.games += 1;
    away.games += 1;
    home.pointsFor += homeScore;
    home.pointsAgainst += awayScore;
    away.pointsFor += awayScore;
    away.pointsAgainst += homeScore;
    const homeMargin = homeScore - awayScore;
    const awayMargin = awayScore - homeScore;
    home.margin += homeMargin;
    away.margin += awayMargin;
    if (homeScore > awayScore) {
      home.wins += 1;
      away.losses += 1;
      home.results.push({ won: true, margin: homeMargin, pointsFor: homeScore, pointsAgainst: awayScore });
      away.results.push({ won: false, margin: awayMargin, pointsFor: awayScore, pointsAgainst: homeScore });
    } else if (awayScore > homeScore) {
      away.wins += 1;
      home.losses += 1;
      away.results.push({ won: true, margin: awayMargin, pointsFor: awayScore, pointsAgainst: homeScore });
      home.results.push({ won: false, margin: homeMargin, pointsFor: homeScore, pointsAgainst: awayScore });
    } else {
      home.results.push({ won: false, margin: homeMargin, pointsFor: homeScore, pointsAgainst: awayScore });
      away.results.push({ won: false, margin: awayMargin, pointsFor: awayScore, pointsAgainst: homeScore });
    }
  }
  for (const value of metrics.values()) {
    const recent = value.results.slice(-3);
    let streak = 0;
    for (let i = value.results.length - 1; i >= 0; i -= 1) {
      if (!value.results[i]?.won) break;
      streak += 1;
    }
    value.avgMargin = perGame(value.margin, value.games);
    value.avgPointsFor = perGame(value.pointsFor, value.games);
    value.avgPointsAgainst = perGame(value.pointsAgainst, value.games);
    value.recentWins = recent.filter((game) => game.won).length;
    value.recentMargin = average(recent.map((game) => game.margin));
    value.recentPointsFor = average(recent.map((game) => game.pointsFor));
    value.recentPointsAgainst = average(recent.map((game) => game.pointsAgainst));
    value.streak = streak;
    value.blowoutWins = value.results.filter((game) => game.margin >= 14).length;
    value.blowoutLosses = value.results.filter((game) => game.margin <= -14).length;
  }
  return metrics;
}

function statMetricsMap(snapshot) {
  const metrics = new Map();
  const ensure = (teamId) => {
    if (!metrics.has(teamId)) {
      metrics.set(teamId, {
        statWeeks: new Set(),
        passYds: 0,
        passTDs: 0,
        passInts: 0,
        passAtt: 0,
        passComp: 0,
        rushYds: 0,
        rushTDs: 0,
        defSacks: 0,
        defInts: 0,
        defTfl: 0,
        defForcedFumbles: 0,
      });
    }
    return metrics.get(teamId);
  };
  for (const week of snapshot?.weeklyStats || []) {
    if (Number(week?.stage ?? week?.stageIndex ?? -1) !== 1) continue;
    const weekIndex = Number(week.weekIndex ?? -1);
    for (const player of week?.passing?.playerPassingStatInfoList || []) {
      const teamId = Number(player.teamId);
      if (!Number.isFinite(teamId)) continue;
      const row = ensure(teamId);
      row.statWeeks.add(weekIndex);
      row.passYds += Number(player.passYds || 0);
      row.passTDs += Number(player.passTDs || 0);
      row.passInts += Number(player.passInts || 0);
      row.passAtt += Number(player.passAtt || 0);
      row.passComp += Number(player.passComp || 0);
    }
    for (const player of week?.rushing?.playerRushingStatInfoList || []) {
      const teamId = Number(player.teamId);
      if (!Number.isFinite(teamId)) continue;
      const row = ensure(teamId);
      row.statWeeks.add(weekIndex);
      row.rushYds += Number(player.rushYds || 0);
      row.rushTDs += Number(player.rushTDs || 0);
    }
    for (const player of week?.defense?.playerDefensiveStatInfoList || []) {
      const teamId = Number(player.teamId);
      if (!Number.isFinite(teamId)) continue;
      const row = ensure(teamId);
      row.statWeeks.add(weekIndex);
      row.defSacks += Number(player.defSacks || 0);
      row.defInts += Number(player.defInts || 0);
      row.defTfl += Number(player.defTacklesForLoss || 0);
      row.defForcedFumbles += Number(player.defForcedFumbles || 0);
    }
  }
  for (const row of metrics.values()) {
    row.games = Math.max(1, row.statWeeks.size);
    row.qbTdInt = row.passTDs - row.passInts;
    row.qbYpa = Number(row.passAtt || 0) > 0 ? row.passYds / row.passAtt : 0;
    row.qbCompPct = Number(row.passAtt || 0) > 0 ? row.passComp / row.passAtt : 0;
    row.defSplash = row.defSacks + row.defInts + row.defForcedFumbles + (row.defTfl * 0.4);
    delete row.statWeeks;
  }
  return metrics;
}

function rankReasonText({ schedule = {}, stats = {}, standing = {} }) {
  const reasons = [];
  const avgMargin = Number(schedule.avgMargin || 0);
  if (Math.abs(avgMargin) >= 0.5) reasons.push(`${avgMargin >= 0 ? '+' : ''}${avgMargin.toFixed(1)} MOV`);
  if (Number(stats.qbTdInt || 0) !== 0) reasons.push(`QB ${stats.qbTdInt >= 0 ? '+' : ''}${stats.qbTdInt}`);
  if (Number(stats.defSplash || 0) > 0) reasons.push(`Def ${Number(stats.defSplash).toFixed(1)}`);
  if (Number(schedule.streak || 0) >= 2) reasons.push(`W${schedule.streak}`);
  if (Number(schedule.recentWins || 0) >= 2) reasons.push(`${schedule.recentWins}-0/3`);
  if (!reasons.length && Number(standing.netPts || 0)) reasons.push(`Net ${Number(standing.netPts) >= 0 ? '+' : ''}${Number(standing.netPts)}`);
  return reasons.slice(0, 3).join(' • ');
}

function rankTeams(snapshot) {
  const standings = snapshot?.standings?.teamStandingInfoList || [];
  const allZero = standings.every(s => (s.totalWins ?? 0) === 0 && (s.totalLosses ?? 0) === 0 && (s.totalTies ?? 0) === 0);
  if (!standings.length || allZero) return [];
  const scheduleMetrics = scheduleMetricsMap(snapshot);
  const statMetrics = statMetricsMap(snapshot);
  const scored = [...standings].map((team) => {
    const teamId = Number(team.teamId);
    const wins = Number(team.totalWins || 0);
    const losses = Number(team.totalLosses || 0);
    const ties = Number(team.totalTies || 0);
    const schedule = scheduleMetrics.get(teamId) || {};
    const stats = statMetrics.get(teamId) || {};
    const gamesPlayed = Math.max(1, schedule.games || wins + losses + ties);
    const winPct = Number(team.winPct ?? (wins / gamesPlayed) ?? 0);
    const netPts = Number(team.netPts || schedule.margin || 0);
    const offTotalYds = Number(team.offTotalYds || (stats.passYds || 0) + (stats.rushYds || 0));
    const ptsFor = Number(team.ptsFor || schedule.pointsFor || 0);
    const ptsAgainst = Number(team.ptsAgainst || schedule.pointsAgainst || 0);
    const pointsPerGame = schedule.games ? Number(schedule.avgPointsFor || 0) : perGame(ptsFor, gamesPlayed);
    const pointsAllowedPerGame = schedule.games ? Number(schedule.avgPointsAgainst || 0) : perGame(ptsAgainst, gamesPlayed);
    const recordScore = clamp((winPct * 28) + (wins * 0.9) - (losses * 0.45), 0, 34);
    const marginScore = clamp((Number(schedule.avgMargin || 0) * 1.35) + (netPts / Math.max(1, gamesPlayed) * 0.7), -16, 22);
    const recentScore = clamp((Number(schedule.recentWins || 0) * 4.2) + (Number(schedule.recentMargin || 0) * 0.65) + (Number(schedule.streak || 0) * 1.6), -13, 18);
    const offenseScore = clamp(((pointsPerGame - 21) * 0.65) + (perGame(offTotalYds, gamesPlayed) - 325) * 0.025, -10, 14);
    const qbScore = clamp(
      (Number(stats.qbTdInt || 0) * 1.8) +
      ((Number(stats.qbYpa || 0) - 7.0) * 3.2) +
      ((Number(stats.qbCompPct || 0) - 0.62) * 18),
      -12,
      16,
    );
    const defenseScore = clamp(((21 - pointsAllowedPerGame) * 0.75) + (Number(stats.defSplash || 0) * 0.75) - (Number(schedule.blowoutLosses || 0) * 2.5), -12, 17);
    const blowoutScore = clamp((Number(schedule.blowoutWins || 0) * 2.2) - (Number(schedule.blowoutLosses || 0) * 2.8), -8, 8);
    const score =
      recordScore +
      marginScore +
      recentScore +
      offenseScore +
      qbScore +
      defenseScore +
      blowoutScore;
    return {
      ...team,
      _powerScore: score,
      _powerMeta: rankReasonText({ schedule, stats, standing: team }),
      _powerComponents: {
        recordScore,
        marginScore,
        recentScore,
        offenseScore,
        qbScore,
        defenseScore,
        blowoutScore,
      },
    };
  });
  const sorted = scored.sort((a, b) =>
    (b._powerScore ?? 0) - (a._powerScore ?? 0) ||
    Number(b.netPts ?? 0) - Number(a.netPts ?? 0) ||
    Number(b.winPct ?? 0) - Number(a.winPct ?? 0) ||
    (b.totalWins ?? 0) - (a.totalWins ?? 0)
  );
  return sorted.slice(0, 10);
}

function loadPrevRanks() {
  try {
    return JSON.parse(fs.readFileSync(RANKS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveRanks(map) {
  fs.mkdirSync(path.dirname(RANKS_FILE), { recursive: true });
  fs.writeFileSync(RANKS_FILE, JSON.stringify(map, null, 2));
}

export async function updatePowerRankings(client, leagueId, guildId = null) {
  const resolvedGuildId = guildId || client?.guilds?.cache?.first?.()?.id || null;
  const snapshot = loadSnapshot(leagueId);
  const seasonInfo = snapshot?.info?.careerHubInfo?.seasonInfo || {};
  const displayWeek = seasonInfo.displayWeek ?? seasonInfo.seasonWeek ?? 0;
  const weekLabel = getMessageForWeek(displayWeek || 0, seasonInfo.seasonWeekType, seasonInfo.offSeasonStage || 0);
  const hasSeasonData = (snapshot?.weeklyStats || []).some(w => Number(w.weekIndex ?? -1) >= 0) ||
    (snapshot?.standings?.teamStandingInfoList || []).length > 0;
  const inPreseason = displayWeek <= 0 && !hasSeasonData;
  if (inPreseason) {
    // Preseason: keep the placeholder message instead of updating rankings
    await resetPowerRankings(client, resolvedGuildId);
    return;
  }
  const teams = teamNameMap(snapshot);
  const ranked = rankTeams(snapshot);
  const prevMap = loadPrevRanks();
  const prev = prevMap[leagueId] || {};
  const hadPreviousRanks = Object.keys(prev).length > 0;
  const fields = [];
  let lines = [];
  const newEntrants = [];
  if (ranked.length === 0) {
    lines = Array.from({ length: 10 }, (_, i) => `${i + 1}) N/A`);
    // reset previous ranks for a fresh season
    prevMap[leagueId] = {};
    saveRanks(prevMap);
  } else {
    lines = ranked.map((s, idx) => {
      const name = teams[s.teamId] || 'Team';
      const rec = formatRecord(s);
      const currentRank = idx + 1;
      const prevRank = prev[s.teamId];
      let move = '(=)';
      if (prevRank === undefined || prevRank > 10) {
        move = '(new)';
        if (hadPreviousRanks) {
          newEntrants.push({ name });
        }
      } else {
        const diff = prevRank - currentRank;
        if (diff > 0) move = `(+${diff})`;
        else if (diff < 0) move = `(${diff})`;
      }
      const meta = s._powerMeta ? ` • ${s._powerMeta}` : '';
      return `${currentRank}) ${name} — ${rec} ${move}${meta}`;
    });
    while (lines.length < 10) lines.push(`${lines.length + 1}) N/A`);
    // Save current ranks for next comparison
    const nextMap = { ...prevMap, [leagueId]: Object.fromEntries(ranked.map((s, idx) => [s.teamId, idx + 1])) };
    saveRanks(nextMap);
  }
  fields.push({ name: 'Top 10', value: lines.join('\n'), inline: false });

  const channelMap = loadChannelMap(resolvedGuildId);
  const channelId = channelMap['Power Rankings'];
  if (!channelId) throw new Error('Power Rankings channel not configured');
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) throw new Error('Power Rankings channel not accessible');

  const boardImage = await renderLeagueBoardImage({
    title: 'Power Rankings',
    subtitle: `Season ${seasonInfo.seasonNumber ?? seasonInfo.seasonIndex ?? 'Current'} • ${weekLabel}`,
    attachmentName: 'power_rankings_board.png',
    accentColor: '#FFCC00',
    columns: [
      {
        title: 'Top 10',
        items: lines.map((line) => {
          const match = String(line).match(/^(\d+)\)\s(.+?)\s—\s(.+)$/);
          if (!match) return { label: line, meta: '', teamLike: null };
          return {
            label: `#${match[1]} ${match[2]}`,
            meta: match[3],
            teamLike: match[2],
          };
        }),
      },
    ],
  });
  const embed = new EmbedBuilder()
    .setTitle(`${getLeagueBuddyLogoEmoji() ? `${getLeagueBuddyLogoEmoji()} ` : ''}Madden Power Rankings`)
    .setColor(0xffcc00)
    .setTimestamp(new Date());
  if (boardImage) embed.setImage(`attachment://${boardImage.name}`);

  await ensureBoardPinMessage(channel, {
    pinKey: 'power_rankings',
    guildId: resolvedGuildId,
    matchTitle: 'Madden Power Rankings',
    payload: { embeds: [embed], files: boardImage ? [boardImage] : [], content: null },
  });

  // Tag new entrants separately
  if (newEntrants.length && channel?.isTextBased()) {
    console.log('[power_rankings] new entries detected:', newEntrants.map(e => e.name));
    const lines = newEntrants.map(e => {
      return `${e.name || 'Team'} has entered the Top 10!`;
    });
    const announce = {
      title: `${getLeagueBuddyLogoEmoji() ? `${getLeagueBuddyLogoEmoji()} ` : ''}New Teams in the Power Rankings`,
      description: lines.join('\n'),
      color: 0xffcc00,
      timestamp: new Date().toISOString(),
    };
    await channel.send({
      embeds: [announce],
      allowedMentions: { parse: [] },
    }).catch(() => null);
  }
}

export async function resetPowerRankings(client, guildId = null) {
  const resolvedGuildId = guildId || client?.guilds?.cache?.first?.()?.id || null;
  const channelMap = loadChannelMap(resolvedGuildId);
  const channelId = channelMap['Power Rankings'];
  if (!channelId) throw new Error('Power Rankings channel not configured');
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) throw new Error('Power Rankings channel not accessible');

  const embed = {
    title: 'Madden Power Rankings',
    description: 'Preseason — rankings will appear once the regular season starts.',
    color: 0xffcc00,
    timestamp: new Date().toISOString(),
  };

  await ensureBoardPinMessage(channel, {
    pinKey: 'power_rankings',
    guildId: resolvedGuildId,
    matchTitle: 'Madden Power Rankings',
    payload: { embeds: [embed], content: null },
  });
}

export default { updatePowerRankings };
