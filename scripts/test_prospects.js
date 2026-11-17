import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import { buildProspectView, loadProspects, PROSPECT_POSITIONS } from '../src/madden/prospects.js';
import { execute as commandExecute } from '../src/madden/coach/prospects.js';
import { execute as menuExecute, customId } from '../src/interactions/madden_prospects.js';
import { loadSoloCommands, loadSoloInteractionHandlers } from '../src/leaguebuddy/solo_mode.js';

const players = loadProspects();
assert.equal(players.length, 6);
assert.equal(PROSPECT_POSITIONS.length, 21);
assert.deepEqual(players.map((p) => p.id), ['1', '2', '6', '14', '56', '63']);
assert.doesNotMatch(JSON.stringify(players), /"overall"|"dev_trait"/);
const home = buildProspectView();
assert.equal(home.components[0].toJSON().components[0].options.length, 21);
assert.equal(home.components[1].toJSON().components[0].options.length, 6);
assert.equal(home.files.length, 0);
const expectedSchoolEmojis = {
  '1': '1572332490356555836', '2': '1572332488435572916', '6': '1572332489186480169',
  '14': '1572332487613354036', '56': '1572332485675847862', '63': '1572332486804119643',
};
for (const player of players) {
  assert.ok(fs.existsSync(player.portrait), `Missing portrait: ${player.name}`);
  const portrait = sharp(player.portrait);
  const metadata = await portrait.metadata();
  const stats = await portrait.stats();
  assert.equal(metadata.hasAlpha, true, `${player.name} must have a transparent PNG portrait`);
  assert.equal(stats.channels.at(-1).min, 0, 'Background contains fully transparent pixels');
  assert.equal(stats.channels.at(-1).max, 255, 'Player contains opaque pixels');
  const view = buildProspectView({ position: 'QB', playerId: player.id });
  const embed = view.embeds[0].toJSON();
  assert.match(embed.title, new RegExp(player.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.ok(embed.description.includes(player.bio));
  assert.ok(embed.description.length < 4096);
  const emojiId = expectedSchoolEmojis[player.id];
  assert.ok(embed.fields.find((field) => field.name === 'School').value.includes(`:${emojiId}>`));
  assert.equal(embed.thumbnail.url, `https://cdn.discordapp.com/emojis/${emojiId}.png`);
  assert.equal(view.components[1].toJSON().components[0].options.find((option) => option.value === player.id).emoji.id, emojiId);
  assert.match(embed.image.url, /^attachment:\/\/cus01-\d+\.png$/);
  assert.equal(view.files[0].name, `cus01-${player.id}.png`);
  assert.deepEqual(view.attachments, [], 'Switching cards removes the previous portrait');
  assert.doesNotMatch(JSON.stringify(embed), /overall|dev_trait|development trait|OVR/i);
  assert.equal(view.components[1].toJSON().components[0].options.filter((p) => p.default).length, 1);
}
const empty = buildProspectView({ position: 'CB' });
assert.equal(empty.components.length, 1);
assert.equal(empty.files.length, 0);
assert.match(empty.embeds[0].toJSON().description, /No completed profiles/);
assert.throws(() => buildProspectView({ position: 'CB', playerId: '1' }), /not available/);
assert.throws(() => buildProspectView({ playerId: '3' }), /not available/);
assert.throws(() => buildProspectView({ position: '../../' }), /Unknown/);

const calls = [];
await commandExecute({ deferReply: async (x) => calls.push(['defer', x]), editReply: async (x) => calls.push(['edit', x]) });
assert.equal(calls[0][1].flags, 64);
assert.equal(calls[1][1].embeds[0].toJSON().title, 'CUS01 Draft Prospects · QB');
for (const [id, value, expected] of [
  ['madden_prospects_player_QB', '1', 'J.T. Rhoads · QB'],
  ['madden_prospects_player_QB', '63', 'Zac Williams · QB'],
  ['madden_prospects_position', 'CB', 'CUS01 Draft Prospects · CB'],
]) {
  let deferred = false;
  let payload;
  assert.ok(customId.test(id));
  await menuExecute({ customId: id, values: [value], isStringSelectMenu: () => true,
    deferUpdate: async () => { deferred = true; }, editReply: async (x) => { payload = x; } });
  assert.equal(deferred, true);
  assert.equal(payload.embeds[0].toJSON().title, expected);
}
const commands = await loadSoloCommands();
assert.ok(commands.has('prospects'));
const handlers = await loadSoloInteractionHandlers();
assert.ok(handlers.some((h) => h.customId.test?.('madden_prospects_player_QB')));
console.log('PASS six prospect portraits, hidden ratings, position browsing, card switching and command registration');
