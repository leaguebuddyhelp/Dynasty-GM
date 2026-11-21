import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ActionRowBuilder, AttachmentBuilder, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';

const classFiles = Object.freeze({
  CUS01: { assetRoot: fileURLToPath(new URL('../../bundled_data/prospects/cus_01/', import.meta.url)), sourceFile: fileURLToPath(new URL('../../bundled_data/madden/Madden - CUS01.json', import.meta.url)), boardFile: fileURLToPath(new URL('../../bundled_data/madden/Madden - CUS01 - Big Board.json', import.meta.url)) },
  CUS02: { assetRoot: fileURLToPath(new URL('../../bundled_data/prospects/cus_02/', import.meta.url)), sourceFile: fileURLToPath(new URL('../../bundled_data/madden/Madden - CUS02.json', import.meta.url)), boardFile: fileURLToPath(new URL('../../bundled_data/madden/Madden - CUS02 - Big Board.json', import.meta.url)) },
});
export const PROSPECT_CLASSES = Object.freeze(Object.keys(classFiles));
export const PROSPECT_POSITIONS = Object.freeze(['QB', 'HB', 'FB', 'WR', 'TE', 'LT', 'LG', 'C', 'RG', 'RT', 'LEDG', 'REDG', 'DT', 'SAM', 'MIKE', 'WILL', 'CB', 'FS', 'SS', 'K', 'P']);
const appearanceKeys = ['skin', 'eye_color', 'ethnicity', 'hair', 'hair_color', 'facial_hair', 'features'];
const offensiveLinePositions = ['LT', 'LG', 'C', 'RG', 'RT'];
const defensiveLinePositions = ['LEDG', 'REDG', 'DT'];
const linebackerPositions = ['SAM', 'MIKE', 'WILL'];
const defensiveBackPositions = ['CB', 'FS', 'SS'];
const schoolAliases = { Minneosta: 'Minnesota', Wiconsin: 'Wisconsin', 'Western Kentucy': 'Western Kentucky', 'Ole MIss': 'Ole Miss' };
const schoolColors = { USC: 0x990000, Alabama: 0x9e1b32, 'Penn State': 0x041e42, 'Notre Dame': 0xc99700, Miami: 0x005030, 'Ohio State': 0xbb0000, Missouri: 0xf1b82d, Colorado: 0xcfb87c, 'North Carolina': 0x7bafd4, Minnesota: 0x7a0019, 'Florida State': 0x782f40, Oklahoma: 0x841617, Texas: 0xbf5700, 'Iowa State': 0xc8102e, 'Boise State': 0x0033a0, Duke: 0x003087, 'South Carolina': 0x73000a, LSU: 0x461d7c, Oregon: 0x154733 };
Object.assign(schoolColors, { Iowa: 0xffcd00, Auburn: 0x0c2340, 'Texas A&M': 0x500000, Louisville: 0xad0000, Syracuse: 0xf76900, Georgia: 0xba0c2f, Michigan: 0x00274c, Charlotte: 0x005035, 'Ole Miss': 0xce1126, Tennessee: 0xff8200, 'Texas Tech': 0xcc0000, 'NC State': 0xcc0000, Wisconsin: 0xc5050c, Clemson: 0xf56600, Utah: 0xcc0000, Stanford: 0x8c1515, UConn: 0x000e2f, Illinois: 0xe84a27 });
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
  Clemson: { name: 'clemson', id: '1573014169631072276' },
  Tennessee: { name: 'tennessee', id: '1573014167361945683' },
  Syracuse: { name: 'syracuse', id: '1573014165646479561' },
  Michigan: { name: 'michigan', id: '1573014722348056636' },
  Georgia: { name: 'georgia', id: '1573014721156743210' },
  Memphis: { name: 'memphis', id: '1573014719563038780' },
  'Ole Miss': { name: 'olemiss', id: '1573014717755166851' },
  'Georgia Tech': { name: 'georgiatech', id: '1573014716639608954' },
  Washington: { name: 'washington', id: '1573014914828869642' },
  Purdue: { name: 'purdue', id: '1573736474514563155' },
  'Boston College': { name: 'bostoncollege', id: '1573736473629302895' },
  'Washington State': { name: 'washingtonstate', id: '1573736472060760216' },
  'Utah State': { name: 'utahstate', id: '1573748015515173067' },
  'Oklahoma State': { name: 'oklahomastate', id: '1573748014009286756' },
  'Western Kentucky': { name: 'westernkentucky', id: '1573748012226973828' },
  Stanford: { name: 'stanford', id: '1573750048502710364' },
};
export function schoolLabel(school) {
  const display = schoolAliases[school] || school;
  const emoji = schoolEmojis[display];
  return emoji ? `<:${emoji.name}:${emoji.id}> ${display}` : display;
}

const number = (value) => Number(value).toLocaleString('en-US');
const rate = (numerator, denominator, digits = 2) => denominator > 0 ? (numerator / denominator).toFixed(digits) : '—';
const hasRank = (value) => Number.isInteger(value) && value > 0;
export const heismanBadge = (bio) => /\bheisman\b/i.test(String(bio || '')) ? '<:heisman:1573390983457022102>' : '';
const boardRank = (row) => Number.isInteger(row.round) && row.round > 0 && Number.isInteger(row.pick) && row.pick > 0 && row.pick <= 32
  ? (row.round - 1) * 32 + row.pick : null;
const hasAppearance = (row) => appearanceKeys.every((key) => String(row[key] || '').trim());
// The position-by-position board includes creator notes such as (94S) after some names.
const prospectKey = (name, position) => `${position}:${name.replace(/\s+\(\d+[A-Z]+\)$/, '').trim()}`;

// Authored fictional college data lives only in prospect profiles. It never feeds
// EA imports, awards or progression. Compute efficiency from the authored totals.
export function formatProspectStatistics(stats) {
  if (!stats || stats.fictional !== true) return null;
  const lines = [];
  if (stats.position === 'QB') {
    lines.push(`${stats.games} G · ${stats.completions}/${stats.attempts} (${rate(stats.completions * 100, stats.attempts, 1)}%)`);
    lines.push(`${number(stats.passingYards)} passing yards · ${stats.passingTD} TD · ${stats.interceptions} INT`);
    const adjustedNetYards = stats.passingYards + 20 * stats.passingTD - 45 * stats.interceptions - stats.sackYards;
    lines.push(`${rate(stats.passingYards, stats.attempts)} yards/attempt · ${rate(adjustedNetYards, stats.attempts + stats.sacks)} ANY/A`);
    if (stats.rushingYards !== undefined) lines.push(`${number(stats.rushingYards)} rush YD · ${stats.rushingTD} rush TD`);
  } else if (stats.position === 'HB') {
    lines.push(`${stats.games} G · ${stats.carries} CAR · ${number(stats.rushingYards)} rush YD · ${stats.rushingTD} rush TD`);
    lines.push(`${rate(stats.rushingYards, stats.carries)} YD/CAR · ${stats.receptions} REC · ${number(stats.receivingYards)} rec YD · ${stats.receivingTD} rec TD`);
    if (stats.rushingYardsAfterContact !== undefined) lines.push(`After contact: ${rate(stats.rushingYardsAfterContact, stats.carries)} rushing yards/carry`);
    if (stats.missedTacklesForced !== undefined) lines.push(`Forced missed tackles: ${stats.missedTacklesForced}`);
  } else if (stats.position === 'WR' || stats.position === 'TE') {
    lines.push(`${stats.games} G · ${stats.receptions} REC / ${stats.targets} TGT · ${number(stats.receivingYards)} YD · ${stats.receivingTD} TD`);
    lines.push(`${rate(stats.receivingYards, stats.receptions)} YD/REC · ${rate(stats.receptions * 100, stats.targets, 1)}% catch rate`);
    lines.push(`${rate(stats.receivingYards, stats.routesRun)} yards/route run (${stats.routesRun} routes)`);
    if (stats.yardsAfterCatch !== undefined) lines.push(`After catch: ${number(stats.yardsAfterCatch)} YD · ${rate(stats.yardsAfterCatch, stats.receptions)} YD/REC`);
    if (stats.runBlockSnaps !== undefined) lines.push(`Run-block wins: ${stats.runBlockWins}/${stats.runBlockSnaps} (${rate(stats.runBlockWins * 100, stats.runBlockSnaps, 1)}%)`);
    if (stats.passBlockSnaps !== undefined) lines.push(`Pressures allowed: ${stats.pressuresAllowed} on ${stats.passBlockSnaps} pass-block snaps (${rate(stats.pressuresAllowed * 100, stats.passBlockSnaps, 1)}%)`);
  } else if (offensiveLinePositions.includes(stats.position)) {
    lines.push(`${stats.games} G · ${number(stats.offensiveSnaps)} offensive snaps`);
    lines.push(`Pressures allowed: ${stats.pressuresAllowed}/${stats.passBlockSnaps} pass-block snaps (${rate(stats.pressuresAllowed * 100, stats.passBlockSnaps, 1)}%)`);
    lines.push(`Run-block wins: ${stats.runBlockWins}/${stats.runBlockSnaps} (${rate(stats.runBlockWins * 100, stats.runBlockSnaps, 1)}%)`);
  } else if (linebackerPositions.includes(stats.position) || defensiveBackPositions.includes(stats.position)) {
    lines.push(`${stats.games} G · ${number(stats.defensiveSnaps)} defensive snaps`);
    lines.push(`${stats.tackles} TKL · ${stats.tacklesForLoss} TFL · ${stats.sacks} SACK · ${stats.forcedFumbles} FF`);
    lines.push(`Run stops: ${stats.runStops}/${stats.runDefenseSnaps} run-defense snaps (${rate(stats.runStops * 100, stats.runDefenseSnaps, 1)}%)`);
    lines.push(`Coverage: ${stats.receptionsAllowed}/${stats.targets} completions · ${stats.passBreakups} breakups · ${stats.interceptions} INT`);
  } else if (defensiveLinePositions.includes(stats.position)) {
    lines.push(`${stats.games} G · ${number(stats.defensiveSnaps)} defensive snaps`);
    lines.push(`${stats.tackles} TKL · ${number(stats.sacks)} SACK · ${stats.tacklesForLoss} TFL · ${stats.forcedFumbles} FF`);
    lines.push(`Pressures: ${stats.pressures}/${stats.passRushSnaps} rushes (${rate(stats.pressures * 100, stats.passRushSnaps, 1)}%)`);
    lines.push(`Run stops: ${stats.runStops}/${stats.runDefenseSnaps} run-defense snaps (${rate(stats.runStops * 100, stats.runDefenseSnaps, 1)}%)`);
  }
  return lines.length ? lines.join('\n') : null;
}

// Only explicitly authored profiles are published. Other board entries stay private
// until their appearance and editorial content are ready. Never expose raw records.
export function loadProspects(classId = 'CUS01') {
  if (!Object.hasOwn(classFiles, classId)) throw new Error('Unknown prospect class');
  const config = classFiles[classId];
  const { sourceFile, boardFile, assetRoot } = config;
  const source = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
  const catalog = JSON.parse(fs.readFileSync(path.join(assetRoot, 'profiles.json'), 'utf8'));
  const board = boardFile ? JSON.parse(fs.readFileSync(boardFile, 'utf8')) : {};
  const boardRows = Object.values(board).filter((row) => row.name && row.position && hasAppearance(row));
  const sourceRows = Object.values(source).filter((row) => row.name && row.position);
  return Object.entries(catalog.profiles).flatMap(([id, profile]) => {
    // Source records may be reordered; saved profile IDs remain stable for buttons and portraits.
    const key = prospectKey(profile.name, profile.position ?? profile.statistics?.position);
    const boardMatches = boardRows.filter((row) => prospectKey(row.name, row.position) === key);
    const matches = boardMatches.length ? boardMatches : sourceRows.filter((row) => prospectKey(row.name, row.position) === key);
    const row = matches.length === 1 ? matches[0] : null;
    if (!row || !hasAppearance(row)) return [];
    if (!PROSPECT_POSITIONS.includes(row.position)) return [];
    return [{ id, name: profile.name, position: row.position, school: schoolAliases[row.school] || row.school,
      age: row.age, year: row.year, height: row.height, weight: row.weight,
      jersey: row.jersey, rank: boardRank(row) ?? (boardMatches.length ? null : row['#']),
      heisman: !!heismanBadge(`${row.bio || ''} ${profile.bio || ''}`),
      headline: profile.headline, bio: profile.bio, watch: profile.watch,
      statistics: profile.statistics,
      portrait: path.join(assetRoot, 'portraits', path.basename(profile.portrait)) }];
  }).sort((a, b) => (hasRank(a.rank) ? a.rank : Infinity) - (hasRank(b.rank) ? b.rank : Infinity));
}

export function buildProspectView({ classId = 'CUS01', position = 'QB', playerId = null, page = 0 } = {}) {
  if (!PROSPECT_POSITIONS.includes(position)) throw new Error('Unknown prospect position');
  const all = loadProspects(classId);
  const players = all.filter((player) => player.position === position);
  const player = playerId === null ? null : players.find((entry) => entry.id === String(playerId));
  const availablePositions = PROSPECT_POSITIONS.filter((entry) => all.some((prospect) => prospect.position === entry));
  const availableLabel = availablePositions.join(' / ');
  if (playerId !== null && !player) throw new Error('Prospect is not available in this position');
  const pageSize = 25;
  const pageCount = Math.ceil(players.length / pageSize);
  const index = player ? Math.floor(players.indexOf(player) / pageSize) : Math.max(0, Math.min(pageCount - 1, Number.isInteger(page) ? page : 0));
  const pagePlayers = players.slice(index * pageSize, (index + 1) * pageSize);
  const prefix = classId === 'CUS01' ? 'madden_prospects' : `madden_prospects_${classId.toLowerCase()}`;
  const positionMenu = new StringSelectMenuBuilder()
    .setCustomId(`${prefix}_position`).setPlaceholder('Choose a position')
    .addOptions(PROSPECT_POSITIONS.map((value) => {
      const count = all.filter((entry) => entry.position === value).length;
      return { label: value, value, description: count ? `${count} prospect profiles available` : 'Profiles not published yet', default: position === value };
    }));
  const components = [new ActionRowBuilder().addComponents(positionMenu)];
  if (players.length) components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId(`${prefix}_player_${position}`).setPlaceholder('Open a player card')
    .addOptions(pagePlayers.map((entry) => ({ label: entry.name, value: entry.id,
      ...(schoolEmojis[entry.school] ? { emoji: schoolEmojis[entry.school] } : {}),
      description: `${entry.school} · ${hasRank(entry.rank) ? `Board #${entry.rank}` : 'Unranked'}`, default: entry.id === player?.id })))));
  if (pageCount > 1) components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId(`${prefix}_page_${position}`).setPlaceholder('Choose a page')
    .addOptions(Array.from({ length: pageCount }, (_, pageIndex) => ({
      label: `Page ${pageIndex + 1} of ${pageCount}`, value: String(pageIndex), default: pageIndex === index,
    })))));

  const classMenu = new StringSelectMenuBuilder().setCustomId('madden_prospects_class').setPlaceholder('Choose a draft class')
    .addOptions(PROSPECT_CLASSES.map((value) => ({ label: value === 'CUS01' ? 'Class 1 · CUS01' : 'Class 2 · CUS02', value, default: classId === value })));
  components.push(new ActionRowBuilder().addComponents(classMenu));
  const embed = new EmbedBuilder().setColor(0x5865f2);
  const files = [];
  if (player) {
    embed.setColor(schoolColors[player.school] || 0x5865f2)
      .setTitle(`${player.name} · ${player.position}${player.heisman ? ` ${heismanBadge('heisman')}` : ''}`).setDescription(player.bio)
      .addFields(
        { name: 'School', value: `${schoolLabel(player.school)} · ${player.year}`, inline: true },
        { name: 'Age / Build', value: `${player.age == null ? 'Age not listed' : `${player.age} years`} · ${player.height} · ${player.weight} lb`, inline: true },
        { name: 'Jersey / Board', value: `${player.jersey} · ${hasRank(player.rank) ? `#${player.rank}` : 'Unranked'}`, inline: true },
      );
    const statistics = formatProspectStatistics(player.statistics);
    if (statistics) embed.addFields({ name: 'Final college season', value: statistics });
    embed.setFooter({ text: statistics ? `${classId} · Simulated college statistics` : `${classId} · Scouting profile` });
    if (fs.existsSync(player.portrait)) {
      const attachment = `${classId.toLowerCase()}-${player.id}.png`;
      files.push(new AttachmentBuilder(player.portrait, { name: attachment }));
      embed.setThumbnail(`attachment://${attachment}`);
    }
  } else {
    embed.setTitle(`${classId} Draft Prospects · ${position}`)
      .setDescription(players.length
        ? `Choose a player below to open their portrait and scouting profile.\n\n${pagePlayers.map((entry) => `**${entry.name}** · ${schoolLabel(entry.school)}`).join('\n')}`
        : `No completed profiles have been published for this position yet. Choose ${availableLabel} to view completed prospects.`)
      .setFooter({ text: `${all.length} profiles available · ${availableLabel} · More positions as the board is completed` });
  }
  return { content: '', embeds: [embed], components, files, attachments: [], allowedMentions: { parse: [] } };
}
