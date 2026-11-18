import { buildEarlyTop10View } from '../madden/early_top_10.js';

export const customId = /^madden_earlytop10_page_([0-9]+)$/;

export async function execute(interaction) {
  if (!interaction.isButton()) return;
  const match = customId.exec(interaction.customId);
  if (!match) return;
  await interaction.deferUpdate();
  try {
    await interaction.editReply(buildEarlyTop10View(Number(match[1])));
  } catch (error) {
    console.warn('[earlytop10] Unable to open page:', error.message);
    await interaction.followUp({ content: 'The early top ten is unavailable. Run `/earlytop10` to try again.', flags: 64 });
  }
}

export default { customId, execute };
