import assert from 'node:assert/strict';
import { POSITION_THREADS, positionThreadKey, buildPositionChangeEmbeds, buildSeasonResultEmbeds } from '../src/madden/position_reports.js';
assert.equal(POSITION_THREADS.length, 21);
for (const position of ['LT', 'LG', 'C', 'RG', 'RT']) assert.equal(positionThreadKey(position), position);
for (const [position, thread] of Object.entries({ LE: 'LEDG', LEDGE: 'LEDG', RE: 'REDG', LOLB: 'SAM', MLB: 'MIKE', ROLB: 'WILL', RB: 'HB' })) assert.equal(positionThreadKey(position), thread);
const snapshot = { teams: { leagueTeamInfoList: [
  { teamId: 1, cityName: 'San Francisco', nickName: '49ers' },
  { teamId: 2, cityName: 'Atlanta', nickName: 'Falcons' },
  { teamId: 3, cityName: 'New York', nickName: 'Giants' },
  { teamId: 4, cityName: 'Chicago', nickName: 'Bears' },
] } };
const player = (player, teamId, position = 'QB', points = 2) => ({ player, teamId, position, direction: points > 0 ? 'upgrade' : 'downgrade', attributes: [
  { attribute: 'Awareness', field: 'awareRating', currentValue: 80, targetValue: 80 + points, points, net: points, positive: Math.max(0, points), negative: Math.max(0, -points), pointsToApply: points },
] });
const record = { seasonKey: 'year_2027', weekNumber: 19, recommendations: [player('Zed Niner', 1), player('Amy Niner', 1, 'QB', -2), player('Falcon', 2), player('Giant', 3), player('Bear', 4)] };
const everyPosition = buildPositionChangeEmbeds(snapshot, { ...record, recommendations: POSITION_THREADS.map((position) => player(`Player ${position}`, 4, position)) });
assert.equal(everyPosition.size, 21, 'All 21 positions route to distinct threads');
const weekly = buildPositionChangeEmbeds(snapshot, record);
assert.equal(weekly.size, 1);
assert.equal(weekly.get('QB').embeds.length, 1, 'Short reports use one embed for the entire position/week');
const text = weekly.get('QB').embeds[0].toJSON().description;
assert.ok(text.indexOf('**Bears**') < text.indexOf('**Falcons**'));
assert.ok(text.indexOf('**Falcons**') < text.indexOf('**49ers**') && text.indexOf('**49ers**') < text.indexOf('**Giants**'), '49ers sort as Forty Niners, under F');
assert.ok(text.indexOf('Amy Niner') < text.indexOf('Zed Niner'), 'Player A–Z sorting includes upgrades and downgrades together');
assert.match(text, /80 → 78 \(-2\)/);
assert.match(text, /80 → 82 \(\+2\)/);
const displayNameOnly = structuredClone(snapshot);
for (const team of displayNameOnly.teams.leagueTeamInfoList) { team.displayName = team.nickName; delete team.nickName; }
assert.equal(buildPositionChangeEmbeds(displayNameOnly, record).get('QB').embeds[0].toJSON().description, text, 'Native displayName mascots sort the same as nickName exports');
const season = buildPositionChangeEmbeds(snapshot, { ...record, application: record.recommendations }, { fullSeason: true });
assert.equal(season.get('QB').embeds.length, 1);
assert.match(season.get('QB').embeds[0].toJSON().title, /Season Total/);
assert.match(season.get('QB').embeds[0].toJSON().footer.text, /ONCE/);
const large = { ...record, recommendations: Array.from({ length: 140 }, (_, index) => player(`Player ${String(index).padStart(3, '0')}`, index % 4 + 1, 'WR', index % 2 ? -2 : 2)) };
const pages = buildPositionChangeEmbeds(snapshot, large).get('WR').embeds;
assert.ok(pages.length > 1);
for (const [index, page] of pages.entries()) {
  const embed = page.toJSON();
  assert.ok(embed.description.length <= 4096);
  assert.ok(JSON.stringify(embed).length < 6000);
  assert.ok(embed.title.endsWith(`${index + 1}/${pages.length}`));
}
const allText = pages.map((page) => page.toJSON().description).join('\n');
for (let index = 0; index < 140; index++) assert.equal(allText.split(`**Player ${String(index).padStart(3, '0')}**`).length - 1, 1, 'Pagination must neither lose nor duplicate players');
const changes = new Map(snapshot.teams.leagueTeamInfoList.map((team) => [String(team.teamId), { upgrades: [{ name: 'Riser', position: 'QB', start: 79, end: 82, change: 3 }], downgrades: [{ name: 'Faller', position: 'WR', start: 91, end: 88, change: -3 }] }]));
const results = buildSeasonResultEmbeds(snapshot, changes, { label: 'Week 1', partial: false });
const resultText = results.map((page) => page.toJSON().description).join('\n');
assert.ok(resultText.indexOf('**Falcons**') < resultText.indexOf('**49ers**') && resultText.indexOf('**49ers**') < resultText.indexOf('**Giants**'));
assert.match(resultText, /79 → 82 \(\+3\)/);
assert.match(resultText, /91 → 88 \(-3\)/);
console.log('PASS 21 position groups, OL separation, defensive aliases, mascot/player ordering, Forty Niners under F, summed totals, lossless embed pagination, and season results');
