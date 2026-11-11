import { resolveLeagueIdStrict } from '../madden/madden_data.js';
import { buildTop100Page, loadTop100Report } from '../madden/top100_boards.js';

export const customId = /^top100_board\|/;

export async function execute(interaction) {
  const match = /^top100_board\|(weekly|season)\|(year_\d+)\|(\d+)$/.exec(interaction.customId);
  if (!match) return interaction.reply({ content: 'This Top 100 control is invalid.', flags: 64 });
  const leagueId = resolveLeagueIdStrict(interaction.guildId);
  if (!leagueId) return interaction.reply({ content: 'The Madden franchise connection is unavailable.', flags: 64 });
  try {
    const report = await loadTop100Report(leagueId, match[2]);
    return await interaction.update(buildTop100Page(report, match[1], Number(match[3])));
  } catch (error) {
    console.error('[top100] failed to load report page', error);
    return interaction.reply({ content: 'This Top 100 page is unavailable. Run `/sync` to refresh it.', flags: 64 });
  }
}

export default { customId, execute };
