import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';

import { getGuildAuthStartUrl } from '../../madden/ea_guild_auth.js';
import { listSavedAccountLeagues, loadSavedEATokens } from '../../madden/ea_saved_auth.js';
import { setGuildLeague } from '../../../madden/madden_config.js';
import { saveLeague as saveLeagueDb } from '../../../madden/madden_db.js';

function truncate(value, max = 100) {
  const str = String(value || '');
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

function buildLeagueOptions(leagues = []) {
  return leagues.slice(0, 25).map((league) => ({
    label: truncate(league?.leagueName || `League ${league?.leagueId}`),
    description: truncate(`League ID ${league?.leagueId}${league?.seasonText ? ` • ${league.seasonText}` : ''}`),
    value: String(league?.leagueId),
  }));
}

export const data = new SlashCommandBuilder()
  .setName('install-league')
  .setDescription('Guided league connection flow for this server.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export const deferOnDispatch = { flags: 64 };

export async function execute(interaction) {
  if (!interaction.guildId) {
    await interaction.editReply({ content: 'This command can only be used in a server.' });
    return;
  }

  const tokens = loadSavedEATokens(interaction.guildId);
  const loginUrl = getGuildAuthStartUrl(interaction.guildId);
  if (!tokens) {
    const embed = new EmbedBuilder()
      .setColor(0xf39c12)
      .setTitle('Connect Your League')
      .setDescription('This server is not connected to a league account yet.')
      .addFields(
        { name: 'Step 1', value: `Open the connection link: ${loginUrl}` },
        { name: 'Step 2', value: 'Finish the browser redirect flow. The callback page should say the connection was saved for this server.' },
        { name: 'Step 3', value: 'If the browser flow does not finish cleanly, run `/auth redirect_url:<paste-callback-url>`.' },
        { name: 'Step 4', value: 'Run `/install-league` again and pick the correct league.' },
      )
      .setFooter({ text: 'League connection is saved per server.' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Open Connection Link')
        .setURL(loginUrl),
    );

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
    return;
  }

  try {
    const leagues = await listSavedAccountLeagues(interaction.guildId);
    const items = Array.isArray(leagues) ? leagues : [];
    if (!items.length) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle('No Leagues Found')
            .setDescription('The connected league account does not appear to have any accessible leagues.'),
        ],
      });
      return;
    }

    if (items.length === 1) {
      const only = items[0];
      setGuildLeague(interaction.guildId, only.leagueId);
      saveLeagueDb(only.leagueId);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle('League Connected')
            .setDescription(`This server is now mapped to **${only.leagueName || 'your league'}** (\`${only.leagueId}\`).`)
            .addFields({
              name: 'Next',
              value: 'Run `/sync`.',
            }),
        ],
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('Choose Your League')
      .setDescription('Pick the Madden league that belongs to this Discord server.');

    const select = new StringSelectMenuBuilder()
      .setCustomId(`install_league_select|${interaction.user.id}`)
      .setPlaceholder('Select a league')
      .addOptions(buildLeagueOptions(items));

    await interaction.editReply({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(select)],
    });
  } catch (error) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle('League Lookup Failed')
          .setDescription(error?.message || 'Could not load leagues from the saved league connection.'),
      ],
    });
  }
}

export default { data, execute };
