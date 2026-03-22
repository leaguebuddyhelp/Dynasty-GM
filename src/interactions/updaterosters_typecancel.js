import { ButtonInteraction } from 'discord.js';


export const customId = /^updaterosters_typecancel_/;

export async function execute(interaction) {
  if (!(interaction instanceof ButtonInteraction)) return;
  const id = interaction.customId.replace('updaterosters_typecancel_', '');
  await interaction.reply({ content: 'Roster update cancel is currently unavailable. Please contact an admin to enable this feature for Madden.', ephemeral: true });
}

export default { customId, execute };
