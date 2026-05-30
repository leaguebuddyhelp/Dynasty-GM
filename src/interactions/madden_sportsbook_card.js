import { ButtonInteraction, EmbedBuilder } from 'discord.js';
import { inferRecognitionContext } from '../shared/league_recognition.js';
import { buildSportsbookPrivateView } from '../shared/madden_sportsbook.js';

export const customId = /^madden_sportsbook_(open|view|card|board)\|/;

export async function execute(interaction) {
  if (!(interaction instanceof ButtonInteraction)) return;
  const parts = interaction.customId.split('|');
  const action = parts[0].replace('madden_sportsbook_', '');
  const launchesPrivateBoard = action === 'open' || action === 'board' || action === 'card';
  const weekNumber = Number(parts[1] || 0);
  const rawMode = parts[2] || 'board';
  const mode = action === 'board'
    ? (rawMode === 'breakdown' ? 'breakdown' : 'leaderboard')
    : action === 'card'
      ? 'card'
      : rawMode === 'tab_board' || rawMode === 'page_prev' || rawMode === 'page_next'
        ? 'board'
        : rawMode === 'props'
          ? 'props'
        : rawMode === 'breakdown_prev' || rawMode === 'breakdown_next'
        ? 'breakdown'
        : rawMode === 'tab_breakdown'
          ? 'breakdown'
          : rawMode === 'tab_futures' || rawMode === 'futures_prev' || rawMode === 'futures_next'
            ? 'futures'
            : rawMode === 'tab_card'
              ? 'card'
              : rawMode === 'tab_leaderboard'
                ? 'leaderboard'
                : rawMode;
  const index = Number(parts[3] || 0);
  const context = inferRecognitionContext('madden', interaction.guildId);
  const seasonKey = context?.seasonKey;
  if (!seasonKey) {
    if (launchesPrivateBoard) {
      await interaction.reply({ content: 'Sportsbook season context is not ready yet.', flags: 64 });
    } else {
      await interaction.update({ content: 'Sportsbook season context is not ready yet.', embeds: [], components: [] });
    }
    return;
  }

  // Opening the board from Franchise Hub should create one private board message.
  // After that, tab/page buttons should update the existing private board in place.
  if (!interaction.deferred && !interaction.replied) {
    if (launchesPrivateBoard) {
      await interaction.deferReply({ flags: 64 });
    } else {
      await interaction.deferUpdate();
    }
  }

  const payload = await buildSportsbookPrivateView({
    seasonKey,
    weekNumber,
    userId: interaction.user.id,
    guildId: interaction.guildId,
    guild: interaction.guild,
    mode,
    index,
  });

  await interaction.editReply(payload);
}

export default { customId, execute };
