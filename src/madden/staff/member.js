import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { execute as onboardExecute, autocomplete as onboardAutocomplete } from './onboard.js';
import { execute as assignExecute, autocomplete as assignAutocomplete } from './assignteam.js';
import { execute as removeExecute, autocomplete as removeAutocomplete } from './removeteam.js';
import { hasFeatureAccess, DEFAULT_DENY_MESSAGE } from '../../leaguebuddy/access.js';

export const data = new SlashCommandBuilder()
  .setName('member')
  .setDescription('Admin-only: onboard, assign, or remove league members in one place.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('onboard')
      .setDescription('Assign a coach to a team and send the onboarding pack.')
      .addUserOption((o) => o.setName('user').setDescription('Coach to onboard').setRequired(true))
      .addStringOption((o) => o.setName('team').setDescription('Team name').setRequired(true).setAutocomplete(true)))
  .addSubcommand((subcommand) =>
    subcommand
      .setName('assign')
      .setDescription('Assign a coach or committee role.')
      .addUserOption((o) => o.setName('user').setDescription('User to assign').setRequired(true))
      .addStringOption((o) => o.setName('role1').setDescription('First role to assign').setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName('role2').setDescription('Second role to assign').setRequired(false).setAutocomplete(true)))
  .addSubcommand((subcommand) =>
    subcommand
      .setName('remove')
      .setDescription('Remove a coach or committee role.')
      .addUserOption((o) => o.setName('user').setDescription('User to update').setRequired(true))
      .addStringOption((o) => o.setName('role1').setDescription('First role to remove').setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName('role2').setDescription('Second role to remove').setRequired(false).setAutocomplete(true)));

export async function execute(interaction) {
  const action = interaction.options.getSubcommand();
  if (action === 'onboard') {
    const guildId = interaction.guildId;
    if (guildId) {
      const check = hasFeatureAccess(guildId, 'scouting_draft');
      if (!check.ok) {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: DEFAULT_DENY_MESSAGE });
        } else {
          await interaction.reply({ content: DEFAULT_DENY_MESSAGE, ephemeral: true });
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
