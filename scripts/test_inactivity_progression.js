import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildWeeklyProgressionRecommendations, buildProgressionCardEmbed } from '../src/madden/progression.js';

const rules = JSON.parse(fs.readFileSync('config/madden_solo_rules.json', 'utf8')).progression;
const roster = [
  { rosterId: 'absent', firstName: 'Absent', lastName: 'QB', position: 'QB', playerBestOvr: 80, awareRating: 80 },
  { rosterId: 'starter', firstName: 'Starter', lastName: 'QB', position: 'QB', playerBestOvr: 80, awareRating: 80, throwAccShortRating: 80 },
  { rosterId: 'injured', firstName: 'Injured', lastName: 'QB', position: 'QB', playerBestOvr: 80, awareRating: 80, injuryLength: 4 },
  { rosterId: 'line', firstName: 'Line', lastName: 'LT', position: 'LT', playerBestOvr: 80, awareRating: 80 },
];
const snapshot = {
  leagueId: 'inactive-test', syncId: 'test', calendarYear: 2026,
  teams: { leagueTeamInfoList: [{ teamId: 1, cityName: 'Test', nickName: 'Team' }, { teamId: 2, cityName: 'Other', nickName: 'Team' }] },
  rosters: { teams: { 1: { rosterInfoList: roster }, 2: { rosterInfoList: [] } } },
  schedule: { schedules: [] }, weeklyStats: [],
};
const history = { periods: {}, seasonAwards: {} };
function addGame(index) {
  snapshot.schedule.schedules.push({ stageIndex: 1, weekIndex: index, status: 2, homeTeamId: 1, awayTeamId: 2 });
  snapshot.weeklyStats.push({ stage: 1, weekIndex: index, passing: { playerPassingStatInfoList: [
    { rosterId: 'starter', teamId: 1, passAtt: 30, passComp: 20, passYds: 250, passTDs: 2 },
  ] } });
}
function evaluate(index, target = snapshot, past = history) {
  return buildWeeklyProgressionRecommendations(target, { weekIndex: index, history: past, rules });
}
for (const index of [0, 1, 3]) {
  addGame(index);
  const record = evaluate(index);
  assert.ok(!record.recommendations.some((item) => item.playerKey === 'roster:absent'));
  history.periods[record.periodKey] = record;
}
addGame(4);
const fourth = evaluate(4);
const inactive = fourth.recommendations.find((item) => item.playerKey === 'roster:absent');
assert.equal(inactive?.direction, 'downgrade');
assert.equal(inactive.attributes[0].attribute, 'Awareness');
assert.equal(inactive.attributes[0].points, -1);
assert.equal(inactive.changeContext.inactivityGames, 4);
assert.ok(!fourth.recommendations.some((item) => ['roster:injured', 'roster:line'].includes(item.playerKey)));
assert.match(JSON.stringify(buildProgressionCardEmbed(fourth, inactive).toJSON()), /does not confirm a DNP/);
history.periods[fourth.periodKey] = fourth;
assert.equal(evaluate(4).recommendations.find((item) => item.playerKey === 'roster:absent').changeContext.inactivityGames, 4);

const unknown = structuredClone(history);
delete unknown.periods.year_2026_week_2.inactivityObservations['roster:absent'];
assert.ok(!evaluate(4, snapshot, unknown).recommendations.some((item) => item.playerKey === 'roster:absent'));
const changedTeam = structuredClone(history);
changedTeam.periods.year_2026_week_2.inactivityObservations['roster:absent'].teamId = '2';
assert.ok(!evaluate(4, snapshot, changedTeam).recommendations.some((item) => item.playerKey === 'roster:absent'));
const incomplete = structuredClone(snapshot);
delete incomplete.weeklyStats.find((entry) => entry.weekIndex === 4).passing;
assert.ok(!evaluate(4, incomplete).recommendations.some((item) => item.playerKey === 'roster:absent'));
const notFinished = structuredClone(snapshot);
notFinished.schedule.schedules.find((entry) => entry.weekIndex === 4).status = 1;
assert.ok(!evaluate(4, notFinished).recommendations.some((item) => item.playerKey === 'roster:absent'));
const played = structuredClone(snapshot);
played.weeklyStats.find((entry) => entry.weekIndex === 4).passing.playerPassingStatInfoList.push({
  rosterId: 'absent', teamId: 1, passAtt: 1, passYds: 0,
});
assert.ok(!evaluate(4, played).recommendations.some((item) => item.playerKey === 'roster:absent'));
const injuredNow = structuredClone(snapshot);
injuredNow.rosters.teams[1].rosterInfoList[0].injuryLength = 1;
assert.ok(!evaluate(4, injuredNow).recommendations.some((item) => item.playerKey === 'roster:absent'));

const poorRules = structuredClone(rules);
poorRules.weekly.positions.DEF.scale = 100;
poorRules.weekly.positions.DEF.weights = { defTotalTackles: 1 };
poorRules.weekly.performanceWeight = 1;
poorRules.weekly.expectationWeight = 0;
const poor = {
  leagueId: 'poor-test', syncId: 'poor', calendarYear: 2026,
  teams: snapshot.teams,
  rosters: { teams: { 1: { rosterInfoList: [{ rosterId: 'cb', firstName: 'Low', lastName: 'CB', position: 'CB', playerBestOvr: 80, awareRating: 80 }] } } },
  schedule: { schedules: Array.from({ length: 3 }, (_, weekIndex) => ({
    stageIndex: 1, weekIndex, status: 2, homeTeamId: 1, awayTeamId: 2,
  })) },
  weeklyStats: Array.from({ length: 3 }, (_, weekIndex) => ({
    stage: 1, weekIndex, defense: { playerDefensiveStatInfoList: [{ rosterId: 'cb', teamId: 1, defTotalTackles: 2 }] },
  })),
};
const poorHistory = { periods: {}, seasonAwards: {} };
for (let index = 0; index < 2; index++) {
  const record = buildWeeklyProgressionRecommendations(poor, { weekIndex: index, rules: poorRules, history: poorHistory });
  poorHistory.periods[record.periodKey] = record;
  assert.ok(!record.recommendations.some((item) => item.playerKey === 'roster:cb'));
}
const poorRecord = buildWeeklyProgressionRecommendations(poor, { weekIndex: 2, rules: poorRules, history: poorHistory });
const poorResult = poorRecord.recommendations.find((item) => item.playerKey === 'roster:cb');
assert.equal(poorResult?.direction, 'downgrade');
assert.equal(poorResult.attributes[0].attribute, 'Awareness');
assert.equal(poorResult.consistency.poorStreak, 3);
assert.ok(poorResult.attributes[0].points < 0);
const noPoorHistory = buildWeeklyProgressionRecommendations(poor, { weekIndex: 2, rules: poorRules });
assert.ok(!noPoorHistory.recommendations.some((item) => item.playerKey === 'roster:cb'));
console.log('PASS cautious inactivity streaks, byes, missing data, injuries, trades, and sustained poor performance');
