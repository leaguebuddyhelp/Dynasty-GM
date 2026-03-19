import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { buildActorFromInteraction } from '../../leaguebuddy/audit.js';
import { setSetupCompleted, ensureGuildActivated } from '../../leaguebuddy/guild_access_service.js';
import { loadGuildMaddenConfigIfComplete } from '../../shared/madden_guild_config.js';

export const data = new SlashCommandBuilder()
    .setName('syncsetupstatus')
    .setDescription('Admin-only: sync LEAGUEbuddy setupCompleted based on Madden v2 overlay completeness.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export const deferOnDispatch = { flags: 64 };

export async function execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.editReply({ content: 'This command can only be used in a server.' });
        return;
    }

    const actor = buildActorFromInteraction(interaction);

    // Our strongest available signal for "real" setup: Madden overlay is present and status=complete.
    const maddenOverlayComplete = !!loadGuildMaddenConfigIfComplete(guildId);

    ensureGuildActivated(guildId, { actor, source: 'command:/syncsetupstatus' });
    const rec = setSetupCompleted(guildId, maddenOverlayComplete, { actor, source: 'command:/syncsetupstatus' });

    await interaction.editReply({
        content: [
            '**Setup status synced**',
            `Madden overlay: ${maddenOverlayComplete ? '✅ complete' : '❌ incomplete/missing'}`,
            `LEAGUEbuddy setupCompleted: **${rec.setupCompleted ? 'yes' : 'no'}**`,
        ].join('\n'),
    });
}

export default { data, execute };
