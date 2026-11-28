import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import { buildProspectView, formatProspectStatistics, heismanBadge, loadProspects, PROSPECT_POSITIONS, schoolLabel } from '../src/madden/prospects.js';
import { execute as commandExecute } from '../src/madden/coach/prospects.js';
import { execute as menuExecute, customId } from '../src/interactions/madden_prospects.js';
import { loadSoloCommands, loadSoloInteractionHandlers } from '../src/leaguebuddy/solo_mode.js';

const players = loadProspects();
assert.equal(players.length, 201);
assert.equal(new Set(players.flatMap((p) => p.statistics ? [p.statistics.games] : [])).size >= 4, true);
assert.equal(PROSPECT_POSITIONS.length, 21);
const olIds = ['8', '10', '15', '19', '20', '28', '37', '49', '60', '65', '71', '73', '76', '77', '79', '93'];
const dlIds = ['3', '9', '25', '27', '31', '35', '36', '38', '39', '41', '45', '46', '54', '55', '62', '70', '72', '75', '80', '95', '96'];
const lbIds = ['7', '12', '51', '52', '53', '57', '58', '59', '69', '78', '87', '88'];
const dbIds = ['4', '5', '16', '22', '23', '29', '32', '34', '40', '42', '47', '50', '64', '66', '68', '81', '82', '85', '90', '91'];
const rankedIds = [...olIds, ...dlIds, ...lbIds, ...dbIds, '1', '2', '6', '11', '13', '14', '17', '18', '21', '24', '26', '30', '33', '43', '44', '48', '56', '61', '63', '67', '74', '83', '84', '86', '89', '92', '94'];
const rankById = { '56': 63, '63': 56 };
const scoutingIds = Array.from({ length: 105 }, (_, index) => String(index + 97));
assert.deepEqual(players.map((p) => p.id), [...rankedIds.sort((a, b) => (rankById[a] ?? Number(a)) - (rankById[b] ?? Number(b))), ...scoutingIds]);
assert.doesNotMatch(JSON.stringify(players), /"overall"|"dev_trait"|"archetype"/);
const home = buildProspectView();
assert.equal(home.components[0].toJSON().components[0].options.length, 21);
assert.equal(home.components[1].toJSON().components[0].options.length, 9);
assert.equal(home.files.length, 0);
const hbHome = buildProspectView({ position: 'HB' });
const board = Object.values(JSON.parse(fs.readFileSync('bundled_data/madden/Madden - CUS01 - Big Board.json', 'utf8')));
const halfbacks = board.filter(({ name, position }) => name && position === 'HB');
assert.equal(halfbacks.length, 20);
assert.deepEqual(hbHome.components[1].toJSON().components[0].options.map((option) => option.label).sort(),
  halfbacks.map(({ name }) => name).sort());
assert.match(hbHome.embeds[0].toJSON().footer.text, /201 profiles available.*QB \/ HB \/ WR \/ TE \/ LT \/ LG \/ C \/ RG \/ RT \/ LEDG \/ REDG \/ DT \/ SAM \/ MIKE \/ WILL \/ CB \/ FS \/ SS/);
assert.equal(players.find((p) => p.name === 'Xander Knox').school, 'Michigan State');
assert.equal(players.find((p) => p.name === 'Anderius Jenkins').jersey, '#0');
assert.equal(players.find((p) => p.name === 'Devin Guillory').jersey, '#0');
const wrHome = buildProspectView({ position: 'WR' });
const receivers = board.filter(({ name, position }) => name && position === 'WR');
assert.equal(receivers.length, 24);
assert.deepEqual(wrHome.components[1].toJSON().components[0].options.map(({ label }) => label).sort(),
  receivers.map(({ name }) => name).sort());
for (const [id, file] of [['114', 'jerald-simms-morrison'], ['116', 'chacha-oakim']]) {
  assert.ok(players.find((p) => p.id === id).portrait.endsWith(`/${file}-early-transparent.png`));
}
assert.ok(wrHome.embeds[0].toJSON().description.includes('Minnesota'));
const teHome = buildProspectView({ position: 'TE' });
const tightEnds = board.filter(({ name, position }) => name && position === 'TE');
const tightEndOptions = teHome.components[1].toJSON().components[0].options;
assert.equal(tightEnds.length, 14);
assert.deepEqual(tightEndOptions.map(({ label }) => label).sort(), tightEnds.map(({ name }) => name).sort());
assert.deepEqual(tightEndOptions.slice(0, 7).map(({ value }) => value), ['13', '26', '44', '48', '74', '84', '94']);
assert.equal(players.find((p) => p.name === 'Ehsando Mwangu').jersey, '#0');
const prospectFields = ({ name, school, jersey }) => [name, school, jersey];
for (const position of ['LT', 'LG', 'C', 'RG', 'RT']) {
  const sourcePlayers = board.filter((row) => row.name && row.position === position);
  assert.deepEqual(players.filter((player) => player.position === position).map(prospectFields).sort(),
    sourcePlayers.map(prospectFields).sort());
}
for (const position of ['LEDG', 'REDG', 'DT', 'SAM', 'MIKE', 'WILL']) {
  const frontSevenFields = ({ name, jersey }) => [name, jersey];
  const sourcePlayers = board.filter((row) => row.name && row.position === position);
  assert.deepEqual(players.filter((player) => player.position === position).map(frontSevenFields).sort(),
    sourcePlayers.map(frontSevenFields).sort());
}
assert.equal(players.filter(({ name }) => name === 'Kaziri Nyokare').length, 1);
assert.equal(players.find(({ id }) => id === '70').position, 'REDG');
for (const [position, count] of Object.entries({ LT: 11, LG: 8, C: 7, RG: 9, RT: 9, LEDG: 11, REDG: 13, DT: 18, SAM: 8, MIKE: 10, WILL: 10, CB: 11, FS: 4, SS: 5 })) {
  const view = buildProspectView({ position });
  const options = view.components[1].toJSON().components[0].options;
  assert.equal(options.length, count);
  assert.ok(options.every((entry) => players.find((player) => player.id === entry.value).position === position));
}
assert.ok(buildProspectView({ position: 'REDG' }).embeds[0].toJSON().description.includes('Wisconsin'));
assert.equal(formatProspectStatistics(null), null);
assert.equal(formatProspectStatistics({ fictional: false }), null);
assert.equal(heismanBadge('(Heisman finalist)'), '<:heisman:1573390983457022102>');
assert.equal(heismanBadge('No award note'), '');
for (const [position, key] of [['QB', 'passingYards'], ['HB', 'rushingYards'], ['WR', 'receivingYards'], ['TE', 'receivingYards']]) {
  const values = players.filter((player) => player.position === position && player.statistics).map((player) => player.statistics[key]);
  assert.ok(values.some((value, index) => index > 0 && value > values[index - 1]), `${position} totals should not simply descend by board rank`);
}
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
  '25': '1572347587690766508', '35': '1572347586486993047', '36': '1572332486804119643',
  '39': '1572347586486993047', '41': '1572339527538843729', '46': '1572347589741772811',
  '75': '1572347588676423750', '80': '1572332490356555836',
  '12': '1572347587690766508', '52': '1572347589741772811', '53': '1572332486804119643',
  '59': '1572332485675847862', '69': '1572339527538843729',
  '5': '1572332486804119643', '16': '1572332486804119643', '22': '1572332486804119643',
  '29': '1572342759443144734', '47': '1572332488435572916', '50': '1572339527538843729',
  '90': '1572347588676423750',
  '97': '1573736474514563155', '98': '1573736473629302895', '99': '1573736472060760216',
  '100': '1573014914828869642', '102': '1572332488435572916', '104': '1572347586486993047',
};
const newlyAddedSchoolEmojis = {
  'North Dakota State': '1575956233998041230', UCF: '1575956232051757278',
  Rutgers: '1575956229459550298', Buffalo: '1575956227865706676',
  'Arizona State': '1574182155125526748',
  'Michigan State': '1574094872737087579', Utah: '1574094869985493123',
  'East Carolina': '1574094868450639952', UAB: '1574094866181259374',
  'Mississippi State': '1574087662527320216', Pittsburgh: '1574087661357105162', Maryland: '1574087659691712603',
  'Fresno State': '1574087657892487310', Liberty: '1574087656315297892', Nebraska: '1574087654990025065',
  'Wake Forest': '1574086719156916306', Illinois: '1574086716904710196', Arizona: '1574086715704999956',
  'Oregon State': '1574086714669006998', Fordham: '1574086713427492925', Rice: '1574086712324390983',
  TCU: '1574086711070302259', Iowa: '1574086710143484078',
  Stanford: '1573750048502710364',
  'Utah State': '1573748015515173067', 'Oklahoma State': '1573748014009286756', 'Western Kentucky': '1573748012226973828',
  Clemson: '1573014169631072276', Tennessee: '1573014167361945683', Syracuse: '1573014165646479561',
  Michigan: '1573014722348056636', Georgia: '1573014721156743210', Memphis: '1573014719563038780',
  'Ole Miss': '1573014717755166851', 'Georgia Tech': '1573014716639608954', Washington: '1573014914828869642',
};
for (const [school, id] of Object.entries(newlyAddedSchoolEmojis)) assert.ok(schoolLabel(school).includes(`:${id}>`));
assert.equal(schoolLabel('Ole MIss'), '<:olemiss:1573014717755166851> Ole Miss');
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
  const words = player.bio.trim().split(/\s+/).length;
  assert.ok(words >= 40 && words <= 50, `${player.name} bio must contain 40–50 words`);
  assert.ok(embed.description.length < 4096);
  const stats = player.statistics;
  if (!stats) {
    assert.ok(scoutingIds.includes(player.id));
    if (['HB', 'WR', 'TE', 'LT', 'LG', 'C', 'RG', 'RT', 'LEDG', 'REDG', 'DT', 'SAM', 'MIKE', 'WILL'].includes(player.position)) {
      assert.deepEqual([metadata.width, metadata.height], [1254, 1254], player.name);
    }
    assert.equal(player.rank, null);
    assert.match(embed.fields.find((field) => field.name === 'Jersey / Board').value, /Unranked/);
    assert.equal(embed.fields.some((field) => field.name === 'Final college season'), false);
    assert.match(embed.footer.text, /^CUS01 · Scouting profile · \d+\/\d+$/);
    assert.equal(view.files[0].attachment, player.portrait);
    const schoolField = embed.fields.find((field) => field.name === 'School').value;
    assert.equal(schoolField, `${schoolLabel(player.school)} · ${player.year}`);
    const emojiId = expectedSchoolEmojis[player.id] ?? newlyAddedSchoolEmojis[player.school] ?? schoolLabel(player.school).match(/^<:[^:]+:(\d+)>/)?.[1];
    assert.equal(view.components[1].toJSON().components[0].options.find((option) => option.value === player.id).emoji?.id, emojiId);
    continue;
  }
  assert.equal(stats.fictional, true);
  assert.equal(stats.position, player.position);
  assert.ok(stats.games > 0 && stats.games <= 15);
  for (const [key, value] of Object.entries(stats).filter(([, value]) => typeof value === 'number')) {
    const fractionalSack = dlIds.includes(player.id) && key === 'sacks';
    assert.ok(Number.isInteger(fractionalSack ? value * 2 : value) && value >= 0);
  }
  if (stats.position === 'QB') {
    assert.ok(stats.completions <= stats.attempts && stats.passingTD + stats.interceptions <= stats.attempts);
    assert.ok(stats.attempts / stats.games >= 12 && stats.attempts / stats.games <= 55);
  }
  if (stats.position === 'WR' || stats.position === 'TE') {
    assert.ok(stats.receptions <= stats.targets && stats.targets <= stats.routesRun);
    if (stats.yardsAfterCatch !== undefined) assert.ok(stats.yardsAfterCatch <= stats.receivingYards);
    if (stats.contestedCatches !== undefined) assert.ok(stats.contestedCatches <= stats.receptions && stats.contestedCatches <= stats.contestedTargets && stats.contestedTargets <= stats.targets);
    if (stats.runBlockWins !== undefined) assert.ok(stats.runBlockWins <= stats.runBlockSnaps);
    if (stats.pressuresAllowed !== undefined) assert.ok(stats.pressuresAllowed <= stats.passBlockSnaps);
  }
  if (stats.rushingYardsAfterContact !== undefined) assert.ok(stats.rushingYardsAfterContact <= stats.rushingYards);
  if (stats.position === 'HB') assert.ok(stats.carries / stats.games <= 28);
  if (olIds.includes(player.id)) {
    assert.equal(stats.offensiveSnaps, stats.passBlockSnaps + stats.runBlockSnaps);
    assert.equal(stats.pressuresAllowed, stats.sacksAllowed + stats.hitsAllowed + stats.hurriesAllowed);
    assert.ok(stats.pressuresAllowed <= stats.passBlockSnaps && stats.runBlockWins <= stats.runBlockSnaps);
    assert.ok(stats.penalties <= stats.offensiveSnaps);
  }
  if (dlIds.includes(player.id)) {
    assert.equal(stats.defensiveSnaps, stats.passRushSnaps + stats.runDefenseSnaps);
    assert.equal(stats.pressures, stats.sackPressures + stats.hits + stats.hurries);
    assert.ok(stats.sacks <= stats.sackPressures && stats.sacks <= stats.tacklesForLoss);
    assert.ok(stats.pressures <= stats.passRushSnaps && stats.runStops <= stats.runDefenseSnaps);
    assert.ok(stats.runStops <= stats.tackles && stats.tacklesForLoss <= stats.tackles);
  }
  if (lbIds.includes(player.id) || dbIds.includes(player.id)) {
    assert.ok(stats.runDefenseSnaps <= stats.defensiveSnaps && stats.runStops <= stats.runDefenseSnaps);
    assert.ok(stats.runStops <= stats.tackles && stats.tacklesForLoss <= stats.tackles);
    assert.ok(stats.receptionsAllowed + stats.passBreakups + stats.interceptions <= stats.targets);
  }
  const statsField = embed.fields.find((field) => field.name === 'Final college season');
  assert.equal(statsField.value, formatProspectStatistics(stats));
  assert.ok(statsField.value.length < 1024);
  assert.match(embed.footer.text, /Simulated college statistics/);
  assert.doesNotMatch(JSON.stringify(embed), /fictional/i);
  const emojiId = expectedSchoolEmojis[player.id] || newlyAddedSchoolEmojis[player.school];
  const schoolField = embed.fields.find((field) => field.name === 'School').value;
  const optionEmoji = view.components[1].toJSON().components[0].options.find((option) => option.value === player.id).emoji;
  if (emojiId) {
    assert.ok(schoolField.includes(`:${emojiId}>`));
    assert.equal(optionEmoji.id, emojiId);
  } else {
    assert.equal(schoolField, `${player.school} · ${player.year}`);
    assert.equal(optionEmoji, undefined);
  }
  assert.match(embed.thumbnail.url, /^attachment:\/\/cus01-\d+\.png$/);
  assert.equal(embed.image, undefined);
  assert.equal(view.files[0].name, `cus01-${player.id}.png`);
  assert.deepEqual(view.attachments, [], 'Switching cards removes the previous portrait');
  assert.doesNotMatch(JSON.stringify(embed), /overall rating|dev_trait|development trait|\bOVR\b/i);
  assert.doesNotMatch(JSON.stringify(embed), /archetype/i);
  assert.equal(view.components[1].toJSON().components[0].options.filter((p) => p.default).length, 1);
}
const qbFixture = { position: 'QB', fictional: true, games: 10, completions: 200, attempts: 300, passingYards: 2400, passingTD: 20, interceptions: 5, sacks: 10, sackYards: 60 };
assert.match(formatProspectStatistics(qbFixture), /10 G · 200\/300 \(66\.7%\).*\n.*\n8\.00 yards\/attempt · 8\.11 ANY\/A/);
const wrFixture = { position: 'WR', fictional: true, games: 10, receptions: 50, targets: 100, receivingYards: 800, receivingTD: 6, routesRun: 400 };
assert.match(formatProspectStatistics(wrFixture), /2\.00 yards\/route run \(400 routes\)/);
const hbFixture = { position: 'HB', fictional: true, games: 10, carries: 100, rushingYards: 600, rushingTD: 6, receptions: 20, receivingYards: 200, receivingTD: 2, rushingYardsAfterContact: 300 };
assert.match(formatProspectStatistics(hbFixture), /3\.00 rushing yards\/carry/);
assert.match(players.find((p) => p.id === '1').bio, /elite anticipation.*all three levels.*offensive centerpiece/i);
assert.equal(players.find((p) => p.id === '2').name, 'Jaquon Hall');
assert.equal(players.find((p) => p.id === '6').name, 'Aaron Archuelta');
assert.equal(players.find((p) => p.id === '56').weight, 225);
assert.equal(players.find((p) => p.id === '63').weight, 215);
assert.match(players.find((p) => p.id === '7').bio, /former safety.*running backs.*tight ends/i);
assert.match(players.find((p) => p.id === '47').bio, /captain.*sure tackler/i);
assert.match(buildProspectView({ position: 'QB', playerId: '1' }).embeds[0].toJSON().title, /<:heisman:1573390983457022102>/);
assert.doesNotMatch(buildProspectView({ position: 'QB', playerId: '2' }).embeds[0].toJSON().title, /:heisman:/);
assert.equal(players.find((p) => p.id === '3').name, 'Cardarion Williams');
assert.equal(players.find((p) => p.id === '3').rank, 3);
assert.ok(buildProspectView({ position: 'CB' }).embeds[0].toJSON().description.includes('Western Kentucky'));
const empty = buildProspectView({ position: 'FB' });
assert.equal(empty.components.length, 2);
assert.equal(empty.files.length, 0);
assert.match(empty.embeds[0].toJSON().description, /No completed profiles/);
assert.throws(() => buildProspectView({ position: 'FB', playerId: '1' }), /not available/);
assert.throws(() => buildProspectView({ position: 'QB', playerId: '18' }), /not available/);
assert.throws(() => buildProspectView({ position: 'HB', playerId: '1' }), /not available/);
assert.throws(() => buildProspectView({ position: 'LT', playerId: '15' }), /not available/);
assert.throws(() => buildProspectView({ position: 'RT', playerId: '8' }), /not available/);
assert.throws(() => buildProspectView({ position: 'LEDG', playerId: '27' }), /not available/);
assert.throws(() => buildProspectView({ position: 'DT', playerId: '3' }), /not available/);
assert.throws(() => buildProspectView({ playerId: '3' }), /not available/);
assert.throws(() => buildProspectView({ position: '../../' }), /Unknown/);

const calls = [];
await commandExecute({ deferReply: async (x) => calls.push(['defer', x]), editReply: async (x) => calls.push(['edit', x]) });
assert.equal(calls[0][1].flags, 64);
assert.equal(calls[1][1].embeds[0].toJSON().title, 'CUS01 Draft Prospects · QB');
for (const [id, value, expected] of [
  ['madden_prospects_player_QB', '1', 'J.T. Rhoads · QB'],
  ['madden_prospects_player_QB', '63', 'Zac Williams · QB'],
  ['madden_prospects_player_QB', '97', 'Danny Franklin · QB'],
  ['madden_prospects_player_QB', '98', 'Jack Greene · QB'],
  ['madden_prospects_player_QB', '99', 'Terrance May · QB'],
  ['madden_prospects_position', 'HB', 'Francis Smith · HB'],
  ['madden_prospects_position', 'FB', 'CUS01 Draft Prospects · FB'],
  ['madden_prospects_player_HB', '18', 'Francis Smith · HB'],
  ['madden_prospects_player_HB', '92', 'Kiaan Brown · HB'],
  ['madden_prospects_player_HB', '100', 'Dannie Chow · HB'],
  ['madden_prospects_player_HB', '112', 'Tanner Melendez · HB'],
  ['madden_prospects_position', 'WR', 'Narquise Jones · WR'],
  ['madden_prospects_player_WR', '11', 'Narquise Jones · WR'],
  ['madden_prospects_player_WR', '89', 'Joseph Lomeli · WR'],
  ['madden_prospects_player_WR', '114', 'Jerald Simms-Morrison · WR'],
  ['madden_prospects_player_WR', '129', 'Reed Richardson · WR'],
  ['madden_prospects_position', 'TE', 'Aleks Zakrzewski · TE'],
  ['madden_prospects_player_TE', '13', 'Aleks Zakrzewski · TE'],
  ['madden_prospects_player_TE', '94', 'Brendan Whitney · TE'],
  ['madden_prospects_player_TE', '130', 'Elijah Bryan · TE'],
  ['madden_prospects_player_TE', '136', 'Ehsando Mwangu · TE'],
  ['madden_prospects_position', 'LT', "Nakana'ela Pukahi · LT"],
  ['madden_prospects_player_LT', '8', "Nakana'ela Pukahi · LT"],
  ['madden_prospects_player_LT', '137', 'Kamryn Brown · LT'],
  ['madden_prospects_player_LG', '144', 'Jalen Chandler Jr · LG'],
  ['madden_prospects_player_C', '150', 'Ahmir Richards · C'],
  ['madden_prospects_player_RG', '155', 'Braylen Valentine · RG'],
  ['madden_prospects_player_RT', '162', "Kalawai'a Pukahi · RT"],
  ['madden_prospects_position', 'LG', 'Darnell Baines · LG'],
  ['madden_prospects_player_LG', '60', 'Darnell Baines · LG'],
  ['madden_prospects_position', 'C', 'Matt Shea · C'],
  ['madden_prospects_player_C', '65', 'Matt Shea · C'],
  ['madden_prospects_position', 'RG', 'Jeramy McCue · RG'],
  ['madden_prospects_player_RG', '93', 'Renaldo Varela · RG'],
  ['madden_prospects_position', 'RT', 'J.C. Martens · RT'],
  ['madden_prospects_player_RT', '79', 'Colt Fisher · RT'],
  ['madden_prospects_position', 'LEDG', 'Cardarion Williams · LEDG'],
  ['madden_prospects_player_LEDG', '3', 'Cardarion Williams · LEDG'],
  ['madden_prospects_player_LEDG', '165', 'Travis Kelley · LEDG'],
  ['madden_prospects_position', 'REDG', 'Deacon Robinson · REDG'],
  ['madden_prospects_player_REDG', '70', 'Kaziri Nyokare · REDG'],
  ['madden_prospects_player_REDG', '169', 'Sammy Jordan · REDG'],
  ['madden_prospects_player_REDG', '96', 'Jerrick McKinley · REDG'],
  ['madden_prospects_position', 'DT', 'Bobbie Crawford · DT'],
  ['madden_prospects_player_DT', '39', 'Johnathan Francisco · DT'],
  ['madden_prospects_player_DT', '173', 'Brandon Hurst · DT'],
  ['madden_prospects_position', 'SAM', 'Willie Mason Jr · SAM'],
  ['madden_prospects_player_SAM', '12', 'Willie Mason Jr · SAM'],
  ['madden_prospects_player_SAM', '186', 'Kalel McKinney · SAM'],
  ['madden_prospects_position', 'MIKE', 'Jonathon Aquino · MIKE'],
  ['madden_prospects_player_MIKE', '52', 'Jonathon Aquino · MIKE'],
  ['madden_prospects_player_MIKE', '190', 'Zeeshan Woods · MIKE'],
  ['madden_prospects_position', 'WILL', 'Kevin Alexander Jr · WILL'],
  ['madden_prospects_player_WILL', '7', 'Kevin Alexander Jr · WILL'],
  ['madden_prospects_player_WILL', '195', 'Rehema Mbarouk · WILL'],
  ['madden_prospects_position', 'CB', 'Kenneth Bell · CB'],
  ['madden_prospects_player_CB', '4', 'Kenneth Bell · CB'],
  ['madden_prospects_position', 'FS', 'Keanu Jones · FS'],
  ['madden_prospects_player_FS', '22', 'Keanu Jones · FS'],
  ['madden_prospects_position', 'SS', 'Malachi Robinson · SS'],
  ['madden_prospects_player_SS', '5', 'Malachi Robinson · SS'],
]) {
  let deferred = false;
  let payload;
  assert.ok(customId.test(id));
  await menuExecute({ customId: id, values: [value], isStringSelectMenu: () => true,
    deferUpdate: async () => { deferred = true; }, editReply: async (x) => { payload = x; } });
  assert.equal(deferred, true);
  assert.equal(payload.embeds[0].toJSON().title, expected === 'J.T. Rhoads · QB' ? `${expected} <:heisman:1573390983457022102>` : expected);
}
const commands = await loadSoloCommands();
assert.ok(commands.has('prospects'));
const handlers = await loadSoloInteractionHandlers();
assert.ok(handlers.some((h) => h.customId.test?.('madden_prospects_player_QB')));
const navigation = (view) => view.components.at(-1).toJSON().components;
const firstReceiver = buildProspectView({ position: 'WR', page: 0 });
const [firstBack, firstNext] = navigation(firstReceiver);
assert.equal(firstReceiver.embeds[0].toJSON().footer.text, 'CUS01 · Simulated college statistics · 1/24');
assert.equal(firstBack.disabled, true);
assert.equal(firstNext.disabled, false);
assert.ok(handlers.some((h) => h.customId.test?.(firstNext.custom_id)));
let card;
const click = async (button) => menuExecute({ customId: button.custom_id, isButton: () => true,
  deferUpdate: async () => {}, editReply: async (reply) => { card = reply; } });
await click(firstNext);
assert.equal(card.embeds[0].toJSON().title, 'Nick Monk · WR');
assert.equal(card.embeds[0].toJSON().footer.text, 'CUS01 · Simulated college statistics · 2/24');
assert.equal(card.files[0].name, 'cus01-17.png');
assert.deepEqual(card.attachments, []);
await click(navigation(card)[0]);
assert.equal(card.embeds[0].toJSON().title, 'Narquise Jones · WR');
const lastReceiver = buildProspectView({ position: 'WR', playerId: '129' });
assert.equal(lastReceiver.embeds[0].toJSON().footer.text, 'CUS01 · Scouting profile · 24/24');
assert.equal(navigation(lastReceiver)[1].disabled, true);
assert.equal(navigation(lastReceiver)[0].disabled, false);
console.log('PASS 201 CUS01 portraits, 28 linebacker cards, and consistent fictional statistics');
