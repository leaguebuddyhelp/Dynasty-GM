import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getBillingSummary } from '../../leaguebuddy/manual_billing_service.js';
import { getSetupStatus } from '../../leaguebuddy/setup_status_service.js';
import { hasFeatureAccess } from '../../leaguebuddy/access.js';
import { FEATURES } from '../../leaguebuddy/plans.js';

export const data = new SlashCommandBuilder()
    .setName('viewguildaccess')
    .setDescription('Admin-only: view access state (plan/subscription/setup + packs enabled).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export const deferOnDispatch = { flags: 64 };

export async function execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.editReply({ content: 'This command can only be used in a server.' });
        return;
    }

    const rec = getBillingSummary(guildId);
    const status = getSetupStatus(guildId);
    const packsEnabled = status.packsEnabled;

    const lines = [];
    lines.push('**LEAGUEbuddy Access Snapshot**');
    lines.push(`Plan: **${rec?.plan || 'free'}**`);
    lines.push(`Subscription: **${rec?.subscriptionStatus || 'inactive'}**`);
    lines.push(`Setup completed: **${status.setupCompleted ? 'yes' : 'no'}**`);
    lines.push(`Activated at: ${rec?.activatedAt || '(not activated)'}`);
    lines.push(`Payment source: ${rec?.billing?.paymentSource || '(not set)'}`);
    lines.push(`Payment reference: ${rec?.billing?.paymentReference || '(not set)'}`);
    lines.push('');
    lines.push('**packsEnabled (Madden overlay)**');
    lines.push(packsEnabled.length ? packsEnabled.map((p) => `• ${p}`).join('\n') : '(none)');
    lines.push('');
    lines.push('**Feature checks (plan gate only)**');

    for (const featureKey of Object.keys(FEATURES)) {
        const check = hasFeatureAccess(guildId, featureKey);
        const label = FEATURES[featureKey]?.label || featureKey;
        lines.push(`• ${check.ok ? '✅' : '❌'} ${label} (${featureKey}) — ${check.reason}`);
    }

    await interaction.editReply({ content: lines.join('\n') });
}

export default { data, execute };
