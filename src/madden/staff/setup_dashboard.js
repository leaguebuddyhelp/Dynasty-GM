import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { loadGuildMaddenConfig } from '../../shared/madden_guild_config.js';
import { getExplicitLeagueForGuild } from '../madden_config.js';
import { loadLeagueSnapshot } from '../madden_data.js';
import { ensureNewBoardChannels, SOLO_CHANNELS } from './madden-setup.js';
import connectionService from '../services/export_first_connection_service.js';

export const data = new SlashCommandBuilder().setName('setup').setDescription('Connect your solo franchise and set up Franchise HQ.');
export const deferOnDispatch = { flags: 64 };

export async function execute(interaction) {
  const guildId = interaction.guildId;
  let boardUpdate;
  let channelError = null;
  try {
    boardUpdate = await ensureNewBoardChannels(interaction);
  } catch (error) {
    console.error('[setup] failed to add Top 100 and All-Pro channels', error);
    channelError = error?.message || String(error);
  }
  const config = loadGuildMaddenConfig(guildId);
  const leagueId = getExplicitLeagueForGuild(guildId);
  let snapshot = null;
  if (leagueId) {
    try { snapshot = loadLeagueSnapshot(leagueId); } catch { /* First sync has not completed. */ }
  }
  const channelsReady = !channelError && config?.status === 'complete'
    && SOLO_CHANNELS.every(([key]) => config?.compat?.maddenChannelMap?.[key]);
  const { setupUrl } = connectionService.beginLeagueConnection({ guildId, guildName: interaction.guild?.name, createdByUserId: interaction.user.id });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('madden_setup|channels').setLabel(channelsReady ? 'Repair Channels' : 'Create Franchise HQ').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setLabel(leagueId ? 'Reconnect Franchise' : 'Connect Franchise').setStyle(ButtonStyle.Link).setURL(setupUrl),
    new ButtonBuilder().setCustomId('madden_setup|refresh').setLabel('Check Again').setStyle(ButtonStyle.Secondary),
  );
  await interaction.editReply({ embeds: [new EmbedBuilder()
    .setTitle('Solo Franchise Setup')
    .setColor(channelsReady && snapshot ? 0x57f287 : 0x5865f2)
    .setDescription('Create your Franchise HQ, connect EA or import an export, then run `/sync`.')
    .addFields(
      { name: 'Channels', value: channelError || (channelsReady ? boardUpdate?.updated ? 'Ready · Top 100 and All-Pro channels updated' : 'Ready' : 'Create or repair Franchise HQ'), inline: true },
      { name: 'Franchise', value: leagueId ? String(leagueId) : 'Connect your franchise', inline: true },
      { name: 'League Data', value: snapshot ? 'Snapshot available' : 'Waiting for the first import or sync', inline: true },
      { name: 'Next', value: channelsReady && snapshot ? 'Run `/sync` after advancing in Madden. Use `/help` to browse your tools.' : 'Use the buttons below, then run `/sync` once your franchise is connected.' },
    )], components: [row] });
}
export default { data, execute, deferOnDispatch };
