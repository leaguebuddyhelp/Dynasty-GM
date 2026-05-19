import { PermissionFlagsBits } from 'discord.js';

import { execute as executeSetupDashboard } from '../madden/staff/setup_dashboard.js';
import { execute as executeSetupChannels } from '../madden/staff/madden-setup.js';
import { execute as executeSetupPins } from '../madden/staff/setup-pins.js';
import { execute as executeSetupRoles } from '../madden/staff/setup_roles.js';

export const customId = /^madden_setup\|/;

async function ensureCanManageGuild(interaction) {
  if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: 'Only server managers can use setup controls.',
      flags: 64,
    }).catch(() => null);
    return false;
  }
  return true;
}

export async function execute(interaction) {
  if (!interaction.isButton?.()) return;
  if (!(await ensureCanManageGuild(interaction))) return;

  const action = String(interaction.customId || '').split('|')[1] || 'refresh';

  if (action === 'channels') {
    await executeSetupChannels(interaction);
    return;
  }

  if (action === 'pins') {
    await interaction.deferReply({ flags: 64 });
    await executeSetupPins(interaction);
    return;
  }

  if (action === 'roles') {
    await interaction.deferReply({ flags: 64 });
    await executeSetupRoles(interaction);
    return;
  }

  await interaction.deferUpdate();
  await executeSetupDashboard(interaction);
}

export default { customId, execute };
