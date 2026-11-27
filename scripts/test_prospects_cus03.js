import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import { buildProspectView, loadProspects } from '../src/madden/prospects.js';
import { customId, execute } from '../src/interactions/madden_prospects.js';

const players = loadProspects('CUS03');
const board = Object.values(JSON.parse(fs.readFileSync('bundled_data/madden/Madden - CUS03 - Big Board.json', 'utf8')));
const quarterbacks = board.filter(({ name, position }) => name && position === 'QB');
const identity = ({ name, position, school, jersey }) => [name, position, school, jersey];
assert.equal(players.length, 9);
assert.deepEqual(players.map(identity), quarterbacks.map(identity));
assert.deepEqual(players.map(({ rank }) => rank), [1, 22, 84, 86, 92, null, null, null, null]);

const home = buildProspectView({ classId: 'CUS03' });
const classChoices = home.components.at(-1).toJSON().components[0].options;
assert.deepEqual(classChoices.map(({ value }) => value), ['CUS01', 'CUS02', 'CUS03']);
assert.ok(classChoices.find(({ value }) => value === 'CUS03').default);

const playerMenu = home.components[1].toJSON().components[0];
assert.equal(playerMenu.custom_id, 'madden_prospects_cus03_player_QB');
assert.deepEqual(playerMenu.options.map(({ value }) => value), players.map(({ id }) => id));
assert.equal(buildProspectView({ classId: 'CUS03', position: 'HB' }).files.length, 0);

const schoolEmojis = {
  'North Dakota State': { name: 'northdakotastate', id: '1575956233998041230' },
  UCF: { name: 'ucf', id: '1575956232051757278' },
  Rutgers: { name: 'rutgers', id: '1575956229459550298' },
  Buffalo: { name: 'buffalo', id: '1575956227865706676' },
};
for (const [index, player] of players.entries()) {
  const view = buildProspectView({ classId: 'CUS03', position: 'QB', playerId: player.id });
  const embed = view.embeds[0].toJSON();
  assert.equal(embed.description, player.bio);
  assert.ok(player.bio.split(/\s+/).length >= 40 && player.bio.split(/\s+/).length <= 50, player.name);
  assert.equal(embed.footer.text, `CUS03 · Scouting profile · ${index + 1}/9`);
  assert.equal(embed.fields.find(({ name }) => name === 'Jersey / Board').value,
    `${player.jersey} · ${player.rank === null ? 'Unranked' : '#' + player.rank}`);
  assert.equal(embed.fields.some(({ name }) => name === 'Final college season'), false);
  const emoji = schoolEmojis[player.school];
  if (emoji) {
    const option = playerMenu.options.find(({ value }) => value === player.id);
    assert.equal(option.emoji.id, emoji.id);
    assert.equal(option.emoji.name, emoji.name);
    assert.equal(embed.fields.find(({ name }) => name === 'School').value,
      `<:${emoji.name}:${emoji.id}> ${player.school} · ${player.year}`);
  }
  assert.equal(view.files[0].attachment, player.portrait);
  assert.equal(embed.thumbnail.url, `attachment://cus03-${player.id}.png`);
  const image = sharp(player.portrait);
  const { width, height, hasAlpha } = await image.metadata();
  const { min, max } = (await image.stats()).channels.at(-1);
  assert.deepEqual([width, height, hasAlpha, min, max], [1254, 1254, true, 0, 255], player.name);
}
assert.equal(players[0].heisman, true);
assert.match(players[5].portrait, /jake-denney-class03-v3\.png$/);

for (const [id, value, expected] of [
  ['madden_prospects_class', 'CUS03', 'CUS03 Draft Prospects · QB'],
  ['madden_prospects_cus03_position', 'QB', 'Dashaud Smith · QB <:heisman:1573390983457022102>'],
  ['madden_prospects_cus03_player_QB', '6', 'Jake Denney · QB'],
  ['madden_prospects_cus03_next_QB_7', undefined, 'Jaxson Suarez · QB'],
  ['madden_prospects_cus03_previous_QB_6', undefined, 'Jake Denney · QB'],
]) {
  assert.ok(customId.test(id));
  let reply;
  await execute({
    customId: id, values: value ? [value] : undefined,
    isStringSelectMenu: () => Boolean(value), isButton: () => value === undefined,
    deferUpdate: async () => {}, editReply: async (payload) => { reply = payload; },
  });
  assert.equal(reply.embeds[0].toJSON().title, expected);
  assert.deepEqual(reply.attachments, []);
}
console.log('PASS CUS03 quarterback cards, portrait framing, board ranks and class navigation');
