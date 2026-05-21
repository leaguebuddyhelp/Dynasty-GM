import { SlashCommandBuilder } from 'discord.js';
import { resolveLeagueIdWithConfig, loadLeagueSnapshot } from '../../../madden/madden_data.js';
import { getMaddenSnapshotContext } from '../../shared/madden_metadata.js';
import { awardRecognitionPoints, getRecognitionUserSummary } from '../../shared/league_recognition.js';
import { loadRoleMapForGuild } from './staffUtils.js';

const COMMISH_ROLE_NAMES = ['LB Commish', 'LB Co-Commish'];
const VALID_TIERS = new Set(['activity', 'impact', 'legacy']);

export const data = new SlashCommandBuilder()
  .setName('points')
  .setDescription('Staff: quickly award Activity, Impact, or Legacy points.')
  .setDefaultMemberPermissions(null)
  .addUserOption((option) =>
    option
      .setName('user')
      .setDescription('Coach receiving the points')
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName('tier')
      .setDescription('Point type to award')
      .setRequired(true)
      .addChoices(
        { name: 'Activity', value: 'activity' },
        { name: 'Impact', value: 'impact' },
        { name: 'Legacy', value: 'legacy' },
      ),
  )
  .addIntegerOption((option) =>
    option
      .setName('amount')
      .setDescription('Number of points to add')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(100),
  )
  .addStringOption((option) =>
    option
      .setName('reason')
      .setDescription('Optional reason shown in recognition history')
      .setRequired(false)
      .setMaxLength(160),
  );

export const deferOnDispatch = { flags: 64 };

function hasCommishRole(member, roleMap = {}) {
  const ids = COMMISH_ROLE_NAMES.map((name) => roleMap?.[name]).filter(Boolean);
  if (ids.length && member?.roles?.cache) {
    return ids.some((id) => member.roles.cache.has(id));
  }
  return member?.roles?.cache?.some((role) => COMMISH_ROLE_NAMES.includes(role.name)) ?? false;
}

function balancesFromState(userState = {}) {
  const spent = userState.spent || {};
  return {
    activity: Math.max(0, Number(userState.activity || 0) - Number(spent.activity || 0)),
    impact: Math.max(0, Number(userState.impact || 0) - Number(spent.impact || 0)),
    legacy: Math.max(0, Number(userState.legacy || 0) - Number(spent.legacy || 0)),
  };
}

export async function execute(interaction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.editReply({ content: 'This command can only be used in a server.' });
    return;
  }

  const roleMap = loadRoleMapForGuild(guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => interaction.member);
  if (!hasCommishRole(member, roleMap)) {
    await interaction.editReply({ content: 'Only LB Commish or LB Co-Commish can use `/points`.' });
    return;
  }

  const targetUser = interaction.options.getUser('user', true);
  const tier = interaction.options.getString('tier', true);
  const amount = interaction.options.getInteger('amount', true);
  const reason = String(interaction.options.getString('reason') || '').trim();

  if (!VALID_TIERS.has(tier)) {
    await interaction.editReply({ content: 'Choose Activity, Impact, or Legacy.' });
    return;
  }

  let leagueId;
  let snapshot;
  try {
    leagueId = resolveLeagueIdWithConfig(guildId, 'staff:points');
    snapshot = loadLeagueSnapshot(leagueId);
  } catch {
    await interaction.editReply({ content: 'No Madden league is connected yet. Run `/setup` first.' });
    return;
  }

  const context = getMaddenSnapshotContext(guildId, { leagueId, snapshot });
  if (!context?.seasonKey) {
    await interaction.editReply({ content: 'Could not resolve the current Madden season for this award.' });
    return;
  }

  const awardReason = reason || `Manual ${tier} point award`;
  const state = awardRecognitionPoints({
    guildId,
    league: 'madden',
    seasonKey: context.seasonKey,
    userId: targetUser.id,
    tier,
    amount,
    reason: `Staff award: ${awardReason}`,
    weekKey: context.weekKey || null,
  });

  if (!state) {
    await interaction.editReply({ content: 'Could not award points. Check the league connection and try again.' });
    return;
  }

  const summary = getRecognitionUserSummary({
    guildId,
    league: 'madden',
    seasonKey: context.seasonKey,
    userId: targetUser.id,
    weekKey: context.weekKey || null,
  });
  const balances = balancesFromState(summary?.userState || state);

  await interaction.editReply({
    content: [
      `Awarded **+${amount} ${tier}** to ${targetUser}.`,
      `Reason: ${awardReason}`,
      `Current balances: Activity **${balances.activity}** • Impact **${balances.impact}** • Legacy **${balances.legacy}**`,
    ].join('\n'),
    allowedMentions: { users: [] },
  });
}

export default { data, execute };
