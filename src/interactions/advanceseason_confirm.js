import { ButtonInteraction } from 'discord.js';


export const customId = /^advanceseason_(confirm|cancel)_/;

export async function execute(interaction) {
  if (!(interaction instanceof ButtonInteraction)) return;
  const [_, action, seasonStr] = interaction.customId.split('_');
  const seasonno = parseInt(seasonStr, 10);
  if (Number.isNaN(seasonno)) {
    await interaction.reply({ content: 'Invalid season number.', ephemeral: true });
    return;
  }
  if (action === 'cancel') {
    await interaction.update({ content: 'Advance season canceled.', components: [] });
    return;
  }
  await interaction.update({ content: `Advancing season is currently unavailable. Please contact an admin to enable this feature for Madden.`, components: [] });
  // Madden-only: No advance season logic implemented yet.
}

export default { customId, execute };
