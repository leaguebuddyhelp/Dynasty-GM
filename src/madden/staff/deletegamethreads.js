import { SlashCommandBuilder } from 'discord.js';
import { resolveLeagueIdWithConfig, loadLeagueSnapshot } from '../../../madden/madden_data.js';
import { loadMaddenChannelMap } from '../../shared/madden_metadata.js';
import { hasStaffRole, loadRoleMapForGuild } from './staffUtils.js';

const PRESEASON_WEEK_CHOICES = [
  { name: 'Preseason Week 1', value: 1 },
  { name: 'Preseason Week 2', value: 2 },
  { name: 'Preseason Week 3', value: 3 },
];
const REGULAR_SEASON_WEEK_CHOICES = Array.from({ length: 18 }, (_, index) => ({
  name: `Regular Season Week ${index + 1}`,
  value: index + 1,
}));

export const data = new SlashCommandBuilder()
  .setName('delete-threads')
  .setDescription('Delete preseason, regular-season, or playoff game threads for this server.')
  .addIntegerOption(o =>
    o.setName('preseason_week')
      .setDescription('Optional preseason week to delete.')
      .setRequired(false)
      .addChoices(...PRESEASON_WEEK_CHOICES)
  )
  .addIntegerOption(o =>
    o.setName('regular_season_week')
      .setDescription('Optional regular-season week to delete.')
      .setRequired(false)
      .addChoices(...REGULAR_SEASON_WEEK_CHOICES)
  )
  .addStringOption(o =>
    o.setName('playoff_round')
      .setDescription('Optional playoff round to delete.')
      .setRequired(false)
      .addChoices(
        { name: 'Wild Card', value: 'wildcard' },
        { name: 'Divisional Round', value: 'divisional' },
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
  const preseasonWeek = interaction.options.getInteger('preseason_week');
  const regularSeasonWeek = interaction.options.getInteger('regular_season_week') ?? interaction.options.getInteger('week');
  if ([Boolean(preseasonWeek), Boolean(regularSeasonWeek), Boolean(playoffRound)].filter(Boolean).length > 1) {
    await interaction.editReply({ content: 'Use only one of `preseason_week`, `regular_season_week`, or `playoff_round` at a time.' });
    return;
  }
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
  let week = regularSeasonWeek;
  if (!week && !playoffRound && !preseasonWeek) {
    try {
      const snap = loadLeagueSnapshot(leagueId);
      const seasonInfo = snap?.info?.careerHubInfo?.seasonInfo || {};
      const inPreseason = Number(seasonInfo.seasonWeekType ?? snap?.stage ?? 1) === 0 && Number(seasonInfo.offSeasonStage || 0) <= 0;
      week = inPreseason ? null : (snap?.currentWeek || 1);
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
    const match = roundNum ? [`PO-${playoffRound}`] : preseasonWeek ? [`Preseason Week ${preseasonWeek}`] : [`W${week}`];
    for (const [, thread] of allThreads) {
      if (match.some(m => thread.name.includes(m))) {
        await thread.delete('Madden game thread cleanup');
        deleted += 1;
      }
    }
    await interaction.editReply({
      content: `Deleted ${deleted} threads for ${playoffRound ? playoffLabels[playoffRound] || playoffRound : preseasonWeek ? `Preseason Week ${preseasonWeek}` : `Week ${week}`}.`,
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
