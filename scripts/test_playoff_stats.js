import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizePlayoffProgressionSnapshot } from '../src/madden/playoff_stats.js';
import { buildWeeklyProgressionRecommendations, resolveProgressionWeek } from '../src/madden/progression.js';
const rules = JSON.parse(fs.readFileSync('config/madden_solo_rules.json', 'utf8')).progression;
const players = Array.from({ length: 24 }, (_, index) => ({ rosterId: `qb-${index}`, firstName: 'Playoff', lastName: `${index}`, position: 'QB', yearsPro: 5,
  playerBestOvr: 80, throwAccShortRating: 80, throwAccMidRating: 80, throwAccDeepRating: 80, throwPowerRating: 80, playActionRating: 80, awareRating: 80 }));
const row = (player) => ({ rosterId: player.rosterId, teamId: 1, position: 'QB', passAtt: 30, passComp: 24, passYds: 350, passTDs: 4, passInts: 0, passLongest: 50 });
const snapshot = {
  leagueId: 'playoff-stage-regression', syncId: 'stage-regression', currentWeek: 20, calendarYear: 2026,
  info: { careerHubInfo: { seasonInfo: { seasonWeekType: 2 } } },
  teams: { leagueTeamInfoList: [{ teamId: 1, cityName: 'Denver', nickName: 'Broncos' }, { teamId: 2, cityName: 'Other', nickName: 'Team' }] },
  rosters: { teams: { 1: { rosterInfoList: players } } },
  schedule: { schedules: [
    { stageIndex: 1, weekIndex: 18, status: 2, homeTeamId: 1, awayTeamId: 2, homeScore: 35, awayScore: 17 },
    { stageIndex: 2, weekIndex: 18, status: 0, homeTeamId: 1, awayTeamId: 2 },
  ] },
  weeklyStats: [
    { stage: 1, weekIndex: 18, passing: { playerPassingStatInfoList: players.map(row) } },
    { stage: 2, weekIndex: 18, passing: { playerPassingStatInfoList: [] } },
    { stage: 0, weekIndex: 18 },
  ],
};
const normalized = normalizePlayoffProgressionSnapshot(snapshot);
assert.equal(normalized.weeklyStats.length, 1);
assert.equal(normalized.weeklyStats[0].passing.playerPassingStatInfoList.length, 24, 'Empty stage 2 cannot discard actual stage-1 playoff stats');
assert.equal(normalized.schedule.schedules.length, 1);
assert.equal(normalized.schedule.schedules[0].status, 2, 'Pending stage-2 schedule cannot replace completed stage-1 games');
assert.equal(resolveProgressionWeek(snapshot), 18);
assert.equal(buildWeeklyProgressionRecommendations(normalized, { weekIndex: 18, rules }).recommendations.length, 24);
const duplicate = structuredClone(snapshot);
duplicate.weeklyStats[1].passing.playerPassingStatInfoList = players.map(row);
const deduped = normalizePlayoffProgressionSnapshot(duplicate);
assert.equal(deduped.weeklyStats[0].passing.playerPassingStatInfoList.length, 24);
assert.equal(deduped.weeklyStats[0].passing.playerPassingStatInfoList[0].passYds, 350, 'Duplicate stage exports are never summed');
const split = structuredClone(snapshot);
split.weeklyStats[1].receiving = { playerReceivingStatInfoList: [{ rosterId: 'wr', teamId: 1, recCatches: 5, recYds: 100, recTDs: 1 }] };
assert.equal(normalizePlayoffProgressionSnapshot(split).weeklyStats[0].receiving.playerReceivingStatInfoList.length, 1);
assert.equal(normalizePlayoffProgressionSnapshot(split).weeklyStats[0].passing.playerPassingStatInfoList.length, 24);
const fallback = structuredClone(snapshot);
fallback.weeklyStats[0].stage = 0;
assert.equal(buildWeeklyProgressionRecommendations(normalizePlayoffProgressionSnapshot(fallback), { weekIndex: 18, rules }).recommendations.length, 24, 'Stage-0 playoff fallback retains real stats');
const empty = structuredClone(snapshot);
empty.weeklyStats[0].passing.playerPassingStatInfoList = [];
assert.equal(resolveProgressionWeek(empty), null, 'Empty completed-week placeholders do not become zero-evidence reports');
assert.deepEqual(normalizePlayoffProgressionSnapshot(normalized), normalized, 'Normalizing an already-normalized export is safe');
console.log('PASS real playoff stats survive empty stage-2 exports, split buckets, stage-0 fallback, schedule placeholders, and duplicate exports');
