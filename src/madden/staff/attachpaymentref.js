import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { buildActorFromInteraction } from '../../leaguebuddy/audit.js';
import { attachPaymentReference } from '../../leaguebuddy/manual_billing_service.js';

export const data = new SlashCommandBuilder()
  .setName('attachpaymentref')
  .setDescription('Admin-only: attach a manual Stripe/payment reference to a guild record.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((o) =>
    o.setName('guild_id')
      .setDescription('Optional target guild id. Defaults to this server.')
      .setRequired(false))
  .addStringOption((o) =>
    o.setName('payment_reference')
      .setDescription('Stripe/payment reference')
      .setRequired(true))
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
    o.setName('billing_note')
      .setDescription('Optional billing note')
      .setRequired(false))
  .addStringOption((o) =>
    o.setName('internal_note')
      .setDescription('Optional internal note')
      .setRequired(false));

export const deferOnDispatch = { flags: 64 };

export async function execute(interaction) {
  const guildId = interaction.options.getString('guild_id') || interaction.guildId;
  if (!guildId) {
    await interaction.editReply({ content: 'A guild id is required when used outside a server.' });
    return;
  }

  const actor = buildActorFromInteraction(interaction);
  const paymentReference = interaction.options.getString('payment_reference', true);
  const paymentSource = interaction.options.getString('payment_source');
  const billingNote = interaction.options.getString('billing_note');
  const internalNote = interaction.options.getString('internal_note');

  const rec = attachPaymentReference(guildId, {
    paymentReference,
    paymentSource,
    billingNote,
    internalNote,
    actor,
    source: 'command:/attachpaymentref',
  });

  await interaction.editReply({
    content: [
      '**Payment reference attached**',
      `Guild: **${guildId}**`,
      `Reference: **${rec.billing?.paymentReference || '(none)'}**`,
      `Source: **${rec.billing?.paymentSource || 'manual'}**`,
    ].join('\n'),
  });
}

export default { data, execute };
