import { SlashCommandBuilder } from 'discord.js';

import { buildPostPaymentEmbed, buildPricingEmbeds, buildPricingLinkRows, isBuyingEnabled } from '../../leaguebuddy/upgrade_ux.js';
import { getBillingSummary } from '../../leaguebuddy/manual_billing_service.js';

export const data = new SlashCommandBuilder()
  .setName('pricing')
  .setDescription('View LEAGUEbuddy Madden pricing, upgrade links, and payment steps.');

export const deferOnDispatch = { flags: 64 };

export async function execute(interaction) {
  const guildId = interaction.guildId || null;
  const currentPlan = guildId ? (getBillingSummary(guildId)?.plan || 'free') : 'free';
  const clientId = interaction.applicationId || interaction.client?.application?.id || null;

  await interaction.editReply({
    embeds: [
      ...buildPricingEmbeds({ currentPlan }),
      ...(isBuyingEnabled() ? [buildPostPaymentEmbed()] : []),
    ],
    components: buildPricingLinkRows({ currentPlan, clientId }),
  });
}

export default { data, execute };
