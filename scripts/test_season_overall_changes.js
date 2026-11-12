import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { buildSeasonOverallChanges, buildOffseasonProgressionRecommendations, publishProgressionReports, refreshProgressionForAwardChange } from '../src/madden/progression.js';
import { persistSyncHistory } from '../src/madden/madden_sync_history.js';
import { saveGuildMaddenConfig } from '../src/shared/madden_guild_config.js';
import { getMaddenDataFilePath } from '../src/leaguebuddy/paths.js';

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
const summaries = [];
let sequence = 0;
const channel = {
  id: 'upgrades', guild, isTextBased: () => true,
  threads: { fetchActive: async () => ({ threads: [] }), fetchArchived: async () => ({ threads: [] }) },
  messages: { fetch: async () => { throw Object.assign(new Error('Missing'), { code: 10008 }); } },
  send: async (payload) => {
    if (payload.embeds) {
      summaries.push(payload);
      return { id: `summary-${++sequence}`, pinned: false, pin: async () => {} };
    }
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

const seasonStart = makeSnapshot('season-start', 1, 1, 2029);
const seasonEnd = makeSnapshot('season-end', 2, 19, 2029);
const seasonPlayers = Array.from({ length: 61 }, (_, index) => ({
  ...makePlayer(`season-${index}`, 75), throwAccShortRating: 75,
}));
seasonStart.rosters.teams[1].rosterInfoList = structuredClone(seasonPlayers);
seasonEnd.rosters.teams[1].rosterInfoList = structuredClone(seasonPlayers);
const poorDefender = { rosterId: 'season-cb', firstName: 'Season', lastName: 'Defender', position: 'CB', playerBestOvr: 85, awareRating: 80 };
seasonStart.rosters.teams[1].rosterInfoList.push(structuredClone(poorDefender));
seasonEnd.rosters.teams[1].rosterInfoList.push(structuredClone(poorDefender));
seasonStart.rosters.teams[2].rosterInfoList = [];
seasonEnd.rosters.teams[2].rosterInfoList = [];
seasonEnd.weeklyStats = Array.from({ length: 18 }, (_, weekIndex) => ({
  stage: 1, weekIndex,
  passing: { playerPassingStatInfoList: seasonPlayers.map((player, index) => ({
    rosterId: player.rosterId, teamId: 1, position: 'QB', passAtt: 30,
    passComp: index === 60 ? 5 : 24, passYds: index === 60 ? 20 : 400,
    passTDs: index === 60 ? 0 : 4, passInts: index === 60 ? 4 : 0,
  })) },
  defense: { playerDefensiveStatInfoList: [{ rosterId: 'season-cb', teamId: 1, position: 'CB', defTotalTackles: 2 }] },
}));
const finaleRules = JSON.parse(await fs.readFile('config/madden_solo_rules.json', 'utf8')).progression;
const evaluateFinale = (snapshot) => buildOffseasonProgressionRecommendations(snapshot, { rules: finaleRules, regularSeasonOnly: true })
  .recommendations.map((item) => ({ playerKey: item.playerKey, score: item.performanceScore, attributes: item.attributes }));
const contaminated = structuredClone(seasonEnd);
const playoffStats = structuredClone(seasonEnd.weeklyStats[0]);
playoffStats.stage = 2;
playoffStats.weekIndex = 18;
playoffStats.passing.playerPassingStatInfoList.forEach((row) => { row.passYds = 0; row.passTDs = 0; row.passInts = 8; });
contaminated.weeklyStats.push(playoffStats, { ...playoffStats, stage: 1 });
assert.deepEqual(evaluateFinale(contaminated), evaluateFinale(seasonEnd), 'Playoff stats cannot alter regular-season finale evaluation');
await persistSyncHistory({ leagueId, snapshot: seasonStart, summary: {} });
await persistSyncHistory({ leagueId, snapshot: seasonEnd, summary: {} });
const totalBefore = falcons.storedMessages.size;
const published = await publishProgressionReports({ client, guildId, snapshot: seasonEnd });
assert.equal(published.recommendationCount, 52, 'Playoffs begin with 50 upgrades and two evidenced downgrades');
assert.equal(published.type, 'season_end');
assert.equal(published.selectionDiagnostics.eligibleUpgrades, 60);
const newMessages = [...falcons.storedMessages.values()].slice(totalBefore);
assert.equal(newMessages.length, 11, '52 recommendations require 11 pages at the first playoff sync');
const cards = newMessages.flatMap((entry) => entry.payload.embeds.map((item) => item.toJSON()))
  .filter((entry) => /^(🟢 Upgrade|🟠 Downgrade)/u.test(entry.title));
assert.equal(cards.length, 52);
assert.equal(cards.filter((card) => card.title.startsWith('🟢')).length, 50);
assert.equal(cards.filter((card) => card.title.startsWith('🟠')).length, 2);
const defenderCard = cards.find((card) => /Season Defender/.test(card.title));
assert.match(JSON.stringify(defenderCard), /not a direct measurement/);
assert.match(cards[0].description, /→/);
await publishProgressionReports({ client, guildId, snapshot: seasonEnd });
assert.equal(falcons.storedMessages.size, totalBefore + 11, 'A repeat playoff sync edits the same batch');
const postseason = structuredClone(seasonEnd);
postseason.info.careerHubInfo.seasonInfo.seasonWeekType = 3;
postseason.currentWeek = 28;
postseason.syncId = 'after-playoffs';
postseason.rosters.teams[1].rosterInfoList.forEach((player) => { player.throwAccShortRating = 95; });
postseason.weeklyStats.push({ ...postseason.weeklyStats[0], stage: 2, weekIndex: 18 });
await persistSyncHistory({ leagueId, snapshot: postseason, summary: {} });
const laterBatch = await publishProgressionReports({ client, guildId, snapshot: postseason });
assert.equal(laterBatch.periodKey, published.periodKey, 'No separate offseason upgrade batch');
assert.equal(laterBatch.recommendationCount, 52);
assert.equal(falcons.storedMessages.size, totalBefore + 12, 'Only the actual-OVR overview is added in offseason');
const replayedCards = newMessages.flatMap((entry) => entry.payload.embeds.map((embed) => embed.toJSON()));
assert.ok(replayedCards.some((card) => /75 →/.test(card.description)), 'Previously issued targets remain stable after manual Madden edits');
const partialPlayoffs = structuredClone(seasonEnd);
partialPlayoffs.leagueId = 'partial-playoffs';
partialPlayoffs.weeklyStats = partialPlayoffs.weeklyStats.slice(0, 4);
assert.match((await publishProgressionReports({ client, guildId, snapshot: partialPlayoffs })).reason, /Week 18/);

const lineWeek = makeSnapshot('line-week', 1, 2, 2030);
lineWeek.rosters.teams[1].rosterInfoList = [{
  rosterId: 'season-lt', firstName: 'Season', lastName: 'Lineman', position: 'LT',
  playerBestOvr: 75, runBlockRating: 75,
}];
lineWeek.rosters.teams[2].rosterInfoList = [];
lineWeek.weeklyStats = [{ stage: 1, weekIndex: 0,
  passing: { playerPassingStatInfoList: [{ rosterId: 'other-qb', teamId: 1, passAtt: 30, passSacks: 1 }] },
  rushing: { playerRushingStatInfoList: [{ rosterId: 'other-hb', teamId: 1, rushAtt: 25, rushYds: 150 }] },
}];
await persistSyncHistory({ leagueId, snapshot: lineWeek, summary: {} });
await publishProgressionReports({ client, guildId, snapshot: lineWeek });
const lineEnd = structuredClone(lineWeek);
lineEnd.syncId = 'line-offseason';
lineEnd.info.careerHubInfo.seasonInfo.seasonWeekType = 3;
await persistSyncHistory({ leagueId, snapshot: lineEnd, summary: {} });
const beforeLine = falcons.storedMessages.size;
const lineReport = await publishProgressionReports({ client, guildId, snapshot: lineEnd });
assert.equal(lineReport.recommendationCount, 1, 'Offseason should use the line starter observed during a weekly sync');
const lineCards = [...falcons.storedMessages.values()].slice(beforeLine).flatMap((entry) => entry.payload.embeds.map((item) => item.toJSON()));
assert.ok(lineCards.some((entry) => /Season Lineman/.test(entry.title) && /proxy, not individual blocking stats/.test(JSON.stringify(entry))));
const replacedLineEnd = structuredClone(lineEnd);
replacedLineEnd.syncId = 'line-offseason-updated';
replacedLineEnd.rosters.teams[1].rosterInfoList.push({
  rosterId: 'better-lt', firstName: 'New', lastName: 'Starter', position: 'LT',
  playerBestOvr: 90, runBlockRating: 90,
});
await persistSyncHistory({ leagueId, snapshot: replacedLineEnd, summary: {} });
const replacedLineReport = await publishProgressionReports({ client, guildId, snapshot: replacedLineEnd });
assert.equal(replacedLineReport.recommendationCount, 0, 'Former starter must be removed and a new starter must not inherit historical evidence');
const updatedLineMessages = [...falcons.storedMessages.values()].slice(beforeLine);
assert.ok(updatedLineMessages.some((entry) => /superseded/.test(entry.payload.content || '')), 'Obsolete backup cards should be cleared on repeat sync');
assert.ok(!updatedLineMessages.flatMap((entry) => entry.payload.embeds).some((item) => /Season Lineman|New Starter/.test(item.toJSON().title)));

const playoffWeek = makeSnapshot('playoff-week', 2, 20, 2031);
playoffWeek.rosters.teams[1].rosterInfoList = [
  { rosterId: 'playoff-winner', firstName: 'Playoff', lastName: 'Winner', position: 'QB', yearsPro: 0, playerBestOvr: 90, throwAccShortRating: 80 },
  { rosterId: 'playoff-missing', firstName: 'Missing', lastName: 'Winner', position: 'QB', yearsPro: 0, playerBestOvr: 90 },
];
playoffWeek.rosters.teams[2].rosterInfoList = [];
playoffWeek.weeklyStats = [{ stage: 2, weekIndex: 18, passing: { playerPassingStatInfoList: [
  { rosterId: 'playoff-winner', teamId: 1, position: 'QB', passAtt: 5, passComp: 3, passYds: 10 },
  { rosterId: 'playoff-missing', teamId: 1, position: 'QB', passAtt: 5, passComp: 3, passYds: 10 },
] } }];
await persistSyncHistory({ leagueId, snapshot: playoffWeek, summary: {} });
const beforePlayoff = falcons.storedMessages.size;
const playoffReport = await refreshProgressionForAwardChange({
  client, guildId, leagueId, snapshot: playoffWeek, weekNumber: 19,
  winners: { afc_offense: { rosterId: 'playoff-winner' }, nfc_offense: { rosterId: 'playoff-missing' } },
});
assert.equal(playoffReport.recommendationCount, 1);
assert.equal(playoffReport.unupgradedAwardWinners[0].player, 'Missing Winner');
const playoffCards = [...falcons.storedMessages.values()].slice(beforePlayoff).flatMap((entry) => entry.payload.embeds.map((item) => item.toJSON()));
assert.ok(playoffCards.some((card) => /Playoff Winner/.test(card.title) && /weekly award/i.test(JSON.stringify(card))));
assert.match(JSON.stringify(summaries.at(-1).embeds[0].toJSON()), /Missing Winner/);
await fs.writeFile(getMaddenDataFilePath('awards.json'), JSON.stringify({
  [leagueId]: { 19: { afc_offense: { rosterId: 'playoff-winner' }, nfc_offense: { rosterId: 'playoff-missing' } }, __seasonByWeek: { 19: 'year_2031' } },
}));
const afterPlayoff = falcons.storedMessages.size;
const retry = await refreshProgressionForAwardChange({ client, guildId, leagueId, snapshot: playoffWeek, weekNumber: 19 });
assert.equal(retry.recommendationCount, 1, 'A sync retry must read the stored playoff awards');
assert.equal(falcons.storedMessages.size, afterPlayoff, 'Retry must edit the existing team post');
console.log('PASS season OVR comparisons, first-playoff finale batch, postseason exclusion, stable targets, duplicate prevention, and season rollover');
