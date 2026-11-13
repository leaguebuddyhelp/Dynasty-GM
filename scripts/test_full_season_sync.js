import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Collection } from 'discord.js';
import { runFullSeasonSync, resolveSyncMode } from '../src/madden/full_season.js';
import { loadFullSeasonRun, matchesFullSeason, findArchivedSeasonBaseline, isStartingSeasonSnapshot, saveFullSeasonRun } from '../src/madden/full_season_store.js';
import { publishProgressionReports, refreshProgressionForAwardChange, buildFullSeasonCardEmbeds, repairProgressionReportNavigation } from '../src/madden/progression.js';
import { publishWeeklyAwards, updateAwards } from '../src/madden/awards.js';
import { saveGuildMaddenConfig } from '../src/shared/madden_guild_config.js';
import { getFranchisePhase } from '../src/madden/franchise_phase.js';
import { getMaddenConfigPath, getMaddenLeagueSnapshotPath, getMaddenDataFilePath } from '../src/leaguebuddy/paths.js';

const guildId = 'full-season-guild', leagueId = 'full-season-league';
process.env.MADDEN_FRANCHISE_MANAGER_ROLE_ID = 'manager';
const teams = Array.from({ length: 32 }, (_, index) => ({ teamId: index + 1, cityName: `City${index}`, nickName: `Club${index}`, divisionName: index < 16 ? 'AFC East' : 'NFC East' }));
const player = (id, position, teamId) => ({ rosterId: id, firstName: 'Season', lastName: id, position, yearsPro: teamId === 1 ? 0 : 5, playerBestOvr: 80,
  awareRating: 75, throwAccShortRating: 75, throwAccMidRating: 75, throwAccDeepRating: 75, throwPowerRating: 75, playActionRating: 75,
  tackleRating: 75, zoneCoverRating: 75, playRecRating: 75, pursuitRating: 75, manCoverRating: 75 });
const baseline = { leagueId, syncId: 'baseline', syncedAt: new Date().toISOString(), season: 1, currentWeek: 1,
  info: { careerHubInfo: { seasonInfo: { calendarYear: 2027, seasonIndex: 1, seasonWeekType: 1 } } },
  teams: { leagueTeamInfoList: teams }, rosters: { teams: Object.fromEntries(teams.map((team) => [team.teamId, { rosterInfoList: [player(`q${team.teamId}`, 'QB', team.teamId), player(`d${team.teamId}`, 'CB', team.teamId)] }])) }, weeklyStats: [], schedule: { schedules: [] } };
const final = structuredClone(baseline);
final.syncId = 'final'; final.currentWeek = 19;
final.info.careerHubInfo.seasonInfo.calendarYear = 2028;
final.info.careerHubInfo.seasonInfo.seasonWeekType = 2;
final.schedule.schedules = Array.from({ length: 18 }, (_, weekIndex) => Array.from({ length: 16 }, (_, index) => ({ weekIndex, stageIndex: 1, status: 2, homeTeamId: index * 2 + 1, awayTeamId: index * 2 + 2, homeScore: 31, awayScore: 14 }))).flat();
final.weeklyStats = Array.from({ length: 18 }, (_, weekIndex) => ({ weekIndex, stage: 1,
  passing: { playerPassingStatInfoList: teams.map(({ teamId }) => ({ rosterId: `q${teamId}`, teamId, position: 'QB', passAtt: 30,
    passComp: teamId % 2 ? 24 : 8, passYds: teamId % 2 ? 350 : 40, passTDs: teamId % 2 ? 4 : 0, passInts: teamId % 2 ? 0 : 3, passLongest: teamId % 2 ? 55 : 10 })) },
  defense: { playerDefensiveStatInfoList: teams.map(({ teamId }) => ({ rosterId: `d${teamId}`, teamId, position: 'CB', defTotalTackles: 8, defInts: teamId % 4 ? 0 : 1, defPassDeflections: 2 })) },
}));
for (const roster of Object.values(final.rosters.teams)) for (const row of roster.rosterInfoList) row.awareRating = 80;
let sequence = 0, failAward = true, failCombined = true, seasonPageSends = 0;
const channels = new Map(), parentMessages = new Map(), awardMessages = new Map(), threads = new Collection();
function message(payload, store) {
  const row = { id: `message-${++sequence}`, payload, pinned: true, pin: async () => {}, edit: async (next) => { row.payload = next; return row; } };
  store.set(row.id, row); return row;
}
const fetchMessage = (store) => async (id) => { if (!store.has(id)) throw Object.assign(new Error('Missing'), { code: 10008 }); return store.get(id); };
const manager = { id: 'manager', mentionable: true };
const guild = { roles: { cache: new Map([['manager', manager]]) }, members: { fetch: async () => ({ roles: { cache: new Map([['manager', manager]]) } }) } };
const parent = { id: 'upgrades', guild, isTextBased: () => true,
  messages: { fetch: fetchMessage(parentMessages) },
  threads: { fetchActive: async () => ({ threads }), fetchArchived: async () => ({ threads: new Collection() }) },
  send: async (payload) => {
    const row = message(payload, parentMessages);
    row.startThread = async ({ name }) => createThread(name);
    return row;
  } };
function createThread(name) {
  const store = new Map();
  const thread = { id: `thread-${++sequence}`, name, archived: false, store, isThread: () => true,
    messages: { fetch: fetchMessage(store) }, send: async (value) => {
      if (failCombined && value.embeds?.[0]?.toJSON().footer?.text.includes('Summed season changes') && seasonPageSends++ >= 1) {
        failCombined = false; throw new Error('Combined report outage');
      }
      return message(value, store);
    } };
  threads.set(thread.id, thread); channels.set(thread.id, thread); return thread;
}
// Simulate the permanent team threads already used by weekly reports.
for (const team of teams) createThread(`${team.cityName} ${team.nickName}`);
const existingThreadIds = [...threads.keys()];
channels.set('upgrades', parent);
channels.set('awards', { isTextBased: () => true, send: async (payload) => {
  if (failAward && awardMessages.size === 4) { failAward = false; throw new Error('Award publication outage'); }
  return message(payload, awardMessages);
} });
const client = { channels: { fetch: async (id) => channels.get(id) } };
saveGuildMaddenConfig(guildId, { status: 'complete', compat: { maddenChannelMap: { 'Player Upgrades': 'upgrades', Awards: 'awards' } } });
const sync = (snapshot) => runFullSeasonSync({ client, guildId, snapshot });
// A normal Week 1 sync already archived the real starting roster. A later
// explicit full-season sync must recover it and continue, without requiring a restart.
const recoveryLeague = 'recovered-season-league';
const recoveryFinal = { ...structuredClone(final), leagueId: recoveryLeague };
await assert.rejects(runFullSeasonSync({ client, guildId, snapshot: recoveryFinal }), /No starting baseline/);
const recoveryDirectory = getMaddenDataFilePath(`leagues/history/${recoveryLeague}`);
await fs.mkdir(recoveryDirectory, { recursive: true });
const archive = [
  { ...structuredClone(baseline), leagueId: recoveryLeague, syncId: 'week-one', syncedAt: '2026-11-12T12:00:00Z' },
  { ...structuredClone(baseline), leagueId: recoveryLeague, syncId: 'preseason', syncedAt: '2026-11-12T11:00:00Z' },
  { ...structuredClone(baseline), leagueId: recoveryLeague, syncId: 'wrong-season', syncedAt: '2026-11-12T13:00:00Z' },
  { ...structuredClone(recoveryFinal), syncId: 'late-roster', syncedAt: '2026-11-12T14:00:00Z' },
];
archive[1].info.careerHubInfo.seasonInfo.seasonWeekType = 0;
archive[2].info.careerHubInfo.seasonInfo.seasonIndex = 0;
for (const snapshot of archive) await fs.writeFile(`${recoveryDirectory}/${snapshot.syncId}.json`, JSON.stringify(snapshot));
await fs.writeFile(`${recoveryDirectory}/index.json`, JSON.stringify({ records: archive.map((snapshot) => ({ syncId: snapshot.syncId, syncedAt: snapshot.syncedAt })) }));
assert.equal((await findArchivedSeasonBaseline(recoveryFinal)).syncId, 'week-one', 'Recover Week 1 rather than preseason, a different season, or playoff ratings');
const staleWeekOne = structuredClone(archive[0]);
staleWeekOne.weeklyStats = [recoveryFinal.weeklyStats[0]];
assert.equal(isStartingSeasonSnapshot(staleWeekOne), false, 'A stale Week 1 hub label cannot accept played-game stats as a baseline');
const emptyRoster = structuredClone(archive[0]);
emptyRoster.rosters.teams[1].rosterInfoList = [];
assert.equal(isStartingSeasonSnapshot(emptyRoster), false);
const recoveryCheckpoint = { ...structuredClone(recoveryFinal), currentWeek: 9 };
recoveryCheckpoint.info.careerHubInfo.seasonInfo.seasonWeekType = 1;
recoveryCheckpoint.weeklyStats = recoveryCheckpoint.weeklyStats.slice(0, 8);
const recoveryPlayoffs = { ...structuredClone(recoveryFinal), weeklyStats: recoveryCheckpoint.weeklyStats };
const recovered = await runFullSeasonSync({ client, guildId, snapshot: recoveryPlayoffs });
assert.equal(recovered.status, 'awaiting_data', 'A playoff recovery must immediately evaluate season coverage, rather than return as if still at Week 1');
assert.equal((await runFullSeasonSync({ client, guildId, snapshot: recoveryCheckpoint })).status, 'collecting');
const recoveredRun = await loadFullSeasonRun(guildId, recoveryLeague);
assert.equal(recoveredRun.recoveredBaseline, true);
assert.equal(recoveredRun.baselineSyncId, 'week-one');
assert.deepEqual(recoveredRun.baseline.rosters, archive[0].rosters);
assert.equal(recoveredRun.coverage.completedWeeks, 8);
assert.equal(awardMessages.size + parentMessages.size, 0);
const prepared = await sync(baseline);
assert.equal(prepared.status, 'prepared');
assert.equal(parentMessages.size + awardMessages.size, 0, 'Preparing a baseline cannot issue any rating or award posts');
const storedBaseline = (await loadFullSeasonRun(guildId, leagueId)).baseline;
const alteredBaseline = structuredClone(baseline); alteredBaseline.rosters.teams[1].rosterInfoList[0].awareRating = 98;
await sync(alteredBaseline);
assert.deepEqual((await loadFullSeasonRun(guildId, leagueId)).baseline, storedBaseline, 'Repeat setup cannot replace the starting baseline');
assert.equal((await resolveSyncMode({ guildId, snapshot: baseline })).mode, 'full-season');
await assert.rejects(resolveSyncMode({ guildId, snapshot: baseline, requestedMode: 'weekly' }), /Full-season mode is active/);
const captured = await updateAwards(null, leagueId, 1, { guildId, snapshot: { ...final, currentWeek: 2, weeklyStats: [final.weeklyStats[0]] }, captureOnly: true, refreshProgression: false });
assert.ok(captured.winners.afc_offense);
await assert.rejects(fs.access(getMaddenDataFilePath('awards.json')), { code: 'ENOENT' });
await assert.rejects(fs.access(getMaddenDataFilePath('season_state.json')), { code: 'ENOENT' });
const checkpoint = structuredClone(final); checkpoint.currentWeek = 9; checkpoint.info.careerHubInfo.seasonInfo.seasonWeekType = 1;
checkpoint.weeklyStats = checkpoint.weeklyStats.slice(0, 8);
assert.equal((await sync(checkpoint)).coverage.completedWeeks, 8);
assert.equal(awardMessages.size, 0);
assert.equal((await publishProgressionReports({ client, guildId, snapshot: checkpoint })).published, false, 'Normal progression cannot overlap full-season mode');
// A previous failed sync retained a larger export from the wrong year.
const mixedRun = await loadFullSeasonRun(guildId, leagueId);
mixedRun.importedWeeks[5].passing.playerPassingStatInfoList.push({ rosterId: 'last-year-only', teamId: 999, seasonIndex: 0, passAtt: 30 });
await saveFullSeasonRun(mixedRun);
const incomplete = structuredClone(final); incomplete.weeklyStats = incomplete.weeklyStats.filter((entry) => entry.weekIndex !== 12);
const waiting = await sync(incomplete);
assert.equal(waiting.status, 'awaiting_data');
assert.deepEqual(waiting.coverage.missingWeeks, [13]);
assert.equal(awardMessages.size, 0, 'Incomplete data cannot produce a claimed full-season report');
const retained = structuredClone(final); retained.weeklyStats = retained.weeklyStats.filter((entry) => entry.weekIndex >= 4);
await assert.rejects(sync(retained), /Award publication outage/);
assert.equal(awardMessages.size, 4);
const calculationTime = (await loadFullSeasonRun(guildId, leagueId)).calculatedAt;
assert.ok(!(await loadFullSeasonRun(guildId, leagueId)).importedWeeks[5].passing.playerPassingStatInfoList.some((row) => row.rosterId === 'last-year-only'));
assert.equal((await loadFullSeasonRun(guildId, leagueId)).coverage.complete, true, 'A saved checkpoint preserves older weeks missing from the final EA response');
await assert.rejects(sync(retained), /Combined report outage/);
assert.equal(awardMessages.size, 18, 'Retry resumes only the remaining weekly award posts');
const firstPosition = [...threads.values()].find((thread) => thread.name === 'QB');
assert.equal(firstPosition.store.size, 1, 'The first position page was saved before a later page failed');
const result = await sync(retained);
assert.equal(result.status, 'complete');
assert.equal(result.awardsPosted, 18);
assert.equal(result.seasonChanges, undefined, 'First playoff season sync must wait until the first offseason week to show OVR risers/fallers');
assert.equal(result.weeklyTallies.length, 18);
assert.equal((await loadFullSeasonRun(guildId, leagueId)).calculatedAt, calculationTime, 'Publication retries do not recalculate issued targets');
assert.ok(result.seasonTotals.positivePoints > 0 && result.seasonTotals.negativePoints > 0);
assert.match(result.reportUrl, /discord.com/);
const titles = [...awardMessages.values()].map((row) => row.payload.embeds[0].toJSON().title);
assert.equal(new Set(titles).size, 18);
assert.ok(titles[0].includes('Week 1') && titles[17].includes('Week 18'));
const combined = [...parentMessages.values()].find((row) => row.payload.embeds?.[0]?.toJSON().title.includes('Season Changes by Position'));
assert.equal(combined.payload.files.length, 2);
assert.match(combined.payload.files[0].attachment.toString(), /Gross upgrades/);
assert.match(combined.payload.files[1].attachment.toString(), /Virtual rating before/);
const positionNames = ['QB', 'HB', 'FB', 'WR', 'TE', 'LT', 'LG', 'C', 'RG', 'RT', 'LEDG', 'REDG', 'DT', 'SAM', 'MIKE', 'WILL', 'CB', 'FS', 'SS', 'K', 'P'];
assert.ok(positionNames.every((name) => [...threads.values()].some((thread) => thread.name === name)));
assert.ok([...threads.values()].some((thread) => thread.name === 'Season Results'));
assert.equal(threads.size, existingThreadIds.length + 22, 'Create 21 position threads plus Season Results; do not recreate extra team threads');
const seasonCards = [...threads.values()].flatMap((thread) => [...thread.store.values()].flatMap((message) => message.payload.embeds || []))
  .map((embed) => embed.toJSON()).filter((embed) => embed.footer?.text.includes('Summed season changes'));
assert.ok(seasonCards.some((embed) => embed.title.startsWith('QB · Season Total')));
assert.ok(seasonCards.some((embed) => embed.title.startsWith('CB · Season Total')));
assert.ok(seasonCards.every((embed) => embed.description.includes('**Club') && embed.footer.text.includes('ONCE')));
assert.ok([...parentMessages.values()].every((message) => !message.payload.embeds?.some((embed) => embed.toJSON().footer?.text.includes('Summed season changes'))),
  'Player changes belong in position threads; the parent channel contains navigation and summary only');
const mixedCards = buildFullSeasonCardEmbeds({ player: 'Mixed Player', team: 'Denver Broncos', position: 'WR', attributes: [
  { attribute: 'Catching', net: 4, positive: 7, negative: 3, currentValue: 80, targetValue: 84, pointsToApply: 4 },
  { attribute: 'Awareness', net: -2, positive: 1, negative: 3, currentValue: 80, targetValue: 78, pointsToApply: -2 },
  { attribute: 'Short Route Running', net: 0, positive: 2, negative: 2, currentValue: 80, targetValue: 80, pointsToApply: 0 },
] }, 'year_2027').map((embed) => embed.toJSON());
assert.equal(mixedCards.length, 2, 'Mixed results get separate upgrade and downgrade cards in the same team thread');
assert.match(mixedCards[0].description, /80 → 84 \(\+4\)/);
assert.match(mixedCards[1].description, /80 → 78 \(-2\)/);
assert.ok(mixedCards.every((embed) => !embed.description.includes('Short Route Running')), 'Net-zero attributes need no Madden update');
const counts = [parentMessages.size, awardMessages.size, [...threads.values()].reduce((sum, thread) => sum + thread.store.size, 0)];
assert.equal((await sync(retained)).duplicate, true);
assert.deepEqual([parentMessages.size, awardMessages.size, [...threads.values()].reduce((sum, thread) => sum + thread.store.size, 0)], counts);
const mode = await resolveSyncMode({ guildId, snapshot: final });
assert.equal(mode.mode, 'weekly', 'After finalization the default returns to weekly playoff sync');
assert.equal(matchesFullSeason(await loadFullSeasonRun(guildId, leagueId), final), true, 'January calendar changes cannot lose the armed season');
assert.equal((await publishWeeklyAwards({ client, guildId, snapshot: final, dedupScope: 'year_2027_1_full' })).duplicate, true, 'Normal sync cannot repost a regular-season award after the combined list');
const regularAgain = await publishProgressionReports({ client, guildId, snapshot: final });
assert.equal(regularAgain.recommendationCount, 0, 'Week 18 cannot be issued a second time after aggregation');
assert.equal((await refreshProgressionForAwardChange({ client, guildId, snapshot: final, weekNumber: 18 })).published, false);
const savedBeforeDeletion = await loadFullSeasonRun(guildId, leagueId);
for (const thread of threads.values()) channels.delete(thread.id);
threads.clear();
const latestRatingsChanged = structuredClone(final);
latestRatingsChanged.rosters.teams[1].rosterInfoList[0].awareRating = 98;
await publishProgressionReports({ client, guildId, snapshot: latestRatingsChanged });
assert.equal(threads.size, 22, 'Next normal sync recreates only 21 position threads and Season Results');
assert.equal(awardMessages.size, 18, 'Rebuilding position threads cannot repost awards');
const afterRebuild = await loadFullSeasonRun(guildId, leagueId);
assert.deepEqual(afterRebuild.application, savedBeforeDeletion.application, 'Reposting saved season totals cannot recompute targets from newer Madden ratings');
assert.equal(afterRebuild.calculatedAt, calculationTime);
const rebuiltQb = [...threads.values()].find((thread) => thread.name === 'QB');
assert.ok([...rebuiltQb.store.values()].some((message) => message.payload.embeds[0].toJSON().title.startsWith('QB · Season Total')));
const playoffs = structuredClone(final); playoffs.currentWeek = 20;
playoffs.weeklyStats.push({ ...structuredClone(final.weeklyStats[0]), weekIndex: 18, stage: 1 });
playoffs.schedule.schedules.push({ weekIndex: 18, stageIndex: 1, status: 2, homeTeamId: 1, awayTeamId: 2, homeScore: 28, awayScore: 7 });
const playoffReport = await publishProgressionReports({ client, guildId, snapshot: playoffs });
assert.equal(playoffReport.type, 'weekly');
const seasonResults = [...threads.values()].find((thread) => thread.name === 'Season Results');
assert.equal(seasonResults.store.size, 0, 'Playoff Week 2 must not post the top-10 recap');
const weeklyQbPages = [...rebuiltQb.store.values()].filter((message) => message.payload.embeds[0].toJSON().title.startsWith('QB · Week 19'));
assert.equal(weeklyQbPages.length, 1, 'One weekly embed combines all QB changes across teams');
assert.equal(weeklyQbPages[0].payload.embeds.length, 1);
await publishProgressionReports({ client, guildId, snapshot: playoffs });
assert.equal([...rebuiltQb.store.values()].filter((message) => message.payload.embeds[0].toJSON().title.startsWith('QB · Week 19')).length, 1, 'Repeat sync updates the weekly position embed without duplicating it');
assert.equal(threads.size, 22, 'Second playoff week cannot recreate team threads');
const offseason = structuredClone(playoffs);
offseason.info.careerHubInfo.seasonInfo.seasonWeekType = 8;
offseason.info.careerHubInfo.seasonInfo.seasonTitle = 'Playoffs';
offseason.info.careerHubInfo.seasonInfo.weekTitle = 'Offseason';
assert.equal(getFranchisePhase(offseason), 'offseason', 'Native offseason code overrides stale Playoffs title');
offseason.info.careerHubInfo.seasonInfo.seasonWeek = 0;
offseason.currentWeek = 24;
const offseasonReport = await publishProgressionReports({ client, guildId, snapshot: offseason });
assert.equal(offseasonReport.recommendationCount, 0, 'Offseason recaps cannot issue rating changes');
assert.ok([...seasonResults.store.values()].some((message) => message.payload.embeds[0].toJSON().title.startsWith('Top 10 Risers / Fallers')));
const recapMessageCount = seasonResults.store.size;
await publishProgressionReports({ client, guildId, snapshot: offseason });
assert.equal(seasonResults.store.size, recapMessageCount, 'Repeated offseason syncs edit the same recap');
const fullSeasonOffseason = await sync(offseason);
assert.equal(fullSeasonOffseason.seasonChanges.teamCount, 32, 'Full-season mode must also publish the offseason recap after completed totals');
assert.equal(fullSeasonOffseason.duplicate, true);
assert.equal(awardMessages.size, 18);
assert.equal((await loadFullSeasonRun(guildId, leagueId)).calculatedAt, calculationTime);
const deferred = await publishProgressionReports({ client, guildId, snapshot: playoffs });
assert.equal(deferred.seasonChangesError, undefined, 'Deferring previously posted position recaps must work without missing imports or legacy thread registries');
assert.ok([...seasonResults.store.values()].every((message) => message.payload.embeds[0].toJSON().title.includes('Offseason Week 1')));
await publishProgressionReports({ client, guildId, snapshot: offseason });
assert.equal(seasonResults.store.size, recapMessageCount, 'The first offseason sync reuses the deferred position recap pages');
const history = JSON.parse(await fs.readFile(getMaddenDataFilePath(`progression_history/${leagueId}.json`), 'utf8'));
assert.ok(history.periods.year_2028_week_19.recommendations.every((row) => ['1', '2'].includes(row.teamId)));
// Deployment recovery publishes the waiting recap from saved data, without EA
// login, new ratings, or another interaction from the user.
await publishProgressionReports({ client, guildId, snapshot: playoffs });
await fs.mkdir(getMaddenDataFilePath('leagues'), { recursive: true });
await fs.writeFile(getMaddenLeagueSnapshotPath(leagueId), JSON.stringify(offseason));
await fs.writeFile(getMaddenConfigPath(), JSON.stringify({ guilds: { [guildId]: leagueId } }));
const repairedRecap = await repairProgressionReportNavigation(client, guildId);
assert.equal(repairedRecap.seasonChanges.teamCount, 32);
assert.equal(repairedRecap.recommendationCount, 0);
assert.equal(await repairProgressionReportNavigation(client, guildId), undefined, 'Completed recap repair is not repeated on every startup');
assert.equal(seasonResults.store.size, recapMessageCount, 'Repair edits existing recap messages rather than duplicating them');
const emptyWeek = { ...structuredClone(baseline), leagueId: 'empty-position-week', syncId: 'empty-position-sync' };
assert.equal((await publishProgressionReports({ client, guildId, snapshot: emptyWeek })).threadCount, 21);
assert.equal(threads.size, 22, 'An empty active week keeps the position layout instead of creating team threads');
console.log('PASS full-season preparation, checkpoint retention, all 18 weekly awards, position threads, saved-total rebuild after deletion, combined/audit CSVs, retry safety, year boundary, and return to weekly playoffs');
