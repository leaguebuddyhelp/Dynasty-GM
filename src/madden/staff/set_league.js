import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { setGuildLeague } from '../../../madden/madden_config.js';
import { saveLeague as saveLeagueDb } from '../../../madden/madden_db.js';

const data = new SlashCommandBuilder()
  .setName('set-league')
  .setDescription('Legacy admin override: manually set the default Madden league for this server.')
  .addStringOption(opt =>
    opt.setName('league_id')
      .setDescription('League ID to set as default')
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

async function execute(interaction) {
  const leagueId = interaction.options.getString('league_id');
  await interaction.deferReply();
  try {
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
        'Recommended path for normal setup is still `/setup`.',
        '',
        'Next: run `/sync`.',
      ].join('\n'))
      .setColor(0x57f287);
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    await interaction.editReply({ content: `Failed to set league: ${err.message}` });
  }
}

export default { data, execute };
