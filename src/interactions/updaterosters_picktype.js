import { StringSelectMenuInteraction } from 'discord.js';


export const customId = /^updaterosters_picktype_/;

export async function execute(interaction) {
  if (!(interaction instanceof StringSelectMenuInteraction)) return;
  const id = interaction.customId.replace('updaterosters_picktype_', '');
  await interaction.reply({ content: 'Roster update is currently unavailable. Please contact an admin to enable this feature for Madden.', ephemeral: true });
}

export default { customId, execute };
