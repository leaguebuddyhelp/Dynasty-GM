import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildRecommendationEmbed,
  buildOffseasonProgressionRecommendations,
  buildRecommendationStatusButtons,
  buildWeeklyProgressionRecommendations,
} from '../src/madden/progression.js';

const baseRules = JSON.parse(fs.readFileSync('config/madden_solo_rules.json', 'utf8')).progression;
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
assert.equal(upgrade.attributes[0].points, 3);
assert.equal(upgrade.windows.currentGame, 90);

const downgrade = recommendations([week(0, { passYds: 0, passInts: 3, passAtt: 30 })], 0)[0];
assert.equal(downgrade.direction, 'downgrade');
assert.equal(downgrade.attributes[0].points, -4);
assert.equal(downgrade.attributes[0].targetValue, 76);

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
