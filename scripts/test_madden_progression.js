import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildRecommendationEmbed,
  buildRecommendationSelect,
  buildProgressionCardEmbed,
  buildOffseasonProgressionRecommendations,
  buildRecommendationStatusButtons,
  buildWeeklyProgressionRecommendations,
  performanceAdjustedRatings,
  isOffseason,
} from '../src/madden/progression.js';

const baseRules = JSON.parse(fs.readFileSync('config/madden_solo_rules.json', 'utf8')).progression;

const lineRoster = [
  { rosterId: 'line-lt', position: 'LT', playerBestOvr: 80, runBlockRating: 80, runBlockPowerRating: 80, runBlockFinesseRating: 80, passBlockRating: 80, passBlockPowerRating: 80, passBlockFinesseRating: 80, impactBlockRating: 80 },
  { rosterId: 'line-backup', position: 'LT', playerBestOvr: 70, runBlockRating: 70 },
  { rosterId: 'line-injured', position: 'LG', playerBestOvr: 90, injuryLength: 2, runBlockRating: 90 },
  { rosterId: 'line-lg', position: 'LG', playerBestOvr: 75, runBlockRating: 75 },
];
const lineWeek = {
  stage: 1, weekIndex: 0,
  passing: { playerPassingStatInfoList: [{ teamId: 1, passAtt: 30, passSacks: 1 }] },
  rushing: { playerRushingStatInfoList: [{ teamId: 1, rushAtt: 25, rushYds: 150 }] },
};
const lineSnapshot = {
  leagueId: 'line-test', syncId: 'sync-line', calendarYear: 2026,
  teams: { leagueTeamInfoList: [{ teamId: 1, cityName: 'Test', nickName: 'Team' }] },
  rosters: { teams: { 1: { rosterInfoList: lineRoster } } }, weeklyStats: [lineWeek],
};
const lineRecord = buildWeeklyProgressionRecommendations(lineSnapshot, { weekIndex: 0, rules: baseRules });
const lineResult = lineRecord.recommendations.find((item) => item.playerKey === 'roster:line-lt');
assert.ok(lineResult);
assert.ok(lineResult.attributes.length > 1);
assert.ok(lineResult.changeContext.teamLineProxy);
assert.equal(lineResult.consistency.strongStreak, 1);
assert.ok(lineRecord.recommendations.some((item) => item.playerKey === 'roster:line-lg'));
assert.ok(!lineRecord.recommendations.some((item) => ['roster:line-backup', 'roster:line-injured'].includes(item.playerKey)));
const lineCard = JSON.stringify(buildProgressionCardEmbed(lineRecord, lineResult).toJSON());
assert.match(lineCard, /proxy, not individual blocking stats/);
assert.match(lineCard, /Starter estimated/);
assert.match(lineCard, /Team carries/);
const unavailableLine = structuredClone(lineSnapshot);
delete unavailableLine.weeklyStats[0].rushing;
delete unavailableLine.weeklyStats[0].passing.playerPassingStatInfoList[0].passSacks;
assert.equal(buildWeeklyProgressionRecommendations(unavailableLine, { weekIndex: 0, rules: baseRules }).recommendations.length, 0);
const rushingOnly = structuredClone(lineSnapshot);
delete rushingOnly.weeklyStats[0].passing;
const rushingRecord = buildWeeklyProgressionRecommendations(rushingOnly, { weekIndex: 0, rules: baseRules });
const rushingLine = rushingRecord.recommendations.find((item) => item.playerKey === 'roster:line-lt');
assert.ok(rushingLine);
assert.match(JSON.stringify(buildProgressionCardEmbed(rushingRecord, rushingLine).toJSON()), /Team rushing performance is a proxy/);
assert.ok(rushingLine.attributes.every((attribute) => attribute.evidence === 'teamRunScore'));
const lineHistory = structuredClone(lineSnapshot);
lineHistory.weeklyStats = [{ ...lineWeek, weekIndex: 0 }, { ...lineWeek, weekIndex: 1 }];
const currentLine = buildWeeklyProgressionRecommendations(lineHistory, { weekIndex: 1, rules: baseRules }).recommendations.find((item) => item.playerKey === 'roster:line-lt');
assert.equal(currentLine.consistency.strongStreak, 1, 'Current roster must not be used to infer historical starters');
const lineVariations = new Set(Array.from({ length: 7 }, (_, index) => {
  const data = structuredClone(lineSnapshot);
  data.weeklyStats[0].weekIndex = index;
  const item = buildWeeklyProgressionRecommendations(data, { weekIndex: index, rules: baseRules }).recommendations.find((result) => result.playerKey === 'roster:line-lt');
  return item.attributes.map((attribute) => attribute.attribute).join(',');
}));
assert.ok(lineVariations.size > 1, 'Eligible line attributes should vary over time');
const maxLine = structuredClone(lineSnapshot);
maxLine.rosters.teams[1].rosterInfoList[0].passBlockRating = 99;
for (const item of buildWeeklyProgressionRecommendations(maxLine, { weekIndex: 0, rules: baseRules }).recommendations.flatMap((recommendation) => recommendation.attributes)) {
  assert.ok(item.targetValue >= 0 && item.targetValue <= 99);
}
const badLine = structuredClone(lineSnapshot);
badLine.weeklyStats[0].rushing.playerRushingStatInfoList[0].rushYds = 20;
badLine.weeklyStats[0].passing.playerPassingStatInfoList[0].passSacks = 9;
assert.equal(buildWeeklyProgressionRecommendations(badLine, { weekIndex: 0, rules: baseRules }).recommendations.find((item) => item.playerKey === 'roster:line-lt')?.direction, 'downgrade');

const specialistSnapshot = {
  ...lineSnapshot,
  rosters: { teams: { 1: { rosterInfoList: [
    { rosterId: 'kicker', position: 'K', playerBestOvr: 75, kickAccRating: 75, kickPowerRating: 75 },
    { rosterId: 'punter', position: 'P', playerBestOvr: 75, kickAccRating: 75, kickPowerRating: 75 },
  ] } } },
  weeklyStats: [{
    weekIndex: 0, stage: 1,
    kicking: { playerKickingStatInfoList: [{ rosterId: 'kicker', fGAtt: 2, fGMade: 2, xPAtt: 2, xPMade: 2, fGLongest: 52 }] },
    punting: { playerPuntingStatInfoList: [{ rosterId: 'punter', puntAtt: 3, puntYds: 135, puntNetYds: 120, puntsIn20: 1 }] },
  }],
};
const specialists = buildWeeklyProgressionRecommendations(specialistSnapshot, { weekIndex: 0, rules: baseRules }).recommendations;
assert.equal(specialists.find((item) => item.playerKey === 'roster:kicker')?.stats.fgCompPct, 100);
assert.equal(specialists.find((item) => item.playerKey === 'roster:punter')?.stats.pntYdsPerAtt, 45);
assert.equal(specialists.find((item) => item.playerKey === 'roster:punter')?.stats.pntNetYdsPerAtt, 40);
const noKicks = structuredClone(specialistSnapshot);
noKicks.weeklyStats[0].kicking.playerKickingStatInfoList[0].fGAtt = 0;
noKicks.weeklyStats[0].kicking.playerKickingStatInfoList[0].xPAtt = 0;
assert.ok(!buildWeeklyProgressionRecommendations(noKicks, { weekIndex: 0, rules: baseRules }).recommendations.some((item) => item.playerKey === 'roster:kicker'));
const specialistDiversitySnapshot = structuredClone(specialistSnapshot);
const passing = [];
for (let index = 0; index < 12; index += 1) {
  const id = `diverse-qb-${index}`;
  specialistDiversitySnapshot.rosters.teams[1].rosterInfoList.push({
    rosterId: id, firstName: 'Quarterback', lastName: String(index),
    position: 'QB', playerBestOvr: 75, throwAccShortRating: 75,
  });
  passing.push({ rosterId: id, passAtt: 30, passComp: 24, passYds: 400, passTDs: 4, passInts: 0 });
}
specialistDiversitySnapshot.weeklyStats[0].passing = { playerPassingStatInfoList: passing };
const specialistDiversityRules = structuredClone(baseRules);
specialistDiversityRules.weekly.maximumRecommendations = 4;
const diverseSpecialists = buildWeeklyProgressionRecommendations(specialistDiversitySnapshot, { weekIndex: 0, rules: specialistDiversityRules }).recommendations;
assert.ok(diverseSpecialists.some((item) => item.position === 'QB'));
assert.ok(diverseSpecialists.some((item) => item.position === 'K'));
assert.ok(diverseSpecialists.some((item) => item.position === 'P'));
for (const weekType of [0, 1, 2]) {
  assert.equal(isOffseason({ info: { careerHubInfo: { seasonInfo: { seasonWeekType: weekType, offSeasonStage: 10 } } } }), false);
}
for (const weekType of [3, 8]) {
  assert.equal(isOffseason({ info: { careerHubInfo: { seasonInfo: { seasonWeekType: weekType } } } }), true);
}
assert.equal(isOffseason({ info: { careerHubInfo: { seasonInfo: { offSeasonStage: 10 } } } }), true);
const rules = structuredClone(baseRules);
rules.weekly.performanceWeight = 1;
rules.weekly.expectationWeight = 0;
rules.weekly.individualGameWeight = 0.4;
rules.weekly.recentFourGameWeight = 0.35;
rules.weekly.seasonToDateWeight = 0.25;
rules.weekly.minimumUpgradePerformanceScore = 0;
rules.weekly.minimumUpgradeSelectionScore = 0;
rules.weekly.maximumDowngradePerformanceScore = 20;
rules.weekly.minimumDowngradeSelectionPriority = 0;
rules.weekly.teamBalancePenalty = 0;
rules.weekly.positionBalancePenalty = 0;
rules.weekly.outstandingGameScore = 101;
rules.weekly.severeGameScore = -1;
rules.weekly.streakEvidenceRatio = 0;
rules.weekly.youngMomentumMaxYearsPro = -1;
rules.weekly.attributesPerRecommendation = 3;
rules.weekly.meaningfulOpportunityMinimums.QB = { passAtt: 1 };
rules.weekly.positions.QB = {
  scale: 100,
  expectedAt70: 1,
  expectedPerOvr: 0,
  weights: { passYds: 1 },
  attributes: [{ attribute: 'Throw Accuracy Short', evidence: 'passYds', minimum: 1 }],
};
rules.weekly.negativeEvidence.QB = [{
  attribute: 'Throw Accuracy Short',
  field: 'passInts',
  minimum: 1,
  minimumOpportunities: 1,
  opportunityField: 'passAtt',
}];
rules.weekly.positiveChangeTiers = [
  { minimumScore: 0, attributePoints: 1 },
  { minimumScore: 80, attributePoints: 3 },
];
rules.weekly.negativeChangeTiers = [
  { maximumScore: 20, attributePoints: -2 },
  { maximumScore: 5, attributePoints: -4 },
];
rules.softBalancing.global80PlusTarget = [0, 1000];
rules.softBalancing.global90PlusTarget = [0, 1000];
rules.softBalancing.quarterback70PlusTarget = [0, 1000];
rules.softBalancing.quarterback80PlusTarget = [0, 1000];
rules.softBalancing.populationOverTargetPenalty = 0;
rules.offseason.minimumUpgradeSelectionScore = 0;
rules.offseason.minimumDowngradeSelectionPriority = 0;
rules.offseason.minimumUpgradePerformanceScore = 0;
rules.offseason.maximumDowngradePerformanceScore = 20;
rules.offseason.positiveChangeTiers = [
  { minimumScore: 0, primaryPoints: 1, secondaryPoints: 0, tertiaryPoints: 0 },
];
rules.offseason.maximumRecommendations = 25;

function player(overrides = {}) {
  return {
    rosterId: 'qb-1',
    firstName: 'Test',
    lastName: 'Quarterback',
    position: 'QB',
    playerBestOvr: 80,
    throwAccShortRating: 80,
    yearsPro: 2,
    ...overrides,
  };
}

function week(weekIndex, stats, stage = 1) {
  return {
    weekIndex,
    stage,
    passing: {
      playerPassingStatInfoList: [{
        rosterId: 'qb-1',
        position: 'QB',
        passYds: stats.passYds ?? 0,
        passAtt: stats.passAtt ?? 1,
        passComp: stats.passComp ?? 1,
        passInts: stats.passInts ?? 0,
      }],
    },
  };
}

function snapshot(weeklyStats, roster = player()) {
  return {
    leagueId: 'progression-test',
    syncId: 'sync-test',
    calendarYear: 2026,
    info: { careerHubInfo: { seasonInfo: { calendarYear: 2026 } } },
    teams: { leagueTeamInfoList: [{ teamId: 1, nickName: 'Testers', cityName: 'Test' }] },
    rosters: { teams: { '1': { rosterInfoList: [roster] } } },
    weeklyStats,
  };
}

function recommendations(stats, weekIndex) {
  return buildWeeklyProgressionRecommendations(snapshot(stats), {
    weekIndex,
    rules,
    history: { periods: {}, seasonAwards: {} },
  }).recommendations;
}

const rawWithDuplicateTotals = week(0, { passYds: 90 });
rawWithDuplicateTotals.playerTotals = [{
  rosterId: 'qb-1',
  totals: { passYds: 900 },
}];
const upgrade = recommendations([rawWithDuplicateTotals], 0)[0];
assert.equal(upgrade.direction, 'upgrade');
assert.equal(upgrade.attributes[0].points, 1);
assert.equal(upgrade.windows.currentGame, 90);

const awarenessRules = structuredClone(rules);
awarenessRules.weekly.awarenessUpgradeEveryWeeks = 3;
const awarenessPlayer = player({ awareRating: 75 });
const awarenessWeeks = Array.from({ length: 3 }, (_, index) => {
  const record = buildWeeklyProgressionRecommendations(snapshot([week(index, { passYds: 90 })], awarenessPlayer), {
    weekIndex: index, rules: awarenessRules,
  });
  return record.recommendations[0];
});
const awarenessChanges = awarenessWeeks.filter((item) => item.attributes.some((attribute) => attribute.attribute === 'Awareness'));
assert.equal(awarenessChanges.length, 1, 'Awareness should rotate rather than be included every week');
const awarenessChange = awarenessChanges[0].attributes.find((attribute) => attribute.attribute === 'Awareness');
assert.equal(awarenessChange.currentValue, 75);
assert.ok(awarenessChange.points > 0 && awarenessChange.points <= 5);
assert.equal(awarenessChange.evidence, 'currentGameScore');
assert.match(JSON.stringify(buildProgressionCardEmbed({ type: 'weekly', seasonKey: 'year_2026', generatedAt: new Date().toISOString() }, awarenessChanges[0]).toJSON()), /Game performance score/);
const noAwarenessOpportunity = buildWeeklyProgressionRecommendations(snapshot([week(0, { passYds: 90, passAtt: 0 })], awarenessPlayer), {
  weekIndex: 0, rules: awarenessRules,
});
assert.equal(noAwarenessOpportunity.recommendations.length, 0);
for (const value of [undefined, 99]) {
  const roster = player({ awareRating: value });
  for (let index = 0; index < 3; index++) {
    const result = buildWeeklyProgressionRecommendations(snapshot([week(index, { passYds: 90 })], roster), { weekIndex: index, rules: awarenessRules });
    assert.ok(result.recommendations.every((item) => item.attributes.every((attribute) => attribute.attribute !== 'Awareness')));
  }
}
for (let index = 0; index < 3; index++) {
  const result = buildWeeklyProgressionRecommendations(snapshot([week(index, { passYds: 0, passInts: 3, passAtt: 30 })], awarenessPlayer), { weekIndex: index, rules: awarenessRules });
  assert.ok(result.recommendations.every((item) => item.attributes.every((attribute) => attribute.attribute !== 'Awareness')));
}
const allPositionAwarenessRules = structuredClone(baseRules);
allPositionAwarenessRules.weekly.awarenessUpgradeEveryWeeks = 1;
const awareLine = structuredClone(lineSnapshot);
awareLine.rosters.teams[1].rosterInfoList[0].awareRating = 70;
const awareSpecialists = structuredClone(specialistSnapshot);
awareSpecialists.rosters.teams[1].rosterInfoList.forEach((entry) => { entry.awareRating = 70; });
Object.assign(awareSpecialists.weeklyStats[0].punting.playerPuntingStatInfoList[0], {
  puntYds: 180, puntNetYds: 165, puntsIn20: 3,
});
const awareDefense = snapshot([{
  weekIndex: 0, stage: 1,
  defense: { playerDefensiveStatInfoList: [{ rosterId: 'def-aware', defTotalTackles: 10, defInts: 2, defPassDeflections: 3, defTDs: 1 }] },
}], { rosterId: 'def-aware', firstName: 'Test', lastName: 'Defender', position: 'CB', playerBestOvr: 75, awareRating: 70, tackleRating: 70, zoneCoverRating: 70 });
const awareRecords = [awareLine, awareSpecialists, awareDefense]
  .flatMap((data) => buildWeeklyProgressionRecommendations(data, { weekIndex: 0, rules: allPositionAwarenessRules }).recommendations);
for (const key of ['roster:line-lt', 'roster:kicker', 'roster:punter', 'roster:def-aware']) {
  const entry = awareRecords.find((item) => item.playerKey === key);
  assert.ok(entry?.attributes.some((attribute) => attribute.attribute === 'Awareness'), `Missing Awareness upgrade for ${key}`);
}

const downgrade = recommendations([week(0, { passYds: 0, passInts: 3, passAtt: 30 })], 0)[0];
assert.equal(downgrade.direction, 'downgrade');
assert.equal(downgrade.attributes[0].points, -1);
assert.equal(downgrade.attributes[0].targetValue, 79);

const strongStreak = recommendations([
  week(0, { passYds: 90 }),
  week(2, { passYds: 90 }),
  week(3, { passYds: 90 }),
], 3)[0];
assert.equal(strongStreak.consistency.strongStreak, 3);
assert.equal(strongStreak.attributes[0].points, 2);
const momentumRules = structuredClone(rules);
momentumRules.weekly.youngMomentumMaxYearsPro = 2;
const momentumSnapshot = snapshot([week(0, { passYds: 90 }), week(1, { passYds: 90 }), week(2, { passYds: 90 })]);
momentumSnapshot.currentWeek = 4;
const momentumRecord = buildWeeklyProgressionRecommendations(momentumSnapshot, { weekIndex: 2, rules: momentumRules });
assert.equal(momentumRecord.recommendations[0].attributes[0].points, 3);
assert.equal(momentumRecord.recommendations[0].changeContext.youngMomentum, true);
const youngForm = performanceAdjustedRatings(momentumSnapshot, momentumRules).get('roster:qb-1');
assert.equal(youngForm.adjusted, 85);
const veteranSnapshot = structuredClone(momentumSnapshot);
veteranSnapshot.rosters.teams[1].rosterInfoList[0].yearsPro = 8;
assert.equal(performanceAdjustedRatings(veteranSnapshot, momentumRules).get('roster:qb-1').adjusted, 84);
const strugglingSnapshot = snapshot([week(0, { passYds: 0, passInts: 3, passAtt: 30 }), week(1, { passYds: 0, passInts: 3, passAtt: 30 }), week(2, { passYds: 0, passInts: 3, passAtt: 30 })], player({ playerBestOvr: 95 }));
strugglingSnapshot.currentWeek = 4;
assert.equal(performanceAdjustedRatings(strugglingSnapshot, momentumRules).get('roster:qb-1').adjusted, 91);
const incompleteForm = snapshot([week(0, { passYds: 0, passAtt: 0 })]);
incompleteForm.currentWeek = 2;
assert.equal(performanceAdjustedRatings(incompleteForm, momentumRules).size, 0);
const brokenStreak = recommendations([
  week(0, { passYds: 90 }),
  week(1, { passYds: 10 }),
  week(2, { passYds: 90 }),
], 2)[0];
assert.equal(brokenStreak.consistency.strongStreak, 1);
assert.equal(brokenStreak.attributes[0].points, 1);
const poorStreak = recommendations([
  week(0, { passYds: 0, passInts: 3, passAtt: 30 }),
  week(1, { passYds: 0, passInts: 3, passAtt: 30 }),
  week(2, { passYds: 0, passInts: 3, passAtt: 30 }),
], 2)[0];
assert.equal(poorStreak.consistency.poorStreak, 3);
assert.equal(poorStreak.attributes[0].points, -2);
for (const [games, points] of [[1, 1], [2, 1], [3, 2], [4, 3], [5, 4], [6, 5], [7, 5]]) {
  const goodWeeks = Array.from({ length: games }, (_, index) => week(index, { passYds: 90 }));
  const badWeeks = Array.from({ length: games }, (_, index) => week(index, { passYds: 0, passInts: 3, passAtt: 30 }));
  const good = recommendations(goodWeeks, games - 1)[0];
  const bad = recommendations(badWeeks, games - 1)[0];
  assert.equal(good.consistency.strongStreak, games);
  assert.equal(good.attributes[0].points, points);
  assert.equal(bad.consistency.poorStreak, games);
  assert.equal(bad.attributes[0].points, -points);
}
const sixGoodWeeks = Array.from({ length: 6 }, (_, index) => week(index, { passYds: 90 }));
const nearMaximum = buildWeeklyProgressionRecommendations(
  snapshot(sixGoodWeeks, player({ throwAccShortRating: 97 })),
  { weekIndex: 5, rules, history: { periods: {}, seasonAwards: {} } },
).recommendations[0];
assert.equal(nearMaximum.attributes[0].targetValue, 99);
assert.equal(nearMaximum.attributes[0].points, 2);
const sixBadWeeks = Array.from({ length: 6 }, (_, index) => week(index, { passYds: 0, passInts: 3, passAtt: 30 }));
const nearMinimum = buildWeeklyProgressionRecommendations(
  snapshot(sixBadWeeks, player({ throwAccShortRating: 2 })),
  { weekIndex: 5, rules, history: { periods: {}, seasonAwards: {} } },
).recommendations[0];
assert.equal(nearMinimum.attributes[0].targetValue, 0);
assert.equal(nearMinimum.attributes[0].points, -2);
const lowOpportunity = recommendations([
  week(0, { passYds: 90 }),
  week(1, { passYds: 90, passAtt: 0 }),
  week(2, { passYds: 90 }),
], 2)[0];
assert.equal(lowOpportunity.consistency.strongStreak, 1);
assert.equal(lowOpportunity.attributes[0].points, 1);

const trend = recommendations([
  week(0, { passYds: 30 }),
  week(1, { passYds: 40 }),
  week(2, { passYds: 50 }),
  week(3, { passYds: 60 }),
], 3)[0];
assert.equal(trend.windows.currentGame, 60);
assert.equal(trend.windows.recentFourGames, 45);
assert.equal(trend.windows.seasonToDate, 45);
assert.equal(trend.consistency.observedGames, 4);
assert.equal(trend.consistency.trend, 30);

const byeWeek = recommendations([
  week(0, { passYds: 30 }),
  week(2, { passYds: 60 }),
], 2)[0];
assert.equal(byeWeek.consistency.observedGames, 2);
assert.equal(byeWeek.windows.recentFourGames, 45);

assert.equal(recommendations([week(0, { passYds: 0, passInts: 3, passAtt: 0 })], 0).length, 0);
const missingNegativeEvidence = week(0, { passYds: 0, passAtt: 30 });
delete missingNegativeEvidence.passing.playerPassingStatInfoList[0].passInts;
assert.equal(recommendations([missingNegativeEvidence], 0).length, 0);

const realQuarterbackWeek = week(0, { passYds: 300, passAtt: 35, passComp: 24 });
realQuarterbackWeek.passing.playerPassingStatInfoList[0].passTDs = 3;
const realDefault = buildWeeklyProgressionRecommendations(snapshot([realQuarterbackWeek]), {
  weekIndex: 0, rules: baseRules, history: { periods: {}, seasonAwards: {} },
}).recommendations[0];
assert.equal(realDefault.direction, 'upgrade');
assert.equal(realDefault.attributes[0].evidence, 'passCompPct');
assert.equal(realDefault.attributes[0].points, 1);

const breakoutPlayer = player({
  rosterId: 'falcons-qb',
  firstName: 'Breakout',
  playerBestOvr: 65,
  throwAccShortRating: 68,
  throwAccMidRating: 67,
  throwAccDeepRating: 66,
  playActionRating: 65,
  throwOnRunRating: 64,
});
const breakoutWeek = {
  weekIndex: 2,
  stage: 1,
  passing: { playerPassingStatInfoList: [{
    rosterId: 'falcons-qb', position: 'QB', passYds: 390, passAtt: 32, passComp: 26,
    passTDs: 4, passInts: 0, passLongest: 52,
  }] },
  rushing: { playerRushingStatInfoList: [{ rosterId: 'falcons-qb', position: 'QB', rushYds: 32 }] },
};
const priorBadWeek = {
  weekIndex: 0, stage: 1,
  passing: { playerPassingStatInfoList: [{
    rosterId: 'falcons-qb', position: 'QB', passYds: 0, passAtt: 25, passComp: 9, passInts: 3,
  }] },
};
const breakoutSnapshot = snapshot([priorBadWeek, { ...priorBadWeek, weekIndex: 1 }, breakoutWeek], breakoutPlayer);
const breakoutAwards = { nfc_offense: { rosterId: 'falcons-qb' } };
const breakoutRecord = buildWeeklyProgressionRecommendations(breakoutSnapshot, {
  weekIndex: 2, rules: baseRules, awardWinners: breakoutAwards, history: { periods: {}, seasonAwards: {} },
});
const breakout = breakoutRecord.recommendations[0];
assert.equal(breakout.direction, 'upgrade');
assert.equal(breakout.attributes.length, 5);
assert.deepEqual(new Set(breakout.attributes.map((attribute) => attribute.points)), new Set([3, 4, 5]));
assert.ok(breakout.performanceScore < baseRules.weekly.minimumUpgradePerformanceScore);
assert.match(breakout.explanation, /65 OVR, weekly award/);
const breakoutCard = buildProgressionCardEmbed(breakoutRecord, breakout).toJSON();
assert.match(JSON.stringify(breakoutCard), /weekly award/i);
assert.match(JSON.stringify(breakoutCard), /Passing yards: 390/);

const noAward = buildWeeklyProgressionRecommendations(breakoutSnapshot, {
  weekIndex: 2, rules: baseRules, history: { periods: {}, seasonAwards: {} },
}).recommendations;
assert.equal(noAward.length, 0);
const wrongAward = buildWeeklyProgressionRecommendations(breakoutSnapshot, {
  weekIndex: 2, rules: baseRules, awardWinners: { nfc_offense: { rosterId: 'different-player' } },
  history: { periods: {}, seasonAwards: {} },
}).recommendations;
assert.equal(wrongAward.length, 0);
const highRated = buildWeeklyProgressionRecommendations(snapshot([breakoutWeek], {
  ...breakoutPlayer, playerBestOvr: 85,
}), {
  weekIndex: 2, rules: baseRules, awardWinners: breakoutAwards, history: { periods: {}, seasonAwards: {} },
}).recommendations[0];
assert.ok(highRated.attributes.every((attribute) => attribute.points <= 2));
assert.doesNotMatch(highRated.explanation, /Breakout/);
const unsupportedBreakout = buildWeeklyProgressionRecommendations(snapshot([breakoutWeek], {
  ...breakoutPlayer, throwAccShortRating: null, throwAccMidRating: null,
  throwAccDeepRating: null, playActionRating: null, throwOnRunRating: null,
}), {
  weekIndex: 2, rules: baseRules, awardWinners: breakoutAwards, history: { periods: {}, seasonAwards: {} },
}).recommendations;
assert.equal(unsupportedBreakout.length, 0);
const severeDowngrade = buildWeeklyProgressionRecommendations(
  snapshot([week(0, { passYds: 0, passInts: 3, passAtt: 30 })]),
  { weekIndex: 0, rules: baseRules, history: { periods: {}, seasonAwards: {} } },
).recommendations[0];
assert.equal(severeDowngrade.attributes[0].points, -2);

const receiver = {
  rosterId: 'wr-1',
  firstName: 'Test',
  lastName: 'Receiver',
  position: 'WR',
  playerBestOvr: 80,
  catchRating: 70,
  routeRunShortRating: 70,
  routeRunMedRating: 70,
  routeRunDeepRating: 70,
  specCatchRating: 70,
};
const receivingWeek = {
  weekIndex: 0,
  stage: 1,
  receiving: {
    playerReceivingStatInfoList: [{
      rosterId: 'wr-1',
      position: 'WR',
      recCatches: 5,
      recYds: 100,
      recTDs: 1,
      recLongest: 35,
      recYdsPerCatch: 20,
      recCatchPct: 83,
    }],
  },
};
const receiverRecommendations = buildWeeklyProgressionRecommendations(
  snapshot([receivingWeek], receiver),
  { weekIndex: 0, rules, history: { periods: {}, seasonAwards: {} } },
).recommendations;
assert.equal(receiverRecommendations.length, 1);
assert.equal(receiverRecommendations[0].attributes.length, 3);
assert.ok(receiverRecommendations[0].attributes.some((attribute) => attribute.attribute === 'Catching'));
assert.ok(receiverRecommendations[0].attributes.some((attribute) => attribute.attribute === 'Medium Route Running'));
const fullReceiverRecord = buildWeeklyProgressionRecommendations(
  snapshot([receivingWeek], receiver),
  { weekIndex: 0, rules: baseRules, history: { periods: {}, seasonAwards: {} } },
);
assert.equal(fullReceiverRecord.recommendations[0].attributes.length, 5);
assert.deepEqual(new Set(fullReceiverRecord.recommendations[0].attributes.map((attribute) => attribute.points)), new Set([1, 2]));
const fullReceiverCard = buildProgressionCardEmbed(fullReceiverRecord, fullReceiverRecord.recommendations[0]).toJSON();
for (const attribute of fullReceiverRecord.recommendations[0].attributes) {
  assert.ok(fullReceiverCard.description.includes(attribute.attribute));
}
for (const label of ['Catch rate', 'Receptions', 'Yards per catch', 'Longest reception', 'Receiving touchdowns']) {
  assert.ok(fullReceiverCard.fields.find((field) => field.name === 'Stats').value.includes(label));
}
const sixReceiverWeeks = Array.from({ length: 6 }, (_, index) => ({ ...receivingWeek, weekIndex: index }));
const sustainedReceiver = buildWeeklyProgressionRecommendations(
  snapshot(sixReceiverWeeks, receiver),
  { weekIndex: 5, rules: baseRules, history: { periods: {}, seasonAwards: {} } },
).recommendations[0];
assert.equal(sustainedReceiver.attributes.length, 5);
assert.deepEqual(new Set(sustainedReceiver.attributes.map((attribute) => attribute.points)), new Set([1, 5]));

const multiNegativeRules = structuredClone(rules);
multiNegativeRules.weekly.attributesPerRecommendation = 5;
multiNegativeRules.weekly.negativeEvidence.QB = [
  'Throw Accuracy Short', 'Throw Accuracy Mid', 'Throw Accuracy Deep', 'Play Action', 'Throw on Run',
].map((attribute) => ({
  attribute, field: 'passInts', minimum: 1, minimumOpportunities: 1, opportunityField: 'passAtt',
}));
const multiNegativePlayer = player({
  throwAccMidRating: 80, throwAccDeepRating: 80, playActionRating: 80, throwOnRunRating: 80,
});
const multiNegativeRecord = buildWeeklyProgressionRecommendations(
  snapshot(sixBadWeeks, multiNegativePlayer),
  { weekIndex: 5, rules: multiNegativeRules, history: { periods: {}, seasonAwards: {} } },
);
assert.equal(multiNegativeRecord.recommendations[0].attributes.length, 5);
assert.ok(multiNegativeRecord.recommendations[0].attributes.every((attribute) => attribute.points === -5));
const multiNegativeCard = buildProgressionCardEmbed(multiNegativeRecord, multiNegativeRecord.recommendations[0]).toJSON();
for (const attribute of multiNegativeRecord.recommendations[0].attributes) {
  assert.ok(multiNegativeCard.description.includes(attribute.attribute));
}
const offseasonNegativeRules = structuredClone(multiNegativeRules);
offseasonNegativeRules.offseason.minimumUpgradePerformanceScore = 65;
const offseasonNegative = buildOffseasonProgressionRecommendations(
  snapshot(sixBadWeeks, multiNegativePlayer),
  { rules: offseasonNegativeRules, history: { periods: {}, seasonAwards: {} } },
).recommendations[0];
assert.equal(offseasonNegative.direction, 'downgrade');
assert.equal(offseasonNegative.attributes.length, 2);

const defensiveRules = structuredClone(rules);
defensiveRules.weekly.meaningfulOpportunityMinimums.DEF = { defPassDeflections: 1 };
defensiveRules.weekly.positions.DEF = {
  scale: 10,
  expectedAt70: 1,
  expectedPerOvr: 0,
  weights: {
    defForcedFumbles: 1,
    defRecoveredFumbles: 1,
    defPassDeflections: 1,
  },
  attributes: [
    { attribute: 'Hit Power', evidence: 'defForcedFumbles', minimum: 1 },
    { attribute: 'Play Recognition', evidence: 'defPassDeflections', minimum: 1 },
    { attribute: 'Tackling', evidence: 'defTotalTackles', minimum: 1 },
    { attribute: 'Zone Coverage', evidence: 'defInts', minimum: 1 },
  ],
};
defensiveRules.weekly.negativeEvidence.DEF = [];
const defensivePlayer = {
  rosterId: 'cb-1',
  firstName: 'Test',
  lastName: 'Cornerback',
  position: 'CB',
  playerBestOvr: 80,
  hitPowerRating: 70,
  playRecRating: 70,
  tackleRating: 70,
  zoneCoverRating: 70,
};
const defensiveWeek = {
  weekIndex: 0,
  stage: 1,
  defense: {
    playerDefensiveStatInfoList: [{
      rosterId: 'cb-1',
      position: 'CB',
      defTotalTackles: 1,
      defInts: 1,
      defForcedFum: 1,
      defFumRec: 1,
      defDeflections: 3,
    }],
  },
  playerTotals: [{
    rosterId: 'cb-1',
    totals: {
      defForcedFumbles: 100,
      defRecoveredFumbles: 100,
      defPassDeflections: 100,
    },
  }],
};
const defensiveRecommendations = buildWeeklyProgressionRecommendations(
  snapshot([defensiveWeek], defensivePlayer),
  { weekIndex: 0, rules: defensiveRules, history: { periods: {}, seasonAwards: {} } },
).recommendations;
assert.equal(defensiveRecommendations.length, 1);
assert.equal(defensiveRecommendations[0].windows.currentGame, 50);
assert.equal(defensiveRecommendations[0].attributes.length, 3);
assert.ok(defensiveRecommendations[0].attributes.some((attribute) => attribute.evidence === 'defPassDeflections'));

const totalsOnlyDefensiveWeek = {
  weekIndex: 0,
  stage: 1,
  playerTotals: [{
    rosterId: 'cb-1',
    position: 'CB',
    totals: {
      defForcedFum: 1,
      defFumRec: 1,
      defDeflections: 3,
    },
  }],
};
const totalsOnlyRecommendation = buildWeeklyProgressionRecommendations(
  snapshot([totalsOnlyDefensiveWeek], defensivePlayer),
  { weekIndex: 0, rules: defensiveRules, history: { periods: {}, seasonAwards: {} } },
).recommendations[0];
assert.equal(totalsOnlyRecommendation.windows.currentGame, 50);
assert.equal(totalsOnlyRecommendation.attributes.length, 2);

const unknownPosition = buildWeeklyProgressionRecommendations(
  snapshot([defensiveWeek], { ...defensivePlayer, position: 'UNKNOWN' }),
  { weekIndex: 0, rules: defensiveRules, history: { periods: {}, seasonAwards: {} } },
).recommendations;
assert.equal(unknownPosition.length, 0);
for (const position of ['LEDGE', 'REDGE', 'SAM', 'MIKE', 'WILL']) {
  const alias = buildWeeklyProgressionRecommendations(
    snapshot([defensiveWeek], { ...defensivePlayer, position }),
    { weekIndex: 0, rules: defensiveRules, history: { periods: {}, seasonAwards: {} } },
  ).recommendations;
  assert.equal(alias.length, 1, position);
}

const mixedPlayers = [
  player({ rosterId: 'up', firstName: 'Up' }),
  player({ rosterId: 'down1', firstName: 'Down One' }),
  player({ rosterId: 'down2', firstName: 'Down Two' }),
];
const league = snapshot([], player());
league.teams.leagueTeamInfoList = [];
league.rosters.teams = {};
const leagueStats = [];
for (let index = 0; index < 36; index += 1) {
  const teamId = String(index + 1);
  const rosterId = `league-qb-${index}`;
  league.teams.leagueTeamInfoList.push({ teamId, cityName: 'Test', nickName: `Team ${teamId}` });
  league.rosters.teams[teamId] = { rosterInfoList: [player({ rosterId, firstName: `Player ${index}` })] };
  if (index >= 32) continue;
  leagueStats.push({
    rosterId, teamId, position: 'QB',
    passYds: index < 24 ? 300 : 0,
    passTDs: index < 24 ? 3 : 0,
    passInts: index < 24 ? 0 : 3,
    passAtt: 30, passComp: index < 24 ? 21 : 10,
  });
}
league.weeklyStats = [{ weekIndex: 1, stage: 1, passing: { playerPassingStatInfoList: leagueStats } }];
const leagueRecord = buildWeeklyProgressionRecommendations(league, {
  weekIndex: 1, rules: baseRules, history: { periods: {}, seasonAwards: {} },
});
assert.equal(leagueRecord.recommendations.length, 30);
assert.equal(leagueRecord.selectionDiagnostics.eligibleCandidates, 32);
assert.ok(leagueRecord.recommendations.some((item) => item.direction === 'upgrade'));
assert.ok(leagueRecord.recommendations.some((item) => item.direction === 'downgrade'));
assert.ok(leagueRecord.recommendations.every((item) => item.attributes.length > 0));
const limitedLeague = structuredClone(league);
limitedLeague.weeklyStats[0].passing.playerPassingStatInfoList = leagueStats.slice(0, 4);
const limitedRecord = buildWeeklyProgressionRecommendations(limitedLeague, {
  weekIndex: 1, rules: baseRules, history: { periods: {}, seasonAwards: {} },
});
assert.equal(limitedRecord.recommendations.length, 4);
assert.equal(limitedRecord.selectionDiagnostics.eligibleCandidates, 4);
const mixedSnapshot = snapshot([{
  weekIndex: 0,
  stage: 1,
  passing: { playerPassingStatInfoList: [
    { rosterId: 'up', passYds: 90, passAtt: 30, passComp: 20 },
    { rosterId: 'down1', passYds: 0, passAtt: 30, passInts: 3 },
    { rosterId: 'down2', passYds: 0, passAtt: 30, passInts: 3 },
  ] },
}]);
mixedSnapshot.rosters.teams['1'].rosterInfoList = mixedPlayers;
const mixedRules = structuredClone(rules);
mixedRules.weekly.maximumRecommendations = 2;
const mixedRecord = buildWeeklyProgressionRecommendations(mixedSnapshot, {
  weekIndex: 0, rules: mixedRules, history: { periods: {}, seasonAwards: {} },
});
assert.deepEqual(new Set(mixedRecord.recommendations.map((item) => item.direction)), new Set(['upgrade', 'downgrade']));
const negativeOnlySnapshot = structuredClone(mixedSnapshot);
negativeOnlySnapshot.rosters.teams['1'].rosterInfoList = mixedPlayers.slice(1);
const negativeOnly = buildWeeklyProgressionRecommendations(negativeOnlySnapshot, {
  weekIndex: 0, rules: mixedRules, history: { periods: {}, seasonAwards: {} },
}).recommendations;
assert.equal(negativeOnly.length, 2);
assert.ok(negativeOnly.every((item) => item.direction === 'downgrade'));
const diversityRules = structuredClone(rules);
diversityRules.weekly.maximumRecommendations = 2;
diversityRules.weekly.teamBalancePenalty = 6;
diversityRules.weekly.positionBalancePenalty = 6;
diversityRules.weekly.positions.WR = {
  scale: 100, expectedAt70: 1, expectedPerOvr: 0,
  weights: { recYds: 1 },
  attributes: [{ attribute: 'Catching', evidence: 'recYds', minimum: 1 }],
};
diversityRules.weekly.meaningfulOpportunityMinimums.WR = { recCatches: 1 };
const diversitySnapshot = snapshot([{
  weekIndex: 0,
  stage: 1,
  passing: { playerPassingStatInfoList: [
    { rosterId: 'up', passYds: 95, passAtt: 30 },
    { rosterId: 'up2', passYds: 94, passAtt: 30 },
  ] },
  receiving: { playerReceivingStatInfoList: [{ rosterId: 'wr-1', recYds: 90, recCatches: 5 }] },
}]);
diversitySnapshot.teams.leagueTeamInfoList.push({ teamId: 2, nickName: 'Others', cityName: 'Test' });
diversitySnapshot.rosters.teams['1'].rosterInfoList = [
  mixedPlayers[0], player({ rosterId: 'up2', firstName: 'Up Two' }),
];
diversitySnapshot.rosters.teams['2'] = { rosterInfoList: [receiver] };
const diverse = buildWeeklyProgressionRecommendations(diversitySnapshot, {
  weekIndex: 0, rules: diversityRules, history: { periods: {}, seasonAwards: {} },
}).recommendations;
assert.deepEqual(new Set(diverse.map((item) => item.position)), new Set(['QB', 'WR']));
assert.equal(new Set(diverse.map((item) => item.teamId)).size, 2);
const card = buildProgressionCardEmbed(mixedRecord, mixedRecord.recommendations.find((item) => item.direction === 'upgrade')).toJSON();
assert.match(JSON.stringify(card), /Passing yards: 90/);
assert.match(JSON.stringify(card), /This game: 90/);
assert.match(JSON.stringify(card), /Strong streak: 1/);
assert.ok(card.fields.some((field) => field.name === 'Why'));
const negativeCard = buildProgressionCardEmbed(mixedRecord, mixedRecord.recommendations.find((item) => item.direction === 'downgrade')).toJSON();
assert.match(JSON.stringify(negativeCard), /Interceptions thrown: 3/);
assert.match(JSON.stringify(negativeCard), /Pass attempts: 30/);
assert.doesNotMatch(JSON.stringify(card), /passYds|recCatches|defInts|Needs review/);
assert.deepEqual(buildRecommendationSelect(mixedRecord, '1', 0, mixedRecord.recommendations), []);
const legacy = structuredClone(mixedRecord.recommendations[0]);
delete legacy.consistency;
delete legacy.windows;
assert.match(JSON.stringify(buildProgressionCardEmbed(mixedRecord, legacy).toJSON()), /N\/A/);

const appliedRecommendation = {
  recommendationId: 'prior-applied',
  playerKey: 'roster:qb-1',
  direction: 'upgrade',
  attributes: [{ points: 2 }],
};
const offseason = buildOffseasonProgressionRecommendations(snapshot([
  week(0, { passYds: 90 }),
]), {
  rules,
  history: {
    periods: {
      year_2026_week_1: {
        seasonKey: 'year_2026',
        recommendations: [appliedRecommendation],
        statusById: { 'prior-applied': { status: 'applied' } },
      },
    },
    seasonAwards: {},
  },
});
assert.equal(offseason.recommendations[0].pointTracking.positivePreviouslyConfirmed, 2);
assert.equal(offseason.recommendations[0].pointTracking.negativePreviouslyConfirmed, 0);
assert.equal(offseason.population.overall80Plus, 1);
assert.equal(offseason.population.quarterbacks80Plus, 1);
const recommendationEmbed = buildRecommendationEmbed(offseason, offseason.recommendations[0]).toJSON();
assert.match(recommendationEmbed.title, /Upgrade/);
assert.match(recommendationEmbed.footer.text, /Season 2026/);
assert.doesNotMatch(JSON.stringify(recommendationEmbed), /prior-applied|sync-test|Performance windows|OVR impact/);

const buttons = buildRecommendationStatusButtons(offseason, offseason.recommendations[0]);
assert.deepEqual(
  buttons[0].components.map((component) => component.data.label),
  ['Mark Applied', 'Mark Skipped', 'View Details'],
);

console.log('Madden progression tests passed.');
