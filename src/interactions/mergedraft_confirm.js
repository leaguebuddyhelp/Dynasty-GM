import { ButtonInteraction } from 'discord.js';


export const customId = /^mergedraft_confirm_(\d+)/;

export async function execute(interaction) {
  if (!(interaction instanceof ButtonInteraction)) return;
  const match = interaction.customId.match(/^mergedraft_confirm_(\d+)/);
  if (!match) return;
  const classNo = parseInt(match[1], 10);
  try {
    await interaction.deferUpdate();
  } catch { }
  await interaction.followUp({ content: 'Draft merging is currently unavailable. Please contact an admin to enable this feature for Madden.', ephemeral: true });
  // Madden-only: No mergedraft logic implemented yet.
}

export default { customId, execute };
