import fs from 'node:fs/promises';
import path from 'node:path';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getMaddenDataFilePath } from '../leaguebuddy/paths.js';
import { getMaddenChannelId, getMaddenSeasonKey } from '../shared/madden_metadata.js';
import { formatTeamLabelWithEmoji } from '../shared/madden_visuals.js';
import { applyEmbedThumbnailFromAsset, getLeagueBuddyBrandAsset } from '../shared/madden_assets.js';
import { ensureBoardPinMessage } from './board_pin_utils.js';
import { SOLO_POSITION_ORDER } from './solo_reports.js';
import { computeWeeklyList, getLatestReliableRegularSeasonWeekIndex } from './top_players.js';

const ROOT = getMaddenDataFilePath('top100_boards');
const activePublications = new Map();
const POSITION_ALIASES = {
  RB: 'HB', TB: 'HB', LEDGE: 'LE', LEDG: 'LE', LDE: 'LE',
  REDGE: 'RE', REDG: 'RE', RDE: 'RE', SAM: 'LOLB', MIKE: 'MLB', WILL: 'ROLB',
};

function safeId(value) {
  const text = String(value || '');
  if (!/^[a-zA-Z0-9_-]+$/.test(text)) throw new Error('Invalid Top 100 league or season identifier.');
  return text;
}

function reportPath(leagueId, seasonKey) {
  return path.join(ROOT, safeId(leagueId), `${safeId(seasonKey)}.json`);
}

export async function loadTop100Report(leagueId, seasonKey) {
  return JSON.parse(await fs.readFile(reportPath(leagueId, seasonKey), 'utf8'));
}

async function saveReport(report) {
  const file = reportPath(report.leagueId, report.seasonKey);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(report), { flag: 'wx' });
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

export function calculateSeasonTop100(weeks) {
  const players = new Map();
  for (const [week, list] of Object.entries(weeks).sort(([a], [b]) => Number(a) - Number(b))) {
    for (const player of list) {
      const id = String(player.id || '');
      const grade = Number(player.grade);
      if (!id || !Number.isFinite(grade)) continue;
      const item = players.get(id) || { ...player, grades: [] };
      item.name = player.name;
      item.position = player.position;
      item.team = player.team;
      item.teamId = player.teamId;
      item.grades.push({ week: Number(week), grade });
      players.set(id, item);
    }
  }
  const ranked = [...players.values()].map((item) => {
    const average = item.grades.reduce((sum, entry) => sum + entry.grade, 0) / item.grades.length;
    const grade = Math.min(99, average * 0.9 + Math.min(item.grades.length / 18, 1) * 10);
    return { ...item, averageGrade: Number(average.toFixed(2)), seasonGrade: Number(grade.toFixed(2)), appearances: item.grades.length };
  }).sort((a, b) => b.seasonGrade - a.seasonGrade || b.appearances - a.appearances || String(a.name).localeCompare(String(b.name)));
  const selected = new Set();
  for (const position of SOLO_POSITION_ORDER) {
    for (const item of ranked.filter((player) => (POSITION_ALIASES[player.position] || player.position) === position).slice(0, 2)) {
      selected.add(item.id);
    }
  }
  for (const item of ranked) {
    if (selected.size >= 100) break;
    selected.add(item.id);
  }
  return ranked.filter((item) => selected.has(item.id)).slice(0, 100);
}

export function buildAllProTeams(players) {
  return SOLO_POSITION_ORDER.map((position) => {
    const matching = players.filter((player) => (POSITION_ALIASES[player.position] || player.position) === position)
      .sort((a, b) => b.seasonGrade - a.seasonGrade || b.appearances - a.appearances || String(a.name).localeCompare(String(b.name)));
    return { position, first: matching[0] || null, second: matching[1] || null };
  });
}

export function buildTop100Page(report, kind, page = 0) {
  const players = kind === 'weekly' ? report.weeks[String(report.latestWeek)] : report.seasonTop100;
  if (!Array.isArray(players)) throw new Error('Top 100 report is unavailable.');
  const pages = Math.max(1, Math.ceil(players.length / 10));
  if (!Number.isInteger(page) || page < 0 || page >= pages) throw new Error('Invalid Top 100 page.');
  const label = kind === 'weekly' ? 'Weekly Top 100' : 'Yearly Top 100';
  const lines = players.slice(page * 10, page * 10 + 10).map((player, index) => {
    const grade = kind === 'weekly' ? player.grade : player.seasonGrade;
    const lineProxy = ['LT', 'LG', 'C', 'RG', 'RT'].includes(player.position) ? ' · team OL proxy' : '';
    return `**${page * 10 + index + 1}. ${player.name}** · ${player.position} · ${Number(grade).toFixed(1)}\n${formatTeamLabelWithEmoji(player.team || 'Unknown Team')}${kind === 'season' ? ` · ${player.appearances} weekly appearances` : ''}${lineProxy}`;
  });
  const embed = new EmbedBuilder().setTitle(label).setColor(0x5865f2)
    .setDescription(lines.join('\n\n') || 'No qualifying players.')
    .setFooter({ text: `${report.seasonKey.replace('year_', 'Season ')}${kind === 'weekly' ? ` · Week ${Number(report.latestWeek) + 1}` : ''} · Page ${page + 1}/${pages}` });
  const files = applyEmbedThumbnailFromAsset(embed, [], getLeagueBuddyBrandAsset({ attachmentName: 'dynasty_gm_logo.png' }));
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`top100_board|${kind}|${report.seasonKey}|${Math.max(0, page - 1)}`)
      .setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(`top100_board|${kind}|${report.seasonKey}|${Math.min(pages - 1, page + 1)}`)
      .setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(page === pages - 1),
  );
  return { embeds: [embed], components: [buttons], files };
}

export function buildAllProEmbeds(report) {
  const positions = buildAllProTeams(report.seasonTop100);
  return ['first', 'second'].map((team, index) => new EmbedBuilder()
    .setTitle(`${index === 0 ? 'First' : 'Second'} Team All-Pro`)
    .setColor(index === 0 ? 0xf1c40f : 0x95a5a6)
    .setDescription(positions.map(({ position, ...players }) => {
      const player = players[team];
      return player ? `**${position}** · ${player.name} · ${formatTeamLabelWithEmoji(player.team || 'Unknown Team')} · ${player.seasonGrade.toFixed(1)}` : `**${position}** · No qualifying player`;
    }).join('\n'))
    .setFooter({ text: `${report.seasonKey.replace('year_', 'Season ')} · Yearly Top 100 · OL grades use team proxies` }));
}

async function publishBoards({ client, guildId, snapshot }) {
  const info = snapshot?.info?.careerHubInfo?.seasonInfo || {};
  const type = Number(info.seasonWeekType);
  if (![1, 2, 3, 8].includes(type)) return { posted: false, reason: 'Regular season has not started.' };
  const year = Number(info.calendarYear ?? snapshot?.info?.calendarYear ?? snapshot?.calendarYear);
  if (!Number.isInteger(year) || year <= 0) throw new Error('Top 100 requires a season year.');
  const currentWeek = Number(snapshot.currentWeek);
  if (type === 1 && (!Number.isInteger(currentWeek) || currentWeek < 2)) return { posted: false, reason: 'No completed regular-season week.' };
  const cap = type === 1 ? Math.min(17, currentWeek - 2) : 17;
  const latest = getLatestReliableRegularSeasonWeekIndex(snapshot, cap);
  if (latest == null || latest < 0) return { posted: false, reason: 'No reliable completed regular-season stats.' };
  const leagueId = safeId(snapshot.leagueId);
  const seasonKey = getMaddenSeasonKey(snapshot);
  let report;
  try {
    report = await loadTop100Report(leagueId, seasonKey);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    report = { leagueId, seasonKey, weeks: {}, latestWeek: null, seasonTop100: null };
  }
  const weekIndexes = [...new Set((snapshot.weeklyStats || [])
    .filter((entry) => Number(entry.stage ?? entry.stageIndex ?? 0) === 1)
    .map((entry) => Number(entry.weekIndex))
    .filter((index) => Number.isInteger(index) && index >= 0 && index <= latest))].sort((a, b) => a - b);
  for (const index of weekIndexes) {
    if (report.weeks[String(index)] && index !== latest) continue;
    if (getLatestReliableRegularSeasonWeekIndex(snapshot, index) !== index) continue;
    const result = computeWeeklyList(snapshot, index);
    if (Array.isArray(result?.top100) && result.top100.length) report.weeks[String(index)] = result.top100;
  }
  if (!report.weeks[String(latest)]?.length) throw new Error('Latest completed week has no graded players.');
  report.latestWeek = latest;
  const seasonEnded = type !== 1 || currentWeek >= 19;
  const missingWeeks = Array.from({ length: 18 }, (_, index) => index).filter((index) => !report.weeks[String(index)]?.length);
  if (seasonEnded && !missingWeeks.length) report.seasonTop100 = calculateSeasonTop100(report.weeks);
  await saveReport(report);
  const boards = [['Weekly Top 100', 'weekly_top100', 'Weekly Top 100', buildTop100Page(report, 'weekly')]];
  if (report.seasonTop100) {
    boards.push(['Yearly Top 100', 'yearly_top100', 'Yearly Top 100', buildTop100Page(report, 'season')]);
    const embeds = buildAllProEmbeds(report);
    const files = applyEmbedThumbnailFromAsset(embeds[0], [], getLeagueBuddyBrandAsset({ attachmentName: 'dynasty_gm_logo.png' }));
    boards.push(['All-Pro Teams', 'all_pro_teams', 'First Team All-Pro', { embeds, components: [], files }]);
  }
  for (const [channelKey, pinKey, matchTitle, payload] of boards) {
    const channelId = getMaddenChannelId(channelKey, guildId);
    if (!channelId) throw new Error(`${channelKey} channel is not configured. Run /setup and create Franchise HQ again.`);
    const channel = await client.channels.fetch(channelId);
    await ensureBoardPinMessage(channel, { pinKey, guildId, matchTitle, payload });
  }
  return { posted: true, weekNumber: latest + 1, seasonPosted: Boolean(report.seasonTop100), missingWeeks: seasonEnded ? missingWeeks.map((index) => index + 1) : [] };
}

export async function publishTop100Boards(options) {
  const key = `${safeId(options.guildId)}:${safeId(options.snapshot?.leagueId)}`;
  if (activePublications.has(key)) return activePublications.get(key);
  const publication = publishBoards(options);
  activePublications.set(key, publication);
  try {
    return await publication;
  } finally {
    activePublications.delete(key);
  }
}
