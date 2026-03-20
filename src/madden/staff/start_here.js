import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('start-here')
  .setDescription('Admin-only: the full LEAGUEbuddy setup path from invite to first game.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export const deferOnDispatch = { flags: 64 };

export async function execute(interaction) {
  const embed = new EmbedBuilder()
    .setColor(0x1e90ff)
    .setTitle('Start Here')
    .setDescription('Use this when you are setting up LEAGUEbuddy in a new server. There is one main flow.')
    .addFields(
      {
        name: 'Commissioner Flow',
        value: [
          '1. Turn on the package: `/activateplan`',
          '2. Start the account connection flow: `/auth`',
          '3. Connect the league: `/install-league`',
          '4. Pull the league data: `/sync`',
          '5. Build the category and channels, then attempt the first pin pass: `/setup-channels`',
          'If that reply says pins missed, rerun only pins with `/setup-pins`',
          '6. Create the staff, trade, and coach roles: `/setup-roles`',
          '7. Mark setup complete: `/syncsetupstatus`',
          '8. Confirm ready: `/server-check`',
          '9. Open the week: `/create-threads`',
          '10. Keep it moving weekly: `/weeklyupdate`',
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
    .setFooter({ text: 'Main path: /activateplan -> /auth -> /install-league -> /sync -> /setup-channels -> /setup-roles -> /syncsetupstatus -> /server-check -> /create-threads' });

  await interaction.editReply({ embeds: [embed] });
}

export default { data, execute, deferOnDispatch };
