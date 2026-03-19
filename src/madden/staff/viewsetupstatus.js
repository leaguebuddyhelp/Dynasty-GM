import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getSetupStatus } from '../../leaguebuddy/setup_status_service.js';

export const data = new SlashCommandBuilder()
    .setName('viewsetupstatus')
    .setDescription('Admin-only: view LEAGUEbuddy server setup/activation status.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export const deferOnDispatch = { flags: 64 };

export async function execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.editReply({ content: 'This command can only be used in a server.' });
        return;
    }

    const status = getSetupStatus(guildId);

    await interaction.editReply({
        content: [
            '**LEAGUEbuddy Setup Status**',
            `Guild record: ${status.facts.leaguebuddyRecordFound ? '✅ found' : '❌ missing'}`,
            `Activated: ${status.facts.activatedAt ? '✅' : '❌'} ${status.facts.activatedAt || ''}`.trim(),
            `LEAGUEbuddy setupCompleted: ${status.setupCompleted ? '✅' : '❌'}`,
            status.facts.setupCompletedAt ? `Setup completed at: ${status.facts.setupCompletedAt}` : null,
            '',
            `Madden overlay config: ${status.overlayStatus.exists ? '✅ found' : '❌ missing'}`,
            `Madden overlay status: ${status.overlayStatus.isComplete ? '✅ complete' : '❌ incomplete'} (${status.overlayStatus.status})`,
            `Sync needed: ${status.syncNeeded ? '⚠️ yes' : '✅ no'}`,
            '',
            `Plan: **${status.plan}**`,
            `Subscription: **${status.subscriptionStatus}**`,
            `packsEnabled: ${status.packsEnabled.length ? status.packsEnabled.join(', ') : '(none)'}`,
            '',
            `Mapped channels: **${status.channels.mappedCount}**`,
            `Mapped roles: **${status.roles.mappedCount}**`,
            status.missingRequiredChannels.length ? `Missing required channels: ${status.missingRequiredChannels.join(', ')}` : 'Missing required channels: none',
            status.missingRequiredRoles.length ? `Missing required roles: ${status.missingRequiredRoles.join(', ')}` : 'Missing required roles: none',
            '',
            `Unlocked features: ${status.unlockedFeatures.map((item) => item.featureKey).join(', ') || '(none)'}`,
            `Blocked features: ${status.blockedFeatures.map((item) => `${item.featureKey}:${item.reason}`).join(', ') || '(none)'}`,
            '',
            `Recommended next action: ${status.recommendedNextAction}`,
        ].filter(Boolean).join('\n'),
    });
}

export default { data, execute };
