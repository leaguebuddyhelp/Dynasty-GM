import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { execute as setupExecute } from './madden-setup.js';

// Temporary backward-compatible alias for older servers.
export const data = new SlashCommandBuilder()
    .setName('madden-setup')
    .setDescription('Alias for /setup-channels (deprecated)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
    return setupExecute(interaction);
}

export default { data, execute, skipDeploy: true };
