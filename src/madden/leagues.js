import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { listSavedAccountLeagues, loadSavedEATokens } from './ea_saved_auth.js';

const data = new SlashCommandBuilder()
  .setName('leagues')
  .setDescription('List leagues available for this server’s saved connection.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

function shorten(msg, max = 1000) {
  if (!msg) return 'Unknown error';
  const str = String(msg);
  return str.length > max ? `${str.slice(0, max - 3)}...` : str;
}

async function execute(interaction) {
  await interaction.deferReply();
  try {
    if (!interaction.guildId) {
      await interaction.editReply({ content: 'This command can only be used in a server.' });
      return;
    }
    const tokens = loadSavedEATokens(interaction.guildId);
    if (!tokens || !tokens.accessToken || !tokens.refreshToken) {
      const embed = new EmbedBuilder()
        .setTitle('Madden Leagues')
        .setDescription('No EA connection is saved for this server. Run `/connectleague` and finish the dashboard flow first.')
        .setColor(0xffcc00);
      await interaction.editReply({ embeds: [embed] });
      return;
    }
    const leagues = await listSavedAccountLeagues(interaction.guildId);
    const items = leagues.map(l => `**${l.leagueId}** — ${l.leagueName || 'Unnamed'} (Season ${l.seasonText || ''})`).slice(0, 10);
    const embed = new EmbedBuilder()
      .setTitle('Madden Leagues')
      .setDescription(items.length ? items.join('\n') : 'No leagues found for this account.')
      .setColor(0x00b0f4);
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error('Madden leagues failed:', err);
    const description = shorten(err?.message, 3900);
    const embed = new EmbedBuilder()
      .setTitle('Madden Leagues Failed')
      .setDescription(`${description}\n(See server logs for full details)`)
      .setColor(0xcc0000);
    await interaction.editReply({ embeds: [embed] });
  }
}

export default { data, execute };
