import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { buildEarlyTop10View, loadEarlyTop10 } from '../src/madden/early_top_10.js';
import { customId, execute } from '../src/interactions/madden_earlytop10_page.js';

const root = 'bundled_data/prospects/cus_04';
const portraits = JSON.parse(fs.readFileSync(path.join(root, 'portrait-prompts.json'), 'utf8'));
const roster = JSON.parse(fs.readFileSync(path.join(root, 'portrait-roster.json'), 'utf8'));
const players = Object.values(JSON.parse(fs.readFileSync('bundled_data/madden/Madden - CUS04.json', 'utf8')));
const described = players.filter((player) => player.name && player.skin);
assert.deepEqual(portraits.map(({ id, name, position, school }) => [id, name, position, school]),
  described.map((player) => [String(player['#']), player.name, player.position, player.school]));
assert.deepEqual(roster.players.map(({ name, portrait }) => [name, portrait]),
  portraits.map(({ name, file }) => [name, file]));
for (const item of portraits) {
  const image = sharp(path.join(root, item.file));
  const metadata = await image.metadata();
  const alpha = (await image.stats()).channels.at(-1);
  assert.equal(metadata.format, 'png');
  assert.deepEqual([metadata.width, metadata.height], [1254, 1254]);
  assert.ok(metadata.hasAlpha && alpha.min === 0 && alpha.max === 255, `Transparency: ${item.name}`);
}

const board = loadEarlyTop10('CUS04');
assert.equal(board.size, 32);
assert.equal(board.get(1).name, 'Conor Williams');
assert.equal(board.get(10).name, 'Alex Martinez');
for (const [name, pick] of [['Alex Savage', 17], ['Johnny Hatcher', 26], ['Jocquise Harrison', 28]]) {
  const player = players.find((entry) => entry.name === name);
  assert.equal(player.round, 1);
  assert.equal(player.pick, pick);
  assert.equal(board.get(pick).name, name);
}
for (let page = 0; page < 32; page++) {
  const rank = page + 1;
  const view = buildEarlyTop10View(page, 'CUS04');
  const embed = view.embeds[0].toJSON();
  const [previous, next] = view.components[0].toJSON().components;
  assert.equal(embed.footer.text, `CUS04 · Early outlook · ${rank}/32`);
  assert.equal(previous.disabled, page === 0);
  assert.equal(next.disabled, page === 31);
  assert.deepEqual(view.attachments, []);
  const player = board.get(rank);
  assert.ok(player, `Missing prospect at rank ${rank}`);
  assert.ok(embed.title.includes(`${player.position} ${player.name}`));
  assert.equal(embed.description, player.scoutingBio);
  const words = player.scoutingBio.trim().split(/\s+/).length;
  assert.ok(words >= 40 && words <= 50, player.name);
  const portrait = portraits.find((item) => item.name === player.name);
  assert.ok(portrait, `Missing portrait for ${player.name}`);
  assert.equal(embed.thumbnail.url, `attachment://early-cus04-rank-${rank}.png`);
  assert.equal(view.files.length, 1);
  assert.equal(view.files[0].attachment, path.resolve(root, portrait.file));
}

for (const [id, values, expected] of [
  ['madden_earlytop10_class', ['CUS04'], 'Conor Williams'],
  ['madden_earlytop10_cus04_page_8', undefined, 'Matteo Jackson'],
  ['madden_earlytop10_cus04_page_9', undefined, 'Alex Martinez'],
  ['madden_earlytop10_cus04_page_31', undefined, 'Ayren Leonard'],
]) {
  assert.ok(customId.test(id));
  let payload;
  await execute({ customId: id, values, isButton: () => !values, isStringSelectMenu: () => !!values,
    deferUpdate: async () => {}, editReply: async (reply) => { payload = reply; } });
  assert.ok(payload.embeds[0].toJSON().title.includes(expected));
  const classes = payload.components[1].toJSON().components[0].options;
  assert.equal(classes.find((option) => option.value === 'CUS04').default, true);
}
console.log('PASS 32 CUS04 Early Big Board cards and 37 matching transparent portraits');
