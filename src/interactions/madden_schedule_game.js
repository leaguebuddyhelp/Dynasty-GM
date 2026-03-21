import { loadLeagueSnapshot, resolveLeagueIdStrict } from '../../madden/madden_data.js';
import { buildGameDetailView, buildScheduleWeekView } from '../madden/coach/schedule.js';

export const customId = /^madden_schedule_game\|/;

export async function execute(interaction) {
  const [, phaseKind, weekRaw] = interaction.customId.split('|');
  const leagueId = resolveLeagueIdStrict(interaction.guildId);
  if (!leagueId) {
    await interaction.reply({ content: 'No league is mapped to this server yet. Run `/connectleague`, finish the dashboard flow, then run `/sync`.', ephemeral: true });
    return;
  }
  const snapshot = loadLeagueSnapshot(leagueId);
  const weekIndex = Number(weekRaw || 0);
  const scheduleId = interaction.values?.[0];
  const detail = buildGameDetailView(snapshot, weekIndex, scheduleId, leagueId, phaseKind || null);
  if (!detail) {
    const fallback = buildScheduleWeekView(snapshot, weekIndex, leagueId, phaseKind || null);
    await interaction.update({
      content: 'Could not open that game from the current export.',
      embeds: [fallback.embed],
      components: fallback.components,
    });
    return;
  }
  await interaction.update({ embeds: [detail.embed], components: detail.components });
}

export default { customId, execute };
