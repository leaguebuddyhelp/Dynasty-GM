import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { PLANS, SUBSCRIPTION_STATUSES, getGuildRecord } from '../../leaguebuddy/guild_store.js';
import { buildActorFromInteraction } from '../../leaguebuddy/audit.js';
import { activatePlanManually } from '../../leaguebuddy/manual_billing_service.js';
import { normalizePlan } from '../../leaguebuddy/plans.js';

export const data = new SlashCommandBuilder()
    .setName('setplan')
    .setDescription('Admin-only: manually set this server\'s plan (free | standard | premium).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
        o.setName('plan')
            .setDescription('Plan to set')
            .setRequired(true)
            .addChoices(
                { name: 'Free', value: PLANS.free },
                { name: 'Standard', value: PLANS.standard },
                { name: 'Premium', value: PLANS.premium },
            )
    )
    .addStringOption((o) =>
        o.setName('subscription_status')
            .setDescription('Optional subscription state (defaults to active for paid plans, inactive for free)')
            .setRequired(false)
            .addChoices(
                { name: 'inactive', value: SUBSCRIPTION_STATUSES.inactive },
                { name: 'active', value: SUBSCRIPTION_STATUSES.active },
                { name: 'trialing', value: SUBSCRIPTION_STATUSES.trialing },
                { name: 'past_due', value: SUBSCRIPTION_STATUSES.past_due },
                { name: 'canceled', value: SUBSCRIPTION_STATUSES.canceled },
            )
    );

export const deferOnDispatch = { flags: 64 };

export async function execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.editReply({ content: 'This command can only be used in a server.' });
        return;
    }

    const actor = buildActorFromInteraction(interaction);

    const plan = normalizePlan(interaction.options.getString('plan'));
    const statusOpt = interaction.options.getString('subscription_status');

    const defaultStatus = plan === PLANS.free
        ? SUBSCRIPTION_STATUSES.inactive
        : SUBSCRIPTION_STATUSES.active;

    const subscriptionStatus = statusOpt ? String(statusOpt) : defaultStatus;

    const before = getGuildRecord(guildId, { createIfMissing: false });
    const rec = activatePlanManually(guildId, {
        plan,
        subscriptionStatus,
        actor,
        source: 'command:/setplan',
    });

    await interaction.editReply({
        content: [
            '**LEAGUEbuddy plan updated**',
            before ? 'Record: updated ✅' : 'Record: created ✅',
            `Plan: **${rec.plan}**`,
            `Subscription: **${rec.subscriptionStatus}**`,
            `Billing interval: **${rec.billing?.interval || 'month'}**`,
        ].join('\n'),
    });
}

export default { data, execute };
