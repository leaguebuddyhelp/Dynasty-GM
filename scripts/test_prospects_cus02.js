import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import { buildProspectView, loadProspects } from '../src/madden/prospects.js';
import { customId, execute } from '../src/interactions/madden_prospects.js';

const players = loadProspects('CUS02');
assert.equal(players.length, 70);
assert.equal(new Set(players.flatMap((p) => p.statistics ? [p.statistics.games] : [])).size >= 4, true);
assert.equal(players.filter((p) => p.position === 'QB').length, 10);
const halfbacks = players.filter((p) => p.position === 'HB');
const board = Object.values(JSON.parse(fs.readFileSync('bundled_data/madden/Madden - CUS02 - Big Board.json', 'utf8')));
const boardHalfbacks = board.filter((row) => row.position === 'HB' && row.name);
assert.equal(halfbacks.length, 27);
assert.deepEqual(halfbacks.map(({ name, school, jersey }) => [name, school, jersey]),
  boardHalfbacks.map(({ name, school, jersey }) => [name, school, jersey]));
const scoutingHalfbacks = new Set(boardHalfbacks.filter(({ round }) => round == null).map(({ name }) => name));
const receivers = players.filter((p) => p.position === 'WR');
const boardReceivers = board.filter((row) => row.position === 'WR' && row.name);
const receiverFields = ({ name, school, jersey }) => [name, school, jersey];
assert.equal(receivers.length, 24);
assert.deepEqual(receivers.map(receiverFields).sort(), boardReceivers.map(receiverFields).sort());
const newReceivers = JSON.parse(fs.readFileSync('bundled_data/prospects/cus_02/big-board-wr-portrait-prompts.json', 'utf8'));
const newReceiversById = new Map(newReceivers.map((entry) => [entry.id, entry]));
assert.equal(newReceiversById.size, 16);
assert.equal(receivers.filter(({ id }) => newReceiversById.has(id)).length, 16);
assert.equal(players.filter((p) => p.position === 'TE').length, 7);
assert.equal(players.filter((p) => p.position === 'FS').length, 1);
assert.equal(players.filter((p) => p.position === 'REDG').length, 1);
assert.throws(() => loadProspects('__proto__'), /Unknown prospect class/);
const scoutingQbs = {
  '102': ['Will Hoggard', 'will-hoggard-early-transparent.png'],
  '103': ['Dan Rudnick', 'dan-rudnick-transparent.png'],
  '104': ['Jackson Beckett', 'jackson-beckett-transparent.png'],
  '105': ['Jordy Willis', 'jordy-willis-transparent.png'],
  '106': ['Tyler Costa', 'tyler-costa-transparent.png'],
};
for (const player of players) {
  assert.ok(['QB', 'HB', 'WR', 'TE', 'FS', 'REDG'].includes(player.position));
  assert.ok(player.bio.split(/\s+/).length >= 40 && player.bio.split(/\s+/).length <= 50);
  const scoutingQb = scoutingQbs[player.id];
  if (scoutingQb) {
    assert.equal(player.position, 'QB');
    assert.equal(player.name, scoutingQb[0]);
    assert.ok(player.portrait.endsWith(`/${scoutingQb[1]}`));
  }
  const scoutingHb = player.position === 'HB' && scoutingHalfbacks.has(player.name);
  const scoutingWr = newReceiversById.get(player.id);
  if (scoutingWr) {
    assert.equal(player.position, 'WR');
    assert.deepEqual(receiverFields(player).slice(0, 2), [scoutingWr.name, scoutingWr.school]);
    assert.ok(player.portrait.endsWith('/' + scoutingWr.file));
  }
  const scouting = scoutingQb || scoutingHb || scoutingWr;
  if (scouting) {
    assert.equal(player.rank, null);
    assert.equal(player.statistics, undefined);
  } else {
    assert.equal(player.statistics.fictional, true);
  }
  if (player.position === 'QB' && !scouting) {
    const s = player.statistics;
    assert.ok(s.completions <= s.attempts && s.passingTD + s.interceptions <= s.attempts);
    assert.ok(s.attempts / s.games >= 12 && s.attempts / s.games <= 55);
  }
  if (player.position === 'HB' && !scoutingHb) {
    const s = player.statistics;
    assert.ok(s.carries / s.games <= 28);
    if (s.rushingYardsAfterContact !== undefined) assert.ok(s.rushingYardsAfterContact <= s.rushingYards);
  }
  if (player.position === 'REDG') {
    const s = player.statistics;
    assert.equal(s.defensiveSnaps, s.passRushSnaps + s.runDefenseSnaps);
    assert.equal(s.pressures, s.sackPressures + s.hits + s.hurries);
    assert.ok(s.sacks <= s.sackPressures && s.tacklesForLoss <= s.tackles);
  }
  if ((player.position === 'WR' && !scoutingWr) || player.position === 'TE') {
    const s = player.statistics;
    assert.ok(s.receptions <= s.targets && s.targets <= s.routesRun);
    assert.ok(s.yardsAfterCatch <= s.receivingYards);
    if (s.runBlockWins !== undefined) assert.ok(s.runBlockWins <= s.runBlockSnaps);
    if (s.pressuresAllowed !== undefined) assert.ok(s.pressuresAllowed <= s.passBlockSnaps);
  }
  assert.ok(fs.existsSync(player.portrait), `Missing portrait for ${player.name}`);
  const image = sharp(player.portrait);
  const metadata = await image.metadata();
  const stats = await image.stats();
  assert.ok(metadata.hasAlpha && stats.channels.at(-1).min === 0 && stats.channels.at(-1).max === 255);
  if (scoutingHb || scoutingWr) assert.deepEqual([metadata.width, metadata.height], [1254, 1254], player.name);
  const view = buildProspectView({ classId: 'CUS02', position: player.position, playerId: player.id });
  const embed = view.embeds[0].toJSON();
  assert.equal(embed.title, `${player.name} · ${player.position}${player.heisman ? ' <:heisman:1573390983457022102>' : ''}`);
  assert.equal(embed.thumbnail.url, `attachment://cus02-${player.id}.png`);
  const positionPlayers = players.filter((entry) => entry.position === player.position);
  assert.equal(embed.footer.text, `CUS02 · ${scouting ? 'Scouting profile' : 'Simulated college statistics'} · ${positionPlayers.indexOf(player) + 1}/${positionPlayers.length}`);
  if (scouting) assert.equal(embed.fields.some(({ name }) => name === 'Final college season'), false);
  if (scoutingWr) assert.match(embed.fields.find(({ name }) => name === 'Jersey / Board').value, /Unranked$/);
  assert.doesNotMatch(JSON.stringify(embed), /fictional|dev_trait|overall rating/i);
  assert.deepEqual(view.attachments, []);
}
assert.match(buildProspectView({ classId: 'CUS02', position: 'QB', playerId: '1' }).embeds[0].toJSON().title, /<:heisman:1573390983457022102>/);
assert.doesNotMatch(buildProspectView({ classId: 'CUS02', position: 'QB', playerId: '31' }).embeds[0].toJSON().title, /:heisman:/);
assert.equal(loadProspects()[0].name, 'J.T. Rhoads');
assert.equal(players[0].name, 'Ameer Young');
for (const [position, key] of [['QB', 'passingYards'], ['HB', 'rushingYards'], ['WR', 'receivingYards'], ['TE', 'receivingYards']]) {
  const values = players.filter((player) => player.position === position && player.statistics).map((player) => player.statistics[key]);
  assert.ok(values.some((value, index) => index > 0 && value > values[index - 1]), `${position} totals should not simply descend by board rank`);
}
assert.match(buildProspectView({ classId: 'CUS02', position: 'QB', playerId: '1' }).embeds[0].toJSON().fields.find((field) => field.name === 'School').value, /<:clemson:1573014169631072276>/);
assert.equal(buildProspectView({ classId: 'CUS02', position: 'QB', playerId: '31' }).components[1].toJSON().components[0].options.find((option) => option.value === '31').emoji.id, '1573014165646479561');
assert.doesNotMatch(buildProspectView({ classId: 'CUS02', position: 'HB', playerId: '19' }).embeds[0].toJSON().fields.find((field) => field.name === 'Age / Build').value, /undefined/);
assert.deepEqual(buildProspectView({ classId: 'CUS02', position: 'WR' }).components[1].toJSON().components[0].options
  .map(({ value }) => value), receivers.map(({ id }) => id));
assert.equal(buildProspectView({ classId: 'CUS02', position: 'TE' }).components[1].toJSON().components[0].options.length, 7);
assert.equal(buildProspectView({ classId: 'CUS02', position: 'FB' }).components.length, 2);
assert.match(buildProspectView({ classId: 'CUS02', position: 'FB' }).embeds[0].toJSON().description, /No completed profiles/);
assert.throws(() => buildProspectView({ classId: 'CUS02', position: 'QB', playerId: '13' }), /not available/);
for (const [id, position] of [['98', 'FS'], ['99', 'REDG'], ['100', 'WR'], ['101', 'QB'], ...Object.keys(scoutingQbs).map((id) => [id, 'QB'])]) {
  const view = buildProspectView({ classId: 'CUS02', position, playerId: id });
  assert.match(view.embeds[0].toJSON().fields.find((f) => f.name === 'Jersey / Board').value, /Unranked/);
  assert.match(view.components[1].toJSON().components[0].options.find((o) => o.value === id).description, /Unranked/);
}
const qbOptions = buildProspectView({ classId: 'CUS02' }).components[1].toJSON().components[0].options;
for (const [id, emoji] of [['101', '1573748014009286756'], ['102', '1573750048502710364'], ['104', '1573748012226973828'], ['106', '1573748015515173067']]) {
  assert.equal(qbOptions.find((option) => option.value === id).emoji.id, emoji);
  const view = buildProspectView({ classId: 'CUS02', playerId: id });
  assert.ok(view.embeds[0].toJSON().fields.find(({ name }) => name === 'School').value.includes(emoji));
}
for (const [id, value, expected] of [
  ['madden_prospects_class', 'CUS02', 'CUS02 Draft Prospects · QB'],
  ['madden_prospects_cus02_position', 'HB', 'LaMarian Johnson · HB'],
  ['madden_prospects_cus02_player_HB', '13', 'LaMarian Johnson · HB'],
  ['madden_prospects_cus02_position', 'WR', 'Michael Oluwafemi · WR'],
  ['madden_prospects_cus02_player_WR', '2', 'Michael Oluwafemi · WR'],
  ['madden_prospects_cus02_player_WR', '125', 'Marques Cook · WR'],
  ['madden_prospects_cus02_position', 'TE', 'Brayan Williams · TE'],
  ['madden_prospects_cus02_player_TE', '33', 'Brayan Williams · TE'],
  ['madden_prospects_cus02_player_QB', '102', 'Will Hoggard · QB'],
  ['madden_prospects_cus02_player_QB', '106', 'Tyler Costa · QB'],
  ['madden_prospects_class', 'CUS01', 'CUS01 Draft Prospects · QB'],
  ['madden_prospects_player_QB', '1', 'J.T. Rhoads · QB'],
]) {
  let payload;
  let deferred = false;
  assert.ok(customId.test(id));
  await execute({ customId: id, values: [value], isStringSelectMenu: () => true, deferUpdate: async () => { deferred = true; }, editReply: async (x) => { payload = x; } });
  assert.ok(deferred);
  assert.equal(payload.embeds[0].toJSON().title, expected === 'J.T. Rhoads · QB' ? `${expected} <:heisman:1573390983457022102>` : expected);
  assert.deepEqual(payload.attachments, []);
}
const firstReceiver = buildProspectView({ classId: 'CUS02', position: 'WR', page: 0 });
const next = firstReceiver.components.at(-1).toJSON().components[1];
let nextCard;
assert.match(next.custom_id, /^madden_prospects_cus02_next_WR_/);
await execute({ customId: next.custom_id, isButton: () => true, deferUpdate: async () => {}, editReply: async (reply) => { nextCard = reply; } });
const nextReceiver = players.filter((player) => player.position === 'WR')[1];
assert.equal(nextCard.embeds[0].toJSON().title, `${nextReceiver.name} · WR`);
assert.equal(nextCard.files[0].name, `cus02-${nextReceiver.id}.png`);
const firstHalfbackGroup = buildProspectView({ classId: 'CUS02', position: 'HB', playerId: halfbacks[24].id });
assert.equal(firstHalfbackGroup.components[1].toJSON().components[0].options.length, 25);
assert.equal(firstHalfbackGroup.components[2].toJSON().components[0].options.length, 2);
const nextHalfback = firstHalfbackGroup.components.at(-1).toJSON().components[1];
let nextHalfbackCard;
await execute({
  customId: nextHalfback.custom_id,
  isButton: () => true,
  deferUpdate: async () => {},
  editReply: async (reply) => { nextHalfbackCard = reply; },
});
assert.equal(nextHalfbackCard.embeds[0].toJSON().title, `${halfbacks[25].name} · HB`);
assert.deepEqual(nextHalfbackCard.components[1].toJSON().components[0].options.map(({ value }) => value),
  halfbacks.slice(25).map(({ id }) => id));
assert.equal(nextHalfbackCard.components[2].toJSON().components[0].options[1].default, true);
const single = buildProspectView({ classId: 'CUS02', position: 'FS', page: 0 });
const [previousOnly, nextOnly] = single.components.at(-1).toJSON().components;
assert.ok(previousOnly.disabled && nextOnly.disabled);
assert.notEqual(previousOnly.custom_id, nextOnly.custom_id);
console.log('PASS 70 CUS02 profiles, 24 receiver cards, halfback pagination, and transparent portraits');
