import { buildProspectView, PROSPECT_POSITIONS } from '../madden/prospects.js';

export const customId = /^madden_prospects_(position|player_[A-Z]+)$/;

export async function execute(interaction) {
  if (!interaction.isStringSelectMenu()) return;
  await interaction.deferUpdate();
  try {
    const positionSelection = interaction.customId === 'madden_prospects_position';
    const position = positionSelection ? interaction.values[0] : interaction.customId.slice('madden_prospects_player_'.length);
    if (!PROSPECT_POSITIONS.includes(position)) throw new Error('Unknown position');
    await interaction.editReply(buildProspectView({ position, playerId: positionSelection ? null : interaction.values[0] }));
  } catch (error) {
    console.warn('[prospects] Unable to open profile:', error.message);
    await interaction.followUp({ content: 'That profile is unavailable. Run `/prospects` to reopen the current board.', flags: 64 });
  }
}

export default { customId, execute };
