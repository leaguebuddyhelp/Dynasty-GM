import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { loadProspects } from './prospects.js';

const sourceFile = fileURLToPath(new URL('../../bundled_data/madden/Madden - CUS01 - Early Top 10.json', import.meta.url));
const biosFile = fileURLToPath(new URL('../../bundled_data/prospects/cus_01/early-top-10-bios.json', import.meta.url));
const PAGE_COUNT = 10;

export function loadEarlyTop10() {
  const source = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
  const bios = JSON.parse(fs.readFileSync(biosFile, 'utf8'));
  const ranks = new Map();
  for (const row of Object.values(source)) {
    const rank = Number(row['#']);
    if (!Number.isInteger(rank) || rank < 1 || rank > PAGE_COUNT || ranks.has(rank)) throw new Error('Invalid or duplicate early top ten rank');
    if (!row.name || !row.position || !row.school) throw new Error(`Incomplete early top ten entry at rank ${rank}`);
    ranks.set(rank, { ...row, rank, scoutingBio: bios[row.name] || null });
  }
  return ranks;
}

export function buildEarlyTop10View(page = 0) {
  const index = Math.max(0, Math.min(PAGE_COUNT - 1, Number.isInteger(page) ? page : 0));
  const rank = index + 1;
  const player = loadEarlyTop10().get(rank);
  const embed = new EmbedBuilder().setColor(0x5865f2).setFooter({ text: `CUS01 · Early outlook · ${rank}/${PAGE_COUNT}` });
  const files = [];
  if (player) {
    embed.setTitle(`Early Top 10 · #${rank} — ${player.name}`)
      .setDescription(player.scoutingBio || 'Scouting report coming soon.')
      .addFields(
        { name: 'Position', value: player.position, inline: true },
        { name: 'School / Year', value: `${player.school} · ${player.year}`, inline: true },
        { name: 'Build', value: `${player.height} · ${player.weight} lb`, inline: true },
      );
    // Match the player identity, not the early rank: the final board uses a different order.
    const prospect = loadProspects().find((entry) => entry.name === player.name && entry.position === player.position && entry.school === player.school);
    if (prospect && fs.existsSync(prospect.portrait)) {
      const name = `early-cus01-${prospect.id}${path.extname(prospect.portrait)}`;
      files.push(new AttachmentBuilder(prospect.portrait, { name }));
      embed.setThumbnail(`attachment://${name}`);
    }
  } else {
    embed.setTitle(`Early Top 10 · #${rank}`)
      .setDescription('This spot has not been assigned yet.');
  }
  const components = [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`madden_earlytop10_page_${Math.max(0, index - 1)}`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
    new ButtonBuilder().setCustomId(`madden_earlytop10_page_${Math.min(PAGE_COUNT - 1, index + 1)}`).setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(index === PAGE_COUNT - 1),
  )];
  return { content: '', embeds: [embed], components, files, attachments: [], allowedMentions: { parse: [] } };
}
