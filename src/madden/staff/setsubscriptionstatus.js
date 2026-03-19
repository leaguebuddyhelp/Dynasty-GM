import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { SUBSCRIPTION_STATUSES } from '../../leaguebuddy/guild_store.js';
import { buildActorFromInteraction } from '../../leaguebuddy/audit.js';
import { deactivatePlanManually } from '../../leaguebuddy/manual_billing_service.js';
import { ensureGuildActivated, setSubscriptionStatus } from '../../leaguebuddy/guild_access_service.js';

export const data = new SlashCommandBuilder()
    .setName('setsubscriptionstatus')
    .setDescription('Admin-only: set this server\'s subscription status (manual ops).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
        o.setName('status')
            .setDescription('New subscription status')
            .setRequired(true)
            .addChoices(
                { name: SUBSCRIPTION_STATUSES.inactive, value: SUBSCRIPTION_STATUSES.inactive },
                { name: SUBSCRIPTION_STATUSES.active, value: SUBSCRIPTION_STATUSES.active },
                { name: SUBSCRIPTION_STATUSES.trialing, value: SUBSCRIPTION_STATUSES.trialing },
                { name: SUBSCRIPTION_STATUSES.past_due, value: SUBSCRIPTION_STATUSES.past_due },
                { name: SUBSCRIPTION_STATUSES.canceled, value: SUBSCRIPTION_STATUSES.canceled },
            )
    );

export const deferOnDispatch = { flags: 64 };

export async function execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.editReply({ content: 'This command can only be used in a server.' });
        return;
    }

    const status = interaction.options.getString('status', true);
    const actor = buildActorFromInteraction(interaction);

    ensureGuildActivated(guildId, { actor, source: 'command:/setsubscriptionstatus' });
    const rec = (
        status === SUBSCRIPTION_STATUSES.canceled || status === SUBSCRIPTION_STATUSES.inactive
            ? deactivatePlanManually(guildId, {
                subscriptionStatus: status,
                actor,
                source: 'command:/setsubscriptionstatus',
            })
            : setSubscriptionStatus(guildId, status, { actor, source: 'command:/setsubscriptionstatus' })
    );

    await interaction.editReply({
        content: [
            '**Subscription status updated**',
            `Status: **${rec.subscriptionStatus}**`,
            `Plan: **${rec.plan}**`,
        ].join('\n'),
    });
}

export default { data, execute };
