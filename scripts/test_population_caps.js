import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPopulationCapPlan, countRatingBands } from '../src/madden/population_caps.js';
import { getRatingPopulationPlan, buildWeeklyProgressionRecommendations } from '../src/madden/progression.js';
const rules = JSON.parse(fs.readFileSync('config/madden_solo_rules.json', 'utf8')).progression;
const policy = rules.populationCaps;
const player = (id, position, currentOvr, score = 80, extra = {}) => ({ playerKey: `roster:${id}`, player: id, position, currentOvr,
  rankScore: score, rawScore: score, games: 16, attempts: position === 'QB' ? 400 : 0, sufficientSample: true, yearsPro: 5, teamId: id, team: `Team ${id}`, ...extra });
const roster = Array.from({ length: 12 }, (_, index) => player(`elite-${index}`, 'QB', 95, 120 - index));
roster.push(player('challenger', 'QB', 87, 140));
roster.push(...Array.from({ length: 20 }, (_, index) => player(`mid-${index}`, 'QB', 85, 90 - index)));
roster.push(...Array.from({ length: 30 }, (_, index) => player(`low-${index}`, 'QB', 75, 60 - index)));
roster.push(...Array.from({ length: 105 }, (_, index) => player(`star-${index}`, index % 2 ? 'WR' : 'CB', 92, 100 - index / 10)));
roster.push(...Array.from({ length: 400 }, (_, index) => player(`solid-${index}`, index % 2 ? 'LT' : 'TE', 83, 95 - index / 20)));
const before = structuredClone(roster);
const plan = buildPopulationCapPlan(roster, policy);
assert.deepEqual(roster, before, 'Planning caps cannot mutate imported Madden ratings');
assert.ok(plan.projectedCounts.quarterbacks90Plus <= 7);
assert.ok(plan.projectedCounts.quarterbacks80Plus <= 18);
assert.ok(plan.projectedCounts.quarterbacks70Plus <= 40);
assert.ok(plan.projectedCounts.overall90Plus <= 90);
assert.ok(plan.projectedCounts.overall80Plus <= 400);
assert.equal(plan.projectedCounts.overall80Plus, 400, 'The accepted league limit is 400, not 375');
assert.ok(plan.eliteQbs.length >= 5 && plan.eliteQbs.length <= 7);
assert.equal(plan.adjustments.find((p) => p.player === 'challenger').targetOvr, 90);
assert.ok(plan.adjustments.some((p) => p.player.startsWith('elite-') && p.targetOvr <= 89), 'A challenger replaces an incumbent rather than creating an eighth elite QB');
assert.equal(plan.ceilings['roster:elite-11'], 89, 'An excluded incumbent cannot receive more growth across the cap');
assert.deepEqual(buildPopulationCapPlan([...roster].reverse(), policy), plan, 'Cap selection must be deterministic despite roster iteration order');
const oneEliteSlot = { ...policy, overall90PlusMaximum: 1 };
const earnedSlot = buildPopulationCapPlan([player('old-wr', 'WR', 92, 60), player('new-cb', 'CB', 89, 100, { eligibleForGrowth: true })], oneEliteSlot);
assert.equal(earnedSlot.adjustments.find((p) => p.player === 'old-wr').targetOvr, 89);
assert.equal(earnedSlot.ceilings['roster:new-cb'], 99, 'A qualified new non-QB star can earn an existing elite slot instead of being permanently blocked at 89');
assert.equal(earnedSlot.ceilings['roster:old-wr'], 89);
const sparse = [player('established', 'QB', 94, 80), player('one-game', 'QB', 89, 150, { games: 1, attempts: 25, sufficientSample: false, rankScore: 75, yearsPro: 0 })];
const small = buildPopulationCapPlan(sparse, policy);
assert.ok(!small.adjustments.some((p) => p.player === 'one-game' && p.targetOvr >= 90), 'One hot game cannot earn an elite slot');
assert.equal(small.projectedCounts.quarterbacks90Plus, 1, 'Do not manufacture five elite QBs when evidence is absent');
const needTeams = [player('ready', 'QB', 78, 80, { teamId: 'ready' }), player('developing', 'QB', 72, 75, { teamId: 'developing', yearsPro: 0, games: 2, attempts: 40, sufficientSample: false }), player('failed-veteran', 'QB', 73, 40, { teamId: 'failed' })];
const outlook = buildPopulationCapPlan(needTeams, policy, ['ready', 'developing', 'failed', 'empty']).qbOutlook;
assert.deepEqual(outlook.target, [3, 4]);
assert.equal(outlook.actualNeeds, 2, 'Need target cannot manufacture demand by downgrading a viable or developing starter');
assert.ok(outlook.teams.some((t) => t.teamId === 'failed') && outlook.teams.some((t) => t.teamId === 'empty'));
const snapshot = { leagueId: 'caps-evidence', syncId: 'caps-evidence', currentWeek: 19,
  info: { careerHubInfo: { seasonInfo: { seasonYear: 2, calendarYear: 2027, seasonWeekType: 2 } } },
  teams: { leagueTeamInfoList: [{ teamId: '1', cityName: 'Atlanta', nickName: 'Falcons' }] },
  rosters: { teams: { 1: { rosterInfoList: [
    { rosterId: 'real-qb', firstName: 'Real', lastName: 'QB', position: 'QB', yearsPro: 3, playerBestOvr: 89,
      throwAccShortRating: 85, throwAccMidRating: 85, throwAccDeepRating: 85, throwPowerRating: 85, playActionRating: 85 },
  ] } } },
  schedule: { schedules: Array.from({ length: 18 }, (_, weekIndex) => ({ stageIndex: 1, weekIndex, status: 2, homeTeamId: '1', awayTeamId: '2' })) },
  weeklyStats: Array.from({ length: 18 }, (_, weekIndex) => ({ stage: 1, weekIndex, passing: { playerPassingStatInfoList: [
    { rosterId: 'real-qb', teamId: '1', seasonIndex: 2, passAtt: 30, passComp: 24, passYds: 350, passTDs: 4, passInts: 0, passLongest: 55 },
  ] } })),
};
const computed = getRatingPopulationPlan(snapshot, rules);
assert.equal(computed.adjustments.find((p) => p.playerKey === 'roster:real-qb').targetOvr, 90);
const traded = structuredClone(snapshot);
for (const week of traded.weeklyStats.slice(0, 12)) week.passing.playerPassingStatInfoList[0].teamId = '2';
assert.equal(getRatingPopulationPlan(traded, rules).eliteQbs[0].games, 18, 'Verified player identity retains same-season performance across trades');
const incompleteStats = structuredClone(snapshot);
for (const week of incompleteStats.weeklyStats) delete week.passing.playerPassingStatInfoList[0].passInts;
assert.equal(getRatingPopulationPlan(incompleteStats, rules).eliteQbs.length, 0, 'Missing interception data must not look like a perfect turnover-free season');
const partial = structuredClone(snapshot); partial.currentWeek = 3; partial.info.careerHubInfo.seasonInfo.seasonWeekType = 1;
const early = getRatingPopulationPlan(partial, rules);
assert.equal(early.eliteQbs.length, 0, 'Future completed-looking exports cannot bypass current-week/sample protection');
assert.ok(!buildWeeklyProgressionRecommendations(partial, { rules, weekIndex: 1 }).recommendations.some((p) => p.playerKey === 'roster:real-qb' && p.direction === 'upgrade'), 'An unqualified QB at 89 cannot earn more growth across 90');
const applied = structuredClone(roster);
for (const adjustment of plan.adjustments) applied.find((p) => p.playerKey === adjustment.playerKey).currentOvr = adjustment.targetOvr;
assert.deepEqual(countRatingBands(applied), plan.projectedCounts);
console.log('PASS overlapping hard caps, accepted 400-player limit, earned elite replacement, no artificial minimums, sample/future-stat protection, manual rating verification, and QB-needs outlook');
