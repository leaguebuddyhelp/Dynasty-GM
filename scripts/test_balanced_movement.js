import assert from 'node:assert/strict';
import fs from 'node:fs';
import { balanceWeeklyAttributePoints, buildWeeklyProgressionRecommendations } from '../src/madden/progression.js';
const rules = JSON.parse(fs.readFileSync('config/madden_solo_rules.json', 'utf8')).progression;
const policy = rules.weekly.pointBalance;
const context = { history: { periods: {} }, seasonKey: 'year_2028', playerKey: 'roster:p', weekIndex: 5, policy };
const attrs = (sign) => ['Man Coverage', 'Zone Coverage', 'Play Recognition'].map((attribute) => ({ attribute, currentValue: 80, targetValue: 80 + sign * 5, points: sign * 5 }));
for (const sign of [1, -1]) {
  const result = balanceWeeklyAttributePoints(attrs(sign), context);
  assert.equal(result.reduce((sum, a) => sum + Math.abs(a.points), 0), policy.weeklyPoints, 'Gains and losses share the same weekly budget');
  assert.ok(result.every((a) => Math.abs(a.points) >= 2 && a.targetValue === 80 + a.points));
  assert.equal(balanceWeeklyAttributePoints(attrs(sign), { ...context, exceptional: true }).reduce((s, a) => s + Math.abs(a.points), 0), policy.exceptionalWeeklyPoints, 'Exceptional good and bad evidence shares the same higher ceiling');
  const history = { periods: { old: { type: 'weekly', seasonKey: context.seasonKey, weekIndex: 4,
    recommendations: [{ playerKey: context.playerKey, attributes: [{ attribute: 'Man Coverage', points: sign * (policy.seasonPoints - 2) }] }] } } };
  assert.equal(balanceWeeklyAttributePoints(attrs(sign), { ...context, history }).reduce((s, a) => s + Math.abs(a.points), 0), 2, 'Both directions stop at the shared earned regular-season points');
  history.periods.old.recommendations[0].attributes[0].points = sign * policy.seasonPoints;
  assert.deepEqual(balanceWeeklyAttributePoints(attrs(sign), { ...context, history }), []);
  assert.equal(balanceWeeklyAttributePoints(attrs(sign), { ...context, history, weekIndex: 18, playoffExtraPoints: 1 }).reduce((s, a) => s + Math.abs(a.points), 0), policy.weeklyPoints + 1, 'Earned playoff rewards retain headroom after the regular season');
  assert.equal(balanceWeeklyAttributePoints(attrs(sign), { ...context, history, weekIndex: 18 }).reduce((s, a) => s + Math.abs(a.points), 0), policy.weeklyPoints, 'Playoff phase alone cannot grant an extra point');
  history.periods.old.seasonKey = 'year_2027';
  assert.equal(balanceWeeklyAttributePoints(attrs(sign), { ...context, history }).reduce((s, a) => s + Math.abs(a.points), 0), policy.weeklyPoints, 'Prior years cannot consume this season’s budget');
  const awareness = [{ attribute: 'Awareness', currentValue: 80, targetValue: 80 + sign * 5, points: sign * 5 }];
  assert.equal(Math.abs(balanceWeeklyAttributePoints(awareness, context)[0].points), 1);
  history.periods.old.seasonKey = context.seasonKey;
  history.periods.old.recommendations[0].attributes = [{ attribute: 'Awareness', points: sign * 10 }];
  assert.deepEqual(balanceWeeklyAttributePoints(awareness, { ...context, history }), [], 'Awareness-only changes cannot carry repeated large season losses');
  history.periods.old.weekIndex = 18;
  assert.deepEqual(balanceWeeklyAttributePoints(awareness, { ...context, history, weekIndex: 19 }), [], 'Prior playoff Awareness losses count toward the season safeguard');
}
// Safeties can earn real coverage growth without needing an interception.
for (const position of ['CB', 'FS', 'SS']) {
  const snapshot = { leagueId: 'balanced-secondary', syncId: 'test', currentWeek: 5,
    teams: { leagueTeamInfoList: [{ teamId: 1, cityName: 'Chicago', nickName: 'Bears' }] },
    rosters: { teams: { 1: { rosterInfoList: [{ rosterId: 'p', firstName: 'Coverage', lastName: position, position, yearsPro: 2, playerBestOvr: 80,
      ...Object.fromEntries(Object.values(rules.weekly.attributeFields).map((field) => [field, 80])) }] } } },
    schedule: { schedules: Array.from({ length: 4 }, (_, weekIndex) => ({ stageIndex: 1, weekIndex, status: 2, homeTeamId: 1, awayTeamId: 2 })) },
    weeklyStats: Array.from({ length: 4 }, (_, weekIndex) => ({ stage: 1, weekIndex, defense: { playerDefensiveStatInfoList: [{ rosterId: 'p', teamId: 1,
      defTotalTackles: 5, defPassDeflections: 2, defCatchAllowed: 1, defInts: 0 }] } })) };
  const record = buildWeeklyProgressionRecommendations(snapshot, { weekIndex: 3, rules });
  const recommendation = record.recommendations.find((p) => p.playerKey === 'roster:p');
  assert.equal(recommendation?.direction, 'upgrade', `${position}: productive non-INT games must earn upgrades`);
  assert.ok(recommendation.attributes.some((a) => ['Man Coverage', 'Zone Coverage', 'Play Recognition'].includes(a.attribute)));
  assert.ok(recommendation.totalAttributePoints <= policy.weeklyPoints);
  const quiet = structuredClone(snapshot);
  for (const w of quiet.weeklyStats) Object.assign(w.defense.playerDefensiveStatInfoList[0], { defTotalTackles: 2, defPassDeflections: 0, defCatchAllowed: 0 });
  assert.ok(!buildWeeklyProgressionRecommendations(quiet, { weekIndex: 3, rules }).recommendations.some((p) => p.direction === 'downgrade'), 'A quiet tracked stat line is not a bad coverage game');
  const bad = structuredClone(snapshot); bad.currentWeek = 9;
  bad.weeklyStats = Array.from({ length: 8 }, (_, weekIndex) => ({ stage: 1, weekIndex, defense: { playerDefensiveStatInfoList: [{ rosterId: 'p', teamId: 1,
    defTotalTackles: 2, defPassDeflections: 0, defCatchAllowed: 3, defInts: 0 }] } }));
  bad.schedule.schedules = bad.weeklyStats.map(({ weekIndex }) => ({ stageIndex: 1, weekIndex, status: 2, homeTeamId: 1, awayTeamId: 2 }));
  const loss = buildWeeklyProgressionRecommendations(bad, { weekIndex: 7, rules }).recommendations.find((p) => p.playerKey === 'roster:p');
  assert.equal(loss?.direction, 'downgrade', `${position}: sustained observed coverage failures have a real skill-loss path`);
  assert.ok(loss.attributes.some((a) => a.attribute === 'Man Coverage') && loss.attributes.some((a) => a.attribute === 'Zone Coverage'));
  assert.equal(loss.changeContext.roleDecline.type, 'coverageEvents');
  assert.ok(Math.abs(loss.totalAttributePoints) <= policy.exceptionalWeeklyPoints);
  const noLeaderBonus = structuredClone(rules); delete noLeaderBonus.weekly.statLeaders;
  assert.equal(buildWeeklyProgressionRecommendations(bad, { weekIndex: 7, rules: noLeaderBonus }).recommendations[0]?.direction, 'downgrade', 'Coverage safeguards also work when leader bonuses are disabled');
  const insufficient = buildWeeklyProgressionRecommendations(bad, { weekIndex: 3, rules }).recommendations;
  assert.ok(!insufficient.some((p) => p.changeContext.roleDecline?.type === 'coverageEvents'), 'Future games cannot supply the six-game coverage sample');
  bad.rosters.teams[1].rosterInfoList[0].injuryLength = 3;
  assert.ok(!buildWeeklyProgressionRecommendations(bad, { weekIndex: 7, rules }).recommendations.some((p) => p.direction === 'downgrade'), 'Injury must not trigger a coverage loss');
}
console.log('PASS symmetric point budgets, regular-season limits, Awareness safeguards, playoff headroom, year isolation, and non-INT DB progression');
