import assert from 'node:assert/strict';
import fs from 'node:fs';
import { seasonImpact, concentrateSeasonEvidence } from '../src/madden/season_impact.js';
import { replayFullSeason } from '../src/madden/full_season_engine.js';
import { getRatingPopulationPlan } from '../src/madden/progression.js';
const rules = JSON.parse(fs.readFileSync('config/madden_solo_rules.json', 'utf8')).progression;
const policy = rules.weekly.seasonImpact;
const strong = { policy, position: 'QB', direction: 'upgrade', games: 6, seasonScore: 90, currentScore: 95, young: true, totals: { passAtt: 180 } };
assert.ok(seasonImpact(strong).extraPoints > seasonImpact({ ...strong, young: false }).extraPoints);
assert.equal(seasonImpact({ ...strong, games: 5 }), null);
assert.equal(seasonImpact({ ...strong, seasonScore: 65 }), null);
assert.equal(seasonImpact({ ...strong, currentScore: 30 }), null);
assert.equal(seasonImpact({ ...strong, totals: { passAtt: 48 } }), null, 'A backup’s six small appearances cannot earn starter-sized changes');
assert.equal(seasonImpact({ ...strong, completeEvidence: false }), null, 'Missing passing fields cannot establish a breakout or bust');
assert.equal(seasonImpact({ ...strong, position: 'K' }), null);
assert.equal(seasonImpact({ ...strong, position: 'P' }), null);
const evidence = ['Awareness', 'Play Action', 'Throw Accuracy Deep', 'Throw Accuracy Short', 'Throw Accuracy Mid'].map((attribute) => ({ attribute, currentValue: 70 }));
assert.deepEqual(concentrateSeasonEvidence(evidence, 'QB').map((a) => a.attribute), ['Throw Accuracy Short', 'Throw Accuracy Mid', 'Throw Accuracy Deep']);
assert.equal(concentrateSeasonEvidence([{ attribute: 'Catching' }], 'WR').length, 1, 'Concentration must not invent additional evidenced skills');
const player = (id, extra) => ({ rosterId: id, firstName: id, lastName: 'QB', position: 'QB', yearsPro: 0, playerBestOvr: 76,
  ...Object.fromEntries(Object.values(rules.weekly.attributeFields).map((field) => [field, 75])), ...extra });
const baseline = { leagueId: 'large-season-impact', syncId: 'baseline', currentWeek: 1,
  info: { careerHubInfo: { seasonInfo: { calendarYear: 2026, seasonIndex: 1, seasonWeekType: 1 } } },
  teams: { leagueTeamInfoList: [1, 2].map((teamId) => ({ teamId, nickName: `Team${teamId}` })) },
  rosters: { teams: { 1: { rosterInfoList: [player('riser')] }, 2: { rosterInfoList: [player('faller', { yearsPro: 5, playerBestOvr: 90 })] } } },
  weeklyStats: [], schedule: { schedules: [] } };
const snapshot = structuredClone(baseline); snapshot.currentWeek = 19;
snapshot.schedule.schedules = Array.from({ length: 18 }, (_, weekIndex) => ({ weekIndex, stageIndex: 1, status: 2, homeTeamId: 1, awayTeamId: 2 }));
snapshot.weeklyStats = Array.from({ length: 18 }, (_, weekIndex) => ({ stage: 1, weekIndex,
  passing: { playerPassingStatInfoList: [
    { rosterId: 'riser', teamId: 1, passAtt: 30, passComp: 25, passYds: 400, passTDs: 4, passInts: 0, passLongest: 55 },
    { rosterId: 'faller', teamId: 2, passAtt: 30, passComp: 8, passYds: 40, passTDs: 0, passInts: 4, passLongest: 10 },
  ] }, defense: { playerDefensiveStatInfoList: [1, 2].map((teamId) => ({ rosterId: `coverage${teamId}`, teamId, defTotalTackles: 2 })) } }));
const replay = await replayFullSeason({ baseline, snapshot, rules, computeAwards: async () => ({}) });
const riser = replay.totals.players.find((p) => p.playerKey === 'roster:riser');
const faller = replay.totals.players.find((p) => p.playerKey === 'roster:faller');
assert.ok(Object.values(riser.attributes).filter((a) => a.net >= 15).length >= 2, 'A true full-season breakout must produce large individual core-skill gains');
assert.ok(Object.values(faller.attributes).filter((a) => a.net <= -15).length >= 2, 'A catastrophic sustained season must produce large core-skill losses');
for (const p of [riser, faller]) {
  assert.ok(Object.values(p.attributes).reduce((s, a) => s + a.positive, 0) <= rules.weekly.pointBalance.seasonPoints);
  assert.ok(Object.values(p.attributes).reduce((s, a) => s + a.negative, 0) <= rules.weekly.pointBalance.seasonPoints);
}
const slotRules = structuredClone(rules); slotRules.populationCaps.overall80PlusMaximum = 1;
const receivers = structuredClone(baseline); receivers.currentWeek = 7;
receivers.rosters.teams = { 1: { rosterInfoList: [
  { ...player('incumbent'), position: 'WR', playerBestOvr: 80 }, { ...player('challenger'), position: 'WR', playerBestOvr: 79 },
] } };
receivers.weeklyStats = Array.from({ length: 6 }, (_, weekIndex) => ({ stage: 1, weekIndex, receiving: { playerReceivingStatInfoList: [
  { rosterId: 'incumbent', teamId: 1, recCatches: 5, recYds: 80, recTDs: 2, recLongest: 30, recCatchPct: 100 },
  { rosterId: 'challenger', teamId: 1, recCatches: 7, recYds: 160, recTDs: 2, recLongest: 60, recCatchPct: 100 },
] } }));
const slots = getRatingPopulationPlan(receivers, slotRules);
assert.equal(slots.ceilings['roster:challenger'], 99, 'Underlying production must distinguish two saturated game grades and reserve an earned tier slot');
assert.equal(slots.adjustments.find((p) => p.playerKey === 'roster:incumbent')?.targetOvr, 79);
console.log('PASS sustained season core concentration, youth boost, sample/ordinary-game safeguards, specialist protection, and genuine 15+ skill gains and losses');
