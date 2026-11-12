import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildWeeklyProgressionRecommendations, buildProgressionCardEmbed } from '../src/madden/progression.js';
import { buildTeamFormContexts } from '../src/madden/weekly_progression_context.js';

const rules = JSON.parse(fs.readFileSync('config/madden_solo_rules.json', 'utf8')).progression;
const oldRules = structuredClone(rules);
delete oldRules.weekly.statProduction;
delete oldRules.weekly.teamForm;
function receivingSeason({ form = null, games = 17 } = {}) {
  return {
    leagueId: 'stat-production', syncId: 'production', currentWeek: 18, calendarYear: 2026,
    teams: { leagueTeamInfoList: [{ teamId: 1, cityName: 'Denver', nickName: 'Broncos' }] },
    rosters: { teams: { 1: { rosterInfoList: [{ rosterId: 'receiver', firstName: 'Marvin', lastName: 'Mims', position: 'WR', yearsPro: 5,
      playerBestOvr: 79, catchRating: 85, routeRunShortRating: 75, routeRunMedRating: 75, routeRunDeepRating: 75, specCatchRating: 80, awareRating: 75 }] } } },
    schedule: { schedules: Array.from({ length: games }, (_, weekIndex) => ({ stageIndex: 1, weekIndex, status: 2, homeTeamId: 1, awayTeamId: 2,
      ...(form ? { homeScore: form === 'winning' ? 31 : 10, awayScore: form === 'winning' ? 10 : 31 } : {}) })) },
    weeklyStats: Array.from({ length: games }, (_, weekIndex) => ({ stage: 1, weekIndex, receiving: { playerReceivingStatInfoList: [{
      rosterId: 'receiver', teamId: 1, position: 'WR', recCatches: 5, recCatchPct: 85, recYds: weekIndex === 16 ? 80 : 70,
      recTDs: weekIndex === 16 ? 2 : weekIndex % 3 === 0 ? 3 : 0, recLongest: 30,
    }] } })),
  };
}
const evaluate = (target, policy = rules) => buildWeeklyProgressionRecommendations(target, { weekIndex: target.weeklyStats.at(-1).weekIndex, rules: policy });
const season = receivingSeason();
const earned = evaluate(season).recommendations[0];
const before = evaluate(season, oldRules).recommendations[0];
assert.equal(earned.direction, 'upgrade');
assert.equal(earned.changeContext.seasonProduction.label, 'Elite season production');
assert.deepEqual(earned.changeContext.seasonProduction.evidence, { recYds: 1200, recTDs: 20 });
assert.ok(earned.selectionScore > before.selectionScore, 'Big season production gets selected more consistently');
assert.ok(earned.totalAttributePoints > before.totalAttributePoints, 'Big production strengthens actual supported attribute gains');
assert.deepEqual(earned.attributes.slice(0, 3).map((attribute) => attribute.attribute), ['Short Route Running', 'Medium Route Running', 'Deep Route Running']);
assert.ok(earned.attributes.slice(0, 3).every((attribute) => attribute.points >= 3));
assert.equal(earned.currentOvr, 79, 'The bot cannot invent an OVR increase');
assert.match(JSON.stringify(buildProgressionCardEmbed(evaluate(season), earned).toJSON()), /1200 receiving yards.*20 receiving touchdowns/);
const winners = evaluate(receivingSeason({ form: 'winning' })).recommendations[0];
assert.equal(winners.changeContext.teamForm.multiplier, 1.5);
assert.ok(winners.totalAttributePoints > earned.totalAttributePoints);
assert.ok(winners.attributes.every((attribute) => attribute.points <= 5 && attribute.targetValue <= 99));
const goodLoser = evaluate(receivingSeason({ form: 'losing' })).recommendations[0];
assert.equal(goodLoser.direction, 'upgrade', 'A good individual is never downgraded just because the team loses');
assert.equal(goodLoser.changeContext.teamForm, null);
assert.ok(!evaluate(receivingSeason({ games: 1 })).recommendations[0]?.changeContext.seasonProduction, 'One big game cannot earn a season bonus');
const limited = receivingSeason({ form: 'winning' });
limited.weeklyStats.at(-1).receiving.playerReceivingStatInfoList[0].recCatches = 1;
assert.equal(evaluate(limited).recommendations.length, 0);

const poor = receivingSeason({ games: 4, form: 'losing' });
poor.rosters.teams[1].rosterInfoList = [{ rosterId: 'qb', firstName: 'Poor', lastName: 'QB', position: 'QB', yearsPro: 5,
  playerBestOvr: 90, awareRating: 80, throwAccShortRating: 80, throwAccMidRating: 80, throwAccDeepRating: 80 }];
poor.weeklyStats.forEach((entry, index) => {
  delete entry.receiving;
  entry.passing = { playerPassingStatInfoList: [{ rosterId: 'qb', teamId: 1, position: 'QB', passAtt: 30, passComp: index === 2 ? 24 : 8,
    passYds: index === 2 ? 400 : 40, passTDs: index === 2 ? 4 : 0, passInts: index === 2 ? 0 : 4 }] };
});
const decline = evaluate(poor).recommendations[0];
const normalDecline = evaluate(poor, oldRules).recommendations[0];
assert.equal(decline.direction, 'downgrade');
assert.equal(decline.changeContext.teamForm.multiplier, 1.5);
assert.ok(decline.totalAttributePoints < normalDecline.totalAttributePoints);
assert.ok(decline.attributes.every((attribute) => attribute.points >= -5 && attribute.targetValue >= 0));
poor.rosters.teams[1].rosterInfoList[0].injuryLength = 2;
assert.equal(evaluate(poor).recommendations.length, 0);

const formPolicy = rules.weekly.teamForm;
const form = (snapshot, week = 16) => buildTeamFormContexts(snapshot, week, formPolicy).get('1');
const original = receivingSeason({ form: 'winning' });
const future = structuredClone(original);
future.schedule.schedules.push({ stageIndex: 1, weekIndex: 17, status: 2, homeTeamId: 1, awayTeamId: 2, homeScore: 0, awayScore: 40 });
assert.deepEqual(form(future), form(original), 'Future scores cannot influence an older weekly evaluation');
const duplicate = structuredClone(original);
duplicate.schedule.schedules.push(structuredClone(duplicate.schedule.schedules.at(-1)));
assert.deepEqual(form(duplicate), form(original), 'Duplicate exports cannot count a win twice');
const missing = receivingSeason({ form: 'winning' });
missing.schedule.schedules.forEach((game) => { delete game.status; });
assert.equal(form(missing), undefined);
const short = receivingSeason({ form: 'winning', games: 2 });
assert.equal(form(short), undefined);
const mixed = receivingSeason({ form: 'winning', games: 4 });
mixed.schedule.schedules[3].homeScore = 3;
assert.equal(form(mixed).upgradeMultiplier, 1.25, 'Three wins from four earns the smaller multiplier');
const missingScore = receivingSeason({ form: 'winning' });
delete missingScore.schedule.schedules.at(-1).homeScore;
assert.equal(form(missingScore), undefined, 'Missing recent scores cannot replace an unknown result with an older win');
const conflictingScore = receivingSeason({ form: 'winning' });
conflictingScore.schedule.schedules.push({ ...conflictingScore.schedule.schedules.at(-1), homeScore: 3 });
assert.equal(form(conflictingScore), undefined, 'Conflicting duplicate results cannot create a team bonus');
console.log('PASS 1200-yard/20-TD weekly growth, key receiving attributes, winning/sliding multipliers, future/duplicate safety, and individual evidence safeguards');
