import { SlashCommandBuilder } from 'discord.js';
import { resolveLeagueIdWithConfig } from '../madden_data.js';
import { updateAwards } from '../awards.js';

export const data = new SlashCommandBuilder()
  .setName('awards')
  .setDescription('View weekly franchise awards.')
  .addIntegerOption((option) => option.setName('week').setDescription('Week number; defaults to the current week').setMinValue(1))
  .addBooleanOption((option) => option.setName('public').setDescription('Post in the current channel'));

export async function execute(interaction) {
  const isPublic = interaction.options.getBoolean('public') || false;
  await interaction.deferReply(isPublic ? {} : { flags: 64 });
  const leagueId = resolveLeagueIdWithConfig(interaction.guildId);
  if (!leagueId) return interaction.editReply({ content: 'Connect your franchise using `/setup` first.' });
  await updateAwards(interaction.client, leagueId, interaction.options.getInteger('week') ?? null, { interaction, isPublic });
}
export default { data, execute };
