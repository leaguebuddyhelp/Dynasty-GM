import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildWeeklyProgressionRecommendations,
  buildOffseasonProgressionRecommendations,
} from '../src/madden/progression.js';

const rules = JSON.parse(fs.readFileSync('config/madden_solo_rules.json', 'utf8')).progression;
const attributes = ['throwAccShortRating', 'throwAccMidRating', 'throwAccDeepRating', 'throwPowerRating', 'playActionRating', 'awareRating'];
function snapshot(ovr, { games = 9, poor = false, weak = false, saturated = false } = {}) {
  const player = {
    rosterId: 'tier-player', firstName: 'Tier', lastName: 'Player', position: 'QB', yearsPro: 5, playerBestOvr: ovr,
    ...Object.fromEntries(attributes.map((field) => [field, saturated ? 99 : ovr])),
  };
  return {
    leagueId: 'rating-tiers', syncId: 'tiers', currentWeek: games + 1,
    info: { careerHubInfo: { seasonInfo: { calendarYear: 2026, seasonWeekType: 1 } } },
    teams: { leagueTeamInfoList: [{ teamId: 1, cityName: 'Arizona', nickName: 'Cardinals' }] },
    rosters: { teams: { 1: { rosterInfoList: [player] } } },
    schedule: { schedules: Array.from({ length: games }, (_, weekIndex) => ({ weekIndex, stageIndex: 1, status: 2, homeTeamId: 1, awayTeamId: 2 })) },
    weeklyStats: Array.from({ length: games }, (_, weekIndex) => ({
      stage: 1, weekIndex,
      passing: { playerPassingStatInfoList: [{
        rosterId: player.rosterId, position: 'QB', teamId: 1,
        passAtt: 30, passComp: poor ? 8 : 24, passYds: poor ? 40 : weak ? 200 : 400,
        passTDs: poor ? 0 : weak ? 1 : 4, passInts: poor ? 3 : 0, passLongest: poor ? 10 : 55,
      }] },
    })),
  };
}
function appliedHistory({ games = 8, pointsPerGame = 10 } = {}) {
  return { periods: Object.fromEntries(Array.from({ length: games }, (_, index) => {
    const id = `previous-${index}`;
    return [`year_2026_week_${index + 1}`, {
      seasonKey: 'year_2026', recommendations: [{ recommendationId: id, playerKey: 'roster:tier-player', direction: 'upgrade', attributes: [{ points: pointsPerGame }] }],
      statusById: { [id]: { status: 'applied' } },
    }];
  })), seasonAwards: {} };
}
const history = appliedHistory();
const options = { rules, history, startingOveralls: { 'roster:tier-player': 75 } };

// Actual Madden OVR is supplied by imports. These tests verify that crossing
// a rating boundary never prevents further supported attribute recommendations.
for (const ovr of [77, 79, 80, 85, 89, 90, 94]) {
  const result = buildWeeklyProgressionRecommendations(snapshot(ovr), { ...options, weekIndex: 8 });
  const growth = result.recommendations.find((item) => item.direction === 'upgrade');
  assert.ok(growth, `Sustained play should stay eligible at ${ovr} OVR after earlier upgrades`);
  assert.equal(growth.pointTracking.positivePreviouslyConfirmed, 80);
  assert.equal(growth.changeContext.sustainedGrowth, true);
  assert.ok(growth.selectionAdjustments.seasonalGuidelineSoftPenalty <= 8);
  assert.ok(growth.attributes.every((attribute) => attribute.points > 0 && attribute.points <= 5 && attribute.targetValue <= 99));
  assert.equal(growth.currentOvr, ovr, 'Recommendations must not invent an actual Madden OVR');
  const annual = buildOffseasonProgressionRecommendations(snapshot(ovr), options).recommendations;
  assert.ok(annual.some((item) => item.direction === 'upgrade'), `Full-season growth should stay eligible at ${ovr} OVR`);
}
const oldRules = structuredClone(rules);
delete oldRules.sustainedGrowth;
assert.equal(buildWeeklyProgressionRecommendations(snapshot(89), { ...options, rules: oldRules, weekIndex: 8 }).recommendations.length, 0,
  'The uncapped seasonal penalty reproduces the old progression stall');

for (const ovr of [94, 92, 90, 89, 85]) {
  const result = buildWeeklyProgressionRecommendations(snapshot(ovr, { poor: true }), { ...options, weekIndex: 8 });
  const decline = result.recommendations.find((item) => item.direction === 'downgrade');
  assert.ok(decline, `Sustained poor play must remain downgrade eligible at ${ovr} OVR`);
  assert.ok(decline.attributes.some((attribute) => attribute.points <= -3));
  assert.ok(decline.attributes.every((attribute) => attribute.points < 0 && attribute.targetValue >= 0));
  const annual = buildOffseasonProgressionRecommendations(snapshot(ovr, { poor: true }), options).recommendations;
  assert.ok(annual.some((item) => item.direction === 'downgrade'), `No 90-OVR protection in offseason (${ovr})`);
}
const withoutHistory = buildWeeklyProgressionRecommendations(snapshot(90, { poor: true }), { rules, weekIndex: 8 }).recommendations[0];
assert.equal(withoutHistory.direction, 'downgrade', 'Veterans can decline even with no earlier upgrades');
assert.equal(buildWeeklyProgressionRecommendations(snapshot(79, { games: 1 }), { ...options, weekIndex: 0 }).recommendations.length, 0,
  'One excellent game must not remove an accumulated seasonal penalty');
assert.equal(buildOffseasonProgressionRecommendations(snapshot(79, { games: 1 }), options).recommendations.length, 0,
  'One-game offseason samples must not earn season-growth relief');
assert.equal(buildWeeklyProgressionRecommendations(snapshot(89, { weak: true }), { ...options, weekIndex: 8 }).recommendations.length, 0,
  'Routine play does not earn sustained-growth relief');
const maxed = snapshot(89, { saturated: true });
maxed.rosters.teams[1].rosterInfoList[0].throwPowerRating = 88;
const maxedRecord = buildWeeklyProgressionRecommendations(maxed, { ...options, weekIndex: 8 }).recommendations[0];
assert.ok(maxedRecord.attributes.some((attribute) => attribute.field === 'throwPowerRating'), 'Maxed attributes must not block other supported changes');
const missing = snapshot(89);
for (const week of missing.weeklyStats) week.passing.playerPassingStatInfoList[0].passAtt = 0;
assert.equal(buildWeeklyProgressionRecommendations(missing, { ...options, weekIndex: 8 }).recommendations.length, 0);
console.log('PASS growth through 79/80 and 89/90 OVR, veteran decline through 90/89, full-season eligibility, saturation, and evidence safeguards');
