import { SlashCommandBuilder } from 'discord.js';
import { buildProspectView } from '../prospects.js';

export const data = new SlashCommandBuilder().setName('prospects')
  .setDescription('Browse draft prospects by position and open their portrait and scouting profile.');

export async function execute(interaction) {
  await interaction.deferReply({ flags: 64 });
  await interaction.editReply(buildProspectView());
}

export default { data, execute };
