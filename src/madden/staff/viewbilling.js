import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getBillingSummary } from '../../leaguebuddy/manual_billing_service.js';
import auditRepository from '../../leaguebuddy/repositories/audit_log_repository.js';

export const data = new SlashCommandBuilder()
  .setName('viewbilling')
  .setDescription('Admin-only: view manual billing metadata for a guild.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((o) =>
    o.setName('guild_id')
      .setDescription('Optional target guild id. Defaults to this server.')
      .setRequired(false));

export const deferOnDispatch = { flags: 64 };

export async function execute(interaction) {
  const guildId = interaction.options.getString('guild_id') || interaction.guildId;
  if (!guildId) {
    await interaction.editReply({ content: 'A guild id is required when used outside a server.' });
    return;
  }

  const billing = getBillingSummary(guildId);
  if (!billing) {
    await interaction.editReply({ content: 'No billing record found for that guild.' });
    return;
  }

  const recent = auditRepository.listRecentAuditEvents({
    guildId,
    kinds: [
      'billing.manual_activation',
      'billing.manual_deactivation',
      'billing.payment_reference_attached',
      'plan.set',
      'subscription_status.set',
    ],
    limit: 5,
  });

  await interaction.editReply({
    content: [
      '**Manual Billing**',
      `Guild: **${guildId}**`,
      `Plan: **${billing.plan}**`,
      `Subscription: **${billing.subscriptionStatus}**`,
      `Guild activated at: ${billing.activatedAt || '(not set)'}`,
      `Billing activated at: ${billing.billing?.activatedAt || '(not set)'}`,
      `Activated by: ${billing.billing?.activatedBy || '(not set)'}`,
      `Last plan change at: ${billing.billing?.lastPlanChangeAt || '(not set)'}`,
      `Payment source: ${billing.billing?.paymentSource || '(not set)'}`,
      `Payment reference: ${billing.billing?.paymentReference || '(not set)'}`,
      `Billing note: ${billing.billing?.billingNote || '(none)'}`,
      `Internal note: ${billing.billing?.internalNote || '(none)'}`,
      '',
      '**Recent billing/admin events**',
      recent.length
        ? recent.map((item) => `• ${item.kind} @ ${item.ts}`).join('\n')
        : '(none)',
    ].join('\n'),
  });
}

export default { data, execute };
