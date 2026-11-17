import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ActionRowBuilder, AttachmentBuilder, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';

const assetRoot = fileURLToPath(new URL('../../bundled_data/prospects/cus_01/', import.meta.url));
const sourceFile = fileURLToPath(new URL('../../bundled_data/draft_classes/madden/Madden - CUS01.json', import.meta.url));
export const PROSPECT_POSITIONS = Object.freeze(['QB', 'HB', 'FB', 'WR', 'TE', 'LT', 'LG', 'C', 'RG', 'RT', 'LEDG', 'REDG', 'DT', 'SAM', 'MIKE', 'WILL', 'CB', 'FS', 'SS', 'K', 'P']);
const appearanceKeys = ['skin', 'eye_color', 'ethnicity', 'hair', 'hair_color', 'facial_hair', 'features'];
const schoolColors = { USC: 0x990000, Alabama: 0x9e1b32, 'Penn State': 0x041e42, 'Notre Dame': 0xc99700, Miami: 0x005030, 'Ohio State': 0xbb0000 };
const schoolEmojis = {
  USC: { name: 'usc', id: '1572332490356555836' },
  'Penn State': { name: 'pennstate', id: '1572332489186480169' },
  Alabama: { name: 'alabama', id: '1572332488435572916' },
  'Notre Dame': { name: 'notredame', id: '1572332487613354036' },
  'Ohio State': { name: 'ohiostate', id: '1572332486804119643' },
  Miami: { name: 'miami', id: '1572332485675847862' },
};
function schoolLabel(school) {
  const emoji = schoolEmojis[school];
  return emoji ? `<:${emoji.name}:${emoji.id}> ${school}` : school;
}

// Only explicitly authored profiles are published. Other board entries stay private
// until their appearance and editorial content are ready. Never expose raw records.
export function loadProspects() {
  const source = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
  const catalog = JSON.parse(fs.readFileSync(path.join(assetRoot, 'profiles.json'), 'utf8'));
  return Object.entries(catalog.profiles).flatMap(([id, profile]) => {
    const row = source[id];
    if (!row || row.name !== profile.name || !appearanceKeys.every((key) => String(row[key] || '').trim())) return [];
    if (!PROSPECT_POSITIONS.includes(row.position)) return [];
    return [{ id, name: row.name, position: row.position, school: row.school,
      age: row.age, year: row.year, height: row.height, weight: row.weight,
      jersey: row.jersey, archetype: row.archetype, rank: row['#'],
      headline: profile.headline, bio: profile.bio, watch: profile.watch,
      portrait: path.join(assetRoot, 'portraits', path.basename(profile.portrait)) }];
  }).sort((a, b) => a.rank - b.rank);
}

export function buildProspectView({ position = 'QB', playerId = null } = {}) {
  if (!PROSPECT_POSITIONS.includes(position)) throw new Error('Unknown prospect position');
  const all = loadProspects();
  const players = all.filter((player) => player.position === position);
  const player = playerId === null ? null : players.find((entry) => entry.id === String(playerId));
  if (playerId !== null && !player) throw new Error('Prospect is not available in this position');
  const positionMenu = new StringSelectMenuBuilder()
    .setCustomId('madden_prospects_position').setPlaceholder('Choose a position')
    .addOptions(PROSPECT_POSITIONS.map((value) => {
      const count = all.filter((entry) => entry.position === value).length;
      return { label: value, value, description: count ? `${count} prospect profiles available` : 'Profiles not published yet', default: position === value };
    }));
  const components = [new ActionRowBuilder().addComponents(positionMenu)];
  if (players.length) components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId(`madden_prospects_player_${position}`).setPlaceholder('Open a player card')
    .addOptions(players.slice(0, 25).map((entry) => ({ label: entry.name, value: entry.id,
      ...(schoolEmojis[entry.school] ? { emoji: schoolEmojis[entry.school] } : {}),
      description: `${entry.school} · ${entry.archetype}`, default: entry.id === player?.id })))));

  const embed = new EmbedBuilder().setColor(0x5865f2);
  const files = [];
  if (player) {
    embed.setColor(schoolColors[player.school] || 0x5865f2)
      .setTitle(`${player.name} · ${player.position}`).setDescription(`**${player.headline}**\n\n${player.bio}`)
      .addFields(
        { name: 'School', value: `${schoolLabel(player.school)} · ${player.year}`, inline: true },
        { name: 'Age / Build', value: `${player.age} years · ${player.height} · ${player.weight} lb`, inline: true },
        { name: 'Player profile', value: `${player.jersey} · ${player.archetype} · Board #${player.rank}`, inline: true },
        { name: 'What to watch', value: player.watch },
      ).setFooter({ text: 'CUS01 · Fictional prospect biography · AI-generated portrait' });
    const schoolEmoji = schoolEmojis[player.school];
    if (schoolEmoji) embed.setThumbnail(`https://cdn.discordapp.com/emojis/${schoolEmoji.id}.png`);
    if (fs.existsSync(player.portrait)) {
      files.push(new AttachmentBuilder(player.portrait, { name: `cus01-${player.id}.png` }));
      embed.setImage(`attachment://cus01-${player.id}.png`);
    }
  } else {
    embed.setTitle(`CUS01 Draft Prospects · ${position}`)
      .setDescription(players.length
        ? `Choose a player below to open their portrait and scouting profile.\n\n${players.map((entry) => `**${entry.name}** · ${schoolLabel(entry.school)}`).join('\n')}`
        : 'No completed profiles have been published for this position yet. Choose QB to view the first six prospects.')
      .setFooter({ text: 'Six QB profiles available · More positions as the board is completed' });
  }
  return { content: '', embeds: [embed], components, files, attachments: [], allowedMentions: { parse: [] } };
}
