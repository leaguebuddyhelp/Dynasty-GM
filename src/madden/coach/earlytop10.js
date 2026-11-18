import { SlashCommandBuilder } from 'discord.js';
import { buildEarlyTop10View } from '../early_top_10.js';

export const data = new SlashCommandBuilder().setName('earlytop10')
  .setDescription('Browse the early top ten prospects by draft class.');

export async function execute(interaction) {
  await interaction.deferReply({ flags: 64 });
  try {
    await interaction.editReply(buildEarlyTop10View());
  } catch (error) {
    console.error('[earlytop10] Unable to load board:', error.message);
    await interaction.editReply({ content: 'The early top ten is unavailable right now.' });
  }
}

export default { data, execute };
