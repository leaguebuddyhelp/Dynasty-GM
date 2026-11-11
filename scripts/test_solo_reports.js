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
assert.match(leaderboardEmbed.description, /\*\*71 OVR\*\*/);
assert.doesNotMatch(leaderboardEmbed.description, /form|Madden OVR|\(\+\d+\)/i);
assert.doesNotMatch(leaderboardEmbed.footer.text, /snapshot-1/);
const rankedReport = buildSoloReportSnapshot({
  ...snapshot,
  rosters: { teams: { 1: { rosterInfoList: Array.from({ length: 12 }, (_, index) => ({
    rosterId: `qb-${index}`, firstName: 'Player', lastName: String(index).padStart(2, '0'),
    position: 'QB', playerBestOvr: 70 + index,
  })) } } },
});
assert.deepEqual(rankedReport.leaderboards.QB.map((entry) => entry.ovr), [81, 80, 79, 78, 77, 76, 75, 74, 73, 72]);
assert.equal(rankedReport.leaderboards.QB.every((entry) => !('performanceRating' in entry)), true);
assert.equal(buildLeaderboardEmbed(rankedReport).toJSON().description.split('\n').filter((line) => /OVR\*\*/.test(line)).length, 10);
const teamOverallsEmbed = buildTeamOverallsEmbed(report).toJSON();
assert.match(teamOverallsEmbed.description, /OFF \*\*\d+\*\* · DEF \*\*\d+\*\*/);
assert.doesNotMatch(teamOverallsEmbed.description, /Snapshot/);
assert.ok(teamOverallsEmbed.description.length < 4096);

const variedTeams = Array.from({ length: 32 }, (_, index) => ({
  teamId: index + 1, cityName: `City${index + 1}`, displayName: `Team${index + 1}`,
}));
const modernPositions = ['QB', 'HB', 'WR', 'WR', 'WR', 'TE', 'LT', 'LG', 'C', 'RG', 'RT',
  'LEDGE', 'REDGE', 'DT', 'DT', 'SAM', 'MIKE', 'WILL', 'CB', 'CB', 'FS', 'SS', 'K', 'P'];
const variedRosters = Object.fromEntries(variedTeams.map((team, index) => [
  String(team.teamId),
  { rosterInfoList: modernPositions.map((position, playerIndex) => ({
    rosterId: 10000 + index * 100 + playerIndex,
    firstName: position, lastName: `Player${playerIndex}`, position,
    playerBestOvr: 74 + (index * 9 / 31),
  })) },
]));
const variedReport = buildSoloReportSnapshot({
  ...snapshot, teams: { leagueTeamInfoList: variedTeams }, rosters: { teams: variedRosters },
});
assert.equal(variedReport.sourceValidation.completeTeamRatings, 32);
assert.equal(variedReport.teamOveralls[0].teamId, '32');
assert.equal(variedReport.teamOveralls.at(-1).teamId, '1');
assert.equal(Math.round(variedReport.teamOveralls[0].total), 92);
assert.equal(Math.round(variedReport.teamOveralls.at(-1).total), 74);
assert.equal(new Set(variedReport.teamOveralls.map((team) => Math.round(team.total))).size >= 15, true);
assert.equal(Math.round(variedReport.teamOveralls[0].defense), 92, 'Modern Madden defensive positions must be included');
assert.equal(Math.round(variedReport.teamOveralls[0].specialTeams), 92, 'Missing return ratings must not hide special teams');
const sameRoster = modernPositions.map((position, index) => ({
  rosterId: 90000 + index, firstName: position, lastName: String(index),
  position, playerBestOvr: 80,
}));
const tiedReport = buildSoloReportSnapshot({
  ...snapshot,
  teams: { leagueTeamInfoList: teams.slice(0, 2) },
  rosters: { teams: { 1: { rosterInfoList: sameRoster }, 2: { rosterInfoList: sameRoster } } },
});
assert.equal(tiedReport.teamOveralls[0].total, tiedReport.teamOveralls[1].total, 'Identical rosters must not be separated by rank');
const incompleteReport = buildSoloReportSnapshot({
  ...snapshot,
  teams: { leagueTeamInfoList: teams.slice(0, 1) },
  rosters: { teams: { 1: { rosterInfoList: [] } } },
});
assert.equal(incompleteReport.teamOveralls[0].rank, null);
assert.match(buildTeamOverallsEmbed(incompleteReport).toJSON().description, /^— /);
console.log('PASS 32-team output, configured team formula, and 21 distinct positional leaderboards');

// Exercise the complete sync-report pipeline without Discord or EA services.
const fs = await import('node:fs/promises');
const path = await import('node:path');
const { Collection } = await import('discord.js');
const { saveGuildMaddenConfig } = await import('../src/shared/madden_guild_config.js');
const { getMaddenLeagueSnapshotPath } = await import('../src/leaguebuddy/paths.js');
const { publishSoloSyncReports, loadSoloReport } = await import('../src/madden/solo_reports.js');
const { persistSyncHistory } = await import('../src/madden/madden_sync_history.js');
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
await persistSyncHistory({ leagueId: snapshot.leagueId, snapshot, summary: {} });
const legacyReportFile = path.join(path.dirname(snapshotFile), '..', 'solo_reports', snapshot.leagueId, `${snapshot.syncId}.json`);
const legacyReport = JSON.parse(await fs.readFile(legacyReportFile, 'utf8'));
legacyReport.version = 1;
legacyReport.leaderboards.QB = [legacyReport.leaderboards.QB[1]];
await fs.writeFile(legacyReportFile, JSON.stringify(legacyReport));
const recoveredReport = await loadSoloReport(snapshot.leagueId, snapshot.syncId);
assert.deepEqual(recoveredReport.leaderboards.QB.map((entry) => entry.ovr), [71, 70], 'Legacy boards must rebuild from the archived roster, not the old top ten');
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
