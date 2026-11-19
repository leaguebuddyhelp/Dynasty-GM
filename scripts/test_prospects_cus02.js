import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import { buildProspectView, loadProspects } from '../src/madden/prospects.js';
import { customId, execute } from '../src/interactions/madden_prospects.js';

const players = loadProspects('CUS02');
assert.equal(players.length, 20);
assert.equal(players.filter((p) => p.position === 'QB').length, 4);
assert.equal(players.filter((p) => p.position === 'HB').length, 9);
assert.equal(players.filter((p) => p.position === 'WR').length, 7);
assert.throws(() => loadProspects('__proto__'), /Unknown prospect class/);
for (const player of players) {
  assert.ok(['QB', 'HB', 'WR'].includes(player.position));
  assert.ok(player.bio.split(/\s+/).length >= 35 && player.bio.split(/\s+/).length <= 45);
  assert.equal(player.statistics.fictional, true);
  if (player.position === 'WR') {
    const s = player.statistics;
    assert.ok(s.receptions <= s.targets && s.targets <= s.routesRun);
    assert.ok(s.yardsAfterCatch <= s.receivingYards);
  }
  assert.ok(fs.existsSync(player.portrait), `Missing portrait for ${player.name}`);
  const image = sharp(player.portrait);
  const metadata = await image.metadata();
  const stats = await image.stats();
  assert.ok(metadata.hasAlpha && stats.channels.at(-1).min === 0 && stats.channels.at(-1).max === 255);
  const view = buildProspectView({ classId: 'CUS02', position: player.position, playerId: player.id });
  const embed = view.embeds[0].toJSON();
  assert.equal(embed.title, `${player.name} · ${player.position}`);
  assert.equal(embed.thumbnail.url, `attachment://cus02-${player.id}.png`);
  assert.match(embed.footer.text, /CUS02 · Simulated college statistics/);
  assert.doesNotMatch(JSON.stringify(embed), /fictional|dev_trait|overall rating/i);
  assert.deepEqual(view.attachments, []);
}
assert.equal(loadProspects()[0].name, 'J.T. Rhoads');
assert.equal(players[0].name, 'Ameer Young');
assert.match(buildProspectView({ classId: 'CUS02', position: 'QB', playerId: '1' }).embeds[0].toJSON().fields.find((field) => field.name === 'School').value, /<:clemson:1573014169631072276>/);
assert.equal(buildProspectView({ classId: 'CUS02', position: 'QB', playerId: '31' }).components[1].toJSON().components[0].options.find((option) => option.value === '31').emoji.id, '1573014165646479561');
assert.doesNotMatch(buildProspectView({ classId: 'CUS02', position: 'HB', playerId: '19' }).embeds[0].toJSON().fields.find((field) => field.name === 'Age / Build').value, /undefined/);
assert.equal(buildProspectView({ classId: 'CUS02', position: 'WR' }).components[1].toJSON().components[0].options.length, 7);
assert.equal(buildProspectView({ classId: 'CUS02', position: 'FB' }).components.length, 2);
assert.match(buildProspectView({ classId: 'CUS02', position: 'FB' }).embeds[0].toJSON().description, /No completed profiles/);
assert.throws(() => buildProspectView({ classId: 'CUS02', position: 'QB', playerId: '13' }), /not available/);
for (const [id, value, expected] of [
  ['madden_prospects_class', 'CUS02', 'CUS02 Draft Prospects · QB'],
  ['madden_prospects_cus02_position', 'HB', 'CUS02 Draft Prospects · HB'],
  ['madden_prospects_cus02_player_HB', '13', 'LaMarian Johnson · HB'],
  ['madden_prospects_cus02_position', 'WR', 'CUS02 Draft Prospects · WR'],
  ['madden_prospects_cus02_player_WR', '2', 'Michael Oluwafemi · WR'],
  ['madden_prospects_class', 'CUS01', 'CUS01 Draft Prospects · QB'],
  ['madden_prospects_player_QB', '1', 'J.T. Rhoads · QB'],
]) {
  let payload;
  let deferred = false;
  assert.ok(customId.test(id));
  await execute({ customId: id, values: [value], isStringSelectMenu: () => true, deferUpdate: async () => { deferred = true; }, editReply: async (x) => { payload = x; } });
  assert.ok(deferred);
  assert.equal(payload.embeds[0].toJSON().title, expected);
  assert.deepEqual(payload.attachments, []);
}
console.log('PASS class selection, 20 CUS02 QB/HB/WR profiles, transparent portraits and class-safe navigation');
