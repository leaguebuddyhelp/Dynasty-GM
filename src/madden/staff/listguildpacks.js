import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { loadGuildMaddenConfig } from '../../shared/madden_guild_config.js';
import { FEATURES } from '../../leaguebuddy/plans.js';

export const data = new SlashCommandBuilder()
    .setName('listguildpacks')
    .setDescription('Admin-only: list packsEnabled (feature flags) from this server\'s Madden overlay config.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export const deferOnDispatch = { flags: 64 };

export async function execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.editReply({ content: 'This command can only be used in a server.' });
        return;
    }

    const cfg = loadGuildMaddenConfig(guildId);
    const packsEnabled = Array.isArray(cfg?.packsEnabled) ? cfg.packsEnabled : [];

    const known = new Set(Object.keys(FEATURES));
    const unknown = packsEnabled.filter((p) => !known.has(String(p)));

    const lines = [];
    lines.push('**packsEnabled (Madden overlay)**');
    lines.push(packsEnabled.length ? packsEnabled.map((p) => `• ${p}`).join('\n') : '(none)');
    if (unknown.length) {
        lines.push('');
        lines.push('**Unknown pack keys**');
        lines.push(unknown.map((p) => `• ${p}`).join('\n'));
    }

    await interaction.editReply({ content: lines.join('\n') });
}

export default { data, execute };
