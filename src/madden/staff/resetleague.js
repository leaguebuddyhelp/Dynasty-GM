import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { deferOnDispatch, execute as executeDisconnectLeague } from './disconnectleague.js';

export const data = new SlashCommandBuilder()
  .setName('resetleague')
  .setDescription('Reset this server’s league connection and setup state so you can start over.')
  .addBooleanOption((option) =>
    option
      .setName('confirm')
      .setDescription('Set to true to confirm the reset.')
      .setRequired(false),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  return executeDisconnectLeague(interaction);
}

export { deferOnDispatch };

export default { data, execute, deferOnDispatch };
