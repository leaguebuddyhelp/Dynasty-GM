import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { loadEarlyTop10 } from '../src/madden/early_top_10.js';
import { execute } from '../src/interactions/madden_earlytop10_page.js';

const root = 'bundled_data/prospects/cus_07';
const portraits = JSON.parse(fs.readFileSync(path.join(root, 'portrait-prompts.json'), 'utf8'));
const roster = Object.values(JSON.parse(fs.readFileSync('bundled_data/madden/Madden - CUS07.json', 'utf8')));
const board = loadEarlyTop10('CUS07');
assert.equal(board.size, 10);
assert.equal(board.get(1).name, 'Keahi Kawaha');
assert.equal(board.get(10).name, 'Antez Robertson');
assert.equal(board.get(6).jersey, '#12');
assert.equal(roster.find(({ name }) => name === "Tre'Darius Bryant").jersey, '#12');
assert.deepEqual(portraits.map(({ id, name, position, school }) => [id, name, position, school]),
  roster.filter(({ name, skin }) => name && skin).map((player) => [String(player['#']), player.name, player.position, player.school]));

for (let index = 0; index < 32; index++) {
  const rank = index + 1;
  let reply;
  await execute({
    customId: index === 0 ? 'madden_earlytop10_class' : `madden_earlytop10_cus07_page_${index}`,
    values: ['CUS07'], isStringSelectMenu: () => index === 0, isButton: () => index !== 0,
    deferUpdate: async () => {}, editReply: async (payload) => { reply = payload; },
  });
  const embed = reply.embeds[0].toJSON();
  const [previous, next] = reply.components[0].toJSON().components;
  assert.equal(embed.footer.text, `CUS07 · Early outlook · ${rank}/32`);
  assert.equal(previous.disabled, index === 0);
  assert.equal(next.disabled, index === 31);
  assert.ok(reply.components[1].toJSON().components[0].options.some(({ value, default: selected }) => value === 'CUS07' && selected));
  assert.deepEqual(reply.attachments, []);
  const player = board.get(rank);
  if (!player) {
    assert.equal(embed.description, 'This spot has not been assigned yet.');
    assert.equal(reply.files.length, 0);
    continue;
  }
  assert.ok(embed.title.includes(`${player.position} ${player.name}`));
  assert.equal(embed.description, player.scoutingBio);
  const words = player.scoutingBio.trim().split(/\s+/).length;
  assert.ok(words >= 40 && words <= 50, player.name);
  const portrait = portraits.find(({ name }) => name === player.name);
  assert.ok(portrait, player.name);
  assert.equal(reply.files.length, 1);
  assert.equal(reply.files[0].attachment, path.resolve(root, portrait.file));
  assert.equal(embed.thumbnail.url, `attachment://early-cus07-rank-${rank}.png`);
  const image = sharp(reply.files[0].attachment);
  const { width, height, hasAlpha } = await image.metadata();
  const { min, max } = (await image.stats()).channels.at(-1);
  assert.deepEqual([width, height, hasAlpha, min, max], [1254, 1254, true, 0, 255], player.name);
}
console.log('PASS CUS07 class navigation, 10 ranked cards and transparent portraits');
