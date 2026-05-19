import { SlashCommandBuilder } from 'discord.js';
import { execute as onboardExecute, autocomplete as onboardAutocomplete } from './onboard.js';
import { execute as assignExecute, autocomplete as assignAutocomplete } from './assignteam.js';
import { execute as removeExecute, autocomplete as removeAutocomplete } from './removeteam.js';
import { featureAccessDenyMessage, hasFeatureAccess } from '../../leaguebuddy/access.js';

export const data = new SlashCommandBuilder()
  .setName('member')
  .setDescription('Admin-only: onboard, assign, or remove league members in one place.')
  .setDefaultMemberPermissions(null)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('onboard')
      .setDescription('Assign a coach to a team and send the onboarding pack.')
      .addUserOption((o) => o.setName('user').setDescription('Coach to onboard').setRequired(true))
      .addStringOption((o) => o.setName('team').setDescription('Team name').setRequired(true).setAutocomplete(true)))
  .addSubcommand((subcommand) =>
    subcommand
      .setName('assign')
      .setDescription('Assign one or two league roles to a user.')
      .addUserOption((o) => o.setName('user').setDescription('User to assign').setRequired(true))
      .addStringOption((o) => o.setName('role').setDescription('Role to assign').setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName('extra_role').setDescription('Optional second role').setRequired(false).setAutocomplete(true)))
  .addSubcommand((subcommand) =>
    subcommand
      .setName('remove')
      .setDescription('Remove one or two league roles from a user.')
      .addUserOption((o) => o.setName('user').setDescription('User to update').setRequired(true))
      .addStringOption((o) => o.setName('role').setDescription('Role to remove').setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName('extra_role').setDescription('Optional second role').setRequired(false).setAutocomplete(true)));

export async function execute(interaction) {
  const action = interaction.options.getSubcommand();
  if (action === 'onboard') {
    const guildId = interaction.guildId;
    if (guildId) {
      const check = hasFeatureAccess(guildId, 'scouting_draft', { requireSetup: false });
      if (!check.ok) {
        const message = featureAccessDenyMessage(check);
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: message });
        } else {
          await interaction.reply({ content: message, ephemeral: true });
        }
        return;
      }
    }
    return onboardExecute(interaction);
  }
  if (action === 'assign') return assignExecute(interaction);
  if (action === 'remove') return removeExecute(interaction);
  return interaction.reply({ content: 'Unknown member action.', ephemeral: true });
}

export async function autocomplete(interaction) {
  const action = interaction.options.getSubcommand();
  if (action === 'onboard') return onboardAutocomplete(interaction);
  if (action === 'assign') return assignAutocomplete(interaction);
  if (action === 'remove') return removeAutocomplete(interaction);
}

export default { data, execute, autocomplete };
