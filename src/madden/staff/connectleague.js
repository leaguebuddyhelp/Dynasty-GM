import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import connectionService from '../services/export_first_connection_service.js';

export const data = new SlashCommandBuilder()
  .setName('connectleague')
  .setDescription('Open the league dashboard setup flow for this server.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export const deferOnDispatch = { flags: 64 };

export async function execute(interaction) {
  if (!interaction.guildId) {
    await interaction.editReply({ content: 'This command can only be used in a server.' });
    return;
  }

  const { session, setupUrl, importUrl } = connectionService.beginLeagueConnection({
    guildId: interaction.guildId,
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
          'Use the dashboard below to create the league record and add one or more export sources.',
          '',
          'What happens next:',
          '1. Open the dashboard.',
          '2. Save the league record.',
          '3. Add an export URL.',
          '4. Run `/league-status` back in Discord.',
        ].join('\n'))
        .addFields(
          { name: 'Dashboard Link', value: setupUrl, inline: false },
          { name: 'Fallback Import Endpoint', value: `\`${importUrl}\``, inline: false },
          { name: 'Expires', value: `<t:${Math.floor(new Date(session.expiresAt).getTime() / 1000)}:R>`, inline: false },
          { name: 'Next', value: 'After the dashboard setup looks right, run `/league-status`.', inline: false },
        ),
    ],
    components: [row],
  });
}

export default { data, execute };
