import { buildEarlyTop10View } from '../madden/early_top_10.js';

export const customId = /^madden_earlytop10_(?:class|(?:(cus02|cus03|cus04|cus05)_)?page_([0-9]+))$/;

export async function execute(interaction) {
  const match = customId.exec(interaction.customId);
  if (!match) return;
  const classSelection = interaction.customId === 'madden_earlytop10_class';
  if (classSelection ? !interaction.isStringSelectMenu() : !interaction.isButton()) return;
  await interaction.deferUpdate();
  try {
    const classId = classSelection ? interaction.values[0] : match[1] ? match[1].toUpperCase() : 'CUS01';
    await interaction.editReply(buildEarlyTop10View(classSelection ? 0 : Number(match[2]), classId));
  } catch (error) {
    console.warn('[earlytop10] Unable to open page:', error.message);
    await interaction.followUp({ content: 'The early big board is unavailable. Run `/earlybigboard` to try again.', flags: 64 });
  }
}

export default { customId, execute };
