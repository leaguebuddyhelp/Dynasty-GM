import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { loadProspects, schoolLabel } from './prospects.js';

const classes = Object.freeze({
  CUS01: { source: 'Madden - CUS01 - Early Big Board.json', folder: 'cus_01', pageCount: 32 },
  CUS02: { source: 'Madden - CUS02 - Early Big Board.json', folder: 'cus_02', pageCount: 32 },
  CUS03: { source: 'Madden - CUS03 - Early Big Board.json', folder: 'cus_03', pageCount: 10 },
});
const dataRoot = fileURLToPath(new URL('../../bundled_data/', import.meta.url));

export function loadEarlyTop10(classId = 'CUS01') {
  if (!Object.hasOwn(classes, classId)) throw new Error('Unknown early top ten class');
  const { source: filename, folder, pageCount } = classes[classId];
  const sourceFile = path.join(dataRoot, 'madden', filename);
  const biosFile = path.join(dataRoot, 'prospects', folder, 'early-top-10-bios.json');
  const source = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
  const bios = JSON.parse(fs.readFileSync(biosFile, 'utf8'));
  const ranks = new Map();
  for (const row of Object.values(source)) {
    const rank = Number(row['#']);
    if (!Number.isInteger(rank) || rank < 1 || rank > pageCount || ranks.has(rank)) throw new Error('Invalid or duplicate early board rank');
    if (!row.name || !row.position || !row.school) throw new Error(`Incomplete early board entry at rank ${rank}`);
    ranks.set(rank, { ...row, rank, scoutingBio: bios[row.name] || null });
  }
  return ranks;
}

export function buildEarlyTop10View(page = 0, classId = 'CUS01') {
  if (!Object.hasOwn(classes, classId)) throw new Error('Unknown early top ten class');
  const { pageCount } = classes[classId];
  const index = Math.max(0, Math.min(pageCount - 1, Number.isInteger(page) ? page : 0));
  const rank = index + 1;
  const player = loadEarlyTop10(classId).get(rank);
  const embed = new EmbedBuilder().setColor(0x5865f2).setFooter({ text: `${classId} · Early outlook · ${rank}/${pageCount}` });
  const files = [];
  if (player) {
    embed.setTitle(`Early Big Board · #${rank} — ${player.position} ${player.name}`)
      .setDescription(player.scoutingBio || 'Scouting report coming soon.')
      .addFields(
        { name: 'Position', value: player.position, inline: true },
        { name: 'School / Year', value: `${schoolLabel(player.school)} · ${player.year}`, inline: true },
        { name: 'Build', value: `${player.height} · ${player.weight} lb`, inline: true },
      );
    // Match the player identity, not the early rank: the final board uses a different order.
    const prospect = classId === 'CUS03' ? null : loadProspects(classId).find((entry) => entry.name === player.name && entry.position === player.position && schoolLabel(entry.school) === schoolLabel(player.school));
    if (prospect && fs.existsSync(prospect.portrait)) {
      const name = `early-${classId.toLowerCase()}-${prospect.id}${path.extname(prospect.portrait)}`;
      files.push(new AttachmentBuilder(prospect.portrait, { name }));
      embed.setThumbnail(`attachment://${name}`);
    } else {
      const root = path.join(dataRoot, 'prospects', classes[classId].folder);
      const manifests = classId === 'CUS01' ? ['early-top-32-portrait-prompts.json'] : classId === 'CUS02' ? ['early-top-10-portrait-prompts.json', 'future-player-portrait-prompts.json'] : ['class03-portrait-prompts.json'];
      const portraits = manifests.flatMap((manifest) => {
        const file = path.join(root, manifest);
        return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
      });
      const match = portraits.find((entry) => entry.name === player.name && entry.position === player.position && schoolLabel(entry.school) === schoolLabel(player.school));
      const portrait = match && path.join(root, 'portraits', path.basename(match.file));
      if (portrait && fs.existsSync(portrait)) {
        const name = `early-${classId.toLowerCase()}-rank-${rank}.png`;
        files.push(new AttachmentBuilder(portrait, { name }));
        embed.setThumbnail(`attachment://${name}`);
      }
    }
  } else {
    embed.setTitle(`Early Big Board · #${rank}`)
      .setDescription('This spot has not been assigned yet.');
  }
  const prefix = classId === 'CUS01' ? 'madden_earlytop10_page' : `madden_earlytop10_${classId.toLowerCase()}_page`;
  const components = [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}_${Math.max(0, index - 1)}`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
    new ButtonBuilder().setCustomId(`${prefix}_${Math.min(pageCount - 1, index + 1)}`).setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(index === pageCount - 1),
  ), new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('madden_earlytop10_class')
    .setPlaceholder('Choose a draft class').addOptions(Object.keys(classes).map((value, index) => ({ label: `Class ${index + 1} · ${value}`, value, default: value === classId }))))];
  return { content: '', embeds: [embed], components, files, attachments: [], allowedMentions: { parse: [] } };
}
