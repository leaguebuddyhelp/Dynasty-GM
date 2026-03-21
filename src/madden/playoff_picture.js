import fs from 'fs';
import { EmbedBuilder } from 'discord.js';
import { getFullTeamName } from '../shared/madden_team_names.js';
import { loadMaddenChannelMap } from '../shared/madden_metadata.js';
import { getMaddenLeagueSnapshotPath } from '../leaguebuddy/paths.js';
import { renderLeagueBoardImage } from '../shared/madden_board_renderer.js';
import { ensureBoardPinMessage } from './board_pin_utils.js';

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
  const w = s?.totalWins ?? 0;
  const l = s?.totalLosses ?? 0;
  const t = s?.totalTies ?? 0;
  return t ? `${w}-${l}-${t}` : `${w}-${l}`;
}

function seedSort(a, b) {
  const aSeed = a.seed ?? 0;
  const bSeed = b.seed ?? 0;
  if (aSeed && bSeed) return aSeed - bSeed;
  if (aSeed && !bSeed) return -1;
  if (!aSeed && bSeed) return 1;
  return (b.winPct ?? 0) - (a.winPct ?? 0)
    || (b.totalWins ?? 0) - (a.totalWins ?? 0)
    || (b.netPts ?? 0) - (a.netPts ?? 0);
}

function topSeeds(standings, conferenceName, teams) {
  const list = standings.filter(s => (s.conferenceName || '').toLowerCase().includes(conferenceName));
  if (!list.length) return Array.from({ length: 7 }, (_, i) => `${i + 1}) N/A`);
  list.sort(seedSort);
  const seeds = list.slice(0, 7).map((s, idx) => {
    const name = teams[s.teamId] || 'Team';
    const record = formatRecord(s);
    const seed = s.seed || idx + 1;
    return `${seed}) ${name} — ${record}`;
  });
  while (seeds.length < 7) seeds.push(`${seeds.length + 1}) N/A`);
  return seeds;
}

export async function updatePlayoffPicture(client, leagueId, guildId = null) {
  const resolvedGuildId = guildId || client?.guilds?.cache?.first?.()?.id || null;
  const snapshot = loadSnapshot(leagueId);
  const seasonInfo = snapshot?.info?.careerHubInfo?.seasonInfo || {};
  const displayWeek = seasonInfo.displayWeek ?? seasonInfo.seasonWeek ?? 0;
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
    subtitle: `Season ${seasonInfo.seasonNumber ?? seasonInfo.seasonIndex ?? 'Current'} • Week ${displayWeek || '?'}`,
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
