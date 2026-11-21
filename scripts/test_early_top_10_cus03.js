import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { buildEarlyTop10View, loadEarlyTop10 } from '../src/madden/early_top_10.js';
import { customId, execute } from '../src/interactions/madden_earlytop10_page.js';

const root = 'bundled_data/prospects/cus_03';
const portraits = JSON.parse(fs.readFileSync(path.join(root, 'class03-portrait-prompts.json')));
const prospects = Object.values(JSON.parse(fs.readFileSync('bundled_data/madden/Madden - CUS03.json', 'utf8')));
const describedProspects = prospects.filter((player) => player.name && player.skin);
const board = loadEarlyTop10('CUS03');
assert.equal(board.size, 32);
assert.deepEqual(portraits.map((item) => [item.id, item.name, item.position, item.school]),
  describedProspects.map((player) => [String(player['#']), player.name, player.position, player.school]));
assert.deepEqual([...board.values()].slice(0, 3).map((p) => p.name), ['Nick Boyle', 'Dannie Montano', 'Micah Howard']);
for (const item of portraits) {
  const image = sharp(path.join(root, item.file));
  const metadata = await image.metadata();
  const stats = await image.stats();
  assert.ok(metadata.hasAlpha && stats.channels.at(-1).min === 0 && stats.channels.at(-1).max === 255, `Transparency: ${item.name}`);
}
for (let page = 0; page < 32; page++) {
  const player = board.get(page + 1);
  const view = buildEarlyTop10View(page, 'CUS03');
  const embed = view.embeds[0].toJSON();
  const buttons = view.components[0].toJSON().components;
  assert.ok(embed.title.includes(`${player.position} ${player.name}`));
  assert.equal(embed.description, player.scoutingBio);
  assert.ok(player.scoutingBio.split(/\s+/).length >= 35 && player.scoutingBio.split(/\s+/).length <= 45);
  assert.doesNotMatch(JSON.stringify(embed), /fictional|simulated|overall rating|dev_trait|archetype|final college season/i);
  assert.equal(embed.footer.text, `CUS03 · Early outlook · ${page + 1}/32`);
  assert.equal(buttons[0].disabled, page === 0);
  assert.equal(buttons[1].disabled, page === 31);
  assert.equal(view.files.length, 1, `Missing portrait for ${player.name}`);
  assert.equal(embed.thumbnail.url, `attachment://early-cus03-rank-${page + 1}.png`);
  const portrait = portraits.find((p) => p.name === player.name && p.school === player.school);
  assert.equal(view.files[0].attachment, path.resolve(root, portrait.file));
  assert.deepEqual(view.attachments, []);
}
for (const [id, values, expected] of [
  ['madden_earlytop10_class', ['CUS03'], 'Nick Boyle'],
  ['madden_earlytop10_cus03_page_1', undefined, 'Dannie Montano'],
  ['madden_earlytop10_cus03_page_10', undefined, 'Jake Rosario'],
  ['madden_earlytop10_cus03_page_23', undefined, 'LEDG Khassim Hayes'],
  ['madden_earlytop10_cus03_page_31', undefined, 'Matt Osborne'],
  ['madden_earlytop10_class', ['CUS02'], 'Michael Oluwafemi'],
  ['madden_earlytop10_class', ['CUS01'], 'Cardarion Williams'],
]) {
  assert.ok(customId.test(id));
  let payload;
  let deferred = false;
  await execute({ customId: id, values, isButton: () => !values, isStringSelectMenu: () => !!values,
    deferUpdate: async () => { deferred = true; }, editReply: async (x) => { payload = x; } });
  assert.ok(deferred);
  assert.ok(payload.embeds[0].toJSON().title.includes(expected));
  assert.deepEqual(payload.attachments, []);
}
console.log(`PASS CUS03 early top 32, ${portraits.length} transparent portraits, preseason bios and three-class navigation`);
