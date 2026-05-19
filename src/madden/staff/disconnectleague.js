import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import connectionService from '../services/export_first_connection_service.js';

export const data = new SlashCommandBuilder()
  .setName('disconnectleague')
  .setDescription('Reset this server’s Madden connection so you can reconnect EA and choose a league again.')
  .addBooleanOption((option) =>
    option
      .setName('confirm')
      .setDescription('Set to true to confirm the disconnect and clear this server’s Madden connection.')
      .setRequired(false),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export const deferOnDispatch = { flags: 64 };

export async function execute(interaction) {
  if (!interaction.guildId) {
    await interaction.editReply({ content: 'This command can only be used in a server.' });
    return;
  }

  const confirm = interaction.options.getBoolean('confirm') === true;
  if (!confirm) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Are You Sure?')
          .setColor(0xe67e22)
          .setDescription('`/disconnectleague` clears this server’s Madden connection and setup state.')
          .addFields(
            {
              name: 'What Happens',
              value: [
                'EA connection for this server is removed',
                'Saved league mapping for this server is removed',
                'Dashboard setup state for this server is cleared',
                'Latest stored snapshot for the previously linked league is deleted',
              ].join('\n'),
              inline: false,
            },
            {
              name: 'To Continue',
              value: 'Run `/disconnectleague confirm:true` if you want to fully reset this server.',
              inline: false,
            },
          ),
      ],
    });
    return;
  }

  const result = connectionService.resetLeagueConnectionByGuild(interaction.guildId);
  if (!result?.ok) {
    await interaction.editReply({
      content: result?.message || 'Could not reset this server’s league connection right now.',
    });
    return;
  }

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle('League Connection Reset')
        .setColor(0xf39c12)
        .setDescription('This server’s Madden connection was cleared so you can start over cleanly.')
        .addFields(
          { name: 'Discord Server', value: interaction.guild?.name || 'Unknown Server', inline: false },
          {
            name: 'What Was Cleared',
            value: [
              'EA connection for this server',
              'Saved league mapping for this server',
              'Dashboard setup state for this server',
              'Latest stored snapshot for the previously linked league',
            ].join('\n'),
            inline: false,
          },
          {
            name: 'Next',
            value: 'Run `/setup` and go through the dashboard again from the start.',
            inline: false,
          },
        ),
    ],
  });
}

export default { data, execute, deferOnDispatch };
