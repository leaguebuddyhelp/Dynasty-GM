import { EmbedBuilder } from 'discord.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getMaddenDataFilePath } from '../leaguebuddy/paths.js';
import { getFullTeamName } from '../shared/madden_team_names.js';
import { getTeamEmojiByName } from '../shared/madden_visuals.js';

export const POSITION_THREADS = ['QB', 'HB', 'FB', 'WR', 'TE', 'LT', 'LG', 'C', 'RG', 'RT', 'LEDG', 'REDG', 'DT', 'SAM', 'MIKE', 'WILL', 'CB', 'FS', 'SS', 'K', 'P'];
const aliases = { RB: 'HB', TB: 'HB', LE: 'LEDG', LEDGE: 'LEDG', LDE: 'LEDG', EDGE: 'LEDG', DE: 'LEDG',
  RE: 'REDG', REDGE: 'REDG', RDE: 'REDG', NT: 'DT', DL: 'DT', LOLB: 'SAM', OLB: 'SAM',
  MLB: 'MIKE', ILB: 'MIKE', LB: 'MIKE', ROLB: 'WILL', DB: 'CB', S: 'FS' };
export function positionThreadKey(position) {
  const value = String(position || '').toUpperCase().replace(/[\s_-]/g, '');
  return POSITION_THREADS.includes(value) ? value : aliases[value] || null;
}
const compare = new Intl.Collator('en', { sensitivity: 'base', numeric: false }).compare;
export function mascotLabel(team = {}, fallback = '') {
  return String(team.displayName || team.nickName || team.nickname || team.teamName || fallback.replace(/^.*?\b(?:City|Bay)\s+/i, '') || 'Free Agents');
}
export function mascotSortKey(mascot) {
  return /49ers|forty[ -]?niners/i.test(mascot) ? 'Forty Niners' : String(mascot);
}
function teamLabels(snapshot, row) {
  const team = (snapshot.teams?.leagueTeamInfoList || []).find((team) => String(team.teamId) === String(row.teamId));
  const full = team ? getFullTeamName(team, row.team || '') : row.team || 'Free Agents';
  const mascot = team ? mascotLabel(team, full) : full === 'Free Agents' ? full : full.split(' ').at(-1);
  return { full, mascot, key: mascotSortKey(mascot) };
}
function paginateBlocks(title, blocks, footer) {
  const pages = [];
  let text = '';
  for (const block of blocks) {
    if (block.length > 3900) throw new Error('A position-report player block exceeds Discord’s description limit.');
    if (text && text.length + block.length + 2 > 3900) { pages.push(text); text = ''; }
    text += `${text ? '\n\n' : ''}${block}`;
  }
  if (text) pages.push(text);
  return pages.map((description, index) => new EmbedBuilder()
    .setTitle(`${title}${pages.length > 1 ? ` · ${index + 1}/${pages.length}` : ''}`.slice(0, 256))
    .setDescription(description).setColor(0x5865f2).setFooter({ text: footer }));
}
export function buildPositionChangeEmbeds(snapshot, record, { fullSeason = false, reportLabel = null, reportFooter = null } = {}) {
  const rows = (fullSeason ? record.application : record.recommendations) || [];
  const grouped = new Map();
  for (const row of rows) {
    const position = positionThreadKey(row.position);
    if (!position) throw new Error(`No position thread mapping for ${row.position || 'missing position'} (${row.player}).`);
    const attributes = row.attributes.filter((attribute) => !fullSeason || attribute.net || attribute.needsReview);
    if (!attributes.length) continue;
    const list = grouped.get(position) || [];
    list.push({ row, attributes, team: teamLabels(snapshot, row) });
    grouped.set(position, list);
  }
  const result = new Map();
  for (const position of POSITION_THREADS) {
    const list = grouped.get(position);
    if (!list?.length) continue;
    list.sort((a, b) => compare(a.team.key, b.team.key) || compare(a.team.mascot, b.team.mascot) || compare(a.row.player, b.row.player));
    const playerBlocks = list.map(({ row, attributes, team }) => {
      const emoji = getTeamEmojiByName(team.full);
      const lines = attributes.map((attribute) => {
        const points = fullSeason ? attribute.pointsToApply : attribute.points;
        const earned = fullSeason ? attribute.net : points;
        const label = `**${attribute.attribute}**`;
        if (attribute.needsReview) return `${label}: earned ${earned >= 0 ? '+' : ''}${earned}; rating missing—review in Madden`;
        return `${label}: ${attribute.currentValue} → ${attribute.targetValue} (${points >= 0 ? '+' : ''}${points})`;
      });
      const positive = attributes.some((attribute) => (fullSeason ? attribute.net : attribute.points) > 0);
      const negative = attributes.some((attribute) => (fullSeason ? attribute.net : attribute.points) < 0);
      return { header: `${emoji ? `${emoji} ` : ''}**${team.mascot}**`, body: `${positive && negative ? '↕' : positive ? '↑' : '↓'} **${row.player}**${row.position !== position ? ` (${row.position})` : ''}${row.ovrCeiling < 99 ? ` · **OVR ceiling ${row.ovrCeiling}**` : ''}${row.changeContext?.playoffStakes ? ` · Playoffs ×${row.changeContext.playoffStakes.multiplier}` : ''}\n${lines.join(' · ')}${row.populationReason ? `\n${row.populationReason}` : ''}` };
    });
    const blocks = [];
    let header = '', body = '';
    for (const block of playerBlocks) {
      if (header && (header !== block.header || header.length + body.length + block.body.length + 2 > 3850)) {
        blocks.push(`${header}\n${body}`); body = '';
      }
      header = block.header;
      body += `${body ? '\n\n' : ''}${block.body}`;
    }
    if (body) blocks.push(`${header}\n${body}`);
    const label = reportLabel || (fullSeason ? 'Season Total · Weeks 1–18' : `Week ${record.weekNumber}`);
    result.set(position, { count: list.length, embeds: paginateBlocks(`${position} · ${label}`, blocks,
      reportFooter || `${String(record.seasonKey).replace(/^year_/, 'Season ')} · ${fullSeason ? 'Summed season changes · Apply final targets ONCE' : 'Apply changes manually in Madden'} · Mascot A–Z, then player A–Z`) });
  }
  return result;
}
async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
async function writeRegistry(file, registry) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(registry, null, 2));
    await fs.rename(temporary, file);
  } catch (error) { await fs.rm(temporary, { force: true }); throw error; }
}
async function ensurePositionThreadsInternal({ client, guildId, channelId, archiveDuration = 10080 }) {
  if (!/^[a-zA-Z0-9_-]+$/.test(String(guildId))) throw new Error('Invalid guild ID for position reports.');
  const parent = await client.channels.fetch(channelId);
  if (!parent?.isTextBased() || !parent.threads) throw new Error('Player Upgrades must be a channel supporting threads.');
  const file = getMaddenDataFilePath(`progression_positions/${String(guildId)}.json`);
  const registry = await readJson(file, { version: 1, channelId, positions: {} });
  if (registry.channelId !== channelId) { registry.positions = {}; registry.channelId = channelId; }
  const active = await parent.threads.fetchActive();
  const archived = await parent.threads.fetchArchived({ type: 'public', limit: 100 });
  const existing = new Map([...active.threads.values(), ...archived.threads.values()].map((thread) => [thread.name.toLowerCase(), thread]));
  for (const name of [...POSITION_THREADS, 'Season Results']) {
    const reference = registry.positions[name];
    let thread = reference ? await client.channels.fetch(reference.threadId).catch((error) => { if (error.code === 10003) return null; throw error; }) : null;
    if (!thread?.isThread()) thread = existing.get(name.toLowerCase());
    if (thread?.parentId && thread.parentId !== channelId) thread = null;
    if (!thread) {
      const starter = await parent.send({ content: name === 'Season Results' ? '**Season Results** · Top 10 risers/fallers from offseason Week 1.' : `**${name}** · Weekly player changes and summed season totals.` });
      thread = await starter.startThread({ name, autoArchiveDuration: archiveDuration, reason: 'Madden position progression reports' });
    }
    if (thread.archived) await thread.setArchived(false, 'Madden position reports');
    registry.positions[name] = { name, threadId: thread.id };
    await writeRegistry(file, registry);
  }
  return registry;
}
const registryQueues = new Map();
export async function ensurePositionThreads(options) {
  const key = String(options.guildId);
  const prior = registryQueues.get(key) || Promise.resolve();
  const pending = prior.catch(() => {}).then(() => ensurePositionThreadsInternal(options));
  registryQueues.set(key, pending);
  try { return await pending; }
  finally { if (registryQueues.get(key) === pending) registryQueues.delete(key); }
}
export async function publishPositionPages({ client, guildId, registry, record, groups, save }) {
  record.positionMessages ||= {};
  record.positionMessages[guildId] ||= {};
  const references = record.positionMessages[guildId];
  const reports = [];
  for (const name of new Set([...groups.keys(), ...Object.keys(references)])) {
    const target = registry.positions[name];
    if (!target) continue;
    const thread = await client.channels.fetch(target.threadId);
    const previous = references[name]?.threadId === thread.id ? references[name].messageIds : [];
    const pages = groups.get(name)?.embeds || [];
    const ids = [];
    for (const [index, embed] of pages.entries()) {
      const prior = previous[index] ? await thread.messages.fetch(previous[index]).catch((error) => { if (error.code === 10008) return null; throw error; }) : null;
      const payload = { embeds: [embed], components: [], allowedMentions: { parse: [] } };
      const posted = prior ? await prior.edit(payload) : await thread.send(payload);
      ids.push(posted.id);
      references[name] = { threadId: thread.id, messageIds: [...ids, ...previous.slice(ids.length)] };
      await save();
    }
    for (const id of previous.slice(pages.length)) {
      const message = await thread.messages.fetch(id).catch((error) => { if (error.code === 10008) return null; throw error; });
      if (message) await message.edit({ content: 'This page is superseded by the current report.', embeds: [], components: [], allowedMentions: { parse: [] } });
    }
    references[name] = { threadId: thread.id, messageIds: ids };
    await save();
    if (ids.length) reports.push({ teamName: name, url: `https://discord.com/channels/${guildId}/${thread.id}/${ids[0]}` });
  }
  record.positionLayoutVersion = 1;
  await save();
  return reports;
}
export function buildSeasonResultEmbeds(snapshot, changes, baseline) {
  const teams = [...(snapshot.teams?.leagueTeamInfoList || [])].sort((a, b) => compare(mascotSortKey(mascotLabel(a)), mascotSortKey(mascotLabel(b))));
  const blocks = teams.map((team) => {
    const rows = changes.get(String(team.teamId)) || { upgrades: [], downgrades: [] };
    const lines = (players) => players.length ? players.map((row) => `${row.name} (${row.position}) ${row.start} → ${row.end} (${row.change > 0 ? '+' : ''}${row.change})`).join('\n') : 'No qualifying changes.';
    return `**${mascotLabel(team)}**\n📈 **Top 10 Risers**\n${lines(rows.upgrades)}\n📉 **Top 10 Fallers**\n${lines(rows.downgrades)}`;
  });
  return paginateBlocks('Top 10 Risers / Fallers · Season Results', blocks, `Actual Madden OVR · Baseline: ${baseline?.label || 'unavailable'}${baseline?.partial ? ' (partial season)' : ''} · Mascot A–Z`);
}
