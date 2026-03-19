import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { setGuildLeague } from '../../../madden/madden_config.js';
import { saveLeague as saveLeagueDb } from '../../../madden/madden_db.js';
import { hasStaffRole, loadRoleMap } from './staffUtils.js';

const data = new SlashCommandBuilder()
  .setName('madden-set-league')
  .setDescription('Set the default Madden league for this server (used by other Madden commands).')
  .addStringOption(opt =>
    opt.setName('league_id')
      .setDescription('League ID to set as default')
      .setRequired(true)
  )
  .setDefaultMemberPermissions(null);

async function execute(interaction) {
  const leagueId = interaction.options.getString('league_id');
  await interaction.deferReply();
  try {
    const roleMap = loadRoleMap();
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!hasStaffRole(member, roleMap)) {
      await interaction.editReply({ content: 'Only Ghost Legacy Commish/Co-Commish can use this command.' });
      return;
    }
    if (!interaction.guildId) throw new Error('This command must be used in a guild.');
    setGuildLeague(interaction.guildId, leagueId);
    saveLeagueDb(leagueId);

    const embed = new EmbedBuilder()
      .setTitle('Madden League Saved')
      .setDescription([
        `Default league for this server set to **${leagueId}**.`,
        'Other Madden commands will use this guild-specific mapping automatically.',
        '',
        'No other league snapshots or process-wide env settings were changed.',
      ].join('\n'))
      .setColor(0x57f287);
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    await interaction.editReply({ content: `Failed to set league: ${err.message}` });
  }
}

export default { data, execute };
