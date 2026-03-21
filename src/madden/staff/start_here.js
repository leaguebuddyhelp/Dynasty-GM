import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

import { execute as setupExecute } from './setup_dashboard.js';

export const data = new SlashCommandBuilder()
  .setName('start-here')
  .setDescription('Alias for /setup. Opens the main LEAGUEbuddy setup dashboard.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export const deferOnDispatch = { flags: 64 };

export async function execute(interaction) {
  return setupExecute(interaction);
}

export default { data, execute, deferOnDispatch, skipDeploy: true };
