import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { buildEarlyTop10View, loadEarlyTop10 } from '../src/madden/early_top_10.js';
import { customId, execute } from '../src/interactions/madden_earlytop10_page.js';

const root = 'bundled_data/prospects/cus_05';
const portraits = JSON.parse(fs.readFileSync(path.join(root, 'portrait-prompts.json'), 'utf8'));
const roster = Object.values(JSON.parse(fs.readFileSync('bundled_data/madden/Madden - CUS05.json', 'utf8')));
const board = loadEarlyTop10('CUS05');
assert.equal(board.size, 10);
assert.deepEqual(portraits.map(({ id, name, position, school }) => [id, name, position, school]),
  roster.filter((player) => player.name && player.skin).map((player) => [String(player['#']), player.name, player.position, player.school]));
for (let index = 0; index < 32; index++) {
  const rank = index + 1;
  const view = buildEarlyTop10View(index, 'CUS05');
  const embed = view.embeds[0].toJSON();
  const [previous, next] = view.components[0].toJSON().components;
  assert.equal(embed.footer.text, `CUS05 · Early outlook · ${rank}/32`);
  assert.equal(previous.disabled, index === 0);
  assert.equal(next.disabled, index === 31);
  assert.deepEqual(view.attachments, []);
  const player = board.get(rank);
  if (!player) {
    assert.equal(embed.description, 'This spot has not been assigned yet.');
    assert.equal(view.files.length, 0);
    continue;
  }
  assert.ok(embed.title.includes(`${player.position} ${player.name}`));
  assert.equal(embed.description, player.scoutingBio);
  const words = embed.description.trim().split(/\s+/).length;
  assert.ok(words >= 40 && words <= 50, player.name);
  const portrait = portraits.find((item) => item.name === player.name);
  assert.ok(portrait, player.name);
  assert.equal(view.files.length, 1);
  assert.equal(view.files[0].attachment, path.resolve(root, portrait.file));
  assert.equal(embed.thumbnail.url, `attachment://early-cus05-rank-${rank}.png`);
  const image = sharp(view.files[0].attachment);
  const { width, height, hasAlpha } = await image.metadata();
  const { min, max } = (await image.stats()).channels.at(-1);
  assert.deepEqual([width, height, hasAlpha, min, max], [1254, 1254, true, 0, 255], player.name);
}

for (const [id, values, title] of [
  ['madden_earlytop10_class', ['CUS05'], 'Joshua Holmes'],
  ['madden_earlytop10_cus05_page_9', undefined, 'Johnny Evans Jr.'],
  ['madden_earlytop10_cus05_page_31', undefined, 'Early Big Board · #32'],
]) {
  assert.ok(customId.test(id));
  let payload;
  await execute({ customId: id, values, isButton: () => !values, isStringSelectMenu: () => !!values,
    deferUpdate: async () => {}, editReply: async (reply) => { payload = reply; } });
  assert.ok(payload.embeds[0].toJSON().title.includes(title));
  const options = payload.components[1].toJSON().components[0].options;
  assert.ok(options.some((option) => option.value === 'CUS05' && option.default));
}
console.log('PASS CUS05 class navigation, 10 ranked cards and transparent portraits');
