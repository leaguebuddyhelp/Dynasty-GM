import { SlashCommandBuilder } from 'discord.js';
import { execute as setupCheckExecute } from './madden-setup-check.js';

// Temporary backward-compatible alias for older servers.
export const data = new SlashCommandBuilder()
    .setName('setup-check')
    .setDescription('Alias for /madden-setup-check (deprecated)');

export async function execute(interaction) {
    return setupCheckExecute(interaction);
}

export default { data, execute, skipDeploy: true };
