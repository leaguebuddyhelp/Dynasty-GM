import { ensureBoardPinMessage } from './board_pin_utils.js';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { stablePlayerKey } from './player_identity.js';
import { getDataFilePath } from '../leaguebuddy/paths.js';
import { getFullTeamName } from '../shared/madden_team_names.js';
import { getMaddenChannelId } from '../shared/madden_metadata.js';
import { formatTeamLabelWithEmoji } from '../shared/madden_visuals.js';
import { performanceAdjustedRatings } from './progression.js';

export const SOLO_POSITION_ORDER = [
  'QB', 'HB', 'FB', 'WR', 'TE',
  'LT', 'LG', 'C', 'RG', 'RT',
  'LE', 'RE', 'DT', 'LOLB', 'MLB', 'ROLB',
  'CB', 'FS', 'SS', 'K', 'P',
];

const SOLO_RULES_PATH = path.resolve(
  process.env.MADDEN_SOLO_RULES_FILE || path.join(process.cwd(), 'config', 'madden_solo_rules.json'),
);
const REPORTS_DIR = getDataFilePath(path.join('madden', 'solo_reports'));
const TEAM_MESSAGE_INDEX = getDataFilePath(path.join('madden', 'solo_reports', 'team_messages.json'));

function readRules() {
  const parsed = JSON.parse(readFileSync(SOLO_RULES_PATH, 'utf8'));
  const weights = parsed?.teamOveralls;
  const sum = Number(weights?.offenseWeight) + Number(weights?.defenseWeight) + Number(weights?.specialTeamsWeight);
  const teamWeights = [weights?.offenseWeight, weights?.defenseWeight, weights?.specialTeamsWeight].map(Number);
  if (!weights || !teamWeights.every((weight) => Number.isFinite(weight) && weight >= 0)
    || Math.abs(sum - 1) > 0.000001 || !(Number(weights.unitStarterWeight) >= 0 && Number(weights.unitStarterWeight) <= 1)) {
    throw new Error(`Invalid solo team-overall weights in ${SOLO_RULES_PATH}.`);
  }
  if (![weights.ratingAnchor, weights.ratingAnchorOutput, weights.ratingSpread].every(Number.isFinite)
    || weights.ratingSpread <= 0) {
    throw new Error(`Invalid solo team-overall rating scale in ${SOLO_RULES_PATH}.`);
  }
  const specialWeights = weights.specialTeamsWeights || {};
  const specialComponents = [specialWeights.kicker, specialWeights.punter, specialWeights.returnSpecialists].map(Number);
  const specialSum = specialComponents.reduce((sum, weight) => sum + weight, 0);
  if (!specialComponents.every((weight) => Number.isFinite(weight) && weight >= 0) || Math.abs(specialSum - 1) > 0.000001) {
    throw new Error(`Invalid solo special-teams weights in ${SOLO_RULES_PATH}.`);
  }
  return parsed;
}

function playerOvr(player) {
  if (player?.playerBestOvr === null || player?.playerBestOvr === undefined || player?.playerBestOvr === '') return null;
  const value = Number(player?.playerBestOvr);
  return Number.isFinite(value) ? value : null;
}

function playerName(player) {
  return String(player?.fullName || [player?.firstName, player?.lastName].filter(Boolean).join(' ') || 'Unknown Player');
}

function flattenRoster(snapshot) {
  const teamDetails = new Map((snapshot?.teams?.leagueTeamInfoList || []).map((team) => [
    String(team.teamId),
    team,
  ]));
  const players = [];
  for (const [teamId, roster] of Object.entries(snapshot?.rosters?.teams || {})) {
    const team = teamDetails.get(String(teamId));
    for (const player of roster?.rosterInfoList || roster?.rosterPlayerInfoList || []) {
      const overall = playerOvr(player);
      if (overall === null) continue;
      players.push({
        ...player,
        teamId: String(player.teamId ?? teamId),
        teamName: getFullTeamName(team || {}, `Team ${teamId}`),
        position: String(player.position || '').toUpperCase(),
        ovr: overall,
        playerKey: stablePlayerKey(player),
      });
    }
  }
  return players;
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const TEAM_POSITION_ALIASES = {
  LEDGE: 'LE', LEDG: 'LE', LDE: 'LE',
  REDGE: 'RE', REDG: 'RE', RDE: 'RE',
  SAM: 'LOLB', MIKE: 'MLB', WILL: 'ROLB',
};

function scaledTeamRating(value, rules) {
  return Math.max(0, Math.min(99, rules.ratingAnchorOutput + (value - rules.ratingAnchor) * rules.ratingSpread));
}

function unitOverall(players, slots, starterWeight) {
  const starters = [];
  const depth = [];
  for (const [position, countValue] of Object.entries(slots)) {
    const count = Number(countValue);
    if (!Number.isInteger(count) || count < 1) throw new Error(`Invalid roster slot count for ${position}.`);
    const atPosition = players
      .filter((player) => (TEAM_POSITION_ALIASES[player.position] || player.position) === position)
      .sort((a, b) => b.ovr - a.ovr || a.playerKey.localeCompare(b.playerKey));
    starters.push(...atPosition.slice(0, count).map((player) => player.ovr));
    depth.push(...atPosition.slice(count, count * 2).map((player) => player.ovr));
  }
  if (starters.length === 0) return null;
  const starterAverage = average(starters);
  const depthAverage = average(depth);
  if (depthAverage === null) return starterAverage;
  return starterAverage * starterWeight + depthAverage * (1 - starterWeight);
}

function specialTeamsOverall(players, rules) {
  const weights = rules.specialTeamsWeights;
  const kicker = players
    .filter((player) => player.position === 'K')
    .sort((a, b) => b.ovr - a.ovr)[0];
  const punter = players
    .filter((player) => player.position === 'P')
    .sort((a, b) => b.ovr - a.ovr)[0];
  const returnCount = Math.max(1, Number(rules.returnSpecialistCount || 2));
  const returners = players
    .filter((player) => player.kickReturnRating !== undefined
      && player.kickReturnRating !== null
      && player.kickReturnRating !== ''
      && Number.isFinite(Number(player.kickReturnRating)))
    .sort((a, b) => Number(b.kickReturnRating) - Number(a.kickReturnRating) || b.ovr - a.ovr)
    .slice(0, returnCount);
  const components = [
    { value: kicker?.ovr, weight: Number(weights.kicker) },
    { value: punter?.ovr, weight: Number(weights.punter) },
    { value: average(returners.map((player) => Number(player.kickReturnRating))), weight: Number(weights.returnSpecialists) },
  ].filter((component) => component.value !== null && component.value !== undefined && component.weight > 0);
  const weight = components.reduce((sum, component) => sum + component.weight, 0);
  if (!weight) return null;
  return components.reduce((sum, component) => sum + component.value * component.weight, 0) / weight;
}

export function buildSoloReportSnapshot(snapshot, { syncId = snapshot?.syncId, rules = readRules() } = {}) {
  const performanceRatings = performanceAdjustedRatings(snapshot, rules.progression);
  const teams = Array.isArray(snapshot?.teams?.leagueTeamInfoList) ? snapshot.teams.leagueTeamInfoList : [];
  const players = flattenRoster(snapshot);
  const byPosition = new Map(SOLO_POSITION_ORDER.map((position) => [position, []]));
  const uniquePlayers = new Map();
  for (const player of players) {
    if (!byPosition.has(player.position)) continue;
    const uniqueKey = player.playerKey || `${player.teamId}:${player.position}:${playerName(player)}`;
    if (!uniquePlayers.has(uniqueKey)) uniquePlayers.set(uniqueKey, player);
  }
  for (const player of uniquePlayers.values()) byPosition.get(player.position).push(player);

  const leaderboards = Object.fromEntries(SOLO_POSITION_ORDER.map((position) => [
    position,
    byPosition.get(position)
      .sort((a, b) => (performanceRatings.get(b.playerKey)?.adjusted ?? b.ovr) - (performanceRatings.get(a.playerKey)?.adjusted ?? a.ovr) || playerName(a).localeCompare(playerName(b)))
      .slice(0, 10)
      .map((player, index) => ({
        rank: index + 1,
        playerKey: player.playerKey,
        player: playerName(player),
        team: player.teamName,
        ovr: player.ovr,
        performanceRating: performanceRatings.get(player.playerKey) || null,
      })),
  ]));

  const teamOveralls = teams.map((team) => {
    const teamId = String(team.teamId);
    const roster = players.filter((player) => player.teamId === teamId);
    const rawOffense = unitOverall(roster, rules.teamOveralls.offenseSlots, rules.teamOveralls.unitStarterWeight);
    const rawDefense = unitOverall(roster, rules.teamOveralls.defenseSlots, rules.teamOveralls.unitStarterWeight);
    const rawSpecialTeams = specialTeamsOverall(roster, rules.teamOveralls);
    const offense = rawOffense === null ? null : scaledTeamRating(rawOffense, rules.teamOveralls);
    const defense = rawDefense === null ? null : scaledTeamRating(rawDefense, rules.teamOveralls);
    const specialTeams = rawSpecialTeams === null ? null : scaledTeamRating(rawSpecialTeams, rules.teamOveralls);
    const complete = [offense, defense, specialTeams].every((rating) => rating !== null);
    const total = complete
      ? offense * rules.teamOveralls.offenseWeight
        + defense * rules.teamOveralls.defenseWeight
        + specialTeams * rules.teamOveralls.specialTeamsWeight
      : null;
    return {
      teamId,
      team: getFullTeamName(team, `Team ${teamId}`),
      offense,
      defense,
      specialTeams,
      total,
      complete,
    };
  }).sort((a, b) => {
    if (a.total === null) return b.total === null ? a.team.localeCompare(b.team) : 1;
    if (b.total === null) return -1;
    return b.total - a.total || a.team.localeCompare(b.team);
  }).map((team, index) => ({ rank: team.total === null ? null : index + 1, ...team }));

  const seasonInfo = snapshot?.info?.careerHubInfo?.seasonInfo || {};
  return {
    version: 1,
    syncId: String(syncId || ''),
    leagueId: String(snapshot?.leagueId || ''),
    syncedAt: String(snapshot?.syncedAt || snapshot?.fetchedAt || new Date().toISOString()),
    season: seasonInfo.seasonNumber ?? seasonInfo.seasonIndex ?? snapshot?.season ?? null,
    week: snapshot?.currentWeek ?? snapshot?.week ?? null,
    sourceValidation: {
      teamCount: teams.length,
      rosterTeamCount: Object.keys(snapshot?.rosters?.teams || {}).length,
      completeTeamRatings: teamOveralls.filter((team) => team.complete).length,
      positionCounts: Object.fromEntries(SOLO_POSITION_ORDER.map((position) => [position, byPosition.get(position).length])),
    },
    teamOveralls,
    leaderboards,
  };
}

function reportFile(leagueId, syncId) {
  return path.join(REPORTS_DIR, String(leagueId), `${String(syncId)}.json`);
}

async function atomicJsonWrite(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), { flag: 'wx' });
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw error;
  }
}

function buildLeaderboardComponents(report, positionIndex = 0) {
  const position = SOLO_POSITION_ORDER[positionIndex];
  const select = new StringSelectMenuBuilder()
    .setCustomId(`madden_solo_rankings_position|${report.syncId}`)
    .setPlaceholder('Choose a position')
    .addOptions(SOLO_POSITION_ORDER.map((value, index) => ({
      label: value,
      value: String(index),
      default: index === positionIndex,
    })));
  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`madden_solo_rankings_page|${report.syncId}|${(positionIndex + SOLO_POSITION_ORDER.length - 1) % SOLO_POSITION_ORDER.length}`)
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`madden_solo_rankings_page|${report.syncId}|${(positionIndex + 1) % SOLO_POSITION_ORDER.length}`)
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary),
  );
  return [new ActionRowBuilder().addComponents(select), nav];
}

function rankBadge(rank) {
  return ({ 1: '🥇', 2: '🥈', 3: '🥉' })[rank] || `**${String(rank).padStart(2, '0')}**`;
}

export function buildLeaderboardEmbed(report, positionIndex = 0) {
  const position = SOLO_POSITION_ORDER[positionIndex] || SOLO_POSITION_ORDER[0];
  const entries = report.leaderboards?.[position] || [];
  const lines = entries.length
    ? entries.map((entry) => `${rankBadge(entry.rank)} **${entry.player}** · ${formatTeamLabelWithEmoji(entry.team)} · **${entry.performanceRating?.adjusted ?? entry.ovr} form** · ${entry.ovr} Madden OVR${entry.performanceRating?.change ? ` (${entry.performanceRating.change > 0 ? '+' : ''}${entry.performanceRating.change})` : ''}`)
    : ['No players at this position have imported ratings yet.'];
  return new EmbedBuilder()
    .setTitle(`🏈 Player Overalls · ${position}`)
    .setDescription(`**Performance-adjusted form rankings** · Madden OVR is unchanged\n\n${lines.join('\n')}`)
    .addFields({
      name: 'Season · Week',
      value: `${report.season ?? 'Unknown'} · ${report.week ?? 'Unknown'}`,
      inline: true,
    })
    .setFooter({ text: `Dynasty GM · Position ${positionIndex + 1} of ${SOLO_POSITION_ORDER.length}` })
    .setTimestamp(new Date(report.syncedAt));
}

async function saveTeamMessageId(leagueId, guildId, channelId, messageId) {
  let index = {};
  try {
    index = JSON.parse(await fs.readFile(TEAM_MESSAGE_INDEX, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  index[`${guildId}:${leagueId}`] = { channelId, messageId };
  await atomicJsonWrite(TEAM_MESSAGE_INDEX, index);
}

export function buildTeamOverallsEmbed(report) {
  const lines = report.teamOveralls.map((team) => {
    const rating = (value) => value === null ? '—' : String(Math.round(value));
    return `${team.rank === null ? '—' : rankBadge(team.rank)} ${formatTeamLabelWithEmoji(team.team)}\nOFF **${rating(team.offense)}** · DEF **${rating(team.defense)}** · ST **${rating(team.specialTeams)}** · OVR **${rating(team.total)}**`;
  });
  return new EmbedBuilder()
    .setTitle('🏟️ Madden Team Overalls')
    .setDescription(lines.length ? lines.join('\n\n') : 'No team ratings are available yet.')
    .addFields({
      name: 'Season · Week',
      value: `${report.season ?? 'Unknown'} · ${report.week ?? 'Unknown'}`,
      inline: true,
    }, {
      name: 'Complete teams',
      value: `${report.sourceValidation.completeTeamRatings} / ${report.sourceValidation.teamCount}`,
      inline: true,
    })
    .setFooter({ text: 'Talent-scaled ratings · ST uses available specialist data' })
    .setTimestamp(new Date(report.syncedAt));
}

async function updateTeamOverallMessage(client, guildId, report) {
  const channelId = getMaddenChannelId('Team Overalls', guildId);
  if (!channelId) return { posted: false, reason: 'Team Overalls channel is not configured.' };
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased()) throw new Error('Configured Team Overalls channel is not text-based.');
  let previous = null;
  try {
    const index = JSON.parse(await fs.readFile(TEAM_MESSAGE_INDEX, 'utf8'));
    previous = index[`${guildId}:${report.leagueId}`] || null;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const message = await ensureBoardPinMessage(channel, {
    pinKey: 'solo_team_overalls',
    guildId,
    matchTitle: 'Madden Team Overalls',
    existingMessageId: previous?.channelId === channelId ? previous.messageId : null,
    payload: { embeds: [buildTeamOverallsEmbed(report)] },
  });
  await saveTeamMessageId(report.leagueId, guildId, channelId, message.id);
  return { posted: true, updated: Boolean(previous?.messageId) };
}

export async function publishSoloSyncReports({ client, guildId, snapshot }) {
  const report = buildSoloReportSnapshot(snapshot);
  if (!report.syncId || !report.leagueId) throw new Error('Cannot create solo reports without sync and league IDs.');
  const filePath = reportFile(report.leagueId, report.syncId);
  let existing = null;
  try {
    existing = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (existing?.playerOverallsMessageId) {
    return { playerOverallsPosted: false, duplicate: true, syncId: report.syncId };
  }
  await atomicJsonWrite(filePath, report);
  const channelId = getMaddenChannelId('Player Overalls', guildId);
  if (!channelId) {
    return { playerOverallsPosted: false, teamOverallsPosted: false, error: 'Player Overalls channel is not configured.' };
  }
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased()) throw new Error('Configured Player Overalls channel is not text-based.');
  const message = await ensureBoardPinMessage(channel, {
    pinKey: 'solo_player_overalls',
    guildId,
    matchTitle: 'Top 10 QB',
    existingMessageId: existing?.playerOverallsChannelId === channelId
      ? existing.playerOverallsMessageId
      : null,
    payload: {
      embeds: [buildLeaderboardEmbed(report)],
      components: buildLeaderboardComponents(report),
    },
  });
  report.playerOverallsMessageId = message.id;
  report.playerOverallsChannelId = channelId;
  await atomicJsonWrite(filePath, report);

  let teamReportResult = { posted: false, reason: 'Team Overalls channel is not configured.' };
  try {
    teamReportResult = await updateTeamOverallMessage(client, guildId, report);
  } catch (error) {
    teamReportResult = { posted: false, reason: error?.message || String(error) };
  }
  const refreshedReports = {};
  for (const [label, modulePath, exportName] of [
    ['standings', './standings_pin.js', 'updateStandings'],
    ['playoffPicture', './playoff_picture.js', 'updatePlayoffPicture'],
    ['statLeaders', './stat_leaders.js', 'updateStatLeaders'],
    ['powerRankings', './power_rankings.js', 'updatePowerRankings'],
    ['transactions', './transactions.js', 'updateTransactions'],
    ['injuries', './injuries.js', 'updateInjuries'],
    ['playerChanges', './player_changes.js', 'updatePlayerChanges'],
  ]) {
    try {
      const reportModule = await import(modulePath);
      await reportModule[exportName](client, report.leagueId, guildId);
      refreshedReports[label] = { updated: true };
    } catch (error) {
      refreshedReports[label] = { updated: false, error: error?.message || String(error) };
      console.error(`[solo-reports] failed to update ${label}`, error);
    }
  }
  const dashboardChannelId = getMaddenChannelId('Franchise Dashboard', guildId);
  if (dashboardChannelId) {
    try {
      const dashboard = await client.channels.fetch(dashboardChannelId);
      await ensureBoardPinMessage(dashboard, {
        pinKey: 'franchise_dashboard', guildId, matchTitle: 'Madden Franchise HQ',
        payload: { embeds: [new EmbedBuilder().setTitle('Madden Franchise HQ').setColor(0x5865f2)
          .setDescription('Your franchise data is synced. Run `/sync` after advancing in Madden.')
          .addFields(
            { name: 'Franchise', value: String(report.leagueId), inline: true },
            { name: 'Season / Week', value: `${report.season ?? 'Unknown'} / ${report.week ?? 'Unknown'}`, inline: true },
            { name: 'Teams', value: String(report.sourceValidation.teamCount), inline: true },
            { name: 'Tools', value: '`/roster` · `/schedule` · `/playersearch` · `/awards` · `/bigboard` · `/mockdraft`' },
          ).setTimestamp(new Date(report.syncedAt))], allowedMentions: { parse: [] } },
      });
      refreshedReports.dashboard = { updated: true };
    } catch (error) {
      refreshedReports.dashboard = { updated: false, error: error.message };
    }
  }
  return {
    playerOverallsPosted: true,
    teamOverallsPosted: teamReportResult.posted,
    teamOverallsReason: teamReportResult.reason || null,
    refreshedReports,
    syncId: report.syncId,
  };
}

export async function loadSoloReport(leagueId, syncId) {
  return JSON.parse(await fs.readFile(reportFile(leagueId, syncId), 'utf8'));
}

export function componentsForSoloReport(report, positionIndex) {
  return buildLeaderboardComponents(report, positionIndex);
}

export default {
  SOLO_POSITION_ORDER,
  buildLeaderboardEmbed,
  buildSoloReportSnapshot,
  componentsForSoloReport,
  loadSoloReport,
  publishSoloSyncReports,
};
