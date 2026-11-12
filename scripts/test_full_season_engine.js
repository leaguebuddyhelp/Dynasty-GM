import assert from 'node:assert/strict';
import fs from 'node:fs';
import { replayFullSeason, collectSeasonTotals, buildSeasonApplication, seasonCoverage, regularSeasonWeeks } from '../src/madden/full_season_engine.js';

const rules = JSON.parse(fs.readFileSync('config/madden_solo_rules.json', 'utf8')).progression;
const teams = [{ teamId: 1, cityName: 'Denver', nickName: 'Broncos' }, { teamId: 2, cityName: 'Los Angeles', nickName: 'Rams' }];
const make = (id, position, yearsPro = 5) => ({ rosterId: id, firstName: 'Season', lastName: id, position, yearsPro,
  playerBestOvr: 80, awareRating: 75, throwAccShortRating: 75, throwAccMidRating: 75, throwAccDeepRating: 75, throwPowerRating: 75,
  playActionRating: 75, tackleRating: 75, zoneCoverRating: 75, playRecRating: 75, pursuitRating: 75, manCoverRating: 75 });
const baseline = { leagueId: 'full-engine', syncId: 'baseline', season: 1, currentWeek: 1,
  info: { careerHubInfo: { seasonInfo: { calendarYear: 2027, seasonIndex: 1, seasonWeekType: 1 } } },
  teams: { leagueTeamInfoList: teams }, rosters: { teams: { 1: { rosterInfoList: [make('q1', 'QB', 0), make('d1', 'CB')] }, 2: { rosterInfoList: [make('q2', 'QB'), make('d2', 'CB')] } } }, weeklyStats: [] };
const snapshot = { ...structuredClone(baseline), currentWeek: 19, syncId: 'final',
  schedule: { schedules: Array.from({ length: 18 }, (_, weekIndex) => ({ stageIndex: 1, weekIndex, status: 2, homeTeamId: 1, awayTeamId: 2, homeScore: 31, awayScore: 14 })) },
  weeklyStats: Array.from({ length: 18 }, (_, weekIndex) => ({ stage: 1, weekIndex,
    passing: { playerPassingStatInfoList: [1, 2].map((teamId) => ({ rosterId: `q${teamId}`, teamId, position: 'QB', passAtt: 30, passComp: teamId === 1 ? 24 : 8,
      passYds: teamId === 1 ? 350 : 40, passTDs: teamId === 1 ? 4 : 0, passInts: teamId === 1 ? 0 : 3, passLongest: teamId === 1 ? 55 : 10 })) },
    defense: { playerDefensiveStatInfoList: [1, 2].map((teamId) => ({ rosterId: `d${teamId}`, teamId, position: 'CB', defTotalTackles: 8, defInts: 1, defPassDeflections: 2 })) },
  })) };
snapshot.info.careerHubInfo.seasonInfo.seasonWeekType = 2;
const original = structuredClone(baseline);
const views = [];
const replay = await replayFullSeason({ baseline, snapshot, rules, computeAwards: async (view, week) => {
  assert.ok(view.weeklyStats.every((entry) => entry.weekIndex < week));
  assert.ok(view.schedule.schedules.every((game) => game.weekIndex < week));
  assert.equal(view.standings.teamStandingInfoList.length, 0, 'End-season standings cannot leak into early-week scoring');
  views.push({ week, rating: view.rosters.teams[1].rosterInfoList.find((player) => player.rosterId === 'q1').throwAccShortRating });
  return {};
} });
assert.equal(Object.keys(replay.weeks).length, 18);
assert.ok(views[1].rating > views[0].rating, 'Prior weekly changes carry into the next week');
assert.deepEqual(baseline, original, 'The saved baseline is immutable');
assert.ok(replay.totals.positivePoints > 0 && replay.totals.negativePoints > 0);
const grossPositive = Object.values(replay.weeks).flatMap((week) => week.recommendations).flatMap((item) => item.attributes).filter((item) => item.points > 0).reduce((sum, item) => sum + item.points, 0);
assert.equal(replay.totals.positivePoints, grossPositive);
assert.equal(replay.totals.netPoints, replay.totals.positivePoints - replay.totals.negativePoints);
for (const player of replay.totals.players) for (const attribute of Object.values(player.attributes)) {
  const initial = Object.values(baseline.rosters.teams).flatMap((roster) => roster.rosterInfoList).find((row) => `roster:${row.rosterId}` === player.playerKey)[attribute.field];
  assert.ok(initial + attribute.net >= 0 && initial + attribute.net <= 99);
}
const staleSeason = structuredClone(snapshot);
for (const week of staleSeason.weeklyStats) {
  week.passing.playerPassingStatInfoList.push({ rosterId: 'last-year-qb', teamId: 999, seasonIndex: 0, passAtt: 30, passYds: 500, passTDs: 7 });
  week.defense.playerDefensiveStatInfoList.push({ rosterId: 'last-year-defender', teamId: 999, seasonIndex: 0, defTotalTackles: 20 });
}
const cleanWeeks = regularSeasonWeeks(staleSeason);
assert.equal(seasonCoverage(staleSeason, cleanWeeks).complete, true);
assert.ok(Object.values(cleanWeeks).every((week) => week.passing.playerPassingStatInfoList.length === 2));
const staleReplay = await replayFullSeason({ baseline, snapshot: staleSeason, rules, computeAwards: async () => ({}) });
assert.deepEqual(staleReplay.totals, replay.totals, 'Foreign-season cache rows must not change the current season’s awards/progression inputs');
const missing = structuredClone(snapshot);
missing.weeklyStats = missing.weeklyStats.filter((week) => week.weekIndex !== 3);
assert.deepEqual(seasonCoverage(missing).missingWeeks, [4]);
await assert.rejects(replayFullSeason({ baseline, snapshot: missing, rules, computeAwards: async () => ({}) }), /Missing weeks: 4/);
const incompleteTeam = structuredClone(snapshot);
incompleteTeam.weeklyStats[2].defense.playerDefensiveStatInfoList.pop();
assert.deepEqual(seasonCoverage(incompleteTeam).missingTeams[3], ['2']);
const totals = collectSeasonTotals({ a: { weekIndex: 0, recommendations: [{ playerKey: 'roster:q1', player: 'Season q1', teamId: '1', team: 'Broncos', position: 'QB', direction: 'upgrade', attributes: [{ attribute: 'Awareness', field: 'awareRating', points: 5 }] }] },
  b: { weekIndex: 1, recommendations: [{ playerKey: 'roster:q1', player: 'Season q1', teamId: '1', team: 'Broncos', position: 'QB', direction: 'downgrade', attributes: [{ attribute: 'Awareness', field: 'awareRating', points: -2 }] }] } });
const latest = structuredClone(snapshot);
latest.rosters.teams[1].rosterInfoList[0].awareRating = 85;
const applied = buildSeasonApplication({ totals, baseline, snapshot: latest, applicationMode: 'add_net' })[0].attributes[0];
assert.equal(applied.net, 3);
assert.equal(applied.currentValue, 85);
assert.equal(applied.targetValue, 88, 'Net deltas preserve Madden’s own development');
assert.equal(applied.positive, 5); assert.equal(applied.negative, 2);
latest.rosters.teams[1].rosterInfoList[0].awareRating = '85';
assert.equal(buildSeasonApplication({ totals, baseline, snapshot: latest, applicationMode: 'add_net' })[0].attributes[0].targetValue, 88, 'Numeric strings must not concatenate into fake target ratings');
latest.rosters.teams[1].rosterInfoList[0].awareRating = 98;
assert.equal(buildSeasonApplication({ totals, baseline, snapshot: latest, applicationMode: 'add_net' })[0].attributes[0].targetValue, 99);
delete latest.rosters.teams[1].rosterInfoList[0].awareRating;
assert.equal(buildSeasonApplication({ totals, baseline, snapshot: latest, applicationMode: 'add_net' })[0].attributes[0].needsReview, true);
const bioBaseline = structuredClone(baseline);
Object.assign(bioBaseline.rosters.teams[1].rosterInfoList[0], { presentationId: 42, birthYear: 2001, birthMonth: 1, birthDay: 1 });
const changedId = structuredClone(snapshot);
Object.assign(changedId.rosters.teams[1].rosterInfoList[0], { presentationId: 42, birthYear: 2001, birthMonth: 1, birthDay: 1, rosterId: 'new-q1' });
changedId.weeklyStats.slice(9).forEach((week) => { week.passing.playerPassingStatInfoList[0].rosterId = 'new-q1'; });
const stableIdentity = await replayFullSeason({ baseline: bioBaseline, snapshot: changedId, rules, computeAwards: async () => ({}) });
assert.ok(stableIdentity.totals.players.some((row) => row.playerKey === 'bio:42:2001:1:1'));
assert.equal(stableIdentity.unmatchedPlayers.length, 0, 'A verified stable identity retains earlier stats across roster-ID changes');
console.log('PASS 18-week chronological replay, carried attributes, immutable baseline, net/gross tallies, real-game coverage, and preservation of Madden ratings');
