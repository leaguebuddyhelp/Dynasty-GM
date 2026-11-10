import { execute as showSetup } from '../madden/staff/setup_dashboard.js';
import { execute as createChannels } from '../madden/staff/madden-setup.js';

export const customId = /^madden_setup\|/;
export async function execute(interaction) {
  const action = String(interaction.customId || '').split('|')[1];
  if (action === 'channels') return createChannels(interaction);
  if (action !== 'refresh') return interaction.reply({ content: 'This setup control is no longer available. Run `/setup`.', flags: 64 });
  await interaction.deferUpdate();
  return showSetup(interaction);
}
export default { customId, execute };
