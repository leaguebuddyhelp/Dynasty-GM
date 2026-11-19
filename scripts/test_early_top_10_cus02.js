import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import { buildEarlyTop10View, loadEarlyTop10 } from '../src/madden/early_top_10.js';
import { customId, execute } from '../src/interactions/madden_earlytop10_page.js';

const board = loadEarlyTop10('CUS02');
assert.equal(board.size, 10);
assert.match(buildEarlyTop10View(0, 'CUS02').embeds[0].toJSON().fields.find((field) => field.name === 'School / Year').value, /<:washington:1573014914828869642>/);
assert.throws(() => loadEarlyTop10('__proto__'), /Unknown early top ten class/);
for (let page = 0; page < 10; page++) {
  const player = board.get(page + 1);
  const view = buildEarlyTop10View(page, 'CUS02');
  const embed = view.embeds[0].toJSON();
  const buttons = view.components[0].toJSON().components;
  assert.ok(embed.title.includes(player.name));
  assert.equal(embed.description, player.scoutingBio);
  assert.ok(player.scoutingBio.split(/\s+/).length >= 35 && player.scoutingBio.split(/\s+/).length <= 45);
  assert.doesNotMatch(JSON.stringify(embed), /fictional|simulated|overall rating|dev_trait|archetype|final college season/i);
  assert.match(embed.footer.text, new RegExp(`CUS02 · Early outlook · ${page + 1}/10`));
  assert.equal(buttons[0].disabled, page === 0);
  assert.equal(buttons[1].disabled, page === 9);
  assert.equal(view.files.length, 1, `Missing portrait for ${player.name}`);
  assert.match(embed.thumbnail.url, /^attachment:\/\/early-cus02-/);
  assert.deepEqual(view.attachments, []);
  const img = sharp(view.files[0].attachment);
  const metadata = await img.metadata();
  const stats = await img.stats();
  assert.ok(metadata.hasAlpha && stats.channels.at(-1).min === 0 && stats.channels.at(-1).max === 255);
}
assert.match(buildEarlyTop10View(2, 'CUS02').embeds[0].toJSON().thumbnail.url, /early-cus02-15\.png/);
assert.match(buildEarlyTop10View(7, 'CUS02').embeds[0].toJSON().title, /Will Hoggard/);
let payload;
for (const [id, values, expected] of [
  ['madden_earlytop10_class', ['CUS02'], 'Michael Oluwafemi'],
  ['madden_earlytop10_cus02_page_1', undefined, 'Kareem Carter'],
  ['madden_earlytop10_class', ['CUS01'], 'Cardarion Williams'],
  ['madden_earlytop10_page_1', undefined, 'Malachi Robinson'],
]) {
  assert.ok(customId.test(id));
  let deferred = false;
  await execute({ customId: id, values, isButton: () => !values, isStringSelectMenu: () => !!values,
    deferUpdate: async () => { deferred = true; }, editReply: async (x) => { payload = x; } });
  assert.ok(deferred);
  assert.ok(payload.embeds[0].toJSON().title.includes(expected));
  assert.deepEqual(payload.attachments, []);
}
assert.ok(fs.existsSync('bundled_data/madden/Madden - CUS02 - Early Top 10.json'));
console.log('PASS CUS02 early top ten, preseason bios, class navigation and identity-matched portraits');
