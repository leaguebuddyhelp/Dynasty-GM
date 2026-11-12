import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildWeeklyProgressionRecommendations } from '../src/madden/progression.js';

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
console.log('PASS stronger weekly gameplay movement across low/mid/high OVR, evidence/usage/injury guards, and current-game recovery/slump protection');
