import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { execute as activateExecute } from './setup.js';

// Backward-compatible alias: old /setup activation command.
// NOTE: This is separate from the new /setup (Madden v2 resources) command.
export const data = new SlashCommandBuilder()
    .setName('lb-activate-alias')
    .setDescription('Alias for /lb-activate (deprecated)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
    return activateExecute(interaction);
}

export default { data, execute };
