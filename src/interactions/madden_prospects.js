import { buildProspectView, PROSPECT_CLASSES, PROSPECT_POSITIONS } from '../madden/prospects.js';

export const customId = /^madden_prospects_(?:class|(?:cus02_)?(?:position|(?:player|page)_[A-Z]+))$/;

export async function execute(interaction) {
  if (!interaction.isStringSelectMenu()) return;
  await interaction.deferUpdate();
  try {
    if (interaction.customId === 'madden_prospects_class') {
      const classId = interaction.values[0];
      if (!PROSPECT_CLASSES.includes(classId)) throw new Error('Unknown class');
      await interaction.editReply(buildProspectView({ classId }));
      return;
    }
    const classId = interaction.customId.startsWith('madden_prospects_cus02_') ? 'CUS02' : 'CUS01';
    const prefix = classId === 'CUS02' ? 'madden_prospects_cus02_' : 'madden_prospects_';
    const selection = interaction.customId.slice(prefix.length);
    const [action, selectedPosition] = selection.split('_');
    const value = interaction.values[0];
    const position = action === 'position' ? value : selectedPosition;
    if (!PROSPECT_POSITIONS.includes(position)) throw new Error('Unknown position');
    await interaction.editReply(buildProspectView({ classId, position, playerId: action === 'player' ? value : null, page: action === 'page' ? Number(value) : 0 }));
  } catch (error) {
    console.warn('[prospects] Unable to open profile:', error.message);
    await interaction.followUp({ content: 'That profile is unavailable. Run `/prospects` to reopen the current board.', flags: 64 });
  }
}

export default { customId, execute };
