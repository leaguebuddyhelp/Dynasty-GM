import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { PLANS, SUBSCRIPTION_STATUSES } from '../../leaguebuddy/guild_store.js';
import { buildActorFromInteraction } from '../../leaguebuddy/audit.js';
import { activatePlanManually } from '../../leaguebuddy/manual_billing_service.js';

export const data = new SlashCommandBuilder()
  .setName('activateplan')
  .setDescription('Admin-only: manually activate a guild plan after payment confirmation.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((o) =>
    o.setName('plan')
      .setDescription('Plan to activate')
      .setRequired(true)
      .addChoices(
        { name: 'Free', value: PLANS.free },
        { name: 'Standard', value: PLANS.standard },
        { name: 'Premium', value: PLANS.premium },
      ))
  .addStringOption((o) =>
    o.setName('guild_id')
      .setDescription('Optional target guild id. Defaults to this server.')
      .setRequired(false))
  .addStringOption((o) =>
    o.setName('subscription_status')
      .setDescription('Optional status override')
      .setRequired(false)
      .addChoices(
        { name: 'inactive', value: SUBSCRIPTION_STATUSES.inactive },
        { name: 'active', value: SUBSCRIPTION_STATUSES.active },
        { name: 'trialing', value: SUBSCRIPTION_STATUSES.trialing },
        { name: 'past_due', value: SUBSCRIPTION_STATUSES.past_due },
        { name: 'canceled', value: SUBSCRIPTION_STATUSES.canceled },
      ))
  .addStringOption((o) =>
    o.setName('payment_reference')
      .setDescription('Optional Stripe/payment reference')
      .setRequired(false))
  .addStringOption((o) =>
    o.setName('payment_source')
      .setDescription('Optional payment source')
      .setRequired(false)
      .addChoices(
        { name: 'stripe_payment_link', value: 'stripe_payment_link' },
        { name: 'manual', value: 'manual' },
        { name: 'other', value: 'other' },
      ))
  .addStringOption((o) =>
    o.setName('note')
      .setDescription('Optional admin-visible billing note')
      .setRequired(false));

export const deferOnDispatch = { flags: 64 };

export async function execute(interaction) {
  const guildId = interaction.options.getString('guild_id') || interaction.guildId;
  if (!guildId) {
    await interaction.editReply({ content: 'A guild id is required when used outside a server.' });
    return;
  }

  const actor = buildActorFromInteraction(interaction);
  const plan = interaction.options.getString('plan', true);
  const subscriptionStatus = interaction.options.getString('subscription_status');
  const paymentReference = interaction.options.getString('payment_reference');
  const paymentSource = interaction.options.getString('payment_source');
  const billingNote = interaction.options.getString('note');

  const rec = activatePlanManually(guildId, {
    plan,
    subscriptionStatus,
    paymentReference,
    paymentSource,
    billingNote,
    actor,
    source: 'command:/activateplan',
  });

  await interaction.editReply({
    content: [
      '**Plan activated**',
      `Guild: **${guildId}**`,
      `Plan: **${rec.plan}**`,
      `Subscription: **${rec.subscriptionStatus}**`,
      `Payment reference: ${rec.billing?.paymentReference || '(none)'}`,
      `Payment source: ${rec.billing?.paymentSource || '(none)'}`,
      '',
      'Next: run `/auth`.',
    ].join('\n'),
  });
}

export default { data, execute };
