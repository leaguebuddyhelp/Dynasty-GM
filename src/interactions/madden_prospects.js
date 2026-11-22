import { buildProspectView, PROSPECT_CLASSES, PROSPECT_POSITIONS } from '../madden/prospects.js';

export const customId = /^madden_prospects_(?:class|(?:cus02_)?(?:position|(?:player|page)_[A-Z]+|(?<button>(?:previous|next)_[A-Z]+_\d+)))$/;

export async function execute(interaction) {
  const match = customId.exec(interaction.customId);
  if (!match) return;
  const isNavigation = Boolean(match.groups.button);
  if (isNavigation ? !interaction.isButton() : !interaction.isStringSelectMenu()) return;
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
    const [action, selectedPosition, target] = selection.split('_');
    const value = isNavigation ? target : interaction.values[0];
    const position = action === 'position' ? value : selectedPosition;
    if (!PROSPECT_POSITIONS.includes(position)) throw new Error('Unknown position');
    await interaction.editReply(buildProspectView({
      classId, position, playerId: isNavigation || action === 'player' ? value : null,
      page: action === 'page' ? Number(value) : action === 'position' ? 0 : null,
    }));
  } catch (error) {
    console.warn('[prospects] Unable to open profile:', error.message);
    await interaction.followUp({ content: 'That profile is unavailable. Run `/prospects` to reopen the current board.', flags: 64 });
  }
}

export default { customId, execute };
