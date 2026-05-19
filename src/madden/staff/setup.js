import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getGuildRecord } from '../../leaguebuddy/guild_store.js';
import { buildActorFromInteraction } from '../../leaguebuddy/audit.js';
import { ensureGuildActivated, setSetupCompleted } from '../../leaguebuddy/guild_access_service.js';
import { getMaddenLeagueSnapshotPath } from '../../leaguebuddy/paths.js';
import connectionService from '../services/export_first_connection_service.js';
import { getExplicitLeagueForGuild } from '../madden_config.js';
import fs from 'fs';

export const data = new SlashCommandBuilder()
    .setName('complete-setup')
    .setDescription('Admin-only: mark LEAGUEbuddy setup as complete for this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

// Use ephemeral replies by default.
export const deferOnDispatch = { flags: 64 };

export async function execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.editReply({ content: 'This command can only be used in a server.' });
        return;
    }

    const leagueId = getExplicitLeagueForGuild(guildId);
    const connection = connectionService.getLeagueConnectionStatus(guildId)?.connection || null;
    const snapshotReady = Boolean(leagueId && fs.existsSync(getMaddenLeagueSnapshotPath(leagueId)));
    if (!leagueId || !connection || connection.status !== 'connected' || !snapshotReady) {
        await interaction.editReply({
            content: 'This server is not fully connected yet. Run `/setup`, finish the league connection, and make sure the first sync completes before using `/complete-setup`.',
        });
        return;
    }

    const actor = buildActorFromInteraction(interaction);

    // Create record if missing, default free plan.
    const before = getGuildRecord(guildId, { createIfMissing: false });
    ensureGuildActivated(guildId, { actor, source: 'command:/complete-setup' });

    const updated = setSetupCompleted(guildId, true, { actor, source: 'command:/complete-setup' });

    const created = !before;
    const content = [
        '**LEAGUEbuddy setup marked complete**',
        created ? 'Record: created ✅' : 'Record: updated ✅',
        `Plan: **${updated.plan}**`,
        `Subscription: **${updated.subscriptionStatus}**`,
        `Activated: ${updated.activatedAt ? '✅' : '❌'}`,
        `Setup completed: ${updated.setupCompleted ? '✅' : '❌'}`,
    ].join('\n');

    await interaction.editReply({ content });
}

export default { data, execute };
