import assert from 'node:assert/strict';
import { buildEarlyTop10View, loadEarlyTop10 } from '../src/madden/early_top_10.js';
import { execute as commandExecute, data } from '../src/madden/coach/earlytop10.js';
import { execute as buttonExecute, customId } from '../src/interactions/madden_earlytop10_page.js';
import { loadSoloCommands, loadSoloInteractionHandlers } from '../src/leaguebuddy/solo_mode.js';

const board = loadEarlyTop10();
assert.equal(data.name, 'earlytop10');
assert.equal(board.get(1).name, 'Cardarion Williams');
assert.equal(board.get(2).name, 'Malachi Robinson');
assert.equal(board.get(5).name, 'J.T. Rhoads');
assert.equal(board.get(10).name, 'Nick Monk');
assert.equal(board.size, 10);
for (let index = 0; index < 10; index++) {
  const view = buildEarlyTop10View(index);
  const embed = view.embeds[0].toJSON();
  const buttons = view.components[0].toJSON().components;
  assert.match(embed.title, new RegExp(`Early Top 10 · #${index + 1}`));
  assert.equal(buttons[0].disabled, index === 0);
  assert.equal(buttons[1].disabled, index === 9);
  assert.deepEqual(view.attachments, []);
  assert.doesNotMatch(JSON.stringify(embed), /fictional|simulated|overall|dev_trait|archetype|final college season/i);
  const row = board.get(index + 1);
  if (!row) {
    assert.match(embed.description, /not been assigned/);
    assert.equal(view.files.length, 0);
  } else if (row.scoutingBio) {
    assert.ok(row.scoutingBio.split(/\s+/).length >= 35 && row.scoutingBio.split(/\s+/).length <= 45);
    assert.equal(embed.description, row.scoutingBio);
    assert.equal(view.files.length, 1, `Missing portrait for ${row.name}`);
    assert.match(embed.thumbnail.url, /^attachment:\/\/early-cus01-\d+\.png$/);
    assert.equal(embed.image, undefined);
  }
}
assert.match(buildEarlyTop10View(0).embeds[0].toJSON().thumbnail.url, /early-cus01-3\.png/);
assert.match(buildEarlyTop10View(1).embeds[0].toJSON().thumbnail.url, /early-cus01-5\.png/);
assert.match(buildEarlyTop10View(3).embeds[0].toJSON().thumbnail.url, /early-cus01-16\.png/);
assert.match(buildEarlyTop10View(4).embeds[0].toJSON().thumbnail.url, /early-cus01-1\.png/);
assert.match(buildEarlyTop10View(999).embeds[0].toJSON().footer.text, /10\/10/);
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
assert.ok((await loadSoloCommands()).has('earlytop10'));
assert.ok((await loadSoloInteractionHandlers()).some((h) => h.customId.test?.('madden_earlytop10_page_1')));
console.log('PASS early top ten ordering, navigation, identity-matched portraits and unpublished slots');
