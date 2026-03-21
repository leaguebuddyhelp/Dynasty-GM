import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { getSetupStatus } from '../../leaguebuddy/setup_status_service.js';
import {
    buildSetupReadinessLines,
    buildSetupReadinessNextSteps,
    inspectSetupReadiness,
} from './setup_readiness.js';

export const data = new SlashCommandBuilder()
    .setName('setup-check')
    .setDescription('View your server setup, plan, and unlocked Madden features.');

export async function execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
        return;
    }

    const status = getSetupStatus(guildId);
    const readiness = await inspectSetupReadiness(interaction.guild);
    const setupSummary = status.syncNeeded && status.overlayStatus.isComplete
        ? 'One fix left: run `/syncsetupstatus` so LEAGUEbuddy access matches the completed overlay setup.'
        : [
            `Overlay setup: ${status.overlayStatus.isComplete ? '✅ complete' : status.overlayStatus.exists ? '⚠️ incomplete' : '❌ not started'}`,
            `LEAGUEbuddy access setup: ${status.setupCompleted ? '✅ complete' : '❌ incomplete'}`,
            `Plan: **${status.plan}**`,
            `Subscription: **${status.subscriptionStatus}**`,
            `Packs: ${status.packsEnabled.length ? status.packsEnabled.join(', ') : '(none)'}`,
        ].join('\n');
    const unlockedNow = status.unlockedFeatures.map((item) => `• ${item.label}`).join('\n') || '• None yet';
    const blockedNow = status.blockedFeatures
        .map((item) => `• ${item.label} (${item.reason === 'plan_too_low' ? 'upgrade required' : item.reason === 'setup_incomplete' ? 'finish setup' : item.reason === 'subscription_inactive' ? 'subscription inactive' : item.reason})`)
        .join('\n') || '• None';

    const embed = new EmbedBuilder()
        .setTitle('Madden Setup Check')
        .setColor(status.syncNeeded ? 0xf1c40f : status.overlayStatus.isComplete && status.setupCompleted ? 0x57f287 : 0x5865f2)
        .setDescription(setupSummary)
        .addFields(
            {
                name: 'Status',
                value: [
                    `${status.overlayStatus.exists ? '✅' : '❌'} Overlay config exists`,
                    `${status.overlayStatus.isComplete ? '✅' : '❌'} Overlay setup is complete`,
                    `${status.setupCompleted ? '✅' : '❌'} Access setup is complete`,
                    `${status.syncNeeded ? '❌' : '✅'} Overlay and access states match`,
                ].join('\n'),
            },
            {
                name: 'Unlocked Now',
                value: unlockedNow,
            },
            {
                name: 'Blocked / Needs Action',
                value: blockedNow,
            },
            {
                name: 'Bot Setup Readiness',
                value: buildSetupReadinessLines(readiness),
            },
            {
                name: 'What To Fix Next',
                value: [
                    status.recommendedNextAction,
                    '',
                    buildSetupReadinessNextSteps(readiness),
                ].join('\n'),
            },
            {
                name: 'Recommended Order',
                value: [
                    '1. `/connectleague`',
                    '2. `/league-status`',
                    '3. `/setup-channels`',
                    '4. `/setup-pins`',
                    '5. `/setup-roles`',
                    '6. `/syncsetupstatus`',
                    '7. `/server-check`',
                    '8. `/create-threads`',
                ].join('\n'),
            },
        );

    if (status.missingRequiredChannels.length || status.missingRequiredRoles.length) {
        embed.addFields({
            name: 'Missing Setup Items',
            value: [
                status.missingRequiredChannels.length ? `Channels: ${status.missingRequiredChannels.join(', ')}` : 'Channels: none',
                status.missingRequiredRoles.length ? `Roles: ${status.missingRequiredRoles.join(', ')}` : 'Roles: none',
            ].join('\n'),
        });
    }

    const components = readiness.inviteUrl
        ? [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setStyle(ButtonStyle.Link)
                    .setLabel('Invite LEAGUEbuddy')
                    .setURL(readiness.inviteUrl),
            ),
        ]
        : [];

    await interaction.reply({ embeds: [embed], components, ephemeral: true });
}

export default { data, execute };
