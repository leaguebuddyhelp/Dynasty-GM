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
        .setDescription([
          'Use the dashboard below to connect your league.',
          '',
          'Main setup path:',
          '1. Open the dashboard.',
          '2. Save your league name.',
          '3. Connect EA and paste the returned browser URL.',
          '4. Choose your Madden account/persona.',
          '5. Choose your league.',
          '6. Return to Discord and run `/league-status`.',
        ].join('\n'))
        .addFields(
          { name: 'Discord Server', value: interaction.guild?.name || 'Unknown Server', inline: false },
          { name: 'Dashboard Link', value: setupUrl, inline: false },
          { name: 'EA Step', value: 'The dashboard will walk you through the reverse EA login flow and league selection.', inline: false },
          { name: 'Expires', value: `<t:${Math.floor(new Date(session.expiresAt).getTime() / 1000)}:R>`, inline: false },
          { name: 'Next', value: 'After the dashboard looks right, run `/league-status`. If you need to restart from zero later, run `/disconnectleague`.', inline: false },
        ),
    ],
    components: [row],
  });
}

export default { data, execute };
