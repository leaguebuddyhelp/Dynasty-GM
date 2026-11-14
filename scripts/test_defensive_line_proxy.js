import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildWeeklyProgressionRecommendations, buildProgressionCardEmbed, buildFullSeasonCardEmbeds } from '../src/madden/progression.js';
import { buildPositionChangeEmbeds } from '../src/madden/position_reports.js';
import { collectSeasonTotals, buildSeasonApplication } from '../src/madden/full_season_engine.js';
const rules = JSON.parse(fs.readFileSync('config/madden_solo_rules.json', 'utf8')).progression;
const player = (id, position, extra = {}) => ({ rosterId: id, firstName: 'Test', lastName: id, position, playerBestOvr: 80, yearsPro: 3,
  ...Object.fromEntries(Object.values(rules.weekly.attributeFields).map((field) => [field, 80])), ...extra });
function fixture(position, kind) {
  return { leagueId: 'dl-proxy', syncId: 'test', currentWeek: 7,
    info: { careerHubInfo: { seasonInfo: { calendarYear: 2028, seasonIndex: 3, seasonWeekType: 1 } } },
    teams: { leagueTeamInfoList: [{ teamId: 1, cityName: 'Chicago', nickName: 'Bears' }, { teamId: 2, cityName: 'Detroit', nickName: 'Lions' }] },
    rosters: { teams: { 1: { rosterInfoList: [player('focus', position)] }, 2: { rosterInfoList: [player('qb', 'QB'), player('hb', 'HB')] } } },
    schedule: { schedules: Array.from({ length: 6 }, (_, weekIndex) => ({ stageIndex: 1, weekIndex, status: 2, homeTeamId: 1, awayTeamId: 2 })) },
    weeklyStats: Array.from({ length: 6 }, (_, weekIndex) => ({ stage: 1, weekIndex,
      passing: { playerPassingStatInfoList: [{ rosterId: 'qb', teamId: 2, passAtt: 30, passYds: kind === 'passRush' ? 300 : 180,
        passSacks: kind === 'passRush' ? 0 : 3, passComp: 20, passTDs: 1, passInts: 0 }] },
      rushing: { playerRushingStatInfoList: [{ rosterId: 'hb', teamId: 2, rushAtt: 25, rushYds: kind === 'runDefense' ? 150 : 100, rushTDs: 1 }] },
      defense: { playerDefensiveStatInfoList: [{ rosterId: 'focus', teamId: 1, position, defTotalTackles: 2, defSacks: 0,
        defInts: 0, defForcedFum: 0, defFumRec: 0, defSafeties: 0, defTDs: 0, defDeflections: 0 }] },
    })) };
}
function evaluate(snapshot, policy = rules) {
  const history = { periods: {}, seasonAwards: {} };
  let record;
  for (let weekIndex = 0; weekIndex < 6; weekIndex++) {
    record = buildWeeklyProgressionRecommendations(snapshot, { rules: policy, history, weekIndex });
    if (weekIndex < 5) assert.ok(!record.recommendations.some((p) => p.changeContext.roleDecline?.type === 'defensiveLineUnit'), 'Do not invent starter history from future stats');
    history.periods[record.periodKey] = record;
  }
  return { record, history };
}
for (const position of ['LEDG', 'REDG', 'DT']) for (const kind of ['runDefense', 'passRush']) {
  const snapshot = fixture(position, kind), original = structuredClone(snapshot);
  const { record, history } = evaluate(snapshot);
  const loss = record.recommendations.find((p) => p.playerKey === 'roster:focus');
  assert.equal(loss?.direction, 'downgrade', `${position} ${kind}: repeated bad units must have a conservative skill-loss path`);
  assert.equal(loss.changeContext.roleDecline.type, 'defensiveLineUnit');
  assert.equal(loss.changeContext.roleDecline.kind, kind);
  assert.equal(loss.changeContext.roleDecline.games, 6);
  assert.ok(loss.attributes.length <= 2 && Math.abs(loss.totalAttributePoints) <= 4);
  assert.ok(loss.attributes.every((a) => a.points >= -2 && a.points < 0 && a.attribute !== 'Awareness'));
  assert.deepEqual(snapshot, original, 'Proxy calculations cannot mutate imported data');
  const description = buildPositionChangeEmbeds(snapshot, record).get(position).embeds[0].toJSON().description;
  assert.match(description, /DL team proxy/);
  assert.match(description, /Individual snaps\/pressures are unavailable/);
  assert.match(JSON.stringify(buildProgressionCardEmbed(record, loss).toJSON()), /DL team-performance proxy/);
  const totals = collectSeasonTotals(history.periods);
  const application = buildSeasonApplication({ totals, baseline: snapshot, snapshot, applicationMode: 'add_net' });
  const total = application.find((p) => p.playerKey === 'roster:focus');
  assert.equal(total.defensiveLineProxySummary.points, 4);
  assert.match(JSON.stringify(buildFullSeasonCardEmbeds(total, record.seasonKey).map((embed) => embed.toJSON())), /DL team-proxy losses/);
  assert.deepEqual(total.defensiveLineProxySummary.weeks, [6]);
  assert.match(buildPositionChangeEmbeds(snapshot, { seasonKey: record.seasonKey, application }, { fullSeason: true })
    .get(position).embeds[0].toJSON().description, /Season totals include 4 points of DL team-proxy losses/, 'Full-season summed posts must retain the proxy disclosure');
  assert.equal(buildWeeklyProgressionRecommendations(snapshot, { rules, history, weekIndex: 5 }).recommendations
    .find((p) => p.playerKey === 'roster:focus').changeContext.roleDecline.games, 6, 'Same-week retries cannot add another observation');
  for (const mutate of [
    (s) => { s.rosters.teams[1].rosterInfoList[0].injuryLength = 3; },
    (s) => { delete s.weeklyStats[5].defense.playerDefensiveStatInfoList[0].defSacks; },
    (s) => { s.weeklyStats[5].defense.playerDefensiveStatInfoList[0].defSacks = 1; },
    (s) => { s.weeklyStats[5].defense.playerDefensiveStatInfoList[0].defDeflections = 1; },
    (s) => { s.weeklyStats[5].defense.playerDefensiveStatInfoList[0].defFumRec = 1; },
    (s) => { s.weeklyStats[5].defense.playerDefensiveStatInfoList[0].defSafeties = 1; },
    (s) => { s.weeklyStats[5].defense.playerDefensiveStatInfoList[0].defTotalTackles = 1; },
    (s) => { delete s.schedule.schedules[5].status; },
    (s) => { s.weeklyStats[5].passing.playerPassingStatInfoList[0].seasonIndex = 2; },
    (s) => { s.schedule.schedules[5].status = 1; },
    (s) => { if (kind === 'passRush') delete s.weeklyStats[5].passing.playerPassingStatInfoList[0].passSacks;
      else delete s.weeklyStats[5].rushing.playerRushingStatInfoList[0].rushYds; },
    (s) => { if (kind === 'passRush') delete s.weeklyStats[5].passing.playerPassingStatInfoList[0].passAtt;
      else delete s.weeklyStats[5].rushing.playerRushingStatInfoList[0].rushAtt; },
    (s) => { s.rosters.teams[1].rosterInfoList.push(player('new-starter', position, { playerBestOvr: 95 }));
      if (position === 'DT') s.rosters.teams[1].rosterInfoList.push(player('new-second-starter', position, { playerBestOvr: 94 })); },
  ]) {
    const changed = structuredClone(snapshot); mutate(changed);
    assert.ok(!buildWeeklyProgressionRecommendations(changed, { rules, history, weekIndex: 5 }).recommendations
      .some((p) => p.playerKey === 'roster:focus' && p.changeContext.roleDecline?.type === 'defensiveLineUnit'), `${position}: protect injury, missing fields, productive players, unfinished games and displaced starters`);
  }
  for (const change of [
    (period) => { period.seasonKey = 'year_2027'; },
    (period) => { period.defensiveLineProxyObservations['roster:focus'].teamId = 'other-team'; },
    (period) => { period.defensiveLineProxyObservations['roster:focus'].position = 'CB'; },
    (period) => { delete period.defensiveLineProxyObservations['roster:focus']; },
  ]) {
    const past = structuredClone(history);
    for (const period of Object.values(past.periods)) if (period.weekIndex < 5) change(period);
    assert.ok(!buildWeeklyProgressionRecommendations(snapshot, { rules, history: past, weekIndex: 5 }).recommendations
      .some((p) => p.changeContext.roleDecline?.type === 'defensiveLineUnit'), 'New starters, trades, position changes and prior seasons cannot supply observations');
  }
  const disabled = structuredClone(rules); disabled.weekly.defensiveLineProxy.enabled = false;
  assert.ok(!evaluate(snapshot, disabled).record.recommendations.some((p) => p.changeContext.roleDecline?.type === 'defensiveLineUnit'));
  const lowHistory = structuredClone(snapshot);
  for (const week of lowHistory.weeklyStats.slice(0, 5)) week.defense.playerDefensiveStatInfoList[0].defTotalTackles = 1;
  assert.equal(evaluate(lowHistory).record.recommendations.find((p) => p.playerKey === 'roster:focus')?.changeContext.roleDecline?.type,
    'defensiveLineUnit', 'Recorded one-tackle starter games build history without allowing a one-tackle current-game penalty');
  if (kind === 'passRush') {
    const highRate = structuredClone(snapshot);
    for (const week of highRate.weeklyStats) week.passing.playerPassingStatInfoList[0].passSacks = 2;
    assert.ok(!evaluate(highRate).record.recommendations.some((p) => p.changeContext.roleDecline?.type === 'defensiveLineUnit'), 'Two sacks on 30 attempts exceeds the weak-rush rate');
    for (const week of highRate.weeklyStats) Object.assign(week.passing.playerPassingStatInfoList[0], { passAtt: 40, passYds: 360 });
    assert.ok(evaluate(highRate).record.recommendations.some((p) => p.changeContext.roleDecline?.type === 'defensiveLineUnit'), 'Two sacks on 40 attempts is a lower sack rate and can qualify with repeated weak results');
  } else {
    const kneels = structuredClone(snapshot);
    for (const week of kneels.weeklyStats) week.rushing.playerRushingStatInfoList.push({ rosterId: 'qb', teamId: 2, rushAtt: 2, rushYds: -2 });
    assert.ok(evaluate(kneels).record.recommendations.some((p) => p.changeContext.roleDecline?.type === 'defensiveLineUnit'), 'Negative rushing yards are valid and must be included in opponent totals');
  }
}
console.log('PASS conservative DL run/pass proxies, six-game starter history, bounded skill losses, explicit labels, retry safety, injuries, good plays, missing stats, unfinished games, trades and position changes');
