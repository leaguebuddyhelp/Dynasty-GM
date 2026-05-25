import { SlashCommandBuilder } from 'discord.js';
import { resolveLeagueIdWithConfig, loadLeagueSnapshot } from '../madden_data.js';
import { buildDraftGradesEmbed, computeDraftGrades } from '../draft_grades_auto.js';
import { loadMaddenChannelMap } from '../../shared/madden_metadata.js';
import { hasStaffRole, loadRoleMapForGuild } from './staffUtils.js';

export const data = new SlashCommandBuilder()
  .setName('draftgrades')
  .setDescription('Preview or post rookie draft grades from the current Madden export.')
  .addBooleanOption(option =>
    option
      .setName('post')
      .setDescription('Post to the Draft Grades channel instead of previewing privately.')
      .setRequired(false))
  .setDefaultMemberPermissions(null);

export const featureKey = 'scouting_draft';

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const roleMap = loadRoleMapForGuild(interaction.guildId);
  if (!member || !hasStaffRole(member, roleMap)) {
    await interaction.editReply({ content: 'Only LB Commish/Co-Commish can use this command.' });
    return;
  }

  const leagueId = resolveLeagueIdWithConfig(interaction.guildId, 'draftgrades');
  if (!leagueId) {
    await interaction.editReply({ content: 'No league is connected yet. Run `/setup` and press Open Setup Dashboard.' });
    return;
  }

  let snapshot = null;
  try {
    snapshot = loadLeagueSnapshot(leagueId);
  } catch {
    await interaction.editReply({ content: 'No current Madden export snapshot found. Run `/weeklyupdate` first.' });
    return;
  }

  const grades = computeDraftGrades(snapshot);
  if (!grades.length) {
    await interaction.editReply({ content: 'No rookie draft data found in the current export yet.' });
    return;
  }

  const embed = buildDraftGradesEmbed(grades, leagueId, snapshot);
  const shouldPost = interaction.options.getBoolean('post') === true;
  if (!shouldPost) {
    await interaction.editReply({ content: `Previewing ${grades.length} team draft grades.`, embeds: [embed] });
    return;
  }

  const channelMap = loadMaddenChannelMap(interaction.guildId);
  const channelId = channelMap['Draft Grades'] || channelMap['Draft grades'] || null;
  const channel = channelId
    ? await interaction.client.channels.fetch(channelId).catch(() => null)
    : interaction.channel;

  if (!channel?.isTextBased?.()) {
    await interaction.editReply({ content: 'I could not find a Draft Grades channel. Set it in setup, or run this command in the channel you want to use.' });
    return;
  }

  await channel.send({ embeds: [embed] });
  await interaction.editReply({ content: `Posted ${grades.length} team draft grades in ${channel}.` });
}

export default { data, featureKey, execute };
