import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getBillingSummary } from '../../leaguebuddy/manual_billing_service.js';

export const data = new SlashCommandBuilder()
    .setName('viewplan')
    .setDescription('Admin-only: view this server\'s LEAGUEbuddy plan + subscription state.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export const deferOnDispatch = { flags: 64 };

export async function execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.editReply({ content: 'This command can only be used in a server.' });
        return;
    }

    const rec = getBillingSummary(guildId);
    if (!rec) {
        await interaction.editReply({
            content: 'No server record found yet. Run `/setup-channels` to create one (defaults to free).',
        });
        return;
    }

    await interaction.editReply({
        content: [
            '**LEAGUEbuddy Plan**',
            `Plan: **${rec.plan}**`,
            `Subscription: **${rec.subscriptionStatus}**`,
            `Billing interval: **${rec.billing?.interval || 'month'}**`,
            `Activated at: ${rec.activatedAt || '(not activated)'}`,
            `Payment source: ${rec.billing?.paymentSource || '(not set)'}`,
            `Payment reference: ${rec.billing?.paymentReference || '(not set)'}`,
        ].join('\n'),
    });
}

export default { data, execute };
