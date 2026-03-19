import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { SUBSCRIPTION_STATUSES } from '../../leaguebuddy/guild_store.js';
import { buildActorFromInteraction } from '../../leaguebuddy/audit.js';
import { deactivatePlanManually } from '../../leaguebuddy/manual_billing_service.js';

export const data = new SlashCommandBuilder()
  .setName('deactivateplan')
  .setDescription('Admin-only: manually deactivate or cancel a guild subscription state.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((o) =>
    o.setName('guild_id')
      .setDescription('Optional target guild id. Defaults to this server.')
      .setRequired(false))
  .addStringOption((o) =>
    o.setName('subscription_status')
      .setDescription('Status to set')
      .setRequired(false)
      .addChoices(
        { name: 'canceled', value: SUBSCRIPTION_STATUSES.canceled },
        { name: 'inactive', value: SUBSCRIPTION_STATUSES.inactive },
        { name: 'past_due', value: SUBSCRIPTION_STATUSES.past_due },
      ))
  .addStringOption((o) =>
    o.setName('note')
      .setDescription('Optional billing/admin note')
      .setRequired(false));

export const deferOnDispatch = { flags: 64 };

export async function execute(interaction) {
  const guildId = interaction.options.getString('guild_id') || interaction.guildId;
  if (!guildId) {
    await interaction.editReply({ content: 'A guild id is required when used outside a server.' });
    return;
  }

  const actor = buildActorFromInteraction(interaction);
  const subscriptionStatus = interaction.options.getString('subscription_status') || SUBSCRIPTION_STATUSES.canceled;
  const billingNote = interaction.options.getString('note');

  const rec = deactivatePlanManually(guildId, {
    subscriptionStatus,
    billingNote,
    actor,
    source: 'command:/deactivateplan',
  });

  await interaction.editReply({
    content: [
      '**Plan deactivated**',
      `Guild: **${guildId}**`,
      `Plan remains: **${rec.plan}**`,
      `Subscription: **${rec.subscriptionStatus}**`,
    ].join('\n'),
  });
}

export default { data, execute };
