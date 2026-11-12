import assert from 'node:assert/strict';
import {
  getApplicationEmojiData,
  getTeamApplicationEmoji,
  getTeamApplicationEmojiData,
  refreshApplicationEmojiMap,
} from '../src/shared/application_emojis.js';
import { buildLeaderboardEmbed } from '../src/madden/solo_reports.js';
import { buildRosterEmbeds } from '../src/madden/coach/roster.js';

process.env.CLIENT_ID = '1569827861638938634';
const abbreviations = ['ari', 'atl', 'bal', 'buf', 'car', 'chi', 'cin', 'cle', 'dal', 'den', 'det', 'gb', 'hou', 'ind', 'jax', 'kc', 'lac', 'lar', 'lv', 'mia', 'min', 'ne', 'no', 'nyg', 'nyj', 'phi', 'pit', 'sea', 'sf', 'tb', 'ten', 'was'];
for (const abbreviation of abbreviations) assert.match(getTeamApplicationEmoji(abbreviation), /^<:[a-z]+:\d{19}>$/, abbreviation);
assert.equal(getTeamApplicationEmoji('Arizona Cardinals'), '<:ari:1569836903870758912>');
assert.equal(getTeamApplicationEmoji('AZ'), '<:ari:1569836903870758912>');
assert.equal(getApplicationEmojiData('az').id, '1569836901244866641');
assert.equal(getTeamApplicationEmoji('Jacksonville Jaguars'), '<:jax:1569836888469274736>');
assert.equal(getTeamApplicationEmoji('Washington Commanders'), '<:was:1569836871931003111>');
assert.equal(getTeamApplicationEmoji('Unknown Team', '—'), '—');
const leaderboard = buildLeaderboardEmbed({
  syncId: 'emoji-test', syncedAt: '2026-11-10T00:00:00.000Z',
  leaderboards: { QB: [{ rank: 1, player: 'Test Player', team: 'Arizona Cardinals', ovr: 90 }] },
}).toJSON();
assert.ok(leaderboard.description.includes('<:ari:1569836903870758912>'));
const roster = buildRosterEmbeds({
  teams: { leagueTeamInfoList: [{ teamId: 1, cityName: 'Arizona', displayName: 'Cardinals' }] },
  rosters: { teams: { 1: { rosterInfoList: [{ position: 'QB', firstName: 'Test', lastName: 'Player', playerBestOvr: 90 }] } } },
}, 'Arizona Cardinals');
assert.ok(roster.embeds[0].toJSON().description.includes('<:ari:1569836903870758912>'));
const mockClient = (id, values) => ({ application: {
  id, fetch: async () => {}, emojis: { fetch: async () => new Map(values.map((value) => [value.id, value])) },
} });
await refreshApplicationEmojiMap(mockClient(process.env.CLIENT_ID, [{ name: 'az', id: '9999999999999999999', animated: true }]));
assert.equal(getTeamApplicationEmoji('Arizona Cardinals'), '<a:az:9999999999999999999>', 'Live aliases override bundled IDs');
assert.equal(getTeamApplicationEmojiData('ARI').animated, true);
assert.equal(getTeamApplicationEmoji('Atlanta Falcons'), '', 'Do not reuse deleted IDs after a successful fetch');
await refreshApplicationEmojiMap({ application: { id: process.env.CLIENT_ID, fetch: async () => { throw new Error('Simulated emoji API outage'); } } });
assert.equal(getTeamApplicationEmoji('Atlanta Falcons'), '<:atl:1569836901857361930>', 'Known IDs remain available during an API outage');
await refreshApplicationEmojiMap(mockClient('1111111111111111111', []));
assert.equal(getTeamApplicationEmoji('Arizona Cardinals'), '', 'Never reuse emojis from a different app');
console.log('PASS all 32 team aliases, supplied emoji IDs, report rendering, live overrides, outage fallback, and app isolation');
