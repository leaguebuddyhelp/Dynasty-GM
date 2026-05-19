import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import connectionService from '../services/export_first_connection_service.js';

export const data = new SlashCommandBuilder()
  .setName('connectleague')
  .setDescription('Open the easy league dashboard setup for this server.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export const deferOnDispatch = { flags: 64 };

export async function execute(interaction) {
  if (!interaction.guildId) {
    await interaction.editReply({ content: 'This command can only be used in a server.' });
    return;
  }

  const { session, setupUrl } = connectionService.beginLeagueConnection({
    guildId: interaction.guildId,
    guildName: interaction.guild?.name || null,
    createdByUserId: interaction.user.id,
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Open League Dashboard')
      .setURL(setupUrl),
  );

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle('Connect League')
        .setColor(0x5865f2)
        .setDescription('Open the dashboard, follow the highlighted step, then return to `/setup`.')
        .addFields(
          { name: 'Discord Server', value: interaction.guild?.name || 'Unknown Server', inline: false },
          { name: 'Expires', value: `<t:${Math.floor(new Date(session.expiresAt).getTime() / 1000)}:R>`, inline: false },
          { name: 'Next', value: 'Return to `/setup` and press Check Again.', inline: false },
        ),
    ],
    components: [row],
  });
}

export default { data, execute };
