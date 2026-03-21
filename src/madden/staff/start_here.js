import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import {
  buildSetupReadinessLines,
  buildSetupReadinessNextSteps,
  inspectSetupReadiness,
} from './setup_readiness.js';

export const data = new SlashCommandBuilder()
  .setName('start-here')
  .setDescription('Admin-only: the full LEAGUEbuddy setup path from invite to first game.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export const deferOnDispatch = { flags: 64 };

export async function execute(interaction) {
  const readiness = await inspectSetupReadiness(interaction.guild);
  const embed = new EmbedBuilder()
    .setColor(0x1e90ff)
    .setTitle('Start Here')
    .setDescription('Use this first after inviting LEAGUEbuddy to a new server. This is the main setup flow.')
    .addFields(
      {
        name: 'Commissioner Flow',
        value: [
          '1. Turn on the package: `/activateplan`',
          'If you still need plan info first, check `/pricing`.',
          '2. Open the league dashboard: `/connectleague`',
          '3. In the dashboard: save the league name, optionally save the league password for onboarding later, connect EA, choose the Madden account, then choose the league.',
          '4. Return to Discord and confirm: `/league-status`',
          '5. Build the category and channels: `/setup-channels`',
          '6. Seed the pinned league boards: `/setup-pins`',
          '7. Create the staff, trade, and coach roles: `/setup-roles`',
          '8. Mark setup complete: `/syncsetupstatus`',
          '9. Confirm ready: `/server-check`',
          '10. Open the week: `/create-threads`',
          '11. Keep it moving weekly: `/weeklyupdate`',
        ].join('\n'),
      },
      {
        name: 'Before `/setup-channels`',
        value: [
          buildSetupReadinessLines(readiness),
          '',
          buildSetupReadinessNextSteps(readiness),
        ].join('\n'),
      },
      {
        name: 'If You Are Testing',
        value: [
          'Use `/activateplan plan:free`, `/activateplan plan:standard`, or `/activateplan plan:premium`.',
          'Then run the same flow above.',
        ].join('\n'),
      },
      {
        name: 'Coach Staffing',
        value: [
          'Assign coaches or committee members: `/member assign`',
          'Remove them later: `/member remove`',
          'Standard and Premium can also use `/member onboard`.',
        ].join('\n'),
      },
      {
        name: 'Tier Differences',
        value: [
          'Free: core league tools, coach assignment, threads, weekly updates.',
          'Standard: adds trades, scouting, draft tools, onboarding.',
          'Premium: adds franchise hub and premium strategy tools.',
        ].join('\n'),
      },
    )
    .setFooter({ text: 'Install entry: invite bot -> /start-here. Main path now begins with /connectleague before the Discord setup flow continues.' });

  const components = readiness.inviteUrl
    ? [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel('Invite LEAGUEbuddy')
            .setURL(readiness.inviteUrl),
        ),
      ]
    : [];

  await interaction.editReply({ embeds: [embed], components });
}

export default { data, execute, deferOnDispatch };
