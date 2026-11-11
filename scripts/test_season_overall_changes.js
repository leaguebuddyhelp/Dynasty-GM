import assert from 'node:assert/strict';
import { buildSeasonOverallChanges, publishProgressionReports } from '../src/madden/progression.js';
import { persistSyncHistory } from '../src/madden/madden_sync_history.js';
import { saveGuildMaddenConfig } from '../src/shared/madden_guild_config.js';

if (!process.env.LB_DATA_ROOT) throw new Error('Set LB_DATA_ROOT to an isolated test directory.');
process.env.MADDEN_SOLO_USER_ID = 'operator';
process.env.MADDEN_FRANCHISE_MANAGER_ROLE_ID = 'manager';
const leagueId = 'season-ovr-test';
const guildId = 'season-ovr-guild';
const teams = [
  { teamId: 1, cityName: 'Atlanta', nickName: 'Falcons' },
  { teamId: 2, cityName: 'Los Angeles', nickName: 'Rams' },
];
const makePlayer = (id, ovr) => ({
  rosterId: id, firstName: 'Player', lastName: id, position: 'QB', playerBestOvr: ovr,
});
const makeSnapshot = (syncId, type, week, year = 2026) => ({
  leagueId, syncId, syncedAt: `2026-01-${syncId === 'start' ? '01' : '02'}T00:00:00Z`, currentWeek: week,
  info: { careerHubInfo: { seasonInfo: { seasonWeekType: type, calendarYear: year } } },
  teams: { leagueTeamInfoList: teams },
  rosters: { teams: {
    1: { rosterInfoList: Array.from({ length: 24 }, (_, i) => makePlayer(String(i), 70)) },
    2: { rosterInfoList: [makePlayer('trade', 80)] },
  } },
  weeklyStats: [],
});
const start = makeSnapshot('start', 1, 4);
const end = makeSnapshot('end', 3, 19);
end.rosters.teams[1].rosterInfoList.forEach((player, index) => {
  player.playerBestOvr += index < 12 ? index + 1 : -(index - 11);
});
end.rosters.teams[1].rosterInfoList.push(makePlayer('trade', 85), makePlayer('new', 99));
end.rosters.teams[2].rosterInfoList = [];
const computed = buildSeasonOverallChanges(end, start);
assert.equal(computed.get('1').upgrades.length, 10);
assert.equal(computed.get('1').downgrades.length, 10);
assert.equal(computed.get('1').upgrades[0].change, 12);
assert.equal(computed.get('1').downgrades[0].change, -12);
assert.ok(!computed.get('1').upgrades.some((entry) => entry.key === 'roster:new'));
assert.ok(computed.get('1').upgrades.some((entry) => entry.key === 'roster:trade'));
assert.equal(computed.has('2'), false);

const role = { id: 'manager', mentionable: true };
const guild = {
  roles: { cache: new Map([['manager', role]]) },
  members: { fetch: async () => ({ roles: { cache: new Map([['manager', role]]) } }) },
};
const channels = new Map();
const threadByName = new Map();
let sequence = 0;
const channel = {
  id: 'upgrades', guild, isTextBased: () => true,
  threads: { fetchActive: async () => ({ threads: [] }), fetchArchived: async () => ({ threads: [] }) },
  messages: { fetch: async () => { throw Object.assign(new Error('Missing'), { code: 10008 }); } },
  send: async (payload) => {
    if (payload.embeds) return { id: `summary-${++sequence}`, pinned: false, pin: async () => {} };
    return {
      startThread: async ({ name }) => {
        const messages = new Map();
        const thread = {
          id: `thread-${++sequence}`, name, archived: false, isThread: () => true,
          messages: { fetch: async (id) => {
            if (!messages.has(id)) throw Object.assign(new Error('Missing'), { code: 10008 });
            return messages.get(id);
          } },
          send: async (next) => {
            const message = { id: `message-${++sequence}`, payload: next, edit: async (updated) => { message.payload = updated; } };
            messages.set(message.id, message);
            return message;
          },
          storedMessages: messages,
        };
        channels.set(thread.id, thread);
        threadByName.set(name, thread);
        return thread;
      },
    };
  },
};
channels.set(channel.id, channel);
const client = { channels: { fetch: async (id) => channels.get(id) } };
saveGuildMaddenConfig(guildId, { compat: { maddenChannelMap: { 'Player Upgrades': 'upgrades' } } });
await persistSyncHistory({ leagueId, snapshot: start, summary: {} });
await persistSyncHistory({ leagueId, snapshot: end, summary: {} });
const first = await publishProgressionReports({ client, guildId, snapshot: end });
assert.deepEqual(first.seasonChanges, { teamCount: 2, baseline: 'Week 4', partial: true });
const falcons = threadByName.get('Atlanta Falcons');
const rams = threadByName.get('Los Angeles Rams');
assert.equal(falcons.storedMessages.size, 1);
assert.equal(rams.storedMessages.size, 1);
const message = [...falcons.storedMessages.values()][0];
const embed = message.payload.embeds[0].toJSON();
assert.match(embed.description, /Partial-season comparison/);
assert.match(embed.description, /Week 4/);
assert.equal(embed.fields[0].value.split('\n').length, 10);
assert.equal(embed.fields[1].value.split('\n').length, 10);
assert.match([...rams.storedMessages.values()][0].payload.embeds[0].toJSON().fields[0].value, /No qualifying changes/);
end.rosters.teams[1].rosterInfoList[0].playerBestOvr = 95;
await publishProgressionReports({ client, guildId, snapshot: end });
assert.equal(falcons.storedMessages.size, 1, 'Repeat sync must edit the existing summary');
assert.match(message.payload.embeds[0].toJSON().fields[0].value, /70 → 95 \(\+25\)/);

const missing = makeSnapshot('missing', 3, 19, 2027);
await persistSyncHistory({ leagueId, snapshot: missing, summary: {} });
const noBaseline = await publishProgressionReports({ client, guildId, snapshot: missing });
assert.equal(noBaseline.seasonChanges.baseline, null);
assert.equal(falcons.storedMessages.size, 2, 'A new season needs a distinct summary');
assert.match([...falcons.storedMessages.values()][1].payload.embeds[0].toJSON().description, /No preseason or regular-season snapshot/);
const early = makeSnapshot('early', 1, 1, 2028);
const nextEnd = makeSnapshot('next-end', 3, 19, 2028);
nextEnd.rosters.teams[1].rosterInfoList[0].playerBestOvr = 74;
await persistSyncHistory({ leagueId, snapshot: early, summary: {} });
await persistSyncHistory({ leagueId, snapshot: nextEnd, summary: {} });
const completeBaseline = await publishProgressionReports({ client, guildId, snapshot: nextEnd });
assert.deepEqual(completeBaseline.seasonChanges, { teamCount: 2, baseline: 'Week 1', partial: false });
const completeEmbed = [...falcons.storedMessages.values()][2].payload.embeds[0].toJSON();
assert.doesNotMatch(completeEmbed.description, /Partial-season/);
assert.match(completeEmbed.fields[0].value, /70 → 74 \(\+4\)/);
console.log('PASS season OVR comparisons, partial baselines, team threads, repeat updates, and season rollover');
