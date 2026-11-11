import fs from 'fs';
import path from 'path';
import { createHash } from 'node:crypto';
import { EmbedBuilder } from 'discord.js';
import { loadLeagueSnapshot } from './madden_data.js';
import { getFullTeamName } from '../shared/madden_team_names.js';
import { deriveTeamNeeds } from './coach/mockdraft.js';
import { loadMaddenChannelMap } from '../shared/madden_metadata.js';
import { getGuildRoleMap } from '../shared/madden_guild_config.js';
import { getTeamEmojiByName } from '../shared/madden_visuals.js';
import { getLeagueBuddyLogoEmoji } from '../shared/application_emojis.js';
import { getMaddenDraftYear } from '../shared/madden_draft_class.js';
import { getMaddenDataFilePath } from '../leaguebuddy/paths.js';
import { isSoloModeEnabled } from '../leaguebuddy/solo_mode.js';

const STATE_FILE = getMaddenDataFilePath(path.join('draft_exports', 'posted_draft_grades.json'));
const DRAFT_GRADES_FORMULA_VERSION = 2;

function loadJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function teamEmoji(name) {
  return getTeamEmojiByName(name);
}

function normalizeName(name = '') {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function mapPositionToNeed(posRaw = '') {
  const pos = String(posRaw || '').toUpperCase();
  if (pos === 'QB') return 'QB';
  if (['HB', 'RB', 'FB', 'TB'].includes(pos)) return 'RB';
  if (['LT', 'RT'].includes(pos)) return 'OT';
  if (['LG', 'C', 'RG'].includes(pos)) return 'IOL';
  if (pos === 'WR') return 'WR';
  if (pos === 'TE') return 'TE';
  if (['LE', 'RE', 'DE', 'EDGE', 'EDG', 'LEDG', 'REDG', 'LDE', 'RDE'].includes(pos)) return 'EDGE';
  if (['DT', 'NT'].includes(pos)) return 'DT';
  if (['MLB', 'ILB', 'LB', 'SAM', 'MIKE', 'WILL', 'ROLB', 'LOLB', 'OLB'].includes(pos)) return 'LB';
  if (pos === 'CB') return 'CB';
  if (['FS', 'SS'].includes(pos)) return 'S';
  return 'BPA';
}

function resolveTeamNeedsForDraftGrades(teamName, needsByTeam = {}) {
  const normalized = normalizeName(teamName);
  if (needsByTeam[normalized]) return needsByTeam[normalized];
  const hit = Object.entries(needsByTeam).find(([key]) => key === normalized || key.includes(normalized) || normalized.includes(key));
  return hit?.[1] || ['BPA'];
}

function isDraftRookie(player) {
  if (player?.isRookie === true) return true;
  if (player?.yearsPro !== undefined && player?.yearsPro !== null) {
    return Number(player.yearsPro) === 0;
  }
  return false;
}

function countDraftedRookies(snapshot) {
  return Object.values(snapshot?.rosters?.teams || {})
    .flatMap((team) => team?.rosterInfoList || team?.rosterPlayerInfoList || [])
    .filter(isDraftRookie)
    .length;
}

export function getDraftClassStateKey(snapshot) {
  const rookieKeys = Object.values(snapshot?.rosters?.teams || {})
    .flatMap((team) => team?.rosterInfoList || team?.rosterPlayerInfoList || [])
    .filter(isDraftRookie)
    .map((player) => {
      if (player?.rosterId !== undefined && player?.rosterId !== null) {
        return `roster:${player.rosterId}`;
      }
      const name = normalizeName(player?.fullName || `${player?.firstName || ''} ${player?.lastName || ''}`);
      const position = String(player?.position || '').toUpperCase();
      const birthYear = player?.birthYear ?? '';
      return name ? `player:${name}:${position}:${birthYear}` : null;
    })
    .filter(Boolean)
    .sort();
  if (!rookieKeys.length) return null;
  const fingerprint = createHash('sha256').update(rookieKeys.join('|')).digest('hex').slice(0, 16);
  return `draft_${getMaddenDraftYear(snapshot)}_${fingerprint}`;
}

export function isDraftReadyForGrades(snapshot) {
  return countDraftedRookies(snapshot) > 0;
}

export function computeDraftGrades(snapshot) {
  const teams = snapshot?.teams?.leagueTeamInfoList || [];
  const rosters = snapshot?.rosters?.teams || {};
  const needsByTeam = deriveTeamNeeds(snapshot);
  const rawGrades = [];
  const devScore = (dev) => {
    switch (Number(dev)) {
      case 3: return 12;
      case 2: return 9;
      case 1: return 6;
      default: return 0;
    }
  };
  teams.forEach(t => {
    const teamName = getFullTeamName(t, `Team ${t.teamId}`);
    const roster = rosters[t.teamId]?.rosterInfoList || rosters[t.teamId]?.rosterPlayerInfoList || [];
    const rookies = roster.filter(isDraftRookie);
    if (!rookies.length) return;
    const teamNeeds = resolveTeamNeedsForDraftGrades(teamName, needsByTeam);
    const avgOvr = rookies.reduce((s, p) => s + Number(p.playerBestOvr || 0), 0) / rookies.length;
    const topOvr = Math.max(...rookies.map(p => Number(p.playerBestOvr || 0)));
    const topThreeAvg = rookies
      .map((p) => Number(p.playerBestOvr || 0))
      .sort((a, b) => b - a)
      .slice(0, 3)
      .reduce((sum, value, _, list) => sum + value / Math.max(1, list.length), 0);
    const devAvg = rookies.reduce((s, p) => s + devScore(p.devTrait), 0) / rookies.length;
    const starCount = rookies.filter((p) => Number(p.devTrait || 0) >= 1).length;
    const superstarCount = rookies.filter((p) => Number(p.devTrait || 0) >= 2).length;
    const xFactorCount = rookies.filter((p) => Number(p.devTrait || 0) >= 3).length;
    const premiumCount = rookies.filter((p) => ['QB', 'LT', 'RT', 'WR', 'TE', 'CB', 'LEDG', 'REDG', 'LE', 'RE', 'EDGE', 'DT'].includes(String(p.position || '').toUpperCase())).length;
    const needFitScore = rookies.reduce((sum, player) => {
      const need = mapPositionToNeed(player.position);
      const needIndex = teamNeeds.indexOf(need);
      if (needIndex < 0) return sum;
      const priorityWeight = needIndex === 0 ? 7 : needIndex === 1 ? 5 : needIndex === 2 ? 3.5 : needIndex === 3 ? 2 : 1;
      const talentWeight =
        Math.max(0, Number(player.playerBestOvr || 0) - 68) * 0.18 +
        (Number(player.devTrait || 0) >= 1 ? 1.4 : 0) +
        (Number(player.devTrait || 0) >= 2 ? 1.2 : 0) +
        (Number(player.devTrait || 0) >= 3 ? 1.4 : 0);
      return sum + priorityWeight + talentWeight;
    }, 0);
    const topNeedHits = rookies.filter((player) => mapPositionToNeed(player.position) === teamNeeds[0]).length;
    const positions = new Set(rookies.map(p => p.position));
    const variety = Math.min(positions.size * 1.5, 8);
    const countBonus = Math.min(rookies.length * 1.2, 8);
    const rawScore = 50
      + (avgOvr - 68) * 0.95
      + (topOvr - 74) * 0.35
      + (topThreeAvg - 72) * 0.7
      + devAvg * 0.65
      + starCount * 1.15
      + superstarCount * 1.2
      + xFactorCount * 1.4
      + premiumCount * 0.55
      + needFitScore * 0.45
      + topNeedHits * 0.8
      + (variety * 0.55)
      + (countBonus * 0.4);
    rawGrades.push({
      teamName,
      emoji: teamEmoji(teamName),
      rawScore,
    });
  });

  rawGrades.sort((a, b) => b.rawScore - a.rawScore);
  const count = rawGrades.length;
  return rawGrades.map((entry, index) => {
    const percentile = count <= 1 ? 0.75 : 1 - (index / (count - 1));
    const qualityBump = Math.max(-1.5, Math.min(1.5, (entry.rawScore - 78) * 0.08));
    const eliteNudge = index === 0 ? 0.6 : index === 1 ? 0.3 : 0;
    const curved = 64 + percentile * 26.5 + qualityBump + eliteNudge;
    return {
      teamName: entry.teamName,
      emoji: entry.emoji,
      grade: Math.max(58, Math.min(92.8, Math.round(curved * 10) / 10)),
      rawScore: Math.round(entry.rawScore * 10) / 10,
    };
  });
}

export function buildDraftGradesEmbed(grades = [], leagueId = null, snapshot = null) {
  const logo = getLeagueBuddyLogoEmoji();
  const draftYear = getMaddenDraftYear(snapshot);
  const lines = grades.map((g, idx) => {
    const badge =
      g.grade >= 90 ? 'A' :
        g.grade >= 82 ? 'B' :
          g.grade >= 74 ? 'C' :
            g.grade >= 66 ? 'D' :
              'F';
    return `${idx + 1}) ${g.emoji || ''} ${g.teamName} — **${badge} (${g.grade})**`;
  });
  const description = lines.join('\n').slice(0, 3900);
  const embed = new EmbedBuilder()
    .setTitle(`${logo ? `${logo} ` : ''}${draftYear} Madden Draft Grades`)
    .setDescription(description || 'No rookie draft data found in the current export.')
    .setColor(0x8e44ad);
  if (leagueId) embed.addFields({ name: 'League', value: String(leagueId), inline: true });
  return embed;
}

export async function maybePostDraftGrades(client, leagueId, guildId = null) {
  try {
    const snapshot = loadLeagueSnapshot(leagueId);
    if (!snapshot) return { posted: false, reason: 'No league snapshot was found.' };
    const seasonInfo = snapshot?.info?.careerHubInfo?.seasonInfo || {};
    const weekType = Number(seasonInfo.seasonWeekType ?? seasonInfo.seasonWeekTypeId ?? snapshot?.stage ?? 1);
    const rookieCount = countDraftedRookies(snapshot);
    console.info('[draft-grades-auto] checking synced rosters', {
      leagueId,
      guildId,
      rookieCount,
      teamRosterCount: Object.keys(snapshot?.rosters?.teams || {}).length,
      isDraftActive: seasonInfo.isDraftActive ?? null,
      weekType,
      offSeasonStage: seasonInfo.offSeasonStage ?? null,
      seasonYear: seasonInfo.calendarYear ?? snapshot?.info?.calendarYear ?? null,
    });
    // Keep checking eligible offseason syncs until grades post successfully.
    if (!isDraftReadyForGrades(snapshot)) {
      console.warn('[draft-grades-auto] skipped: draft completion criteria were not met', {
        leagueId,
        guildId,
        weekType,
        offSeasonStage: seasonInfo.offSeasonStage,
        seasonTitle: seasonInfo.seasonTitle,
        rookieCount,
      });
      return { posted: false, reason: 'Draft completion criteria were not met.' };
    }
    const channelMap = loadMaddenChannelMap(guildId);
    const roleMap = (getGuildRoleMap(guildId) && Object.keys(getGuildRoleMap(guildId)).length)
      ? getGuildRoleMap(guildId)
      : loadJson(path.join(process.cwd(), 'data', 'madden', 'madden_role_ids.json'));
    const draftChannelId = channelMap['Draft Results']
      || channelMap['draft-results']
      || channelMap['Draft Grades']
      || channelMap['Draft grades']
      || null;
    if (!draftChannelId) {
      console.warn('[draft-grades-auto] skipped: Draft Grades channel is not mapped', { leagueId, guildId });
      return { posted: false, reason: 'Draft Results channel is not configured.' };
    }

    const state = loadJson(STATE_FILE, {});
    const seasonYear = Number(seasonInfo.calendarYear || snapshot?.info?.calendarYear || new Date().getFullYear());
    const draftClassKey = getDraftClassStateKey(snapshot);
    state[leagueId] = state[leagueId] || {};
    const lastPosted = state[leagueId]?.[draftClassKey];
    if (lastPosted?.formulaVersion === DRAFT_GRADES_FORMULA_VERSION) {
      return { posted: false, reason: 'Draft grades were already posted for this rookie class.' };
    }

    const grades = computeDraftGrades(snapshot);
    if (!grades.length) return { posted: false, reason: 'No drafted rookies were found to grade.' };

    const embed = buildDraftGradesEmbed(grades, leagueId, snapshot);

    const channel = await client.channels.fetch(draftChannelId).catch(() => null);
    if (channel && channel.isTextBased()) {
      const coachRoleId = isSoloModeEnabled()
        ? null
        : roleMap['LEAGUEbuddy Coaches'] || roleMap['LB Coaches'] || roleMap['Ghost Legacy'];
      const coachTag = coachRoleId ? `<@&${coachRoleId}>` : null;
      await channel.send({ content: coachTag ?? undefined, embeds: [embed] });
      state[leagueId][draftClassKey] = {
        posted: true,
        fetchedAt: snapshot.fetchedAt,
        seasonYear,
        draftYear: getMaddenDraftYear(snapshot),
        rookieCount,
        formulaVersion: DRAFT_GRADES_FORMULA_VERSION,
        postedAt: new Date().toISOString(),
      };
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
      return { posted: true, channelId: draftChannelId };
    } else {
      console.warn('[draft-grades-auto] skipped: Draft Grades channel could not be fetched', { leagueId, guildId, draftChannelId });
      return { posted: false, reason: 'Draft Results channel could not be fetched.' };
    }
  } catch (e) {
    console.warn('[draft-grades-auto] skipped:', e?.message || e);
    return { posted: false, error: e?.message || String(e) };
  }
}
