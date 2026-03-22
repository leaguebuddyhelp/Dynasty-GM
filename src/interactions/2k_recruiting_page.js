

export const customId = /^2k_recruiting_page_(\d+)$/;

export async function execute(interaction) {
  if (!interaction.isButton()) return;
  const match = interaction.customId.match(customId);
  if (!match) return;

  await interaction.update({ content: 'Recruiting is currently unavailable. Please contact an admin to enable this feature for Madden.', embeds: [], components: [] });
}

export default { execute, customId };
