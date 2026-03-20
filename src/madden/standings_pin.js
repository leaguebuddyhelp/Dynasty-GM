import fs from 'fs';
import { EmbedBuilder } from 'discord.js';
import { getPinId, setPinId } from './pins_store.js';
import { getFullTeamName } from '../shared/madden_team_names.js';
import { loadMaddenChannelMap } from '../shared/madden_metadata.js';
import { getMaddenLeagueSnapshotPath } from '../leaguebuddy/paths.js';
import { renderLeagueBoardImage } from '../shared/madden_board_renderer.js';

function loadSnapshot(leagueId) {
  const file = getMaddenLeagueSnapshotPath(leagueId);
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

function loadChannelMap(guildId = null) {
  return loadMaddenChannelMap(guildId);
}

function formatRecord(team) {
  const w = team?.totalWins ?? 0;
  const l = team?.totalLosses ?? 0;
  const t = team?.totalTies ?? 0;
  return t ? `${w}-${l}-${t}` : `${w}-${l}`;
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

function groupByDivision(snapshot) {
  const standings = snapshot?.standings?.teamStandingInfoList || [];
  const divisions = new Map();

  if (standings.length === 0) {
    // Fallback: build from teams list with default 0-0
    const teams = snapshot?.teams?.leagueTeamInfoList || [];
    teams.forEach(t => {
      const key = t.divName || 'Division';
      if (!divisions.has(key)) divisions.set(key, []);
      divisions.get(key).push({
        divisionName: t.divName,
        teamId: t.teamId,
        totalWins: 0,
        totalLosses: 0,
        totalTies: 0,
        winPct: 0,
        netPts: 0,
      });
    });
    return divisions;
  }

  standings.forEach(s => {
    const key = s.divisionName || 'Division';
    if (!divisions.has(key)) divisions.set(key, []);
    divisions.get(key).push(s);
  });
  return divisions;
}

function sortDivision(list) {
  const allZero = list.every(t => (t.totalWins ?? 0) === 0 && (t.totalLosses ?? 0) === 0 && (t.totalTies ?? 0) === 0);
  if (allZero) {
    // Alphabetical by team name placeholder (we inject name in caller)
    return list;
  }
  return list.sort((a, b) =>
    (b.winPct ?? 0) - (a.winPct ?? 0) ||
    (b.totalWins ?? 0) - (a.totalWins ?? 0) ||
    (b.netPts ?? 0) - (a.netPts ?? 0)
  );
}

export async function updateStandings(client, leagueId, guildId = null) {
  const resolvedGuildId = guildId || client?.guilds?.cache?.first?.()?.id || null;
  const snapshot = loadSnapshot(leagueId);
  const seasonInfo = snapshot?.info?.careerHubInfo?.seasonInfo || {};
  const seasonWeekType = seasonInfo.seasonWeekType;
  const displayWeek = seasonInfo.displayWeek ?? seasonInfo.seasonWeek ?? 0;
  const hasSeasonData = (snapshot?.weeklyStats || []).some(w => Number(w.weekIndex ?? -1) >= 0) ||
    (snapshot?.standings?.teamStandingInfoList || []).length > 0;
  const inPreseason = (seasonWeekType === 0 || displayWeek <= 0) && !hasSeasonData;
  if (inPreseason) {
    await resetStandings(client);
    return;
  }
  const divisions = groupByDivision(snapshot);
  const teams = teamNameMap(snapshot);

  const afcDivs = {};
  const nfcDivs = {};
  const other = {};

  for (const [div, list] of divisions.entries()) {
    const sorted = sortDivision(list);
    const allZero = sorted.every(t => (t.totalWins ?? 0) === 0 && (t.totalLosses ?? 0) === 0 && (t.totalTies ?? 0) === 0);
    const sortedWithNames = allZero
      ? [...sorted].sort((a, b) => (teams[a.teamId] || '').localeCompare(teams[b.teamId] || ''))
      : sorted;
    const lines = sortedWithNames.map(t => {
      const name = teams[t.teamId] || 'Team';
      return `${name} — ${formatRecord(t)}`;
    });
    const lower = (div || '').toLowerCase();
    const value = lines.length ? lines.join('\n') : 'N/A';
    if (lower.includes('afc')) afcDivs[div] = value;
    else if (lower.includes('nfc')) nfcDivs[div] = value;
    else other[div] = value;
  }

  const orderAfc = ['AFC East', 'AFC North', 'AFC South', 'AFC West'];
  const orderNfc = ['NFC East', 'NFC North', 'NFC South', 'NFC West'];

  function buildConferenceItems(divOrder, divisionsMap) {
    const items = [];
    for (const divisionName of divOrder) {
      items.push({ type: 'section', title: divisionName });
      const divisionTeams = divisions.get(divisionName) || [];
      const sorted = sortDivision([...divisionTeams]);
      const allZero = sorted.every(t => (t.totalWins ?? 0) === 0 && (t.totalLosses ?? 0) === 0 && (t.totalTies ?? 0) === 0);
      const sortedWithNames = allZero
        ? [...sorted].sort((a, b) => (teams[a.teamId] || '').localeCompare(teams[b.teamId] || ''))
        : sorted;
      if (!sortedWithNames.length) {
        items.push({ label: 'No teams', meta: 'No synced standings yet.', teamLike: null });
        continue;
      }
      for (const team of sortedWithNames) {
        items.push({
          label: teams[team.teamId] || 'Team',
          meta: formatRecord(team),
          teamLike: teams[team.teamId] || 'Team',
        });
      }
    }
    return items;
  }

  const channelMap = loadChannelMap(resolvedGuildId);
  const channelId = channelMap['Standings'];
  if (!channelId) throw new Error('Standings channel not configured');
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) throw new Error('Standings channel not accessible');

  const boardImage = await renderLeagueBoardImage({
    title: 'Standings',
    subtitle: `Season ${seasonInfo.seasonNumber ?? seasonInfo.seasonIndex ?? 'Current'} • Week ${displayWeek || '?'}`,
    attachmentName: 'standings_board.png',
    accentColor: '#00B0F4',
    columns: [
      { title: 'AFC', items: buildConferenceItems(orderAfc, afcDivs) },
      { title: 'NFC', items: buildConferenceItems(orderNfc, nfcDivs) },
    ],
  });
  const embed = new EmbedBuilder()
    .setTitle('Madden Standings')
    .setColor(0x00b0f4)
    .setTimestamp(new Date());
  if (boardImage) embed.setImage(`attachment://${boardImage.name}`);

  const pinId = getPinId('standings', resolvedGuildId);
  if (!pinId) return;
  const msg = await channel.messages.fetch(pinId).catch(() => null);
  if (!msg) {
    console.warn('[standings] pin not found; skipping create');
    return;
  }
  await msg.edit({ embeds: [embed], files: boardImage ? [boardImage] : [], content: null }).catch(() => null);
}

export async function resetStandings(client, guildId = null) {
  const resolvedGuildId = guildId || client?.guilds?.cache?.first?.()?.id || null;
  const channelMap = loadChannelMap(resolvedGuildId);
  const channelId = channelMap['Standings'];
  if (!channelId) throw new Error('Standings channel not configured');
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) throw new Error('Standings channel not accessible');

  const placeholder = {
    title: 'Madden Standings',
    description: 'Preseason — standings will appear here once the regular season starts.',
    color: 0x00b0f4,
    timestamp: new Date().toISOString(),
  };

  const pinId = getPinId('standings', resolvedGuildId);
  if (!pinId) return;
  const msg = await channel.messages.fetch(pinId).catch(() => null);
  if (!msg) return;
  await msg.edit({ embeds: [placeholder], content: null }).catch(() => null);
}

export default { updateStandings };
