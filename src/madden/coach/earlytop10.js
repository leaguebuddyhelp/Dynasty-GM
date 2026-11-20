import { SlashCommandBuilder } from 'discord.js';
import { buildEarlyTop10View } from '../early_top_10.js';

export const data = new SlashCommandBuilder().setName('earlybigboard')
  .setDescription('Browse early draft prospect rankings by class.');

export async function execute(interaction) {
  await interaction.deferReply({ flags: 64 });
  try {
    await interaction.editReply(buildEarlyTop10View());
  } catch (error) {
    console.error('[earlytop10] Unable to load board:', error.message);
    await interaction.editReply({ content: 'The early big board is unavailable right now.' });
  }
}

export default { data, execute };
