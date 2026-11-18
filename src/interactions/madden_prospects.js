import { buildProspectView, PROSPECT_CLASSES, PROSPECT_POSITIONS } from '../madden/prospects.js';

export const customId = /^madden_prospects_(?:class|(?:(?:cus02)_)?(?:position|player_[A-Z]+))$/;

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
    const positionSelection = selection === 'position';
    const position = positionSelection ? interaction.values[0] : selection.slice('player_'.length);
    if (!PROSPECT_POSITIONS.includes(position)) throw new Error('Unknown position');
    await interaction.editReply(buildProspectView({ classId, position, playerId: positionSelection ? null : interaction.values[0] }));
  } catch (error) {
    console.warn('[prospects] Unable to open profile:', error.message);
    await interaction.followUp({ content: 'That profile is unavailable. Run `/prospects` to reopen the current board.', flags: 64 });
  }
}

export default { customId, execute };
