import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getGuildRecord } from '../../leaguebuddy/guild_store.js';
import { buildActorFromInteraction } from '../../leaguebuddy/audit.js';
import { ensureGuildActivated, setSetupCompleted } from '../../leaguebuddy/guild_access_service.js';

export const data = new SlashCommandBuilder()
    .setName('lb-activate')
    .setDescription('Admin-only: activate LEAGUEbuddy access/billing record for this server (internal).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption((o) =>
        o.setName('complete')
            .setDescription('Mark setup as completed (true/false). Defaults to true.')
            .setRequired(false)
    );

// Use ephemeral replies by default.
export const deferOnDispatch = { flags: 64 };

export async function execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.editReply({ content: 'This command can only be used in a server.' });
        return;
    }

    const actor = buildActorFromInteraction(interaction);

    // Create record if missing, default free plan.
    const before = getGuildRecord(guildId, { createIfMissing: false });
    const rec = ensureGuildActivated(guildId, { actor, source: 'command:/lb-activate' });

    // Always mark setup as complete when this command is run
    const updated = setSetupCompleted(guildId, true, { actor, source: 'command:/lb-activate' });

    const created = !before;
    const content = [
        '**LEAGUEbuddy server activation complete**',
        created ? 'Record: created ✅' : 'Record: updated ✅',
        `Plan: **${updated.plan}**`,
        `Subscription: **${updated.subscriptionStatus}**`,
        `Activated: ${updated.activatedAt ? '✅' : '❌'}`,
        `Setup completed: ${updated.setupCompleted ? '✅' : '❌'}`,
    ].join('\n');

    await interaction.editReply({ content });
}

export default { data, execute };
