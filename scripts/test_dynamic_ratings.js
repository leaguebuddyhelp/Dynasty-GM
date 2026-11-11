import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'madden-dynamic-ratings-'));
const previous = process.env.LB_DATA_ROOT;
process.env.LB_DATA_ROOT = root;
try {
  const { buildWeeklyProgressionRecommendations, performanceAdjustedRatings } = await import('../src/madden/progression.js');
  const rules = JSON.parse(fs.readFileSync('config/madden_solo_rules.json', 'utf8')).progression;
  const player = {
    rosterId: 'kelly', firstName: 'Test', lastName: 'Kelly', position: 'QB',
    playerBestOvr: 80, yearsPro: 6, throwAccShortRating: 80, throwAccMidRating: 80,
    throwAccDeepRating: 80, playActionRating: 80, throwPowerRating: 80,
  };
  const game = (weekIndex) => ({
    weekIndex, stage: 1,
    passing: { playerPassingStatInfoList: [{
      rosterId: 'kelly', position: 'QB', teamId: 1, passAtt: 30, passComp: 24,
      passYds: 400, passTDs: 4, passInts: 0, passLongest: 55,
    }] },
  });
  const snapshot = {
    leagueId: 'ratings', syncId: 'ratings-sync', currentWeek: 3,
    info: { careerHubInfo: { seasonInfo: { calendarYear: 2026, seasonWeekType: 1 } } },
    teams: { leagueTeamInfoList: [{ teamId: 1, cityName: 'Los Angeles', nickName: 'Rams' }] },
    rosters: { teams: { 1: { rosterInfoList: [player] } } },
    weeklyStats: [game(0), game(1)],
  };
  const winners = { nfc_offense: { rosterId: 'kelly' } };
  const awardsPath = path.join(root, 'madden', 'awards.json');
  fs.mkdirSync(path.dirname(awardsPath), { recursive: true });
  fs.writeFileSync(awardsPath, JSON.stringify({
    ratings: { 1: winners, 2: winners, __seasonByWeek: { 1: 'year_2026', 2: 'year_2026' } },
  }));
  const withAwards = buildWeeklyProgressionRecommendations(snapshot, { weekIndex: 1, rules, awardWinners: winners }).recommendations[0];
  assert.equal(withAwards.changeContext.awardMomentum, true);
  const formWithAwards = performanceAdjustedRatings(snapshot, rules).get('roster:kelly');
  fs.writeFileSync(awardsPath, JSON.stringify({
    ratings: { 1: winners, 2: winners, __seasonByWeek: { 1: 'year_2025', 2: 'year_2025' } },
  }));
  const withoutAwards = buildWeeklyProgressionRecommendations(snapshot, { weekIndex: 1, rules }).recommendations[0];
  assert.equal(withoutAwards.changeContext.awardMomentum, false);
  assert.ok(withAwards.attributes[0].points > withoutAwards.attributes[0].points);
  assert.equal(formWithAwards.adjusted, performanceAdjustedRatings(snapshot, rules).get('roster:kelly').adjusted + 1);
} finally {
  if (previous === undefined) delete process.env.LB_DATA_ROOT;
  else process.env.LB_DATA_ROOT = previous;
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('PASS repeated awards accelerate supported attribute changes and form ratings without stale-season bleed');
