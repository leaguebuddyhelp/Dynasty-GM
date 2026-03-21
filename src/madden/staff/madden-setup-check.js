import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { displaySetupItemName, getSetupStatus } from '../../leaguebuddy/setup_status_service.js';
import {
    buildSetupReadinessLines,
    buildSetupReadinessNextSteps,
    inspectSetupReadiness,
} from './setup_readiness.js';

export const data = new SlashCommandBuilder()
    .setName('setup-check')
    .setDescription('View only the Madden setup progress for this server.');

function describeSetupStage(status) {
    if (!status.overlayStatus.exists) {
        return 'Setup has not started yet. Begin with `/connectleague`, then `/setup-channels`.';
    }
    if (!status.overlayStatus.isComplete) {
        return 'Final setup is still missing. Run `/setup-roles` to finish the LEAGUEbuddy role pass, then run `/syncsetupstatus`.';
    }
    if (status.syncNeeded) {
        return 'One final setup step is left: run `/syncsetupstatus` so LEAGUEbuddy access matches the completed setup.';
    }
    if (!status.setupCompleted) {
        return 'Run `/syncsetupstatus` to mark setup complete.';
    }
    return 'Setup is complete. The next check should be `/server-check`.';
}

function setupStepLines(status) {
    return [
        `${status.overlayStatus.exists ? '✅' : '❌'} League connected and setup started`,
        `${status.missingRequiredChannels.length === 0 && status.overlayStatus.exists ? '✅' : '❌'} Channels created`,
        `${status.overlayStatus.exists ? '✅' : '❌'} Pins seeded`,
        `${status.missingRequiredRoles.length === 0 ? '✅' : '❌'} Roles created`,
        `${status.overlayStatus.isComplete ? '✅' : '❌'} Final setup pass finished`,
        `${status.syncNeeded ? '❌' : status.setupCompleted ? '✅' : '❌'} Setup synced to LEAGUEbuddy access`,
    ].join('\n');
}

function formatMissingSetupItems(items = []) {
    return items.map((item) => displaySetupItemName(item)).join(', ');
}

export async function execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
        return;
    }

    const status = getSetupStatus(guildId);
    const readiness = await inspectSetupReadiness(interaction.guild);
    const setupSummary = describeSetupStage(status);

    const embed = new EmbedBuilder()
        .setTitle('Madden Setup Check')
        .setColor(status.syncNeeded ? 0xf1c40f : status.overlayStatus.isComplete && status.setupCompleted ? 0x57f287 : 0x5865f2)
        .setDescription(setupSummary)
        .addFields(
            {
                name: 'Setup Steps',
                value: setupStepLines(status),
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
            name: 'Missing Final Setup Items',
            value: [
                status.missingRequiredChannels.length ? `Channels: ${formatMissingSetupItems(status.missingRequiredChannels)}` : 'Channels: none',
                status.missingRequiredRoles.length ? `Roles: ${formatMissingSetupItems(status.missingRequiredRoles)}` : 'Roles: none',
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
