import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getFranchisePhase } from '../src/madden/franchise_phase.js';
import { buildWeeklyProgressionRecommendations, resolveProgressionWeek } from '../src/madden/progression.js';

assert.equal(getFranchisePhase({ currentWeek: 1, info: { careerHubInfo: { seasonInfo: { seasonWeekType: 8, seasonTitle: 'Playoffs', offSeasonStage: 10 } } } }), 'offseason');
assert.equal(getFranchisePhase({ currentWeek: 1, info: { careerHubInfo: { seasonInfo: { seasonWeekType: 0, seasonTitle: 'Playoffs', offSeasonStage: 10 } } } }), 'preseason');
assert.equal(getFranchisePhase({ currentWeek: 23, info: { careerHubInfo: { seasonInfo: { seasonWeekType: 5, seasonTitle: 'Playoffs', offSeasonStage: 10 } } } }), 'playoffs');
const rules = JSON.parse(fs.readFileSync('config/madden_solo_rules.json', 'utf8')).progression;
const calibrated = structuredClone(rules);
// These fixtures isolate gameplay strength and round volume; cap policy has its own integration tests.
calibrated.populationCaps.enabled = false;
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
// Playoff volume scales with the teams that actually played, not the regular
// season's league-wide target. Each team has both strong and poor performers.
const round = snapshot(80, { games: 1 });
round.currentWeek = 20;
round.info = { careerHubInfo: { seasonInfo: { seasonWeekType: 2 } } };
round.teams.leagueTeamInfoList = Array.from({ length: 14 }, (_, index) => ({ teamId: index + 1 }));
round.rosters.teams = {};
const roundRows = [];
for (let teamId = 1; teamId <= 14; teamId++) {
  round.rosters.teams[teamId] = { rosterInfoList: Array.from({ length: 8 }, (_, index) => ({
    ...template, rosterId: `team-${teamId}-player-${index}`, lastName: `${teamId}-${index}`,
  })) };
  for (const [index, player] of round.rosters.teams[teamId].rosterInfoList.entries()) roundRows.push({
    ...statTemplate, rosterId: player.rosterId, teamId, passTDs: index < 6 ? 4 : 0, passInts: index < 6 ? 0 : 4,
  });
}
round.weeklyStats = [{ stage: 1, weekIndex: 18, passing: { playerPassingStatInfoList: roundRows } }];
round.schedule = { schedules: Array.from({ length: 6 }, (_, index) => ({ stageIndex: 1, weekIndex: 18,
  status: 2, homeTeamId: index * 2 + 1, awayTeamId: index * 2 + 2 })) };
const wildCard = buildWeeklyProgressionRecommendations(round, { rules: calibrated, weekIndex: 18 });
assert.equal(wildCard.recommendations.length, 60, 'Twelve playing teams may earn five changes each, exceeding the regular-season league cap');
assert.deepEqual(wildCard.selectionDiagnostics.playoffPerTeamRange, [1, 5]);
assert.ok(Object.values(wildCard.selectionDiagnostics.teamCounts).every((count) => count === 5));
assert.ok(wildCard.recommendations.every((item) => Number(item.teamId) <= 12), 'Byes and eliminated teams are excluded even with stale stats');
const superBowl = structuredClone(round);
superBowl.schedule.schedules = [superBowl.schedule.schedules[0]];
const finalists = buildWeeklyProgressionRecommendations(superBowl, { rules: calibrated, weekIndex: 18 });
assert.equal(finalists.recommendations.length, 10, 'Two playing teams stop at ten changes without filling to twenty');
assert.ok(finalists.recommendations.some((item) => item.direction === 'upgrade'));
assert.ok(finalists.recommendations.some((item) => item.direction === 'downgrade'));
const smallSample = structuredClone(superBowl);
smallSample.weeklyStats[0].passing.playerPassingStatInfoList = roundRows.filter((row) => row.rosterId === 'team-1-player-0');
const supported = buildWeeklyProgressionRecommendations(smallSample, { rules: calibrated, weekIndex: 18 });
assert.equal(supported.recommendations.length, 1, 'One supported player is sufficient; missing evidence cannot create extra changes');
assert.equal(supported.selectionDiagnostics.teamCounts['2'], 0);
const noStakes = structuredClone(calibrated);
delete noStakes.weekly.playoffStakes;
for (const poor of [false, true]) {
  const stakesWeek = snapshot(85, { poor, games: 2 });
  stakesWeek.currentWeek = 20;
  stakesWeek.info = { careerHubInfo: { seasonInfo: { seasonWeekType: 2 } } };
  stakesWeek.weeklyStats.forEach((week, index) => { week.weekIndex = 17 + index; });
  stakesWeek.schedule.schedules.forEach((game, index) => { game.weekIndex = 17 + index; });
  const original = structuredClone(stakesWeek);
  const base = buildWeeklyProgressionRecommendations(stakesWeek, { weekIndex: 18, rules: noStakes }).recommendations[0];
  const boosted = buildWeeklyProgressionRecommendations(stakesWeek, { weekIndex: 18, rules: calibrated }).recommendations[0];
  assert.equal(boosted.direction, poor ? 'downgrade' : 'upgrade');
  assert.equal(Math.abs(boosted.totalAttributePoints), Math.abs(base.totalAttributePoints) + 1, 'Good and bad playoff performances receive one modest extra earned point');
  assert.deepEqual(boosted.changeContext.playoffStakes, { multiplier: 1.15, extraAttributePoints: 1 });
  assert.deepEqual(boosted.attributes.map((a) => a.field), base.attributes.map((a) => a.field), 'Stakes cannot invent a new attribute');
  assert.ok(boosted.attributes.every((a) => Math.abs(a.points) <= 5 && a.targetValue >= 0 && a.targetValue <= 99));
  assert.deepEqual(stakesWeek, original);
  stakesWeek.rosters.teams[1].rosterInfoList[0].injuryLength = 3;
  if (poor) assert.equal(buildWeeklyProgressionRecommendations(stakesWeek, { weekIndex: 18, rules: calibrated }).recommendations.length, 0);
}
const finale = snapshot(85, { games: 2 });
finale.currentWeek = 19; finale.info = { careerHubInfo: { seasonInfo: { seasonWeekType: 2 } } };
finale.weeklyStats.forEach((week, index) => { week.weekIndex = 16 + index; });
finale.schedule.schedules.forEach((game, index) => { game.weekIndex = 16 + index; });
assert.deepEqual(buildWeeklyProgressionRecommendations(finale, { weekIndex: 17, rules: calibrated }).recommendations,
  buildWeeklyProgressionRecommendations(finale, { weekIndex: 17, rules: noStakes }).recommendations,
  'First playoff sync evaluating regular-season Week 18 must not receive playoff stakes');
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
console.log('PASS weekly 20-player fill from eight primary candidates, smaller evidence-backed changes, playoff 1–5 changes per playing team without a league quota, offseason blocking, and correct completed-week selection');
