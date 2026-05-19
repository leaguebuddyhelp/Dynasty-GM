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
