import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import { buildProspectView, formatProspectStatistics, loadProspects, PROSPECT_POSITIONS } from '../src/madden/prospects.js';
import { execute as commandExecute } from '../src/madden/coach/prospects.js';
import { execute as menuExecute, customId } from '../src/interactions/madden_prospects.js';
import { loadSoloCommands, loadSoloInteractionHandlers } from '../src/leaguebuddy/solo_mode.js';

const players = loadProspects();
assert.equal(players.length, 43);
assert.equal(PROSPECT_POSITIONS.length, 21);
const olIds = ['8', '10', '15', '19', '20', '28', '37', '49', '60', '65', '71', '73', '76', '77', '79', '93'];
assert.deepEqual(players.map((p) => p.id), [...olIds, '1', '2', '6', '11', '13', '14', '17', '18', '21', '24', '26', '30', '33', '43', '44', '48', '56', '61', '63', '67', '74', '83', '84', '86', '89', '92', '94'].sort((a, b) => Number(a) - Number(b)));
assert.doesNotMatch(JSON.stringify(players), /"overall"|"dev_trait"|"archetype"/);
const home = buildProspectView();
assert.equal(home.components[0].toJSON().components[0].options.length, 21);
assert.equal(home.components[1].toJSON().components[0].options.length, 6);
assert.equal(home.files.length, 0);
const hbHome = buildProspectView({ position: 'HB' });
assert.equal(hbHome.components[1].toJSON().components[0].options.length, 7);
assert.match(hbHome.embeds[0].toJSON().footer.text, /43 profiles available.*QB \/ HB \/ WR \/ TE \/ LT \/ LG \/ C \/ RG \/ RT/);
const wrHome = buildProspectView({ position: 'WR' });
assert.equal(wrHome.components[1].toJSON().components[0].options.length, 7);
assert.ok(wrHome.embeds[0].toJSON().description.includes('Minnesota'));
const teHome = buildProspectView({ position: 'TE' });
assert.equal(teHome.components[1].toJSON().components[0].options.length, 7);
for (const [position, count] of Object.entries({ LT: 4, LG: 2, C: 2, RG: 2, RT: 6 })) {
  const view = buildProspectView({ position });
  const options = view.components[1].toJSON().components[0].options;
  assert.equal(options.length, count);
  assert.ok(options.every((entry) => players.find((player) => player.id === entry.value).position === position));
}
assert.equal(formatProspectStatistics(null), null);
assert.equal(formatProspectStatistics({ fictional: false }), null);
const expectedSchoolEmojis = {
  '1': '1572332490356555836', '2': '1572332488435572916', '6': '1572332489186480169',
  '14': '1572332487613354036', '56': '1572332485675847862', '63': '1572332486804119643',
  '18': '1572332486804119643', '24': '1572332488435572916',
  '67': '1572332487613354036', '92': '1572332490356555836',
  '61': '1572332487613354036',
  '30': '1572339527538843729', '43': '1572339526540730378', '83': '1572339525215326319',
  '13': '1572332489186480169', '48': '1572332488435572916',
  '89': '1572342760273346670', '33': '1572342759443144734', '21': '1572342758235054080',
  '17': '1572342757408899213', '11': '1572342756410400849',
  '86': '1572343727098306762',
  '26': '1572347589741772811', '44': '1572347588676423750',
  '74': '1572347587690766508', '84': '1572347587690766508', '94': '1572347586486993047',
  '8': '1572332486804119643', '15': '1572332488435572916', '19': '1572332489186480169',
  '65': '1572332487613354036', '93': '1572332490356555836',
};
for (const player of players) {
  assert.ok(fs.existsSync(player.portrait), `Missing portrait: ${player.name}`);
  const portrait = sharp(player.portrait);
  const metadata = await portrait.metadata();
  const imageStats = await portrait.stats();
  assert.equal(metadata.hasAlpha, true, `${player.name} must have a transparent PNG portrait`);
  assert.equal(imageStats.channels.at(-1).min, 0, 'Background contains fully transparent pixels');
  assert.equal(imageStats.channels.at(-1).max, 255, 'Player contains opaque pixels');
  const view = buildProspectView({ position: player.position, playerId: player.id });
  const embed = view.embeds[0].toJSON();
  assert.match(embed.title, new RegExp(player.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.ok(embed.description.includes(player.bio));
  assert.ok(embed.description.length < 4096);
  const stats = player.statistics;
  assert.equal(stats.fictional, true);
  assert.equal(stats.position, player.position);
  assert.ok(stats.games > 0 && stats.games <= 15);
  for (const value of Object.values(stats).filter((value) => typeof value === 'number')) assert.ok(Number.isInteger(value) && value >= 0);
  if (stats.position === 'QB') assert.ok(stats.completions <= stats.attempts && stats.passingTD + stats.interceptions <= stats.attempts);
  if (stats.position === 'WR' || stats.position === 'TE') {
    assert.ok(stats.receptions <= stats.targets && stats.targets <= stats.routesRun);
    if (stats.yardsAfterCatch !== undefined) assert.ok(stats.yardsAfterCatch <= stats.receivingYards);
    if (stats.contestedCatches !== undefined) assert.ok(stats.contestedCatches <= stats.receptions && stats.contestedCatches <= stats.contestedTargets && stats.contestedTargets <= stats.targets);
    if (stats.runBlockWins !== undefined) assert.ok(stats.runBlockWins <= stats.runBlockSnaps);
    if (stats.pressuresAllowed !== undefined) assert.ok(stats.pressuresAllowed <= stats.passBlockSnaps);
  }
  if (stats.rushingYardsAfterContact !== undefined) assert.ok(stats.rushingYardsAfterContact <= stats.rushingYards);
  if (olIds.includes(player.id)) {
    assert.equal(stats.offensiveSnaps, stats.passBlockSnaps + stats.runBlockSnaps);
    assert.equal(stats.pressuresAllowed, stats.sacksAllowed + stats.hitsAllowed + stats.hurriesAllowed);
    assert.ok(stats.pressuresAllowed <= stats.passBlockSnaps && stats.runBlockWins <= stats.runBlockSnaps);
    assert.ok(stats.penalties <= stats.offensiveSnaps);
  }
  const statsField = embed.fields.find((field) => field.name === 'Fictional final college season');
  assert.equal(statsField.value, formatProspectStatistics(stats));
  assert.ok(statsField.value.length < 1024);
  assert.match(embed.footer.text, /Fictional.*college stats/);
  const emojiId = expectedSchoolEmojis[player.id];
  const schoolField = embed.fields.find((field) => field.name === 'School').value;
  const optionEmoji = view.components[1].toJSON().components[0].options.find((option) => option.value === player.id).emoji;
  if (emojiId) {
    assert.ok(schoolField.includes(`:${emojiId}>`));
    assert.equal(embed.thumbnail.url, `https://cdn.discordapp.com/emojis/${emojiId}.png`);
    assert.equal(optionEmoji.id, emojiId);
  } else {
    assert.equal(schoolField, `${player.school} · ${player.year}`);
    assert.equal(embed.thumbnail, undefined);
    assert.equal(optionEmoji, undefined);
  }
  assert.match(embed.image.url, /^attachment:\/\/cus01-\d+\.png$/);
  assert.equal(view.files[0].name, `cus01-${player.id}.png`);
  assert.deepEqual(view.attachments, [], 'Switching cards removes the previous portrait');
  assert.doesNotMatch(JSON.stringify(embed), /overall|dev_trait|development trait|OVR/i);
  assert.doesNotMatch(JSON.stringify(embed), /archetype|Field General|Strong Arm|Power Back|Receiving Back|Elusive Back|Deep Threat|Vertical Threat|Pass Protector|Playmaker|Scrambler/i);
  assert.equal(view.components[1].toJSON().components[0].options.filter((p) => p.default).length, 1);
}
assert.match(formatProspectStatistics(players.find((p) => p.id === '1').statistics), /69\.5%.*\n.*\n9\.42 YD\/ATT · 9\.86 adjusted/);
assert.match(formatProspectStatistics(players.find((p) => p.id === '11').statistics), /3\.23 yards\/route run \(408 routes\)/);
assert.match(formatProspectStatistics(players.find((p) => p.id === '18').statistics), /3\.45 rushing yards\/carry/);
assert.match(formatProspectStatistics(players.find((p) => p.id === '17').statistics), /662 YD · 7\.52 YD\/REC/);
assert.match(formatProspectStatistics(players.find((p) => p.id === '61').statistics), /17\/30 \(56\.7%\)/);
assert.match(formatProspectStatistics(players.find((p) => p.id === '13').statistics), /3\.02 yards\/route run \(326 routes\)/);
assert.match(formatProspectStatistics(players.find((p) => p.id === '84').statistics), /154\/196 \(78\.6%\)/);
assert.match(formatProspectStatistics(players.find((p) => p.id === '84').statistics), /3 on 58 pass-block snaps \(5\.2%\)/);
assert.match(formatProspectStatistics(players.find((p) => p.id === '8').statistics), /14\/398 pass-block snaps \(3\.5%\)/);
assert.match(formatProspectStatistics(players.find((p) => p.id === '8').statistics), /329\/388 \(84\.8%\)/);
assert.match(formatProspectStatistics(players.find((p) => p.id === '10').statistics), /Allowed: 0 sacks/);
assert.match(formatProspectStatistics(players.find((p) => p.id === '93').statistics), /43\/411 pass-block snaps \(10\.5%\)/);
const empty = buildProspectView({ position: 'CB' });
assert.equal(empty.components.length, 1);
assert.equal(empty.files.length, 0);
assert.match(empty.embeds[0].toJSON().description, /No completed profiles/);
assert.throws(() => buildProspectView({ position: 'CB', playerId: '1' }), /not available/);
assert.throws(() => buildProspectView({ position: 'QB', playerId: '18' }), /not available/);
assert.throws(() => buildProspectView({ position: 'HB', playerId: '1' }), /not available/);
assert.throws(() => buildProspectView({ position: 'LT', playerId: '15' }), /not available/);
assert.throws(() => buildProspectView({ position: 'RT', playerId: '8' }), /not available/);
assert.throws(() => buildProspectView({ playerId: '3' }), /not available/);
assert.throws(() => buildProspectView({ position: '../../' }), /Unknown/);

const calls = [];
await commandExecute({ deferReply: async (x) => calls.push(['defer', x]), editReply: async (x) => calls.push(['edit', x]) });
assert.equal(calls[0][1].flags, 64);
assert.equal(calls[1][1].embeds[0].toJSON().title, 'CUS01 Draft Prospects · QB');
for (const [id, value, expected] of [
  ['madden_prospects_player_QB', '1', 'J.T. Rhoads · QB'],
  ['madden_prospects_player_QB', '63', 'Zac Williams · QB'],
  ['madden_prospects_position', 'HB', 'CUS01 Draft Prospects · HB'],
  ['madden_prospects_player_HB', '18', 'Francis Smith · HB'],
  ['madden_prospects_player_HB', '92', 'Kiaan Brown · HB'],
  ['madden_prospects_position', 'WR', 'CUS01 Draft Prospects · WR'],
  ['madden_prospects_player_WR', '11', 'Narquise Jones · WR'],
  ['madden_prospects_player_WR', '89', 'Joseph Lomeli · WR'],
  ['madden_prospects_position', 'TE', 'CUS01 Draft Prospects · TE'],
  ['madden_prospects_player_TE', '13', 'Aleks Zakrzewski · TE'],
  ['madden_prospects_player_TE', '94', 'Brendan Whitney · TE'],
  ['madden_prospects_position', 'LT', 'CUS01 Draft Prospects · LT'],
  ['madden_prospects_player_LT', '8', "Nakana'ela Pukahi · LT"],
  ['madden_prospects_position', 'LG', 'CUS01 Draft Prospects · LG'],
  ['madden_prospects_player_LG', '60', 'Darnell Baines · LG'],
  ['madden_prospects_position', 'C', 'CUS01 Draft Prospects · C'],
  ['madden_prospects_player_C', '65', 'Matt Shea · C'],
  ['madden_prospects_position', 'RG', 'CUS01 Draft Prospects · RG'],
  ['madden_prospects_player_RG', '93', 'Renaldo Varela · RG'],
  ['madden_prospects_position', 'RT', 'CUS01 Draft Prospects · RT'],
  ['madden_prospects_player_RT', '79', 'Colt Fisher · RT'],
  ['madden_prospects_position', 'CB', 'CUS01 Draft Prospects · CB'],
]) {
  let deferred = false;
  let payload;
  assert.ok(customId.test(id));
  await menuExecute({ customId: id, values: [value], isStringSelectMenu: () => true,
    deferUpdate: async () => { deferred = true; }, editReply: async (x) => { payload = x; } });
  assert.equal(deferred, true);
  assert.equal(payload.embeds[0].toJSON().title, expected);
}
const commands = await loadSoloCommands();
assert.ok(commands.has('prospects'));
const handlers = await loadSoloInteractionHandlers();
assert.ok(handlers.some((h) => h.customId.test?.('madden_prospects_player_QB')));
console.log('PASS 43 transparent prospect portraits, nine position groups, hidden ratings/archetypes, school emojis and consistent fictional receiving/blocking efficiency');
