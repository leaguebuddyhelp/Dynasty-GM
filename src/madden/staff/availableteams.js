import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { resolveLeagueIdWithConfig, loadLeagueSnapshot } from '../../../madden/madden_data.js';
import { draftOrder, applyPickTrades } from '../coach/mockdraft.js';
import { deriveTeamNeeds } from '../coach/mockdraft.js';
import { getFullTeamName } from '../../shared/madden_team_names.js';
import { loadMaddenChannelMap } from '../../shared/madden_metadata.js';
import { getGuildRoleMap } from '../../shared/madden_guild_config.js';
import { getTeamEmojiByName } from '../../shared/madden_visuals.js';
import { buildMaddenTeamAvailability } from '../../shared/madden_team_availability.js';

const AVP_FILE = path.join(process.cwd(), 'data', 'madden', 'madden_avp.json');

const ROLE_MAP_FILE = path.join(process.cwd(), 'data', 'madden', 'madden_role_ids.json');
const STAFF_ROLES = ['LB Commish', 'LB Co-Commish', 'Ghost Legacy Commish', 'Ghost Legacy Co-Commish'];
// Specific fallback pin/message id provided by user
const FALLBACK_PIN_ID = '1469153107207393465';

async function safeEditReply(interaction, payload) {
  try {
    await interaction.editReply(payload);
  } catch (err) {
    if ([50027, 10015, 10062].includes(err?.code) && interaction.channel?.isTextBased()) {
      await interaction.channel.send(typeof payload === 'string' ? payload : { ...payload, ephemeral: false });
      return;
    }
    throw err;
  }
}

function loadRoleMap(guildId = null) {
  const overlay = getGuildRoleMap(guildId);
  if (overlay && Object.keys(overlay).length) return overlay;
  try {
    const raw = fs.readFileSync(ROLE_MAP_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function loadChannelMap(guildId = null) {
  return loadMaddenChannelMap(guildId);
}

function safeReadJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function seasonWeekLabel(snapshot) {
  const seasonInfo = snapshot?.info?.careerHubInfo?.seasonInfo || {};

  // Madden exports are inconsistent: sometimes seasonNumber is missing, sometimes seasonIndex is 0-based,
  // sometimes only a year-like value is present. We always want a human-friendly "Season N".
  const rawSeason =
    seasonInfo?.seasonNumber ??
    seasonInfo?.seasonIndex ??
    seasonInfo?.season ??
    seasonInfo?.currentSeason;

  let seasonNum = Number.isFinite(Number(rawSeason)) ? Number(rawSeason) : null;
  if (seasonNum != null && seasonNum >= 0 && seasonNum < 50) {
    // If it looks like a 0-based index (common), display it as 1-based.
    if (seasonNum === 0 || (seasonInfo?.seasonNumber == null && seasonInfo?.seasonIndex != null)) {
      seasonNum += 1;
    }
  } else {
    seasonNum = null;
  }

  // As a last resort, infer season from calendarYear if it looks reasonable (e.g. 2026 -> Season 2).
  if (seasonNum == null) {
    const calYear = Number(seasonInfo?.calendarYear ?? snapshot?.info?.calendarYear ?? snapshot?.calendarYear);
    if (Number.isFinite(calYear) && calYear >= 2000 && calYear <= 2100) {
      // Assumption: league started in 2025 (Season 1). If this isn't true for a league, we'll still
      // show at least a season number rather than blank.
      seasonNum = Math.max(1, calYear - 2024);
    }
  }

  const seasonPart = seasonNum != null ? `Season ${seasonNum}` : 'Season';

  const displayWeek = seasonInfo?.displayWeek ?? seasonInfo?.seasonWeek;
  const weekPart = displayWeek != null && Number(displayWeek) > 0 ? `Week ${displayWeek}` : null;

  const offStage = seasonInfo?.offSeasonStage;
  const offPart = offStage != null ? `Offseason Stage ${offStage}` : 'Offseason';

  const seasonWeekType = Number(seasonInfo?.seasonWeekType ?? seasonInfo?.seasonWeekTypeId ?? 1);
  const isOffseason = seasonWeekType === 8 || (seasonInfo?.seasonTitle || '').toLowerCase().includes('offseason');
  return isOffseason
    ? `${seasonPart} — ${offPart}`
    : weekPart
      ? `${seasonPart} — ${weekPart}`
      : seasonPart;
}

function loadAvp() {
  const avp = safeReadJSON(AVP_FILE, null);
  if (!avp?.prospects) return null;
  return avp;
}

function buildAvpPreview({ avp, earliestPickNum, limit = 5, needs = [] }) {
  if (!avp || !earliestPickNum) return null;
  const needSet = new Set((needs || []).slice(0, 3).map((n) => String(n).toUpperCase()));
  const items = Object.entries(avp.prospects || {})
    .map(([id, row]) => ({ id, ...row }))
    .filter((row) => Number.isFinite(row?.avp) && row.avp)
    // likely available at or after this pick
    .filter((row) => Number(row.avp) >= Number(earliestPickNum) - 0.75)
    .sort((a, b) => Number(a.avp) - Number(b.avp) || Number(a.boardRank || 9999) - Number(b.boardRank || 9999))
    .slice(0, 60);

  if (!items.length) return null;

  const boosted = items
    .slice()
    .sort((a, b) => {
      const aNeed = needSet.has(String(a.position || '').toUpperCase()) ? -1 : 0;
      const bNeed = needSet.has(String(b.position || '').toUpperCase()) ? -1 : 0;
      return aNeed - bNeed || (Number(a.avp) - Number(b.avp)) || (Number(a.boardRank || 9999) - Number(b.boardRank || 9999));
    })
    .slice(0, limit);

  return boosted.map((p) => {
    const pos = String(p.position || '').toUpperCase();
    const needStar = needSet.has(pos) ? '⭐ ' : '';
    const avpPick = Number(p.avp).toFixed(1);
    return `${needStar}${pos} ${p.name} (AVP ${avpPick})`;
  }).join(' • ');
}

function hasStaffRole(member, roleMap) {
  const roleIds = STAFF_ROLES.map((name) => roleMap?.[name]).filter(Boolean);
  if (roleIds.length && member?.roles?.cache) {
    return roleIds.some((id) => member.roles.cache.has(String(id)));
  }
  return member?.roles?.cache?.some((role) => STAFF_ROLES.includes(role.name)) ?? false;
}

function formatTeamName(team) {
  return getFullTeamName(team, `Team ${team?.teamId}`);
}

function teamEmoji(team) {
  const fullName = formatTeamName(team);
  const emoji = getTeamEmojiByName(fullName);
  return emoji ? `${emoji} ` : '';
}

function normalizeKey(name = '') {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildPickMap(snapshot) {
  if (!snapshot) return new Map();
  let order = [];
  try {
    const seasonYear =
      snapshot?.info?.careerHubInfo?.seasonInfo?.calendarYear ||
      snapshot?.info?.calendarYear ||
      snapshot?.calendarYear;
    order = applyPickTrades(draftOrder(snapshot), seasonYear);
  } catch { return new Map(); }
  const map = new Map();
  order.forEach((pick, idx) => {
    const ownerName = pick.name || pick.nick || '';
    const keys = [
      normalizeKey(ownerName),
      normalizeKey(ownerName.split(/\s+/).pop() || ownerName),
    ].filter(Boolean);
    if (!keys.length) return;
    const entry = { num: idx + 1, via: pick.via };
    keys.forEach(k => {
      const list = map.get(k) || [];
      list.push(entry);
      map.set(k, list);
    });
  });
  return map;
}

function buildRecordMap(snapshot) {
  const standings = snapshot?.standings?.teamStandingInfoList || [];
  const map = new Map();
  for (const row of standings) {
    const teamId = Number(row?.teamId);
    if (!Number.isFinite(teamId)) continue;
    const w = Number(row?.totalWins ?? row?.wins ?? 0) || 0;
    const l = Number(row?.totalLosses ?? row?.losses ?? 0) || 0;
    const t = Number(row?.totalTies ?? row?.ties ?? 0) || 0;
    map.set(teamId, { w, l, t });
  }
  return map;
}

function formatRecord(rec) {
  if (!rec) return '';
  const w = Number(rec.w ?? 0) || 0;
  const l = Number(rec.l ?? 0) || 0;
  const t = Number(rec.t ?? 0) || 0;
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}

function uniqPicks(picks = []) {
  const seen = new Set();
  const out = [];
  for (const p of picks) {
    const key = `${p.num}|${p.via || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

async function execute(interaction) {
  await interaction.deferReply({ ephemeral: false });
  const roleMap = loadRoleMap(interaction.guildId);
  const channelMap = loadChannelMap(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!hasStaffRole(member, roleMap)) {
    await safeEditReply(interaction, { content: 'Only LB Commish/Co-Commish can use this command.' });
    return;
  }

  const leagueId = resolveLeagueIdWithConfig(interaction.guildId);
  if (!leagueId) {
    await safeEditReply(interaction, { content: 'No league is connected yet. Run `/setup` and press Open Setup Dashboard.' });
    return;
  }

  try {
    const snapshot = loadLeagueSnapshot(leagueId);
    const teams = snapshot?.teams?.leagueTeamInfoList || [];
    const standings = snapshot?.standings?.teamStandingInfoList || [];
    const seasonInfo = snapshot?.info?.careerHubInfo?.seasonInfo || {};
        const recordMap = buildRecordMap(snapshot);
        const availability = await buildMaddenTeamAvailability({
      guild: interaction.guild,
      guildId: interaction.guildId,
      teams,
      roleMap,
    });
    const availabilityByTeam = new Map(
      availability.rows.map((row) => [normalizeKey(row.teamName), row]),
    );

    const lines = [];
    const phaseLabel = seasonWeekLabel(snapshot);
    for (const t of teams) {
      const availabilityRow = availabilityByTeam.get(normalizeKey(formatTeamName(t)));
      if (availabilityRow?.assigned) continue;
      const prefix = teamEmoji(t);
      const rec = recordMap.get(Number(t?.teamId));
      const recText = rec ? formatRecord(rec) : '0-0';
      lines.push(`${prefix}${formatTeamName(t)} - ${recText}`);
    }

    const embed = new EmbedBuilder()
      .setTitle('Madden Available Teams')
      .setDescription([
        phaseLabel,
        '',
        lines.length ? lines.join('\n') : 'No open teams.',
      ].join('\n'))
      .setColor(0x00b0f4);
    await safeEditReply(interaction, { embeds: [embed] });
  } catch (err) {
    await safeEditReply(interaction, { content: `Failed to load teams: ${err.message || err}` });
  }
}

const data = new SlashCommandBuilder()
  .setName('availableteams')
  .setDescription('List unassigned teams (staff-only).')
  .setDefaultMemberPermissions(null);

export default { data, execute };
