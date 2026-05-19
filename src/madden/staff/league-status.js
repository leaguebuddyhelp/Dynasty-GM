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
  const syncError = connection?.summary?.lastSyncError ? String(connection.summary.lastSyncError) : '';

  function buildSyncNextStep(errorText) {
    if (!errorText) {
      return 'Your league is linked. If this is a new server, run `/setup` now. To fully restart from scratch later, run `/disconnectleague`.';
    }
    if (errorText.includes('temporary system error')) {
      return 'EA returned a temporary service error. Wait a moment, then run `/sync` again.';
    }
    if (errorText.includes('session expired') || errorText.includes('Reconnect EA')) {
      return 'The league is linked, but the EA session expired. Reconnect EA from `/setup`, then run `/sync`.';
    }
    if (errorText.includes('taking too long')) {
      return 'EA took too long to respond. Run `/sync` again. If it keeps timing out, reopen the dashboard and reconnect EA.';
    }
    return 'The league is linked, but the first sync failed. Run `/sync` now. If it fails again, return to the dashboard and reconnect EA.';
  }

  if (!connection) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('League Status')
          .setColor(0xf39c12)
          .setDescription('No league is connected to this server yet.')
          .addFields(
            { name: 'Next', value: 'Run `/setup`, press Connect League, finish the dashboard flow, then refresh setup.', inline: false },
          ),
      ],
    });
    return;
  }

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle('League Status')
        .setColor(connection.status === 'connected' ? 0x57f287 : connection.status === 'sync_error' ? 0xed4245 : 0xf39c12)
        .addFields(
          { name: 'League', value: connection.leagueName || 'Unknown', inline: false },
          { name: 'Status', value: connection.status || 'unknown', inline: true },
          { name: 'Source', value: connection.sourceType || 'unknown', inline: true },
          { name: 'EA Connected', value: guildTokens ? 'yes' : 'no', inline: true },
          { name: 'Last Snapshot', value: snapshot?.id || 'none', inline: false },
          { name: 'Week', value: String(snapshot?.summary?.week || connection?.summary?.week || 'unknown'), inline: true },
          { name: 'Teams', value: String(snapshot?.summary?.teams || connection?.summary?.teams || 0), inline: true },
          { name: 'Last Import', value: snapshot?.createdAt ? `<t:${Math.floor(new Date(snapshot.createdAt).getTime() / 1000)}:R>` : 'never', inline: false },
          ...(syncError ? [{ name: 'Sync Error', value: syncError.slice(0, 1024), inline: false }] : []),
          { name: 'Next', value: connection.status === 'sync_error'
            ? buildSyncNextStep(syncError)
            : 'Your league is linked. Return to `/setup` and press Refresh Setup. To fully restart from scratch later, run `/disconnectleague`.',
            inline: false },
        ),
    ],
  });
}

export default { data, execute };
