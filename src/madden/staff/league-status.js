import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import connectionService from '../services/export_first_connection_service.js';

export const data = new SlashCommandBuilder()
  .setName('league-status')
  .setDescription('Show the current export/import connection status for this server.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export const deferOnDispatch = { flags: 64 };

export async function execute(interaction) {
  if (!interaction.guildId) {
    await interaction.editReply({ content: 'This command can only be used in a server.' });
    return;
  }

  const status = connectionService.getLeagueConnectionStatus(interaction.guildId);
  const connection = status.connection;
  const snapshot = status.latestSnapshot;
  const exportSources = status.exportSources || [];
  const guildTokens = status.guildTokens;

  if (!connection) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('League Status')
          .setColor(0xf39c12)
          .setDescription('No league is connected to this server yet.')
          .addFields(
            { name: 'Next', value: 'Run `/connectleague`, open the dashboard, save the league name, connect EA, choose your Madden account, then choose your league.', inline: false },
          ),
      ],
    });
    return;
  }

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle('League Status')
        .setColor(connection.status === 'connected' ? 0x57f287 : 0xf39c12)
        .addFields(
          { name: 'League', value: connection.leagueName || 'Unknown', inline: false },
          { name: 'Status', value: connection.status || 'unknown', inline: true },
          { name: 'Source', value: connection.sourceType || 'unknown', inline: true },
          { name: 'EA Connected', value: guildTokens ? 'yes' : 'no', inline: true },
          { name: 'Last Snapshot', value: snapshot?.id || 'none', inline: false },
          { name: 'Week', value: String(snapshot?.summary?.week || connection?.summary?.week || 'unknown'), inline: true },
          { name: 'Teams', value: String(snapshot?.summary?.teams || connection?.summary?.teams || 0), inline: true },
          { name: 'Last Import', value: snapshot?.createdAt ? `<t:${Math.floor(new Date(snapshot.createdAt).getTime() / 1000)}:R>` : 'never', inline: false },
          { name: 'Next', value: connection.sourceType === 'ea_dashboard'
            ? 'Your league is linked through the dashboard. Return there if you need to reconnect EA or pick a different league.'
            : 'This league was connected through a fallback source. Return to the dashboard if you want to move it onto the EA-driven setup path.',
            inline: false },
        ),
    ],
  });
}

export default { data, execute };
