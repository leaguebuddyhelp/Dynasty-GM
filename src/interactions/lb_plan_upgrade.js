import { ButtonInteraction } from 'discord.js';

import { buildUpgradeReply, isBuyingEnabled } from '../leaguebuddy/upgrade_ux.js';

export const customId = /^lb_plan_upgrade\|(standard|premium)$/;

function canManage(interaction) {
    const perms = interaction?.memberPermissions;
    return !!(perms?.has?.('ManageGuild') || perms?.has?.('Administrator'));
}

export async function execute(interaction) {
    if (!(interaction instanceof ButtonInteraction)) return;

    if (!isBuyingEnabled()) {
        await interaction.reply({ content: 'LEAGUEbuddy buying is disabled while this league is in private testing.', ephemeral: true });
        return;
    }

    if (!interaction.guildId) {
        await interaction.reply({ content: 'This button only works in a server.', ephemeral: true });
        return;
    }

    if (!canManage(interaction)) {
        await interaction.reply({ content: 'Only server administrators can manage upgrades.', ephemeral: true });
        return;
    }

    const match = customId.exec(interaction.customId);
    const target = match?.[1];
    if (!target) return;
    const clientId = interaction.applicationId || interaction.client?.application?.id || null;

    // Keep the original /plan message intact; respond ephemerally.
    await interaction.reply({
        ...buildUpgradeReply({ targetPlan: target, guildId: interaction.guildId, clientId }),
        ephemeral: true,
    });
}

export default { customId, execute };
