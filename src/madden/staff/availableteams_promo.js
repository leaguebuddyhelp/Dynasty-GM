import { SlashCommandBuilder } from 'discord.js';
import { resolveLeagueIdWithConfig, loadLeagueSnapshot } from '../../../madden/madden_data.js';
import { getFullTeamName } from '../../shared/madden_team_names.js';
import { getCoachAssignmentMap } from '../../shared/madden_coach_assignments.js';
import { hasStaffRole, loadRoleMapForGuild } from './staffUtils.js';
import { getMessageForWeek } from '../madden_utils.js';

const DEFAULT_PROMO_INVITE_URL = process.env.LB_PROMO_INVITE_URL || 'https://discord.gg/VHB7UXttwB';

function safeEditReply(interaction, payload) {
  return interaction.editReply(payload).catch(async (err) => {
    if ([50027, 10015, 10062].includes(err?.code) && interaction.channel?.isTextBased()) {
      return interaction.channel.send(typeof payload === 'string' ? payload : { ...payload, ephemeral: false });
    }
    throw err;
  });
}

function normalizeName(name) {
  if (!name) return name;
  const lower = name.toLowerCase();
  if (lower === 'g-men' || lower === 'gmen') return 'Giants';
  if (lower === 'jags') return 'Jaguars';
  if (lower === 'vikes' || lower === 'vikings') return 'Vikings';
  if (lower === 'fins' || lower === 'fins up' || lower === 'phins' || lower === 'dolphins') return 'Dolphins';
  if (lower === 'bucs' || lower === 'buccs') return 'Buccaneers';
  if (lower === 'pats') return 'Patriots';
  if (lower === 'bolts') return 'Chargers';
  if (lower === 'pack') return 'Packers';
  return name;
}

function resolveRoleId(team, roleMap) {
  const nick = normalizeName(team?.displayName) || normalizeName(team?.nickName) || '';
  const city = team?.cityName || '';
  const abbr = team?.abbrName || team?.teamAbbr || '';
  const mascot = (nick || '').split(/\s+/).pop();
  const normalizeKey = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const roleEntries = Object.entries(roleMap || {})
    .filter(([k]) => /coach$/i.test(k))
    .map(([k, v]) => ({ norm: normalizeKey(k), id: v }));

  const candidates = [
    `${nick} Coach`,
    `${city} ${nick} Coach`,
    `${normalizeName(city)} ${nick} Coach`,
    `${abbr} Coach`,
    `${mascot} Coach`,
  ].filter(Boolean);

  for (const c of candidates) {
    const norm = normalizeKey(c);
    const found = roleEntries.find(r => r.norm === norm || r.norm.includes(norm) || norm.includes(r.norm));
    if (found) return found.id;
  }
  return null;
}

async function buildRoleCounts(interaction) {
  // Best effort: build a roleId -> memberCount map from a single member fetch.
  // This is more reliable than fetching roles one-by-one mid-loop.
  try {
    const members = await interaction.guild.members.fetch();
    const roleCounts = {};
    members.forEach(m => {
      m.roles.cache.forEach(r => {
        roleCounts[r.id] = (roleCounts[r.id] || 0) + 1;
      });
    });
    return roleCounts;
  } catch (e) {
    console.warn('[madden-promo] member fetch skipped:', e?.message || e);
    return null;
  }
}

async function fetchGuildMembers(interaction) {
  try {
    return await interaction.guild.members.fetch();
  } catch (e) {
    console.warn('[madden-promo] member fetch skipped:', e?.message || e);
    return null;
  }
}

function hasActiveAssignedMember(assignedTeams, teamName, members) {
  const assignedUserIds = assignedTeams.get(normalizeKey(teamName)) || new Set();
  if (!assignedUserIds.size) return false;
  if (!members) return true;
  return [...assignedUserIds].some((userId) => members.has(String(userId)));
}

function buildRoleCountsFromMembers(members) {
  if (!members) return null;
  const roleCounts = {};
  members.forEach(m => {
    m.roles.cache.forEach(r => {
      roleCounts[r.id] = (roleCounts[r.id] || 0) + 1;
    });
  });
  return roleCounts;
}

function formatTeamName(team) {
  return getFullTeamName(team, `Team ${team?.teamId}`);
}

function normalizeKey(name = '') {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return null;
}

function currentWeekNumber(snapshot, seasonInfo = {}) {
  const displayWeek = firstPositiveNumber(seasonInfo.displayWeek, snapshot?.currentWeek);
  if (displayWeek) return displayWeek;
  const zeroBased = Number(seasonInfo.seasonWeek ?? seasonInfo.weekIndex);
  if (Number.isFinite(zeroBased) && zeroBased >= 0) return zeroBased + 1;
  return 1;
}

function promoSeasonLabel(snapshot, seasonInfo = {}) {
  const seasonNumber = seasonInfo.seasonNumber ?? seasonInfo.seasonIndex ?? seasonInfo.calendarYear ?? snapshot?.calendarYear ?? '–';
  const stage = Number(seasonInfo.seasonWeekType ?? seasonInfo.seasonWeekTypeId ?? snapshot?.stage ?? 1);
  const offSeasonStage = Number(seasonInfo.offSeasonStage || 0);
  const seasonTitle = String(seasonInfo.seasonTitle || '').trim();
  const week = currentWeekNumber(snapshot, seasonInfo);

  let phaseLabel;
  if (offSeasonStage > 0 || stage === 8 || seasonTitle.toLowerCase().includes('offseason')) {
    phaseLabel = `Offseason Stage ${offSeasonStage || 1}`;
  } else if (stage === 0) {
    phaseLabel = `Preseason Week ${Math.max(1, week)}`;
  } else if (stage === 2 || week >= 19) {
    phaseLabel = getMessageForWeek(week, 2, 0);
  } else {
    phaseLabel = `Regular Season Week ${Math.max(1, week)}`;
  }

  return `Season ${seasonNumber} • ${phaseLabel}`;
}

export const data = new SlashCommandBuilder()
  .setName('promo')
  .setDescription('Staff: Post promo + currently available Madden teams.')
  .addBooleanOption(o =>
    o.setName('link')
      .setDescription('Include the public join link at the bottom')
      .setRequired(false)
  )
  .setDefaultMemberPermissions(null);

export async function execute(interaction) {
  try {
    await interaction.deferReply({ ephemeral: false });
  } catch {
    // if already acknowledged, continue
  }
  try {
    const roleMap = loadRoleMapForGuild(interaction.guildId);
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

    const includeLink = interaction.options.getBoolean('link') ?? false;

    const assignmentMap = getCoachAssignmentMap({ guildId: interaction.guildId });
    const assignedTeams = assignmentMap?.teamToUserIds || new Map();

    const snapshot = loadLeagueSnapshot(leagueId);
    const seasonInfo = snapshot?.info?.careerHubInfo?.seasonInfo || {};
    const debug = process.env.MOCK_DEBUG === 'true';
    if (debug) {
      console.log('[promo] seasonInfo', seasonInfo);
    }
    const teams = snapshot?.teams?.leagueTeamInfoList || [];
    const standings = snapshot?.standings?.teamStandingInfoList || [];
    const standingsByTeam = new Map();
    standings.forEach(s => standingsByTeam.set(s.teamId, s));

    const guildMembers = await fetchGuildMembers(interaction);
    const roleCounts = buildRoleCountsFromMembers(guildMembers) || await buildRoleCounts(interaction);

    const openLines = [];
    for (const t of teams) {
      const roleId = resolveRoleId(t, roleMap);
      let assigned = false;
      const teamName = formatTeamName(t);
      if (hasActiveAssignedMember(assignedTeams, teamName, guildMembers)) {
        assigned = true;
      }
      if (roleId) {
        let count = (roleCounts && typeof roleCounts[String(roleId)] === 'number') ? roleCounts[String(roleId)] : undefined;
        if (count === undefined) {
          const cachedRole = interaction.guild.roles.cache.get(String(roleId))
            || await interaction.guild.roles.fetch(String(roleId)).catch(() => null);
          count = cachedRole?.members ? cachedRole.members.size : 0;
        }
        assigned = assigned || count > 0;
      }
      if (assigned) continue;
      const rec = standingsByTeam.get(t.teamId);
      const wins = rec?.totalWins ?? rec?.wins ?? 0;
      const losses = rec?.totalLosses ?? rec?.losses ?? 0;
      const ties = rec?.totalTies ?? rec?.ties ?? 0;
      const record = ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
      openLines.push(`${teamName} - ${record}`);
    }

    const promoLines = [
      '🏈 **LEAGUEbuddy Madden**',
      '**STARTING FROM SUPER BOWL / OFFSEASON**',
      promoSeasonLabel(snapshot, seasonInfo),
      '',
      'A cleaner Discord home for connected franchise leagues.',
      '',
      '🧰 **League Tools**',
      '• Live standings, schedules, stats, awards, and weekly updates',
      '• Auto game threads, reminders, stream links, and staff logs',
      '• Scouting hub, draft primer, mock draft, big board, and matchup prep',
      '• Premium adds recognition points, sportsbook, perks, and deeper engagement',
      '',
      `📋 **Open Teams (${openLines.length})**`,
      (openLines.length
        ? openLines.map(l => `• ${l}`).join('\n')
        : 'No open teams right now.'),
      includeLink ? `\n**Join:** ${DEFAULT_PROMO_INVITE_URL}` : null,
    ].filter(Boolean).join('\n');

    await safeEditReply(interaction, { content: promoLines });
  } catch (err) {
    console.error('[madden-promo] failed', err);
    const msg = 'There was an error building the promo. Please try again after a sync.';
    if (interaction.deferred || interaction.replied) {
      await safeEditReply(interaction, { content: msg });
    } else {
      await interaction.reply({ content: msg, ephemeral: true }).catch(() => { });
    }
  }
}

export default { data, execute };
