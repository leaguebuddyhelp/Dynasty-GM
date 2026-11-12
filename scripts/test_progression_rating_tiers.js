import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildWeeklyProgressionRecommendations,
} from '../src/madden/progression.js';
import { replayFullSeason, buildSeasonApplication } from '../src/madden/full_season_engine.js';

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
  assert.ok(decline.attributes.some((attribute) => attribute.field === 'throwAccShortRating'));
}
const withoutHistory = buildWeeklyProgressionRecommendations(snapshot(90, { poor: true }), { rules, weekIndex: 8 }).recommendations[0];
assert.equal(withoutHistory.direction, 'downgrade', 'Veterans can decline even with no earlier upgrades');
assert.equal(buildWeeklyProgressionRecommendations(snapshot(79, { games: 1 }), { ...options, weekIndex: 0 }).recommendations.length, 0,
  'One excellent game must not remove an accumulated seasonal penalty');
assert.equal(buildWeeklyProgressionRecommendations(snapshot(89, { weak: true }), { ...options, weekIndex: 8 }).recommendations.length, 0,
  'Routine play does not earn sustained-growth relief');
const maxed = snapshot(89, { saturated: true });
maxed.rosters.teams[1].rosterInfoList[0].throwPowerRating = 88;
const maxedRecord = buildWeeklyProgressionRecommendations(maxed, { ...options, weekIndex: 8 }).recommendations[0];
assert.ok(maxedRecord.attributes.some((attribute) => attribute.field === 'throwPowerRating'), 'Maxed attributes must not block other supported changes');
const missing = snapshot(89);
for (const week of missing.weeklyStats) week.passing.playerPassingStatInfoList[0].passAtt = 0;
assert.equal(buildWeeklyProgressionRecommendations(missing, { ...options, weekIndex: 8 }).recommendations.length, 0);
// Exercise the actual full-season replay, and compare it to 18 individually
// applied weekly results. Attribute crossings are measurable; actual OVR still
// comes from Madden, whose archetype weights are not reproduced here.
for (const [rising, falling, reverse] of [[76, 94], [79, 90], [86, 84], [89, 80], [79, 90, true]]) {
  const initial = snapshot(rising, { games: 18 });
  const star = initial.rosters.teams[1].rosterInfoList[0];
  const struggler = { ...star, rosterId: 'falling-player', firstName: 'Falling', playerBestOvr: falling,
    ...Object.fromEntries(attributes.map((field) => [field, falling])) };
  initial.teams.leagueTeamInfoList.push({ teamId: 2, cityName: 'Atlanta', nickName: 'Falcons' });
  initial.rosters.teams[2] = { rosterInfoList: [struggler] };
  for (const week of initial.weeklyStats) {
    week.passing.playerPassingStatInfoList.push({ rosterId: struggler.rosterId, position: 'QB', teamId: 2,
      passAtt: 30, passComp: 8, passYds: 40, passTDs: 0, passInts: 3, passLongest: 10 });
    if (reverse && week.weekIndex >= 9) {
      const [good, poor] = week.passing.playerPassingStatInfoList;
      const goodStats = { ...good }, poorStats = { ...poor };
      Object.assign(good, poorStats, { rosterId: goodStats.rosterId, teamId: goodStats.teamId });
      Object.assign(poor, goodStats, { rosterId: poorStats.rosterId, teamId: poorStats.teamId });
    }
    week.defense = { playerDefensiveStatInfoList: [1, 2].map((teamId) => ({ rosterId: `coverage-${teamId}`, teamId, defTotalTackles: 5 })) };
  }
  const baseline = structuredClone(initial);
  baseline.currentWeek = 1;
  baseline.weeklyStats = [];
  baseline.schedule.schedules = [];
  const full = await replayFullSeason({ baseline, snapshot: initial, rules, computeAwards: async () => ({}) });
  const virtual = structuredClone(baseline);
  const weeklyHistory = { periods: {}, seasonAwards: {} };
  const weeklyPlayers = [virtual.rosters.teams[1].rosterInfoList[0], virtual.rosters.teams[2].rosterInfoList[0]];
  for (let weekIndex = 0; weekIndex < 18; weekIndex++) {
    const view = { ...virtual, currentWeek: weekIndex + 2,
      weeklyStats: initial.weeklyStats.slice(0, weekIndex + 1),
      schedule: { schedules: initial.schedule.schedules.slice(0, weekIndex + 1) } };
    const record = buildWeeklyProgressionRecommendations(view, { rules, weekIndex, history: weeklyHistory });
    assert.deepEqual(record.recommendations.map((item) => [item.playerKey, item.attributes]),
      full.weeks[weekIndex + 1].recommendations.map((item) => [item.playerKey, item.attributes]),
      `Weekly and season mode must earn the same changes at week ${weekIndex + 1}`);
    record.statusById = {};
    weeklyHistory.periods[record.periodKey] = record;
    for (const recommendation of record.recommendations) {
      record.statusById[recommendation.recommendationId] = { status: 'applied' };
      const player = weeklyPlayers.find((row) => `roster:${row.rosterId}` === recommendation.playerKey);
      for (const attribute of recommendation.attributes) player[attribute.field] = attribute.targetValue;
    }
  }
  const application = buildSeasonApplication({ totals: full.totals, baseline, snapshot: initial, applicationMode: 'add_net' });
  for (const row of application) for (const attribute of row.attributes) {
    const weeklyPlayer = weeklyPlayers.find((player) => `roster:${player.rosterId}` === row.playerKey);
    assert.equal(attribute.targetValue, weeklyPlayer[attribute.field], 'Combined targets must equal individually applied weekly changes');
  }
  if (reverse) {
    for (const player of weeklyPlayers) {
      const directions = new Set(Object.values(full.weeks).flatMap((week) => week.recommendations)
        .filter((item) => item.playerKey === `roster:${player.rosterId}`).map((item) => item.direction));
      assert.deepEqual([...directions].sort(), ['downgrade', 'upgrade'], 'Players must change direction when their sustained performance reverses');
    }
    continue;
  }
  const risen = weeklyPlayers[0], fallen = weeklyPlayers[1];
  for (const field of ['throwAccShortRating', 'throwAccMidRating', 'throwAccDeepRating']) {
    assert.ok(risen[field] >= 90, `${rising}-rated strong performer must earn core accuracy into the 90s (${field}: ${risen[field]})`);
  }
  for (const field of ['throwAccShortRating', 'awareRating']) {
    assert.ok(fallen[field] < 80, `${falling}-rated poor performer must lose core ratings through the 80s (${field}: ${fallen[field]})`);
  }
}
const onePoorGame = buildWeeklyProgressionRecommendations(snapshot(90, { poor: true, games: 1 }), { rules, weekIndex: 0 });
assert.ok(onePoorGame.recommendations.every((item) => !item.attributes.some((attribute) => attribute.field === 'awareRating')),
  'A single poor game cannot earn sustained-performance Awareness loss');
const injured = snapshot(90, { poor: true });
injured.rosters.teams[1].rosterInfoList[0].injuryLength = 4;
assert.equal(buildWeeklyProgressionRecommendations(injured, { rules, weekIndex: 8 }).recommendations.length, 0);
console.log('PASS weekly/full-season parity, earned core ratings into 80s/90s and back down, sustained skill/Awareness decline, saturation, and injury safeguards');
