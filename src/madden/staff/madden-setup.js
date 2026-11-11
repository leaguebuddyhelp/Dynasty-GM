import { ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { loadGuildMaddenConfig, saveGuildMaddenConfig } from '../../shared/madden_guild_config.js';
import { getSoloInteractionDenial, getSoloModeConfig } from '../../leaguebuddy/solo_mode.js';

export const data = new SlashCommandBuilder()
  .setName('setup-channels')
  .setDescription('Create your private Franchise HQ and franchise management channels.');

export const SOLO_CATEGORIES = Object.freeze([
  { key: 'Franchise HQ', name: '🏈 FRANCHISE HQ' },
  { key: 'Franchise Management', name: '⚙️ FRANCHISE MANAGEMENT' },
]);
export const SOLO_CHANNELS = Object.freeze([
  ['Franchise Dashboard', 'franchise-dashboard', 'Franchise HQ'],
  ['Team Overalls', 'team-overalls', 'Franchise HQ'],
  ['Player Overalls', 'player-overalls', 'Franchise HQ'],
  ['Awards', 'awards', 'Franchise HQ'],
  ['Weekly Top 100', 'weekly-top-100', 'Franchise HQ'],
  ['Yearly Top 100', 'yearly-top-100', 'Franchise HQ'],
  ['All-Pro Teams', 'all-pro-teams', 'Franchise HQ'],
  ['Standings', 'standings', 'Franchise HQ'],
  ['Stat Leaders', 'stat-leaders', 'Franchise HQ'],
  ['Power Rankings', 'power-rankings', 'Franchise HQ'],
  ['Playoff Picture', 'playoff-picture', 'Franchise HQ'],
  ['Data Imports', 'data-imports', 'Franchise HQ'],
  ['Transaction Log', 'transactions', 'Franchise HQ'],
  ['Injuries Log', 'injuries-log', 'Franchise HQ'],
  ['Player Change Log', 'player-change-log', 'Franchise HQ'],
  ['Player Upgrades', 'player-upgrades', 'Franchise Management'],
  ['Mock Draft', 'mock-draft', 'Franchise Management'],
  ['Draft Results', 'draft-results', 'Franchise Management'],
]);

export async function execute(interaction) {
  const denial = getSoloInteractionDenial({ userId: interaction.user?.id, guildId: interaction.guildId });
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: 64 });
  if (denial) return interaction.editReply({ content: denial });
  const guild = interaction.guild;
  const { userId } = getSoloModeConfig();
  const me = guild.members.me || await guild.members.fetchMe();
  if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.editReply({ content: 'Give the bot Manage Channels, then use the Create Franchise HQ button in `/setup` again.' });
  }
  await guild.channels.fetch();
  const previous = loadGuildMaddenConfig(guild.id) || {};
  const oldMap = previous.compat?.maddenChannelMap || {};
  const managedKeys = new Set([...SOLO_CATEGORIES.map((spec) => spec.key), ...SOLO_CHANNELS.map(([key]) => key)]);
  const channelMap = Object.fromEntries(Object.entries(oldMap).filter(([key]) => managedKeys.has(key)));
  const permissions = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.UseApplicationCommands, PermissionFlagsBits.SendMessagesInThreads] },
    { id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.ManageThreads] },
  ];
  const config = {
    version: 3,
    status: 'incomplete',
    updatedAt: new Date().toISOString(),
    compat: { maddenChannelMap: channelMap, maddenRoleMap: {} },
    pins: previous.pins || {},
  };
  // Persist each successful step so retries recover channels without duplicating them.
  for (const spec of SOLO_CATEGORIES) {
    let category = guild.channels.cache.get(oldMap[spec.key])
      || guild.channels.cache.find((item) => item.type === ChannelType.GuildCategory && item.name === spec.name);
    if (category?.type !== ChannelType.GuildCategory) category = null;
    if (!category) category = await guild.channels.create({ name: spec.name, type: ChannelType.GuildCategory, permissionOverwrites: permissions });
    else await category.permissionOverwrites.set(permissions);
    channelMap[spec.key] = category.id;
    saveGuildMaddenConfig(guild.id, config);
  }
  for (const [key, name, categoryKey] of SOLO_CHANNELS) {
    let channel = guild.channels.cache.get(oldMap[key]);
    if (channel?.type !== ChannelType.GuildText) channel = null;
    channel ||= guild.channels.cache.find((item) => item.type === ChannelType.GuildText && item.name === name && item.parentId === channelMap[categoryKey]);
    if (!channel) channel = await guild.channels.create({ name, type: ChannelType.GuildText, parent: channelMap[categoryKey], permissionOverwrites: permissions });
    else {
      if (channel.parentId !== channelMap[categoryKey]) await channel.setParent(channelMap[categoryKey], { lockPermissions: false });
      await channel.permissionOverwrites.set(permissions);
    }
    channelMap[key] = channel.id;
    saveGuildMaddenConfig(guild.id, config);
  }
  config.status = 'complete';
  saveGuildMaddenConfig(guild.id, config);
  await interaction.editReply({ embeds: [new EmbedBuilder()
    .setTitle('Franchise HQ Ready')
    .setColor(0x57f287)
    .setDescription('Your solo channels are ready. Run `/setup` to connect your franchise, then `/sync` to refresh reports.')], components: [] });
}
export default { data, execute };
