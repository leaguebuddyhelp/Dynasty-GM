import { loadLeagueSnapshot, resolveLeagueIdStrict } from '../../madden/madden_data.js';
import { buildScheduleWeekView } from '../madden/coach/schedule.js';

export const customId = /^madden_schedule_back\|/;

export async function execute(interaction) {
  const [, weekRaw] = interaction.customId.split('|');
  const leagueId = resolveLeagueIdStrict(interaction.guildId);
  if (!leagueId) {
    await interaction.reply({ content: 'No league is mapped to this server yet. Run `/setup` and press Connect League, then run `/sync`.', ephemeral: true });
    return;
  }
  const snapshot = loadLeagueSnapshot(leagueId);
  const view = buildScheduleWeekView(snapshot, Number(weekRaw || 0), leagueId);
  await interaction.update({ embeds: [view.embed], components: view.components });
}

export default { customId, execute };
