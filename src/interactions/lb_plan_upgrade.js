import { ButtonInteraction } from 'discord.js';

import { buildUpgradeReply } from '../leaguebuddy/upgrade_ux.js';

export const customId = /^lb_plan_upgrade\|(standard|premium)$/;

function canManage(interaction) {
    const perms = interaction?.memberPermissions;
    return !!(perms?.has?.('ManageGuild') || perms?.has?.('Administrator'));
}

export async function execute(interaction) {
    if (!(interaction instanceof ButtonInteraction)) return;

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

    // Keep the original /plan message intact; respond ephemerally.
    await interaction.reply({
        ...buildUpgradeReply({ targetPlan: target, guildId: interaction.guildId }),
        ephemeral: true,
    });
}

export default { customId, execute };
