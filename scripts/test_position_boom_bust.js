import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildWeeklyProgressionRecommendations } from '../src/madden/progression.js';
import { replayFullSeason } from '../src/madden/full_season_engine.js';
import { POSITION_THREADS } from '../src/madden/position_reports.js';
const rules = JSON.parse(fs.readFileSync('config/madden_solo_rules.json', 'utf8')).progression;
const player = (id, position, teamId = 1) => ({ rosterId: id, firstName: 'Test', lastName: id, position, yearsPro: 3,
  playerBestOvr: 85, ...Object.fromEntries(Object.values(rules.weekly.attributeFields).map((field) => [field, 80])), teamId });
const fields = { passing: 'playerPassingStatInfoList', rushing: 'playerRushingStatInfoList', receiving: 'playerReceivingStatInfoList', defense: 'playerDefensiveStatInfoList', kicking: 'playerKickingStatInfoList', punting: 'playerPuntingStatInfoList' };
function line(position) { return ['LT', 'LG', 'C', 'RG', 'RT'].includes(position); }
function stats(position, poor) {
  if (position === 'QB') return ['passing', { passAtt: 30, passComp: poor ? 8 : 24, passYds: poor ? 40 : 350, passTDs: poor ? 0 : 4, passInts: poor ? 4 : 0, passLongest: poor ? 10 : 55, passSacks: poor ? 10 : 0 }];
  if (['HB', 'FB'].includes(position)) return ['rushing', { rushAtt: position === 'FB' ? 5 : 25, rushYds: poor ? 6 : position === 'FB' ? 35 : 150, rushTDs: poor ? 0 : 1, rushFum: poor ? 2 : 0, recCatches: 2 }];
  if (['WR', 'TE'].includes(position)) return ['receiving', { recCatches: poor ? 4 : 6, recYds: poor ? 12 : 75, recTDs: poor ? 0 : 1, recDrops: poor ? 3 : 0, recLongest: poor ? 5 : 30 }];
  if (position === 'K') return ['kicking', { fGAtt: 3, fGMade: poor ? 0 : 3, fGLongest: poor ? 0 : 54, xPAtt: 3, xPMade: poor ? 0 : 3 }];
  if (position === 'P') return ['punting', { puntAtt: 4, puntYds: poor ? 120 : 200, puntNetYds: poor ? 80 : 184, puntsIn20: poor ? 0 : 3 }];
  return ['defense', { defTotalTackles: poor ? 2 : ['SAM', 'MIKE', 'WILL'].includes(position) ? 8 : position === 'DT' || ['FS', 'SS'].includes(position) ? 5 : 3,
    defSacks: poor ? 0 : ['LEDG', 'REDG'].includes(position) ? 1 : position === 'DT' ? 0.5 : 0,
    defInts: 0, defDeflections: !poor && ['SAM', 'MIKE', 'WILL', 'CB', 'FS', 'SS'].includes(position) ? 2 : 0,
    defCatchAllowed: poor && ['SAM', 'MIKE', 'WILL', 'CB', 'FS', 'SS'].includes(position) ? 8 : 0 }];
}
function fixture(position, poor, games = 4) {
  const target = player('focus', position);
  const roster = [target];
  if (line(position)) roster.push(player('team-qb', 'QB'), player('team-hb', 'HB'));
  const weeklyStats = Array.from({ length: games }, (_, weekIndex) => {
    const week = { stage: 1, weekIndex };
    const add = (id, pos) => { const [bucket, row] = stats(pos, poor); (week[bucket] ||= { [fields[bucket]]: [] })[fields[bucket]].push({ ...row, rosterId: id, teamId: 1, position: pos }); };
    if (line(position)) { add('team-qb', 'QB'); add('team-hb', 'HB'); }
    else add('focus', position);
    return week;
  });
  return { leagueId: 'position-boom-bust', syncId: 'focus', currentWeek: games + 1,
    info: { careerHubInfo: { seasonInfo: { calendarYear: 2027, seasonYear: 1, seasonWeekType: 1 } } },
    teams: { leagueTeamInfoList: [{ teamId: 1, cityName: 'Chicago', nickName: 'Bears' }, { teamId: 2, cityName: 'Detroit', nickName: 'Lions' }] },
    rosters: { teams: { 1: { rosterInfoList: roster } } }, weeklyStats,
    schedule: { schedules: weeklyStats.map(({ weekIndex }) => ({ stageIndex: 1, weekIndex, status: 2, homeTeamId: 1, awayTeamId: 2 })) } };
}
function evaluate(snapshot, policy = rules) {
  const history = { periods: {}, seasonAwards: {} };
  let record;
  for (let weekIndex = 0; weekIndex < snapshot.weeklyStats.length; weekIndex++) {
    record = buildWeeklyProgressionRecommendations(snapshot, { rules: policy, weekIndex, history });
    history.periods[record.periodKey] = record;
  }
  return { record, history };
}
const secondary = POSITION_THREADS.filter((position) => !['QB', 'WR', 'HB'].includes(position));
for (const position of secondary) for (const poor of [false, true]) {
  const snapshot = fixture(position, poor);
  const { record } = evaluate(snapshot);
  const result = record.recommendations.find((row) => row.playerKey === 'roster:focus');
  assert.ok(result, `${position} must have a supported ${poor ? 'bust' : 'boom'} path`);
  assert.equal(result.direction, poor ? 'downgrade' : 'upgrade', position);
  assert.ok(result.attributes.some((attribute) => Math.abs(attribute.points) >= 2), `${position} sustained performance must earn consequential movement`);
  assert.ok(result.attributes.every((attribute) => Math.abs(attribute.points) <= (line(position) ? 2 : 5) && attribute.targetValue >= 0 && attribute.targetValue <= 99));
  if (position === 'LEDG' && !poor) assert.ok(result.attributes.some((a) => a.field === 'powerMovesRating') && result.attributes.some((a) => a.field === 'finesseMovesRating'));
  if (position === 'CB' && poor) assert.ok(result.attributes.some((a) => a.field === 'manCoverRating'));
  const injured = structuredClone(snapshot); injured.rosters.teams[1].rosterInfoList[0].injuryLength = 4;
  if (poor) assert.ok(!evaluate(injured).record.recommendations.some((row) => row.playerKey === 'roster:focus'), `${position}: injury cannot create a bust penalty`);
}
const unrestricted = structuredClone(rules);
delete unrestricted.weekly.specialistMovement;
for (const position of ['K', 'P']) for (const poor of [false, true]) {
  const target = fixture(position, poor, 6);
  for (const game of target.schedule.schedules) { game.homeScore = poor ? 10 : 35; game.awayScore = poor ? 35 : 10; }
  const base = evaluate(target, unrestricted).record.recommendations.find((row) => row.playerKey === 'roster:focus');
  const reduced = evaluate(target).record.recommendations.find((row) => row.playerKey === 'roster:focus');
  assert.equal(reduced.direction, base.direction, 'Specialists retain earned upgrades/downgrades');
  assert.ok(Math.abs(reduced.totalAttributePoints) < Math.abs(base.totalAttributePoints), `${position}: reduce both growth and decline even with team-form bonuses`);
  assert.ok(reduced.attributes.length <= 2 && reduced.attributes.every((a) => Math.abs(a.points) <= 2));
  const playoff = structuredClone(target);
  playoff.currentWeek = 20; playoff.info.careerHubInfo.seasonInfo.seasonWeekType = 2;
  for (const week of playoff.weeklyStats) week.weekIndex += 13;
  for (const game of playoff.schedule.schedules) game.weekIndex += 13;
  const playoffHistory = { periods: {}, seasonAwards: {} };
  let result;
  for (let weekIndex = 13; weekIndex <= 18; weekIndex++) {
    result = buildWeeklyProgressionRecommendations(playoff, { rules, weekIndex, history: playoffHistory });
    playoffHistory.periods[result.periodKey] = result;
  }
  const changed = result.recommendations.find((row) => row.playerKey === 'roster:focus');
  assert.ok(changed);
  assert.ok(changed.attributes.length <= 2 && changed.attributes.every((a) => Math.abs(a.points) <= 2), 'Playoff stakes cannot bypass the lower specialist caps');
  assert.ok(Math.abs(changed.totalAttributePoints) <= 4);
}
// A genuinely quiet stat line is not evidence that a player did not play well.
const missing = fixture('CB', true);
for (const week of missing.weeklyStats) delete week.defense;
assert.equal(evaluate(missing).record.recommendations.length, 0);
const promoted = fixture('LT', false);
const history = evaluate(promoted).history;
promoted.rosters.teams[1].rosterInfoList[0].rosterId = 'new-starter';
const promotion = buildWeeklyProgressionRecommendations(promoted, { rules, weekIndex: 3, history });
assert.ok(promotion.recommendations.find((row) => row.playerKey === 'roster:new-starter').attributes.every((attribute) => attribute.points <= 1), 'A newly promoted lineman cannot inherit another player’s starter history');
// Heavy QB competition cannot crowd out eligible secondary position groups.
const crowd = fixture('CB', false);
for (let index = 0; index < 60; index++) {
  const id = `crowded-qb-${index}`;
  crowd.rosters.teams[1].rosterInfoList.push(player(id, 'QB'));
  for (const week of crowd.weeklyStats) (week.passing ||= { playerPassingStatInfoList: [] }).playerPassingStatInfoList.push({ ...stats('QB', false)[1], rosterId: id, teamId: 1, position: 'QB' });
}
assert.ok(evaluate(crowd).record.recommendations.some((row) => row.playerKey === 'roster:focus'), 'A productive corner must be selected even with 60 eligible quarterbacks');
for (const position of [...secondary.filter((position) => position !== 'CB'), 'HB']) {
  const id = `mixed-${position}`; crowd.rosters.teams[1].rosterInfoList.push(player(id, position));
  if (!line(position)) for (const week of crowd.weeklyStats) { const [bucket, row] = stats(position, false); (week[bucket] ||= { [fields[bucket]]: [] })[fields[bucket]].push({ ...row, rosterId: id, teamId: 1, position }); }
}
const mixed = evaluate(crowd).record;
for (const position of secondary) assert.ok(mixed.recommendations.some((row) => row.position === position), `${position} deserves a selection opportunity even in a crowded league`);
// Full-season replay uses the same role scoring and carries line observations.
const season = fixture('LT', false, 18);
season.rosters.teams[1].rosterInfoList.push(player('edge', 'LEDG'), player('punter', 'P'));
season.rosters.teams[2] = { rosterInfoList: [player('other-qb', 'QB', 2), player('other-cb', 'CB', 2)] };
for (const week of season.weeklyStats) {
  for (const [id, pos] of [['edge', 'LEDG'], ['punter', 'P']]) { const [bucket, row] = stats(pos, false); (week[bucket] ||= { [fields[bucket]]: [] })[fields[bucket]].push({ ...row, rosterId: id, teamId: 1, position: pos }); }
  week.passing.playerPassingStatInfoList.push({ ...stats('QB', true)[1], rosterId: 'other-qb', teamId: 2 });
  week.defense.playerDefensiveStatInfoList.push({ ...stats('CB', true)[1], rosterId: 'other-cb', teamId: 2 });
}
const baseline = structuredClone(season); baseline.weeklyStats = []; baseline.currentWeek = 1;
const replay = await replayFullSeason({ baseline, snapshot: season, rules, computeAwards: async () => ({}) });
for (const id of ['focus', 'edge', 'punter']) assert.ok(replay.totals.players.find((row) => row.playerKey === `roster:${id}`)?.attributes, `${id}: full-season path must accumulate non-skill-position growth`);
assert.ok(Object.values(replay.weeks[4].lineProxyObservations).length);
console.log('PASS supported boom/bust paths at all 18 secondary positions, consequential changes, OL history/promotion safeguards, position selection opportunity, injury/missing-data protection, and full-season replay');
