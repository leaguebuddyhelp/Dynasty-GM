import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { resolveLeagueIdWithConfig, loadLeagueSnapshot } from '../../../madden/madden_data.js';
import { getFullTeamName } from '../../shared/madden_team_names.js';
import { getMaddenSeasonKey } from '../../shared/madden_metadata.js';
import { updateFairSimBoard } from '../../shared/fairsim_board.js';
import {
  ensureStrikeSeason,
  loadStrikeStore,
  saveStrikeStore,
  strikeWeight,
} from '../../shared/madden_strikes.js';
import { loadRoleMapForGuild } from './staffUtils.js';

function normalizeKey(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function loadSnapshotForGuild(guildId) {
  const leagueId = resolveLeagueIdWithConfig(guildId);
  if (!leagueId) return null;
  try {
    return loadLeagueSnapshot(leagueId);
  } catch {
    return null;
  }
}

function getTeamChoices(snapshot) {
  const teams = snapshot?.teams?.leagueTeamInfoList || [];
  return teams
    .map((team) => getFullTeamName(team, '').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function findCoachRole(guild, roleMap, teamName) {
  const base = String(teamName || '').trim();
  const candidates = [
    `${base} Coach`,
    base,
  ];
  for (const candidate of candidates) {
    const roleId = roleMap[candidate];
    if (roleId) {
      const byId = guild.roles.cache.get(roleId);
      if (byId) return byId;
    }
  }
  const target = `${base} Coach`;
  return guild.roles.cache.find((role) => normalizeKey(role.name) === normalizeKey(target)) || null;
}

function setSeededStrikeState(seasonData, userId, {
  fairSimCount,
  forceWinCount,
  determinedStrikeCount,
  respondedWeeks,
  silentWeeks,
  consecutiveSilentWeeks,
  completedGames,
} = {}) {
  const key = String(userId);
  const fair = Number(fairSimCount) || 0;
  const force = Number(forceWinCount) || 0;
  const determined = Number(determinedStrikeCount) || 0;
  const totalCount = fair + force + determined;
  const weighted = Number((fair * strikeWeight('fair_sim')) + (force * strikeWeight('force_win')) + (determined * strikeWeight('determined_strike')));

  seasonData.counts[key] = totalCount;
  seasonData.weightedCounts[key] = Math.round(weighted * 10) / 10;
  seasonData.consecutive[key] = silentWeeks > 0 ? 1 : 0;
  seasonData.categories[key] = {};
  if (fair > 0) seasonData.categories[key].fair_sim = fair;
  if (force > 0) seasonData.categories[key].force_win = force;
  if (determined > 0) seasonData.categories[key].determined_strike = determined;

  seasonData.communication[key] = {
    respondedWeeks: Number(respondedWeeks) || 0,
    silentWeeks: Number(silentWeeks) || 0,
    consecutiveSilentWeeks: Number(consecutiveSilentWeeks) || 0,
    onTimeOutcomes: Number(completedGames) || 0,
    completedGames: Number(completedGames) || 0,
    nonPlayOutcomes: totalCount,
    faultOutcomes: force + determined,
    history: [
      {
        kind: 'seed',
        type: 'demo_seed',
        label: 'SEED',
        weight: Math.round(weighted * 10) / 10,
        ts: Date.now(),
      },
    ],
  };
}

export const data = new SlashCommandBuilder()
  .setName('seedstrikes')
  .setDescription('Admin-only: seed strike-board demo data for a team coach role.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((o) =>
    o.setName('team')
      .setDescription('Team to seed')
      .setRequired(true)
      .setAutocomplete(true))
  .addIntegerOption((o) =>
    o.setName('fair_sims')
      .setDescription('Fair sim count (0.5 each)')
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(10))
  .addIntegerOption((o) =>
    o.setName('force_wins')
      .setDescription('Force win count (1.0 each)')
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(10))
  .addIntegerOption((o) =>
    o.setName('determined_strikes')
      .setDescription('Determined strike count (1.5 each)')
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(10))
  .addIntegerOption((o) =>
    o.setName('responded_weeks')
      .setDescription('Weeks with thread response')
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(20))
  .addIntegerOption((o) =>
    o.setName('silent_weeks')
      .setDescription('Weeks without thread response')
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(20))
  .addIntegerOption((o) =>
    o.setName('consecutive_silent')
      .setDescription('Current straight silent-week streak')
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(20))
  .addIntegerOption((o) =>
    o.setName('completed_games')
      .setDescription('Completed games used for the played percentage')
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(20));

export const deferOnDispatch = { flags: 64 };

export async function execute(interaction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.editReply({ content: 'This command can only be used in a server.' });
    return;
  }

  const snapshot = loadSnapshotForGuild(guildId);
  if (!snapshot) {
    await interaction.editReply({ content: 'No synced league snapshot was found for this server. Run `/connectleague` and sync first.' });
    return;
  }

  const teamName = interaction.options.getString('team', true);
  const roleMap = loadRoleMapForGuild(guildId);
  const coachRole = findCoachRole(interaction.guild, roleMap, teamName);
  if (!coachRole) {
    await interaction.editReply({ content: `No coach role was found for **${teamName}**. Run \`/setup-roles\` first.` });
    return;
  }

  const members = [...coachRole.members.values()];
  if (!members.length) {
    await interaction.editReply({
      content: `**${coachRole.name}** has no members. Add yourself or a test user to that role first, then rerun this command.`,
    });
    return;
  }

  const fairSimCount = interaction.options.getInteger('fair_sims') ?? 0;
  const forceWinCount = interaction.options.getInteger('force_wins') ?? 0;
  const determinedStrikeCount = interaction.options.getInteger('determined_strikes') ?? 0;
  const respondedWeeks = interaction.options.getInteger('responded_weeks') ?? 0;
  const silentWeeks = interaction.options.getInteger('silent_weeks') ?? 0;
  const consecutiveSilentWeeks = interaction.options.getInteger('consecutive_silent') ?? 0;
  const completedGames = interaction.options.getInteger('completed_games') ?? 0;

  const store = loadStrikeStore();
  const seasonKey = getMaddenSeasonKey(snapshot);
  const seasonData = ensureStrikeSeason(store, seasonKey);

  for (const member of members) {
    setSeededStrikeState(seasonData, member.id, {
      fairSimCount,
      forceWinCount,
      determinedStrikeCount,
      respondedWeeks,
      silentWeeks,
      consecutiveSilentWeeks,
      completedGames,
    });
  }

  saveStrikeStore(store);
  try {
    await updateFairSimBoard(interaction.client, guildId);
  } catch (error) {
    await interaction.editReply({
      content: `Seeded strike data for **${teamName}**, but the board refresh failed: ${error?.message || error}`,
    });
    return;
  }

  const weighted = Math.round(((fairSimCount * strikeWeight('fair_sim')) + (forceWinCount * strikeWeight('force_win')) + (determinedStrikeCount * strikeWeight('determined_strike'))) * 10) / 10;
  await interaction.editReply({
    content: [
      `Seeded strike data for **${teamName}**.`,
      `Role: **${coachRole.name}**`,
      `Members updated: **${members.length}**`,
      `Weighted total: **${weighted}/5**`,
      `Breakdown: FS ${fairSimCount} • FW ${forceWinCount} • DS ${determinedStrikeCount}`,
    ].join('\n'),
  });
}

export async function autocomplete(interaction) {
  const snapshot = loadSnapshotForGuild(interaction.guildId);
  const focused = interaction.options.getFocused();
  const focusedNormalized = normalizeKey(focused);
  const choices = getTeamChoices(snapshot)
    .filter((teamName) => !focusedNormalized || normalizeKey(teamName).includes(focusedNormalized))
    .slice(0, 25)
    .map((teamName) => ({ name: teamName, value: teamName }));
  try {
    await interaction.respond(choices);
  } catch (error) {
    console.warn('[seedstrikes autocomplete] respond failed:', error?.message || error);
  }
}

export default { data, execute, autocomplete };
