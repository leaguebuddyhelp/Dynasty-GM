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
  .setDescription('Legacy fallback: guided league connection flow for this server.')
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
      .setDescription('This is the legacy connection helper. The recommended path is `/setup`.')
      .addFields(
        { name: 'Recommended', value: 'Run `/setup`, open the dashboard, connect EA, choose your Madden account, then choose your league.' },
        { name: 'Legacy Fallback', value: `If you are intentionally using the old flow, open the connection link: ${loginUrl}` },
        { name: 'Manual Finish', value: 'If the browser flow does not finish cleanly, run `/auth redirect_url:<paste-callback-url>`.' },
        { name: 'Then', value: 'Run `/install-league` again and pick the correct league.' },
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
              value: 'Run `/sync`, then continue the normal setup flow.',
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
