import { SlashCommandBuilder } from 'discord.js';
import { resolveLeagueIdWithConfig, loadLeagueSnapshot } from '../../../madden/madden_data.js';
import { getFullTeamName } from '../../shared/madden_team_names.js';
import { hasStaffRole, loadRoleMapForGuild } from './staffUtils.js';
import { getMessageForWeek } from '../madden_utils.js';
import { buildMaddenTeamAvailability } from '../../shared/madden_team_availability.js';

const DEFAULT_PROMO_INVITE_URL = process.env.LB_PROMO_INVITE_URL || 'https://discord.gg/VHB7UXttwB';

function safeEditReply(interaction, payload) {
  return interaction.editReply(payload).catch(async (err) => {
    if ([50027, 10015, 10062].includes(err?.code) && interaction.channel?.isTextBased()) {
      return interaction.channel.send(typeof payload === 'string' ? payload : { ...payload, ephemeral: false });
    }
    throw err;
  });
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

function weeklyPlayerCount(entry = {}) {
  const explicit = Number(entry.playerCount ?? entry.totalPlayerCount);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  let count = 0;
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      count += value.length;
      return;
    }
    Object.values(value).forEach(visit);
  };
  visit(entry);
  return count;
}

function gameWeekIndex(game = {}) {
  const raw = Number(game.weekIndex ?? game.week ?? game.seasonWeekIndex);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  const seasonWeek = Number(game.seasonWeek);
  return Number.isFinite(seasonWeek) && seasonWeek > 0 ? seasonWeek - 1 : null;
}

function resolvePromoPhase(snapshot, seasonInfo = {}) {
  const week = currentWeekNumber(snapshot, seasonInfo);
  const weekIndex = week > 0 ? week - 1 : null;
  const rawStage = Number(seasonInfo.seasonWeekType ?? seasonInfo.seasonWeekTypeId ?? snapshot?.stage ?? 1);
  const offSeasonStage = Number(seasonInfo.offSeasonStage || 0);
  const seasonTitle = String(seasonInfo.seasonTitle || '').toLowerCase();
  const weeklyStats = Array.isArray(snapshot?.weeklyStats) ? snapshot.weeklyStats : [];
  const schedule = Array.isArray(snapshot?.schedule?.schedules) ? snapshot.schedule.schedules : [];

  const stageOneStats = weeklyStats
    .filter(entry => Number(entry?.stage ?? entry?.stageIndex ?? -1) === 1)
    .filter(entry => weeklyPlayerCount(entry) > 0);
  const latestStageOneStatWeek = stageOneStats
    .map(entry => Number(entry?.weekIndex ?? -1))
    .filter(value => Number.isFinite(value) && value >= 0 && value <= 17)
    .reduce((max, value) => Math.max(max, value), -1);

  const hasCurrentStageOneSchedule = weekIndex !== null && schedule.some(game =>
    Number(game?.stageIndex ?? game?.stage ?? -1) === 1 &&
    gameWeekIndex(game) === weekIndex
  );
  const regularSeasonLooksCurrent =
    week >= 1 &&
    week <= 18 &&
    (
      rawStage === 1 ||
      hasCurrentStageOneSchedule ||
      (latestStageOneStatWeek >= 0 && latestStageOneStatWeek <= weekIndex && latestStageOneStatWeek >= Math.max(0, weekIndex - 2))
    );

  if (regularSeasonLooksCurrent) {
    return { kind: 'regular', week, offSeasonStage: 0 };
  }
  if (rawStage === 0) {
    return { kind: 'preseason', week, offSeasonStage: 0 };
  }
  if (rawStage === 2 || week >= 19) {
    return { kind: 'playoffs', week, offSeasonStage: 0 };
  }
  if (offSeasonStage > 0 || rawStage === 8 || seasonTitle.includes('offseason')) {
    return { kind: 'offseason', week, offSeasonStage: offSeasonStage || 1 };
  }
  return { kind: 'regular', week, offSeasonStage: 0 };
}

function promoSeasonLabel(snapshot, seasonInfo = {}) {
  const seasonNumber = seasonInfo.calendarYear ?? snapshot?.info?.calendarYear ?? snapshot?.calendarYear ?? seasonInfo.seasonNumber ?? seasonInfo.seasonIndex ?? '–';
  const phase = resolvePromoPhase(snapshot, seasonInfo);

  let phaseLabel;
  if (phase.kind === 'offseason') {
    phaseLabel = `Offseason Stage ${phase.offSeasonStage || 1}`;
  } else if (phase.kind === 'preseason') {
    phaseLabel = `Preseason Week ${Math.max(1, phase.week)}`;
  } else if (phase.kind === 'playoffs') {
    phaseLabel = getMessageForWeek(phase.week, 2, 0);
  } else {
    phaseLabel = `Regular Season Week ${Math.max(1, phase.week)}`;
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

    const availability = await buildMaddenTeamAvailability({
      guild: interaction.guild,
      guildId: interaction.guildId,
      teams,
      roleMap,
    });
    const availabilityByTeam = new Map(
      availability.rows.map((row) => [normalizeKey(row.teamName), row]),
    );

    const openLines = [];
    for (const t of teams) {
      const teamName = formatTeamName(t);
      const availabilityRow = availabilityByTeam.get(normalizeKey(teamName));
      if (availabilityRow?.assigned) continue;
      const rec = standingsByTeam.get(t.teamId);
      const wins = rec?.totalWins ?? rec?.wins ?? 0;
      const losses = rec?.totalLosses ?? rec?.losses ?? 0;
      const ties = rec?.totalTies ?? rec?.ties ?? 0;
      const record = ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
      openLines.push(`${teamName} - ${record}`);
    }

    const promoLines = [
      '🏈 **LEAGUEbuddy Madden**',
      '**EVERY 24 HR SIM**',
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
