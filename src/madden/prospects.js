import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ActionRowBuilder, AttachmentBuilder, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';

const assetRoot = fileURLToPath(new URL('../../bundled_data/prospects/cus_01/', import.meta.url));
const sourceFile = fileURLToPath(new URL('../../bundled_data/madden/Madden - CUS01.json', import.meta.url));
export const PROSPECT_POSITIONS = Object.freeze(['QB', 'HB', 'FB', 'WR', 'TE', 'LT', 'LG', 'C', 'RG', 'RT', 'LEDG', 'REDG', 'DT', 'SAM', 'MIKE', 'WILL', 'CB', 'FS', 'SS', 'K', 'P']);
const appearanceKeys = ['skin', 'eye_color', 'ethnicity', 'hair', 'hair_color', 'facial_hair', 'features'];
const offensiveLinePositions = ['LT', 'LG', 'C', 'RG', 'RT'];
const schoolColors = { USC: 0x990000, Alabama: 0x9e1b32, 'Penn State': 0x041e42, 'Notre Dame': 0xc99700, Miami: 0x005030, 'Ohio State': 0xbb0000, Missouri: 0xf1b82d, Colorado: 0xcfb87c, 'North Carolina': 0x7bafd4, Minnesota: 0x7a0019, 'Florida State': 0x782f40, Oklahoma: 0x841617, Texas: 0xbf5700, 'Iowa State': 0xc8102e, 'Boise State': 0x0033a0, Duke: 0x003087, 'South Carolina': 0x73000a, LSU: 0x461d7c, Oregon: 0x154733 };
Object.assign(schoolColors, { Iowa: 0xffcd00, Auburn: 0x0c2340, 'Texas A&M': 0x500000, Louisville: 0xad0000, Syracuse: 0xf76900, Georgia: 0xba0c2f, Michigan: 0x00274c, Charlotte: 0x005035, 'Ole Miss': 0xce1126, Tennessee: 0xff8200 });
const schoolEmojis = {
  USC: { name: 'usc', id: '1572332490356555836' },
  'Penn State': { name: 'pennstate', id: '1572332489186480169' },
  Alabama: { name: 'alabama', id: '1572332488435572916' },
  'Notre Dame': { name: 'notredame', id: '1572332487613354036' },
  'Ohio State': { name: 'ohiostate', id: '1572332486804119643' },
  Miami: { name: 'miami', id: '1572332485675847862' },
  Missouri: { name: 'missouri', id: '1572339527538843729' },
  Colorado: { name: 'colorado', id: '1572339526540730378' },
  'North Carolina': { name: 'northcarolina', id: '1572339525215326319' },
  'Boise State': { name: 'boisestate', id: '1572342760273346670' },
  Texas: { name: 'texas', id: '1572342759443144734' },
  Oklahoma: { name: 'oklahoma', id: '1572342758235054080' },
  'Florida State': { name: 'floridastate', id: '1572342757408899213' },
  Minnesota: { name: 'minnesota', id: '1572342756410400849' },
  'Iowa State': { name: 'iowastate', id: '1572343727098306762' },
  Duke: { name: 'duke', id: '1572347589741772811' },
  'South Carolina': { name: 'southcarolina', id: '1572347588676423750' },
  LSU: { name: 'lsu', id: '1572347587690766508' },
  Oregon: { name: 'oregon', id: '1572347586486993047' },
};
function schoolLabel(school) {
  const emoji = schoolEmojis[school];
  return emoji ? `<:${emoji.name}:${emoji.id}> ${school}` : school;
}

const number = (value) => Number(value).toLocaleString('en-US');
const rate = (numerator, denominator, digits = 2) => denominator > 0 ? (numerator / denominator).toFixed(digits) : '—';

// Authored fictional college data lives only in prospect profiles. It never feeds
// EA imports, awards or progression. Compute efficiency from the authored totals.
export function formatProspectStatistics(stats) {
  if (!stats || stats.fictional !== true) return null;
  const lines = [];
  if (stats.position === 'QB') {
    lines.push(`${stats.games} G · ${stats.completions}/${stats.attempts} (${rate(stats.completions * 100, stats.attempts, 1)}%)`);
    lines.push(`${number(stats.passingYards)} pass YD · ${stats.passingTD} TD / ${stats.interceptions} INT`);
    const adjustedNetYards = stats.passingYards + 20 * stats.passingTD - 45 * stats.interceptions - stats.sackYards;
    lines.push(`${rate(stats.passingYards, stats.attempts)} YD/ATT · ${rate(adjustedNetYards, stats.attempts + stats.sacks)} adjusted net yards/attempt (ANY/A)`);
    if (stats.rushingYards !== undefined) lines.push(`${number(stats.rushingYards)} rush YD · ${stats.rushingTD} rush TD`);
  } else if (stats.position === 'HB') {
    lines.push(`${stats.games} G · ${stats.carries} CAR · ${number(stats.rushingYards)} rush YD · ${stats.rushingTD} rush TD`);
    lines.push(`${rate(stats.rushingYards, stats.carries)} YD/CAR · ${stats.receptions} REC · ${number(stats.receivingYards)} rec YD · ${stats.receivingTD} rec TD`);
    if (stats.rushingYardsAfterContact !== undefined) lines.push(`After contact: ${rate(stats.rushingYardsAfterContact, stats.carries)} rushing yards/carry`);
    if (stats.missedTacklesForced !== undefined) lines.push(`Forced missed tackles: ${stats.missedTacklesForced}`);
    if (stats.fumbles !== undefined) lines.push(`Fumbles: ${stats.fumbles}`);
  } else if (stats.position === 'WR' || stats.position === 'TE') {
    lines.push(`${stats.games} G · ${stats.receptions} REC / ${stats.targets} TGT · ${number(stats.receivingYards)} YD · ${stats.receivingTD} TD`);
    lines.push(`${rate(stats.receivingYards, stats.receptions)} YD/REC · ${rate(stats.receptions * 100, stats.targets, 1)}% catch rate`);
    lines.push(`${rate(stats.receivingYards, stats.routesRun)} yards/route run (${stats.routesRun} routes)`);
    if (stats.yardsAfterCatch !== undefined) lines.push(`After catch: ${number(stats.yardsAfterCatch)} YD · ${rate(stats.yardsAfterCatch, stats.receptions)} YD/REC`);
    if (stats.contestedTargets !== undefined) lines.push(`Contested catches: ${stats.contestedCatches}/${stats.contestedTargets} (${rate(stats.contestedCatches * 100, stats.contestedTargets, 1)}%)`);
    if (stats.runBlockSnaps !== undefined) lines.push(`Run-block wins: ${stats.runBlockWins}/${stats.runBlockSnaps} (${rate(stats.runBlockWins * 100, stats.runBlockSnaps, 1)}%)`);
    if (stats.passBlockSnaps !== undefined) lines.push(`Pressures allowed: ${stats.pressuresAllowed} on ${stats.passBlockSnaps} pass-block snaps (${rate(stats.pressuresAllowed * 100, stats.passBlockSnaps, 1)}%)`);
  } else if (offensiveLinePositions.includes(stats.position)) {
    lines.push(`${stats.games} G · ${number(stats.offensiveSnaps)} offensive snaps`);
    lines.push(`Pressures allowed: ${stats.pressuresAllowed}/${stats.passBlockSnaps} pass-block snaps (${rate(stats.pressuresAllowed * 100, stats.passBlockSnaps, 1)}%)`);
    lines.push(`Allowed: ${stats.sacksAllowed} sacks · ${stats.hitsAllowed} hits · ${stats.hurriesAllowed} hurries`);
    lines.push(`Run-block wins: ${stats.runBlockWins}/${stats.runBlockSnaps} (${rate(stats.runBlockWins * 100, stats.runBlockSnaps, 1)}%)`);
    lines.push(`Penalties: ${stats.penalties}`);
  }
  return lines.length ? lines.join('\n') : null;
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
    return [{ id, name: row.name, position: row.position, school: row.school === 'Minneosta' ? 'Minnesota' : row.school,
      age: row.age, year: row.year, height: row.height, weight: row.weight,
      jersey: row.jersey, rank: row['#'],
      headline: profile.headline, bio: profile.bio, watch: profile.watch,
      statistics: profile.statistics,
      portrait: path.join(assetRoot, 'portraits', path.basename(profile.portrait)) }];
  }).sort((a, b) => a.rank - b.rank);
}

export function buildProspectView({ position = 'QB', playerId = null } = {}) {
  if (!PROSPECT_POSITIONS.includes(position)) throw new Error('Unknown prospect position');
  const all = loadProspects();
  const players = all.filter((player) => player.position === position);
  const player = playerId === null ? null : players.find((entry) => entry.id === String(playerId));
  const availablePositions = PROSPECT_POSITIONS.filter((entry) => all.some((prospect) => prospect.position === entry));
  const availableLabel = availablePositions.join(' / ');
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
      description: `${entry.school} · Board #${entry.rank}`, default: entry.id === player?.id })))));

  const embed = new EmbedBuilder().setColor(0x5865f2);
  const files = [];
  if (player) {
    embed.setColor(schoolColors[player.school] || 0x5865f2)
      .setTitle(`${player.name} · ${player.position}`).setDescription(`**${player.headline}**\n\n${player.bio}`)
      .addFields(
        { name: 'School', value: `${schoolLabel(player.school)} · ${player.year}`, inline: true },
        { name: 'Age / Build', value: `${player.age} years · ${player.height} · ${player.weight} lb`, inline: true },
        { name: 'Player profile', value: `${player.jersey} · Board #${player.rank}`, inline: true },
        { name: 'What to watch', value: player.watch },
      ).setFooter({ text: 'CUS01 · Fictional scouting profiles and college stats · AI-generated portrait' });
    const statistics = formatProspectStatistics(player.statistics);
    if (statistics) embed.addFields({ name: 'Fictional final college season', value: statistics });
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
        : `No completed profiles have been published for this position yet. Choose ${availableLabel} to view completed prospects.`)
      .setFooter({ text: `${all.length} profiles available · ${availableLabel} · More positions as the board is completed` });
  }
  return { content: '', embeds: [embed], components, files, attachments: [], allowedMentions: { parse: [] } };
}
