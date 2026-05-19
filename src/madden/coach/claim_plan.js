import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { buildActorFromInteraction } from '../../leaguebuddy/audit.js';
import { claimPlanForGuild } from '../../leaguebuddy/claim_service.js';
import { buildClaimInstructions } from '../../leaguebuddy/upgrade_ux.js';

export const data = new SlashCommandBuilder()
  .setName('claim-plan')
  .setDescription('Claim a paid LEAGUEbuddy plan for this server after checkout.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption((o) =>
    o.setName('code')
      .setDescription('Optional one-time claim code')
      .setRequired(false))
  .addStringOption((o) =>
    o.setName('payment_reference')
      .setDescription('Optional Stripe payment reference from your receipt')
      .setRequired(false));

export const deferOnDispatch = { flags: 64 };

export async function execute(interaction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.editReply({ content: 'This command can only be used in a server.' });
    return;
  }

  const claimCode = interaction.options.getString('code');
  const paymentReference = interaction.options.getString('payment_reference');
  if (!claimCode && !paymentReference) {
    const embed = new EmbedBuilder()
      .setColor(0xf39c12)
      .setTitle('Claim Your Plan')
      .setDescription('Enter either a one-time claim code or the Stripe payment reference from your receipt email.')
      .addFields({
        name: 'How It Works',
        value: buildClaimInstructions(),
      });
    await interaction.editReply({
      embeds: [embed],
      content: '',
    });
    return;
  }

  try {
    const actor = buildActorFromInteraction(interaction);
    const { claim, record } = await claimPlanForGuild({
      guildId,
      claimCode,
      paymentReference,
      actor,
      source: 'command:/claim-plan',
    });

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('Plan Claimed')
      .setDescription(`Your **${record.plan}** plan is now active for this server.`)
      .addFields(
        { name: 'Guild', value: String(guildId), inline: true },
        { name: 'Subscription', value: String(record.subscriptionStatus), inline: true },
        { name: 'Claim', value: claim.claimCode || '(payment reference)', inline: true },
        {
          name: 'Next Steps',
          value: [
            '• Run `/plan` to confirm access.',
            '• Run `/setup` to see the next server step.',
            '• If this is a brand new server, a manager should run `/setup` and press the button it shows.',
          ].join('\n'),
        },
        {
          name: 'Recovery Tip',
          value: 'If someone loses the one-time code, `/claim-plan payment_reference:...` can still use the Stripe receipt reference instead.',
        },
      );

    await interaction.editReply({
      embeds: [embed],
      content: '',
    });
  } catch (error) {
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('Claim Failed')
      .setDescription(error?.message || 'The plan could not be claimed right now.')
      .addFields({
        name: 'Tip',
        value: 'If you do not have a claim code yet, use the Stripe payment reference from your receipt email.',
      });
    await interaction.editReply({
      embeds: [embed],
      content: '',
    });
  }
}

export default { data, execute };
