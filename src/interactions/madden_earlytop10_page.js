import { buildEarlyTop10View } from '../madden/early_top_10.js';

export const customId = /^madden_earlytop10_(?:class|(?:(cus02)_)?page_([0-9]+))$/;

export async function execute(interaction) {
  const match = customId.exec(interaction.customId);
  if (!match) return;
  const classSelection = interaction.customId === 'madden_earlytop10_class';
  if (classSelection ? !interaction.isStringSelectMenu() : !interaction.isButton()) return;
  await interaction.deferUpdate();
  try {
    const classId = classSelection ? interaction.values[0] : match[1] === 'cus02' ? 'CUS02' : 'CUS01';
    await interaction.editReply(buildEarlyTop10View(classSelection ? 0 : Number(match[2]), classId));
  } catch (error) {
    console.warn('[earlytop10] Unable to open page:', error.message);
    await interaction.followUp({ content: 'The early top ten is unavailable. Run `/earlytop10` to try again.', flags: 64 });
  }
}

export default { customId, execute };
