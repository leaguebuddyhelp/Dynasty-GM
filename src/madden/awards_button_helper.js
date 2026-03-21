import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getPinId, setPinId } from './pins_store.js';
import { loadMaddenChannelMap } from '../shared/madden_metadata.js';
import { loadGuildMaddenConfig } from '../shared/madden_guild_config.js';

export async function ensureMaddenAwardsButton(client) {
  for (const guild of client?.guilds?.cache?.values?.() || []) {
    const guildId = guild?.id || null;
    const tier = String(loadGuildMaddenConfig(guildId)?.license?.tier || 'free').toLowerCase();
    if (tier !== 'standard' && tier !== 'premium') continue;
    const channelMap = loadMaddenChannelMap(guildId);
    const channelId = channelMap['Yearly Awards'] || channelMap['Awards'] || null;
    if (!channelId) continue;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) continue;

    const embed = new EmbedBuilder()
      .setTitle('Madden Yearly Awards (Staff)')
      .setDescription(
        [
          'Staff: after the season ends and before the next season begins, click below to enter the yearly awards.',
          'MVP, Coach of the Year, OPOY, DPOY, OROY, DROY, Super Bowl Champion, Super Bowl MVP.',
          'Bot will post embeds with player name, team emoji, coach tag, and season number.',
        ].join('\n'),
      )
      .setColor(0xFFD700);

    const button = new ButtonBuilder()
      .setCustomId('madden_awards_button')
      .setLabel('Enter Madden Yearly Awards')
      .setStyle(ButtonStyle.Primary);

    const components = [new ActionRowBuilder().addComponents(button)];

    const pinId = getPinId('madden_awards_button', guildId);
    if (!pinId) continue;
    const msg = await channel.messages.fetch(pinId).catch(() => null);
    if (msg) {
      await msg.edit({ embeds: [embed], components }).catch(() => null);
    }
  }
}
