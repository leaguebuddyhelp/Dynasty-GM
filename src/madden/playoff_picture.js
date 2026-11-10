import fs from 'fs';
import { EmbedBuilder } from 'discord.js';
import { getFullTeamName } from '../shared/madden_team_names.js';
import { loadMaddenChannelMap } from '../shared/madden_metadata.js';
import { getMaddenLeagueSnapshotPath } from '../leaguebuddy/paths.js';
import { renderLeagueBoardImage } from '../shared/madden_board_renderer.js';
import { ensureBoardPinMessage } from './board_pin_utils.js';
import { getMessageForWeek } from './madden_utils.js';

function loadSnapshot(leagueId) {
  const file = getMaddenLeagueSnapshotPath(leagueId);
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
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
  const w = s?.totalWins ?? s?.wins ?? s?.w ?? 0;
  const l = s?.totalLosses ?? s?.losses ?? s?.l ?? 0;
  const t = s?.totalTies ?? s?.ties ?? s?.t ?? 0;
  return t ? `${w}-${l}-${t}` : `${w}-${l}`;
}

function standingWins(team = {}) {
  return Number(team.totalWins ?? team.wins ?? team.w ?? 0);
}

function standingLosses(team = {}) {
  return Number(team.totalLosses ?? team.losses ?? team.l ?? 0);
}

function standingTies(team = {}) {
  return Number(team.totalTies ?? team.ties ?? team.t ?? 0);
}

function standingWinPct(team = {}) {
  const wins = standingWins(team);
  const losses = standingLosses(team);
  const ties = standingTies(team);
  const games = wins + losses + ties;
  return games ? (wins + ties * 0.5) / games : 0;
}

function recordSort(a, b) {
  return standingWinPct(b) - standingWinPct(a)
    || standingWins(b) - standingWins(a)
    || standingLosses(a) - standingLosses(b)
    || Number(b.divisionWins ?? b.divWins ?? -1) - Number(a.divisionWins ?? a.divWins ?? -1)
    || Number(b.conferenceWins ?? b.confWins ?? -1) - Number(a.conferenceWins ?? a.confWins ?? -1)
    || (b.netPts ?? 0) - (a.netPts ?? 0)
    || (b.ptsFor ?? 0) - (a.ptsFor ?? 0)
    || String(a.teamId ?? '').localeCompare(String(b.teamId ?? ''));
}

function existingSeedSort(a, b) {
  const aSeed = Number(a.seed ?? 0);
  const bSeed = Number(b.seed ?? 0);
  if (aSeed && bSeed) return aSeed - bSeed;
  if (aSeed && !bSeed) return -1;
  if (!aSeed && bSeed) return 1;
  return recordSort(a, b);
}

function computeConferenceSeeds(standings, conferenceName) {
  const list = standings.filter(s => (s.conferenceName || '').toLowerCase().includes(conferenceName));
  if (!list.length) return [];
  const explicitSeeds = list
    .filter((team) => Number(team.seed || 0) > 0 && Number(team.seed) <= 7)
    .sort(existingSeedSort);
  const explicitSeedMap = new Map();
  const explicitTeamIds = new Set();
  for (const team of explicitSeeds) {
    const seed = Number(team.seed);
    const teamId = String(team.teamId);
    if (explicitSeedMap.has(seed) || explicitTeamIds.has(teamId)) continue;
    explicitSeedMap.set(seed, team);
    explicitTeamIds.add(teamId);
  }
  if ([1, 2, 3, 4, 5, 6, 7].every((seed) => explicitSeedMap.has(seed))) {
    return [1, 2, 3, 4, 5, 6, 7].map((seed) => ({
      team: explicitSeedMap.get(seed),
      authoritative: true,
    }));
  }

  const byDiv = {};
  list.forEach((team) => {
    const div = team.divisionId || team.divisionName || 'division';
    byDiv[div] = byDiv[div] || [];
    byDiv[div].push(team);
  });
  const divisionWinners = Object.values(byDiv)
    .map((divisionTeams) => [...divisionTeams].sort(recordSort)[0])
    .filter(Boolean)
    .sort(recordSort);
  const winnerIds = new Set(divisionWinners.map((team) => Number(team.teamId)));
  const wildcards = list
    .filter((team) => !winnerIds.has(Number(team.teamId)))
    .sort(recordSort);
  const projected = [...divisionWinners.slice(0, 4), ...wildcards.slice(0, 3)];
  if (!explicitSeedMap.size) return projected.map((team) => ({ team, authoritative: false }));
  const slots = new Map(explicitSeedMap);
  const used = new Set([...slots.values()].map((team) => String(team.teamId)));
  const remaining = projected.filter((team) => !used.has(String(team.teamId)));
  for (let seed = 1; seed <= 7 && remaining.length; seed += 1) {
    if (!slots.has(seed)) slots.set(seed, remaining.shift());
  }
  return [...slots.entries()]
    .sort(([a], [b]) => a - b)
    .slice(0, 7)
    .map(([seed, team]) => ({ team, authoritative: Number(team.seed || 0) === seed }));
}

function topSeeds(standings, conferenceName, teams) {
  const list = computeConferenceSeeds(standings, conferenceName);
  if (!list.length) return Array.from({ length: 7 }, (_, i) => `${i + 1}) N/A`);
  const seeds = list.slice(0, 7).map(({ team, authoritative }, idx) => {
    const name = teams[team.teamId] || 'Team';
    const record = formatRecord(team);
    const seed = Number(team.seed || 0) || idx + 1;
    return `${seed}) ${name} — ${record}${authoritative ? '' : ' • Projected'}`;
  });
  while (seeds.length < 7) seeds.push(`${seeds.length + 1}) N/A`);
  return seeds;
}

function completedPostseasonGames(snapshot, teams) {
  const games = snapshot?.schedule?.schedules || [];
  return games
    .filter((game) => Number(game.stageIndex ?? game.stage ?? -1) === 2)
    .filter((game) => {
      if (game.homeScore === null || game.homeScore === undefined
        || game.awayScore === null || game.awayScore === undefined) return false;
      const homeScore = Number(game.homeScore);
      const awayScore = Number(game.awayScore);
      return (Number(game.status ?? 0) >= 2 || homeScore > 0 || awayScore > 0)
        && Number.isFinite(homeScore)
        && Number.isFinite(awayScore);
    })
    .map((game) => {
      const week = Number(game.weekIndex);
      const away = teams[game.awayTeamId] || `Team ${game.awayTeamId}`;
      const home = teams[game.homeTeamId] || `Team ${game.homeTeamId}`;
      return `Week ${Number.isInteger(week) ? week + 1 : '?'}: ${away} ${game.awayScore} — ${home} ${game.homeScore}`;
    })
    .slice(-8);
}

export async function updatePlayoffPicture(client, leagueId, guildId = null) {
  const resolvedGuildId = guildId || client?.guilds?.cache?.first?.()?.id || null;
  const snapshot = loadSnapshot(leagueId);
  const seasonInfo = snapshot?.info?.careerHubInfo?.seasonInfo || {};
  const displayWeek = seasonInfo.displayWeek ?? seasonInfo.seasonWeek ?? 0;
  const weekLabel = getMessageForWeek(displayWeek || 0, seasonInfo.seasonWeekType, seasonInfo.offSeasonStage || 0);
  const standings = snapshot?.standings?.teamStandingInfoList || [];
  const hasSeasonData = (snapshot?.weeklyStats || []).some(w => Number(w.weekIndex ?? -1) >= 0) || standings.length > 0;
  const inPreseason = displayWeek <= 0 && !hasSeasonData;
  if (inPreseason) {
    await resetPlayoffPicture(client, resolvedGuildId);
    return;
  }
  const teams = teamNameMap(snapshot);

  const afcSeeds = topSeeds(standings, 'afc', teams);
  const nfcSeeds = topSeeds(standings, 'nfc', teams);

  const channelMap = loadChannelMap(resolvedGuildId);
  const channelId = channelMap['Playoff Picture'];
  if (!channelId) throw new Error('Playoff Picture channel not configured');
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) throw new Error('Playoff Picture channel not accessible');

  const boardImage = await renderLeagueBoardImage({
    title: 'Playoff Picture',
    subtitle: `Season ${seasonInfo.seasonNumber ?? seasonInfo.seasonIndex ?? 'Current'} • ${weekLabel}`,
    attachmentName: 'playoff_picture_board.png',
    accentColor: '#00B0F4',
    columns: [
      {
        title: 'AFC',
        items: afcSeeds.map((line) => {
          const match = String(line).match(/^(\d+)\)\s(.+?)\s—\s(.+)$/);
          if (!match) return { label: line, meta: '', teamLike: null };
          return {
            label: `#${match[1]} ${match[2]}`,
            meta: match[3],
            teamLike: match[2],
          };
        }),
      },
      {
        title: 'NFC',
        items: nfcSeeds.map((line) => {
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
    .setTitle('Madden Playoff Picture')
    .setColor(0x00b0f4)
    .setTimestamp(new Date());
  const postseasonGames = completedPostseasonGames(snapshot, teams);
  embed.setDescription(postseasonGames.length
    ? `Imported postseason results\n${postseasonGames.join('\n')}`.slice(0, 4096)
    : 'Projected seeds are provisional until Madden provides authoritative seeds. Completed postseason games are shown only when imported results are available.');
  if (boardImage) embed.setImage(`attachment://${boardImage.name}`);

  await ensureBoardPinMessage(channel, {
    pinKey: 'playoff_picture',
    guildId: resolvedGuildId,
    matchTitle: 'Madden Playoff Picture',
    payload: { embeds: [embed], files: boardImage ? [boardImage] : [], content: null },
  });
}

export async function resetPlayoffPicture(client, guildId = null) {
  const resolvedGuildId = guildId || client?.guilds?.cache?.first?.()?.id || null;
  const channelMap = loadChannelMap(resolvedGuildId);
  const channelId = channelMap['Playoff Picture'];
  if (!channelId) throw new Error('Playoff Picture channel not configured');
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) throw new Error('Playoff Picture channel not accessible');

  const embed = {
    title: 'Madden Playoff Picture',
    description: 'Preseason — playoff picture will appear once the regular season starts.',
    color: 0x00b0f4,
    timestamp: new Date().toISOString(),
  };

  await ensureBoardPinMessage(channel, {
    pinKey: 'playoff_picture',
    guildId: resolvedGuildId,
    matchTitle: 'Madden Playoff Picture',
    payload: { embeds: [embed], content: null },
  });
}

export default { updatePlayoffPicture };
