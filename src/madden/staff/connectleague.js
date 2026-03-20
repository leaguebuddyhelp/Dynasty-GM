import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import connectionService from '../services/export_first_connection_service.js';

export const data = new SlashCommandBuilder()
  .setName('connectleague')
  .setDescription('Start the self-serve export/import connection flow for this server.')
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
      .setLabel('Open League Setup')
      .setURL(setupUrl),
  );

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle('Connect League')
        .setColor(0x5865f2)
        .setDescription([
          'Use the setup page below to connect your league without EA browser OAuth.',
          '',
          'What happens next:',
          '1. Open the setup page.',
          '2. Paste the exported league JSON.',
          '3. Submit it once.',
          '4. Run `/league-status` back in Discord.',
        ].join('\n'))
        .addFields(
          { name: 'Setup Link', value: setupUrl, inline: false },
          { name: 'Direct Import Endpoint', value: `\`${importUrl}\``, inline: false },
          { name: 'Expires', value: `<t:${Math.floor(new Date(session.expiresAt).getTime() / 1000)}:R>`, inline: false },
          { name: 'Next', value: 'After the import succeeds, run `/league-status`.', inline: false },
        ),
    ],
    components: [row],
  });
}

export default { data, execute };
