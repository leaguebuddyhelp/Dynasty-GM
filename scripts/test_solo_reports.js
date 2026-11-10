#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildLeaderboardEmbed,
  buildSoloReportSnapshot,
  buildTeamOverallsEmbed,
  SOLO_POSITION_ORDER,
} from '../src/madden/solo_reports.js';

const teams = Array.from({ length: 32 }, (_, index) => ({
  teamId: index + 1,
  cityName: `City${index + 1}`,
  displayName: `Team${index + 1}`,
}));
const offenseSlots = { QB: 1, HB: 1, FB: 1, WR: 3, TE: 1, LT: 1, LG: 1, C: 1, RG: 1, RT: 1 };
const defenseSlots = { LE: 1, RE: 1, DT: 2, LOLB: 1, MLB: 1, ROLB: 1, CB: 2, FS: 1, SS: 1 };
let rosterId = 1;
const rosterInfoList = [];
for (const [position, count] of Object.entries({ ...offenseSlots, ...defenseSlots, K: 1, P: 1 })) {
  for (let index = 0; index < count * 2; index += 1) {
    rosterInfoList.push({
      rosterId: rosterId++,
      firstName: position,
      lastName: `Player${index}`,
      position,
      playerBestOvr: 70 + index,
      kickReturnRating: position === 'HB' || position === 'WR' ? 80 - index : undefined,
    });
  }
}
const snapshot = {
  syncId: 'snapshot-1',
  syncedAt: '2026-11-10T00:00:00.000Z',
  leagueId: 'league-1',
  currentWeek: 3,
  teams: { leagueTeamInfoList: teams },
  rosters: { teams: { '1': { rosterInfoList } } },
};
const report = buildSoloReportSnapshot(snapshot);
assert.equal(report.teamOveralls.length, 32);
assert.equal(report.teamOveralls.filter((team) => team.complete).length, 1);
assert.equal(report.teamOveralls[0].teamId, '1');
assert.equal(
  Math.abs(report.teamOveralls[0].total - (
    report.teamOveralls[0].offense * 0.45
    + report.teamOveralls[0].defense * 0.45
    + report.teamOveralls[0].specialTeams * 0.1
  )) < 1e-10,
  true,
);
assert.deepEqual(Object.keys(report.leaderboards), SOLO_POSITION_ORDER);
assert.equal(report.leaderboards.QB.length, 2);
assert.equal(report.leaderboards.QB[0].ovr > report.leaderboards.QB[1].ovr, true);
assert.equal(report.sourceValidation.teamCount, 32);
const leaderboardEmbed = buildLeaderboardEmbed(report).toJSON();
assert.match(leaderboardEmbed.title, /Player Overalls/);
assert.match(leaderboardEmbed.description, /🥇/);
assert.doesNotMatch(leaderboardEmbed.footer.text, /snapshot-1/);
const teamOverallsEmbed = buildTeamOverallsEmbed(report).toJSON();
assert.match(teamOverallsEmbed.description, /OFF \*\*\d+\*\* · DEF \*\*\d+\*\*/);
assert.doesNotMatch(teamOverallsEmbed.description, /Snapshot/);
assert.ok(teamOverallsEmbed.description.length < 4096);
console.log('PASS 32-team output, configured team formula, and 21 distinct positional leaderboards');

// Exercise the complete sync-report pipeline without Discord or EA services.
const fs = await import('node:fs/promises');
const path = await import('node:path');
const { Collection } = await import('discord.js');
const { saveGuildMaddenConfig } = await import('../src/shared/madden_guild_config.js');
const { getMaddenLeagueSnapshotPath } = await import('../src/leaguebuddy/paths.js');
const { publishSoloSyncReports } = await import('../src/madden/solo_reports.js');
const { SOLO_CHANNELS } = await import('../src/madden/staff/madden-setup.js');
const { updateWeeklyGameLog } = await import('../src/madden/weekly_game_log.js');
const snapshotFile = getMaddenLeagueSnapshotPath(snapshot.leagueId);
await fs.mkdir(path.dirname(snapshotFile), { recursive: true });
await fs.writeFile(snapshotFile, JSON.stringify(snapshot));
const channelMap = Object.fromEntries(SOLO_CHANNELS.map(([key], index) => [key, `report-channel-${index}`]));
saveGuildMaddenConfig('guild-1', { status: 'complete', compat: { maddenChannelMap: channelMap, maddenRoleMap: {} } });
const sent = [];
let messageCounter = 0;
const channels = new Collection();
const client = { user: { id: 'bot-1' }, guilds: { cache: new Collection([['guild-1', { id: 'guild-1' }]]) } };
for (const id of Object.values(channelMap)) {
  const messages = new Collection();
  const channel = {
    id, client, guildId: 'guild-1', isTextBased: () => true,
    messages: {
      fetch: async (query) => {
        if (typeof query === 'object') return messages;
        const message = messages.get(query);
        if (!message) throw Object.assign(new Error('Unknown message'), { code: 10008 });
        return message;
      },
      fetchPinned: async () => [...messages.values()].filter((message) => message.pinned),
    },
    send: async (payload) => {
      const message = {
        id: `report-message-${++messageCounter}`, author: client.user, embeds: payload.embeds || [], pinned: false,
        components: payload.components || [],
        pin: async () => { message.pinned = true; },
        edit: async (next) => {
          message.embeds = next.embeds || [];
          message.components = next.components || [];
          return message;
        },
      };
      sent.push({ channelId: id, payload });
      messages.set(message.id, message);
      return message;
    },
  };
  channels.set(id, channel);
}
client.channels = { fetch: async (id) => channels.get(id) };
updateWeeklyGameLog(snapshot.leagueId, snapshot);
const published = await publishSoloSyncReports({ client, guildId: 'guild-1', snapshot });
assert.equal(published.playerOverallsPosted, true);
assert.equal(published.teamOverallsPosted, true);
for (const [name, state] of Object.entries(published.refreshedReports)) assert.equal(state.updated, true, `${name}: ${state.error || ''}`);
assert.equal(published.refreshedReports.dashboard.updated, true);
assert.ok(sent.some((item) => item.channelId === channelMap['Franchise Dashboard']));
assert.equal((await publishSoloSyncReports({ client, guildId: 'guild-1', snapshot })).duplicate, true);
const playerChannel = channels.get(channelMap['Player Overalls']);
const teamChannel = channels.get(channelMap['Team Overalls']);
const originalPlayerMessage = (await playerChannel.messages.fetchPinned())[0];
const originalTeamMessage = (await teamChannel.messages.fetchPinned())[0];
assert.ok(originalPlayerMessage);
assert.ok(originalTeamMessage);
const nextSnapshot = {
  ...snapshot,
  syncId: 'snapshot-2',
  currentWeek: 4,
  syncedAt: '2026-11-11T00:00:00.000Z',
};
await fs.writeFile(snapshotFile, JSON.stringify(nextSnapshot));
updateWeeklyGameLog(nextSnapshot.leagueId, nextSnapshot);
const nextPublished = await publishSoloSyncReports({ client, guildId: 'guild-1', snapshot: nextSnapshot });
assert.equal(nextPublished.playerOverallsPosted, true);
assert.equal((await playerChannel.messages.fetchPinned()).length, 1, 'Player overalls should edit its pinned post on the next sync');
assert.equal((await teamChannel.messages.fetchPinned()).length, 1, 'Team overalls should edit its pinned post on the next sync');
assert.equal((await playerChannel.messages.fetchPinned())[0].id, originalPlayerMessage.id);
assert.equal((await teamChannel.messages.fetchPinned())[0].id, originalTeamMessage.id);
assert.match(originalPlayerMessage.embeds[0].toJSON().fields[0].value, /4$/);
assert.match(originalPlayerMessage.components[0].toJSON().components[0].custom_id, /snapshot-2/);
console.log('PASS report styling, pinned player/team updates, dashboard, auxiliary refreshes, and sync deduplication');
