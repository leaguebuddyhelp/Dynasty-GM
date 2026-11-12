import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildWeeklyProgressionRecommendations, resolveProgressionWeek } from '../src/madden/progression.js';

const rules = JSON.parse(fs.readFileSync('config/madden_solo_rules.json', 'utf8')).progression;
const calibrated = structuredClone(rules);
calibrated.weekly.performanceWeight = 1;
calibrated.weekly.expectationWeight = 0;
calibrated.weekly.positions.QB.weights = { passTDs: 20 };
calibrated.weekly.positions.QB.scale = 100;
const legacy = structuredClone(calibrated);
delete legacy.weekly.gameplayMovement;
function snapshot(ovr, { poor = false, games = 2, injuryLength = 0, limited = false } = {}) {
  return {
    leagueId: 'gameplay-weekly', syncId: `gameplay-${games}`, currentWeek: games + 1, calendarYear: 2026,
    teams: { leagueTeamInfoList: [{ teamId: 1, cityName: 'Arizona', nickName: 'Cardinals' }] },
    rosters: { teams: { 1: { rosterInfoList: [{
      rosterId: 'player', firstName: 'Weekly', lastName: 'Player', position: 'QB', yearsPro: 5, playerBestOvr: ovr, injuryLength,
      throwAccShortRating: ovr, throwAccMidRating: ovr, throwAccDeepRating: ovr,
      throwPowerRating: ovr, playActionRating: ovr, awareRating: ovr,
    }] } } },
    schedule: { schedules: Array.from({ length: games }, (_, weekIndex) => ({ stageIndex: 1, weekIndex, status: 2, homeTeamId: 1, awayTeamId: 2 })) },
    weeklyStats: Array.from({ length: games }, (_, weekIndex) => ({ stage: 1, weekIndex, passing: { playerPassingStatInfoList: [{
      rosterId: 'player', teamId: 1, position: 'QB', passAtt: limited ? 1 : 30, passComp: poor ? 8 : 24,
      passYds: poor ? 40 : 300, passTDs: poor ? 0 : 4, passInts: poor ? 4 : 0, passLongest: poor ? 10 : 55,
    }] } })),
  };
}
function evaluate(target, policy) {
  const history = { periods: {}, seasonAwards: {} };
  let record;
  for (let weekIndex = 0; weekIndex < target.weeklyStats.length; weekIndex++) {
    record = buildWeeklyProgressionRecommendations(target, { weekIndex, rules: policy, history });
    history.periods[record.periodKey] = record;
  }
  return record;
}
for (const ovr of [65, 79, 80, 89, 90, 95]) {
  for (const poor of [false, true]) {
    const target = snapshot(ovr, { poor });
    const current = evaluate(target, calibrated).recommendations[0];
    const previous = evaluate(target, legacy).recommendations[0];
    assert.ok(current && previous);
    assert.equal(current.direction, poor ? 'downgrade' : 'upgrade');
    assert.ok(Math.abs(current.totalAttributePoints) > Math.abs(previous.totalAttributePoints), `Stronger weekly movement at ${ovr} OVR, poor=${poor}`);
    assert.equal(current.changeContext.gameplayMomentum, true);
    assert.ok(current.attributes.every((attribute) => Math.abs(attribute.points) <= 5 && attribute.targetValue >= 0 && attribute.targetValue <= 99));
  }
}
const selectedAgain = evaluate(snapshot(80), calibrated).recommendations[0];
assert.equal(selectedAgain.selectionAdjustments.recentSelectionPenalty, 2, 'A small recent-selection penalty gives other deserving players a chance');
assert.ok(selectedAgain.selectionScore >= calibrated.weekly.minimumUpgradeSelectionScore, 'Repeated strong performers remain eligible');
const single = evaluate(snapshot(80, { games: 1 }), calibrated).recommendations[0];
assert.equal(single.changeContext.gameplayMomentum, false, 'One game does not earn a sustained-performance bonus');
assert.equal(evaluate(snapshot(80, { limited: true }), calibrated).recommendations.length, 0);
assert.equal(evaluate(snapshot(90, { poor: true, injuryLength: 2 }), calibrated).recommendations.length, 0);
const recovery = snapshot(90, { poor: true, games: 4 });
recovery.weeklyStats.at(-1).passing.playerPassingStatInfoList[0].passTDs = 5;
assert.ok(!evaluate(recovery, calibrated).recommendations.some((item) => item.direction === 'downgrade'), 'A strong current game cannot receive a stale poor-window downgrade');
const slump = snapshot(80, { games: 4 });
slump.weeklyStats.at(-1).passing.playerPassingStatInfoList[0].passTDs = 0;
assert.ok(!evaluate(slump, calibrated).recommendations.some((item) => item.direction === 'upgrade'), 'A poor current game cannot receive an upgrade from stale strong games');
const crowd = snapshot(75, { games: 1 });
const template = crowd.rosters.teams[1].rosterInfoList[0];
crowd.rosters.teams[1].rosterInfoList = Array.from({ length: 28 }, (_, index) => ({ ...template, rosterId: `crowd-${index}` }));
const statTemplate = crowd.weeklyStats[0].passing.playerPassingStatInfoList[0];
crowd.weeklyStats[0].passing.playerPassingStatInfoList = Array.from({ length: 28 }, (_, index) => ({ ...statTemplate, rosterId: `crowd-${index}`, passTDs: index < 8 ? 4 : 3 }));
const filled = evaluate(crowd, calibrated);
assert.equal(filled.recommendations.length, 20, 'Eight primary players plus supported smaller changes reach the weekly minimum');
assert.equal(filled.selectionDiagnostics.primaryEligible, 8);
assert.equal(filled.selectionDiagnostics.reserveSelected, 12);
assert.ok(filled.recommendations.filter((item) => item.eligibilityTier === 'reserve').every((item) => item.attributes.length <= 2 && item.attributes.every((attribute) => attribute.points === 1)));
const short = structuredClone(crowd);
short.weeklyStats[0].passing.playerPassingStatInfoList = short.weeklyStats[0].passing.playerPassingStatInfoList.slice(0, 8);
assert.equal(evaluate(short, calibrated).recommendations.length, 8, 'Missing gameplay cannot be fabricated to fill the quota');
assert.equal(evaluate(short, calibrated).selectionDiagnostics.targetShortfall, 12);
const playoff = snapshot(80);
playoff.info = { careerHubInfo: { seasonInfo: { seasonWeekType: 2 } } };
playoff.currentWeek = 19;
playoff.weeklyStats = [{ ...playoff.weeklyStats[0], weekIndex: 17 }, { ...playoff.weeklyStats[1], weekIndex: 18, stage: 2 }];
playoff.schedule = { schedules: [{ stageIndex: 2, weekIndex: 18, status: 1, homeTeamId: 1, awayTeamId: 2 }] };
assert.equal(resolveProgressionWeek(playoff), 17, 'First playoff sync evaluates the final regular-season week, not upcoming playoff stats');
playoff.schedule.schedules[0].status = 2;
assert.equal(resolveProgressionWeek(playoff), 18);
const benchTeam = structuredClone(template);
benchTeam.rosterId = 'bye-player';
playoff.rosters.teams[3] = { rosterInfoList: [benchTeam] };
playoff.weeklyStats[1].stage = 1;
playoff.weeklyStats[1].passing.playerPassingStatInfoList.push({ ...statTemplate, rosterId: 'bye-player', teamId: 3 });
const playingOnly = buildWeeklyProgressionRecommendations(playoff, { weekIndex: 18, rules: calibrated });
assert.ok(playingOnly.recommendations.length);
assert.ok(playingOnly.recommendations.every((item) => ['1', '2'].includes(item.teamId)), 'Stale stat rows cannot give bye/eliminated teams changes');
for (const snapshotPhase of [
  { seasonWeekType: 3 }, { seasonWeekType: 8 },
  { seasonWeekType: 1, seasonTitle: '2026 Offseason' },
]) {
  const offseason = { ...playoff, info: { careerHubInfo: { seasonInfo: snapshotPhase } } };
  assert.equal(resolveProgressionWeek(offseason), null, 'Offseason never resolves a rating-change week');
}
const regular = snapshot(80, { games: 2 });
regular.currentWeek = 2;
assert.equal(resolveProgressionWeek(regular), 0, 'Do not evaluate the currently active regular-season week');
console.log('PASS weekly 20-player fill from eight primary candidates, smaller evidence-backed changes, playoff participants, offseason blocking, and correct completed-week selection');
