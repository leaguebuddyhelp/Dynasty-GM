import { SlashCommandBuilder } from 'discord.js';
import { resolveLeagueIdWithConfig, loadLeagueSnapshot } from '../../../madden/madden_data.js';
import { loadMaddenChannelMap } from '../../shared/madden_metadata.js';
import { hasStaffRole, loadRoleMapForGuild } from './staffUtils.js';

export const data = new SlashCommandBuilder()
  .setName('delete-threads')
  .setDescription('Delete the current week or playoff game threads for this server.')
  .addIntegerOption(o => o.setName('week').setDescription('Optional regular-season week override. Leave empty during playoffs.').setRequired(false))
  .addStringOption(o =>
    o.setName('playoff_round')
      .setDescription('Optional playoff round. Use this instead of week during the postseason.')
      .setRequired(false)
      .addChoices(
        { name: 'Wildcard', value: 'wildcard' },
        { name: 'Divisional', value: 'divisional' },
        { name: 'Conference Championship', value: 'conference' },
        { name: 'Super Bowl', value: 'superbowl' },
      )
  )
  .setDefaultMemberPermissions(null);

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const roleMap = loadRoleMapForGuild(interaction.guildId);
  const channelMap = loadMaddenChannelMap(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!hasStaffRole(member, roleMap)) {
    await interaction.editReply({ content: 'Only server admins, LB Commish, or LB Co-Commish can use this command.' });
    return;
  }
  const playoffRound = interaction.options.getString('playoff_round');
  const playoffMap = {
    wildcard: 19,
    divisional: 20,
    conference: 21,
    superbowl: 23,
  };
  const playoffLabels = {
    wildcard: 'Wild Card',
    divisional: 'Divisional Round',
    conference: 'Conference Championship',
    superbowl: 'Super Bowl',
  };
  const leagueId = resolveLeagueIdWithConfig(interaction.guildId);
  let week = interaction.options.getInteger('week');
  if (!week && !playoffRound) {
    try {
      const snap = loadLeagueSnapshot(leagueId);
      week = snap?.currentWeek || 1;
    } catch {
      week = 1;
    }
  }
  const threadsChannelId = channelMap['Game threads'];
  if (!threadsChannelId) {
    await interaction.editReply({ content: 'Game threads channel ID not set.' });
    return;
  }
  const channel = await interaction.client.channels.fetch(threadsChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    await interaction.editReply({ content: 'Game threads channel not found or not text-based.' });
    return;
  }
  try {
    const active = await channel.threads.fetchActive();
    const archived = await channel.threads.fetchArchived();
    const allThreads = new Map([...active.threads, ...archived.threads]);
    let deleted = 0;
    const roundNum = playoffRound ? playoffMap[playoffRound] : null;
    const match = roundNum ? [`PO-${playoffRound}`] : [`W${week}`];
    for (const [, thread] of allThreads) {
      if (match.some(m => thread.name.includes(m))) {
        await thread.delete('Madden game thread cleanup');
        deleted += 1;
      }
    }
    await interaction.editReply({
      content: `Deleted ${deleted} threads for ${playoffRound ? playoffLabels[playoffRound] || playoffRound : `Week ${week}`}.`,
    });
  } catch (err) {
    if (err.code === 50001) {
      await interaction.editReply({ content: 'Missing access to the Game threads channel. Check bot permissions and channel ID.' });
      return;
    }
    await interaction.editReply({ content: `Failed to delete threads: ${err.message || err}` });
  }
}

export default { data, execute };
