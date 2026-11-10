import { MessageFlags } from 'discord.js';
import { resolveLeagueIdWithConfig } from '../madden/madden_data.js';
import {
  buildRecommendationEmbed,
  buildRecommendationStatusButtons,
  loadProgressionPeriod,
  refreshProgressionMessages,
  updateProgressionStatus,
} from '../madden/progression.js';

export const customId = /^madden_progression_(?:select|status|details)\|/;

async function getSelectedRecommendation(leagueId, periodKey, recommendationId) {
  const result = await loadProgressionPeriod(leagueId, periodKey, recommendationId);
  return { record: result.record, recommendation: result.recommendation };
}

export async function execute(interaction) {
  const [action, ...parts] = String(interaction.customId || '').split('|');
  const leagueId = resolveLeagueIdWithConfig(interaction.guildId);
  if (!leagueId || !interaction.guildId) {
    await interaction.reply({
      content: 'No connected Madden league was found for this server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'madden_progression_select') {
    const [periodKey, teamId] = parts;
    const recommendationId = interaction.values?.[0];
    if (!periodKey || !teamId || !recommendationId) throw new Error('Invalid progression selection.');
    const { record, recommendation } = await getSelectedRecommendation(leagueId, periodKey, recommendationId);
    if (recommendation.teamId !== teamId) throw new Error('Selected recommendation does not belong to this team thread.');
    await interaction.reply({
      embeds: [buildRecommendationEmbed(record, recommendation)],
      components: buildRecommendationStatusButtons(record, recommendation),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'madden_progression_status') {
    const [status, periodKey, recommendationId] = parts;
    const record = await updateProgressionStatus({
      leagueId,
      periodKey,
      recommendationId,
      status,
      userId: interaction.user.id,
    });
    await refreshProgressionMessages({
      client: interaction.client,
      guildId: interaction.guildId,
      leagueId,
      periodKey,
    });
    const recommendation = record.recommendations.find((item) => item.recommendationId === recommendationId);
    await interaction.update({
      embeds: [buildRecommendationEmbed(record, recommendation)],
      components: buildRecommendationStatusButtons(record, recommendation),
    });
    return;
  }

  if (action === 'madden_progression_details') {
    const [periodKey, recommendationId] = parts;
    const { record, recommendation } = await getSelectedRecommendation(leagueId, periodKey, recommendationId);
    await interaction.update({
      embeds: [buildRecommendationEmbed(record, recommendation)],
      components: buildRecommendationStatusButtons(record, recommendation),
    });
  }
}

export default { customId, execute };
