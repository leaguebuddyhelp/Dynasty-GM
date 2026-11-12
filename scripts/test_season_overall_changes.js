import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildSeasonOverallChanges, publishProgressionReports, refreshProgressionForAwardChange, refreshProgressionForSeasonAwardChange, repairProgressionReportNavigation, isSeasonMovementDue } from '../src/madden/progression.js';
import { persistSyncHistory } from '../src/madden/madden_sync_history.js';
import { saveGuildMaddenConfig } from '../src/shared/madden_guild_config.js';
import { getMaddenDataFilePath, getMaddenLeaguesDir, getMaddenConfigPath, getMaddenLeagueSnapshotPath } from '../src/leaguebuddy/paths.js';

const seasonSummaryInfo = ({ teamCount, baseline, partial }) => ({ teamCount, baseline, partial });
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
let failOverview = false;
const parentMessages = new Map();
const channel = {
  id: 'upgrades', guild, isTextBased: () => true,
  threads: { fetchActive: async () => ({ threads: [] }), fetchArchived: async () => ({ threads: [] }) },
  messages: { fetch: async (id) => { if (!parentMessages.has(id)) throw Object.assign(new Error('Missing'), { code: 10008 }); return parentMessages.get(id); } },
  send: async (payload) => {
    if (payload.embeds) {
      summaries.push(payload);
      const message = { id: `summary-${++sequence}`, payload, pinned: true, pin: async () => {},
        edit: async (updated) => { message.payload = updated; summaries.push(updated); return message; } };
      parentMessages.set(message.id, message);
      return message;
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
            if (failOverview && next.embeds?.some((embed) => embed.toJSON().title === '📊 Season OVR Changes')) {
              failOverview = false;
              throw new Error('Simulated OVR report failure');
            }
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
const indexPath = `${getMaddenLeaguesDir()}/history/${leagueId}/index.json`;
const archiveIndex = JSON.parse(await fs.readFile(indexPath, 'utf8'));
archiveIndex.records.unshift({ syncId: 'missing-old-archive', syncedAt: '2000-01-01T00:00:00Z' });
await fs.writeFile(indexPath, JSON.stringify(archiveIndex));
const first = await publishProgressionReports({ client, guildId, snapshot: end });
assert.deepEqual(seasonSummaryInfo(first.seasonChanges), { teamCount: 2, baseline: 'Week 4', partial: true });
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
assert.deepEqual(seasonSummaryInfo(completeBaseline.seasonChanges), { teamCount: 2, baseline: 'Week 1', partial: false });
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
await persistSyncHistory({ leagueId, snapshot: seasonStart, summary: {} });
await persistSyncHistory({ leagueId, snapshot: seasonEnd, summary: {} });
const totalBefore = falcons.storedMessages.size;
const published = await publishProgressionReports({ client, guildId, snapshot: seasonEnd });
assert.equal(published.recommendationCount, 30, 'Only the final regular-season weekly batch is issued, capped at 30');
assert.equal(published.type, 'weekly');
assert.match(published.reportUrl, /discord.com\/channels/);
assert.equal(published.seasonChanges, undefined, 'Wild-card week cannot publish top 10 lists before manual ratings are applied');
const periodHistoryPath = getMaddenDataFilePath(`progression_history/${leagueId}.json`);
const underfilledHistory = JSON.parse(await fs.readFile(periodHistoryPath, 'utf8'));
const underfilledPeriod = underfilledHistory.periods[published.periodKey];
underfilledPeriod.recommendations = underfilledPeriod.recommendations.slice(0, 8);
underfilledPeriod.gameplayPolicyVersion = 1;
const issuedTargets = underfilledPeriod.recommendations.map((item) => item.attributes);
await fs.writeFile(periodHistoryPath, JSON.stringify(underfilledHistory));
const repaired = await publishProgressionReports({ client, guildId, snapshot: seasonEnd });
assert.equal(repaired.recommendationCount, 30, 'An older frozen eight-player week can fill to the weekly target');
const repairedHistory = JSON.parse(await fs.readFile(periodHistoryPath, 'utf8'));
assert.deepEqual(repairedHistory.periods[published.periodKey].recommendations.slice(0, 8).map((item) => item.attributes), issuedTargets, 'Previously issued targets remain unchanged');
assert.equal(falcons.storedMessages.size, totalBefore + 6, 'First playoff week posts six rating-change pages without an OVR list');
assert.equal(isSeasonMovementDue(seasonEnd), false);
const playoffWeekTwo = structuredClone(seasonEnd);
playoffWeekTwo.currentWeek = 20;
playoffWeekTwo.syncId = 'second-playoff-week';
playoffWeekTwo.rosters.teams[1].rosterInfoList[0].playerBestOvr = 80;
const secondWeek = await publishProgressionReports({ client, guildId, snapshot: playoffWeekTwo });
assert.equal(isSeasonMovementDue(playoffWeekTwo), true);
assert.deepEqual(seasonSummaryInfo(secondWeek.seasonChanges), { teamCount: 2, baseline: 'Week 1', partial: false });
const newMessages = [...falcons.storedMessages.values()].slice(totalBefore);
assert.equal(newMessages.length, 7, 'Second playoff week adds the OVR overview while retaining the issued attribute cards');
const offseasonOverview = newMessages.find((message) => message.payload.embeds[0].toJSON().title === '📊 Season OVR Changes');
assert.match(offseasonOverview.payload.embeds[0].toJSON().fields[0].value, /75 → 80 \(\+5\)/, 'Top 10 uses newly imported ratings after first-week manual changes');
await publishProgressionReports({ client, guildId, snapshot: playoffWeekTwo });
assert.equal(falcons.storedMessages.size, totalBefore + 7, 'Repeated second-week syncs refresh the same overview');
await publishProgressionReports({ client, guildId, snapshot: seasonEnd });
assert.match(offseasonOverview.payload.embeds[0].toJSON().description, /second playoff week/, 'Premature reports from older versions become waiting notices');
assert.equal(offseasonOverview.payload.embeds[0].toJSON().fields, undefined);
await publishProgressionReports({ client, guildId, snapshot: playoffWeekTwo });
assert.equal(falcons.storedMessages.size, totalBefore + 7, 'Publishing after deferral reuses the existing overview');
const postseason = structuredClone(seasonEnd);
postseason.info.careerHubInfo.seasonInfo.seasonWeekType = 3;
postseason.currentWeek = 28;
postseason.syncId = 'after-playoffs';
postseason.rosters.teams[1].rosterInfoList.forEach((player) => { player.throwAccShortRating = 95; });
postseason.rosters.teams[1].rosterInfoList[0].playerBestOvr = 80;
postseason.rosters.teams[1].rosterInfoList[1].playerBestOvr = 70;
postseason.weeklyStats.push({ ...postseason.weeklyStats[0], stage: 2, weekIndex: 18 });
await persistSyncHistory({ leagueId, snapshot: postseason, summary: {} });
const laterBatch = await publishProgressionReports({ client, guildId, snapshot: postseason });
assert.equal(laterBatch.type, 'season_summary', 'Offseason only updates the OVR overview');
assert.equal(laterBatch.recommendationCount, 0, 'Offseason never creates rating changes');
assert.deepEqual(seasonSummaryInfo(laterBatch.seasonChanges), { teamCount: 2, baseline: 'Week 1', partial: false });
const refreshedOverview = offseasonOverview.payload.embeds[0].toJSON();
assert.deepEqual(refreshedOverview.fields.map((field) => field.name), ['📈 Top 10 Growers', '📉 Top 10 Fallers']);
assert.match(refreshedOverview.fields[0].value, /75 → 80 \(\+5\)/);
assert.match(refreshedOverview.fields[1].value, /75 → 70 \(-5\)/);
assert.equal(falcons.storedMessages.size, totalBefore + 7, 'Offseason refreshes the existing playoff overview');
postseason.rosters.teams[1].rosterInfoList[0].playerBestOvr = 81;
await publishProgressionReports({ client, guildId, snapshot: postseason });
assert.equal(falcons.storedMessages.size, totalBefore + 7, 'Later offseason syncs update the same overview');
assert.match(offseasonOverview.payload.embeds[0].toJSON().fields[0].value, /75 → 81 \(\+6\)/);
const savedHistory = JSON.parse(await fs.readFile(getMaddenDataFilePath(`progression_history/${leagueId}.json`), 'utf8'));
assert.ok(!savedHistory.periods.year_2029_offseason, 'No retired annual rating batch is saved');
assert.ok(savedHistory.periods.year_2029_ovr_summary);

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
assert.equal(lineReport.recommendationCount, 0, 'Offseason cannot create offensive-line rating changes');
const replacedLineEnd = structuredClone(lineEnd);
replacedLineEnd.syncId = 'line-offseason-updated';
replacedLineEnd.rosters.teams[1].rosterInfoList.push({
  rosterId: 'better-lt', firstName: 'New', lastName: 'Starter', position: 'LT',
  playerBestOvr: 90, runBlockRating: 90,
});
await persistSyncHistory({ leagueId, snapshot: replacedLineEnd, summary: {} });
const replacedLineReport = await publishProgressionReports({ client, guildId, snapshot: replacedLineEnd });
assert.equal(replacedLineReport.recommendationCount, 0, 'Former starter must be removed and a new starter must not inherit historical evidence');
assert.equal(falcons.storedMessages.size, beforeLine + 1, 'Only the season OVR overview is created');

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
assert.match(JSON.stringify(summaries.findLast((payload) => payload.embeds[0].toJSON().title === '🏈 Franchise Progression').embeds[0].toJSON()), /Missing Winner/);
await fs.writeFile(getMaddenDataFilePath('awards.json'), JSON.stringify({
  [leagueId]: { 19: { afc_offense: { rosterId: 'playoff-winner' }, nfc_offense: { rosterId: 'playoff-missing' } }, __seasonByWeek: { 19: 'year_2031' } },
}));
const afterPlayoff = falcons.storedMessages.size;
const retry = await refreshProgressionForAwardChange({ client, guildId, leagueId, snapshot: playoffWeek, weekNumber: 19 });
assert.equal(retry.recommendationCount, 1, 'A sync retry must read the stored playoff awards');
assert.equal(falcons.storedMessages.size, afterPlayoff, 'Retry must edit the existing team post');
for (const stage of [1, 2]) {
  const played = structuredClone(seasonEnd);
  played.info.careerHubInfo.seasonInfo.calendarYear = 2032 + stage;
  played.currentWeek = 20;
  played.syncId = `played-playoff-${stage}`;
  played.weeklyStats.push({ ...structuredClone(played.weeklyStats[0]), stage, weekIndex: 18 });
  played.schedule = { schedules: [{ weekIndex: 18, stageIndex: stage, status: 2, homeTeamId: 1, awayTeamId: 2 }] };
  const report = await publishProgressionReports({ client, guildId, snapshot: played });
  assert.equal(report.type, 'weekly');
  assert.equal(report.periodKey, `year_${2032 + stage}_week_19`);
  assert.ok(report.recommendationCount > 0 && report.recommendationCount <= 30, 'Completed playoff games receive weekly gameplay recommendations for either EA stage encoding');
  assert.ok(report.seasonChanges);
}
const reportFailure = structuredClone(seasonEnd);
reportFailure.info.careerHubInfo.seasonInfo.calendarYear = 2038;
reportFailure.syncId = 'summary-retry';
reportFailure.currentWeek = 20;
failOverview = true;
const failedReport = await publishProgressionReports({ client, guildId, snapshot: reportFailure });
assert.equal(failedReport.recommendationCount, 30, 'A failed OVR list must not block weekly changes');
assert.match(failedReport.seasonChangesError, /Simulated OVR report failure/);
const recoveredReport = await publishProgressionReports({ client, guildId, snapshot: reportFailure });
assert.equal(recoveredReport.seasonChanges.teamCount, 2, 'The next sync retries the missing top-10 lists');
assert.equal(recoveredReport.recommendationCount, 30);
const awardRefresh = await refreshProgressionForSeasonAwardChange({ client, guildId, snapshot: postseason });
assert.equal(awardRefresh.published, false, 'Season awards cannot recreate an annual rating batch');
const configPath = getMaddenConfigPath();
await fs.mkdir(path.dirname(configPath), { recursive: true });
await fs.writeFile(configPath, JSON.stringify({ guilds: { [guildId]: leagueId } }));
await fs.writeFile(getMaddenLeagueSnapshotPath(leagueId), JSON.stringify(reportFailure));
const navigationHistory = JSON.parse(await fs.readFile(periodHistoryPath, 'utf8'));
delete navigationHistory.periods.year_2038_week_18.reportIndexMessages;
delete navigationHistory.periods.year_2038_ovr_summary.reportIndexMessages;
const originalTargets = navigationHistory.periods.year_2038_week_18.recommendations.map((item) => item.attributes);
await fs.writeFile(periodHistoryPath, JSON.stringify(navigationHistory));
const parentCount = parentMessages.size;
const backfilled = await repairProgressionReportNavigation(client, guildId);
assert.equal(backfilled.recommendationCount, 30);
assert.equal(parentMessages.size, parentCount + 2, 'Startup backfills one weekly index and one top-10 index');
const repairedNavigation = JSON.parse(await fs.readFile(periodHistoryPath, 'utf8'));
assert.deepEqual(repairedNavigation.periods.year_2038_week_18.recommendations.map((item) => item.attributes), originalTargets, 'Backfill never issues another set of rating changes');
assert.equal(await repairProgressionReportNavigation(client, guildId), undefined);
assert.equal(parentMessages.size, parentCount + 2, 'Restarting again cannot duplicate the report indexes');
const mixedStages = structuredClone(seasonEnd);
mixedStages.info.careerHubInfo.seasonInfo.calendarYear = 2039;
mixedStages.currentWeek = 20;
mixedStages.syncId = 'mixed-playoff-stages';
mixedStages.weeklyStats.push({ ...structuredClone(mixedStages.weeklyStats[0]), stage: 1, weekIndex: 18 }, { stage: 2, weekIndex: 18 });
mixedStages.schedule = { schedules: [{ stageIndex: 1, weekIndex: 18, status: 2, homeTeamId: 1, awayTeamId: 2 }] };
await fs.writeFile(getMaddenLeagueSnapshotPath(leagueId), JSON.stringify(mixedStages));
const brokenHistory = JSON.parse(await fs.readFile(periodHistoryPath, 'utf8'));
brokenHistory.periods.year_2039_week_19 = { ...brokenHistory.periods.year_2038_week_18,
  periodKey: 'year_2039_week_19', seasonKey: 'year_2039', weekIndex: 18, weekNumber: 19,
  recommendations: [], teamMessages: {}, reportIndexMessages: {}, statusById: {} };
delete brokenHistory.periods.year_2039_week_19.playoffStatsVersion;
await fs.writeFile(periodHistoryPath, JSON.stringify(brokenHistory));
const repairedPlayoff = await repairProgressionReportNavigation(client, guildId);
assert.equal(repairedPlayoff.periodKey, 'year_2039_week_19');
assert.equal(repairedPlayoff.recommendationCount, 5, 'A saved zero-player playoff report is repaired from actual stage-1 stats without another EA import');
assert.equal(await repairProgressionReportNavigation(client, guildId), undefined, 'The repaired report is not reissued on every restart');
console.log('PASS saved playoff-stat repair, weekly/season indexes, startup replay without EA, and repeat-sync deduplication');
