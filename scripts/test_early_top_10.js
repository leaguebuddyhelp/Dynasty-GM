import assert from 'node:assert/strict';
import { buildEarlyTop10View, loadEarlyTop10 } from '../src/madden/early_top_10.js';
import { execute as commandExecute, data } from '../src/madden/coach/earlytop10.js';
import { execute as buttonExecute, customId } from '../src/interactions/madden_earlytop10_page.js';
import { loadSoloCommands, loadSoloInteractionHandlers } from '../src/leaguebuddy/solo_mode.js';

const board = loadEarlyTop10();
assert.equal(data.name, 'earlybigboard');
assert.equal(board.get(1).name, 'Cardarion Williams');
assert.equal(board.get(2).name, 'Malachi Robinson');
assert.equal(board.get(5).name, 'J.T. Rhoads');
assert.equal(board.get(10).name, 'Nick Monk');
assert.equal(board.size, 32);
for (let index = 0; index < 32; index++) {
  const view = buildEarlyTop10View(index);
  const embed = view.embeds[0].toJSON();
  const buttons = view.components[0].toJSON().components;
  assert.match(embed.title, new RegExp(`Early Big Board · #${index + 1}`));
  assert.equal(buttons[0].disabled, index === 0);
  assert.equal(buttons[1].disabled, index === 31);
  assert.deepEqual(view.attachments, []);
  assert.doesNotMatch(JSON.stringify(embed), /fictional|simulated|overall rating|dev_trait|archetype|final college season/i);
  const row = board.get(index + 1);
  if (!row) {
    assert.match(embed.description, /not been assigned/);
    assert.equal(view.files.length, 0);
  } else if (row.scoutingBio) {
    assert.ok(row.scoutingBio.split(/\s+/).length >= 40 && row.scoutingBio.split(/\s+/).length <= 50);
    assert.equal(embed.description, row.scoutingBio);
    assert.equal(view.files.length, 1, `Missing portrait for ${row.name}`);
    assert.match(embed.thumbnail.url, /^attachment:\/\/early-cus01-(?:rank-)?\d+\.png$/);
    assert.equal(embed.image, undefined);
  }
}
assert.match(buildEarlyTop10View(0).embeds[0].toJSON().thumbnail.url, /early-cus01-3\.png/);
assert.match(buildEarlyTop10View(1).embeds[0].toJSON().thumbnail.url, /early-cus01-5\.png/);
assert.match(buildEarlyTop10View(3).embeds[0].toJSON().thumbnail.url, /early-cus01-16\.png/);
assert.match(buildEarlyTop10View(4).embeds[0].toJSON().thumbnail.url, /early-cus01-1\.png/);
assert.doesNotMatch(buildEarlyTop10View(4).embeds[0].toJSON().title, /:heisman:/, 'Later awards must not leak into an earlier board');
assert.match(buildEarlyTop10View(999).embeds[0].toJSON().footer.text, /32\/32/);
assert.match(buildEarlyTop10View(18).embeds[0].toJSON().thumbnail.url, /early-cus01-31\.png/);
assert.match(buildEarlyTop10View(16).files[0].attachment, /chacha-oakim-early-transparent\.png$/);
assert.match(buildEarlyTop10View(21).embeds[0].toJSON().thumbnail.url, /early-cus01-rank-22\.png/);
assert.match(buildEarlyTop10View(25).files[0].attachment, /jerald-simms-morrison-early-transparent\.png$/);
assert.match(buildEarlyTop10View(26).embeds[0].toJSON().thumbnail.url, /early-cus01-rank-27\.png/);
assert.equal(buildEarlyTop10View(9).components[0].toJSON().components[1].disabled, false);
let commandReply;
await commandExecute({ deferReply: async ({ flags }) => assert.equal(flags, 64), editReply: async (payload) => { commandReply = payload; } });
assert.match(commandReply.embeds[0].toJSON().title, /Cardarion Williams/);
let deferred = false;
let edited;
assert.ok(customId.test('madden_earlytop10_page_1'));
await buttonExecute({ isButton: () => true, customId: 'madden_earlytop10_page_1', deferUpdate: async () => { deferred = true; }, editReply: async (payload) => { edited = payload; } });
assert.equal(deferred, true);
assert.match(edited.embeds[0].toJSON().title, /Malachi Robinson/);
assert.deepEqual(edited.attachments, []);
assert.ok((await loadSoloCommands()).has('earlybigboard'));
assert.ok((await loadSoloInteractionHandlers()).some((h) => h.customId.test?.('madden_earlytop10_page_1')));
console.log('PASS early top ten ordering, navigation, identity-matched portraits and unpublished slots');
