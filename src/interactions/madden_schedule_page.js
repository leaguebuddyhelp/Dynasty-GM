import { loadLeagueSnapshot, resolveLeagueIdStrict } from '../madden/madden_data.js';
import { buildScheduleWeekView } from '../madden/coach/schedule.js';

export const customId = /^madden_schedule_page(?:\|.*)?$/;

export async function execute(interaction) {
  const phaseFromId = interaction.customId.split('|')[1] || null;
  const selected = interaction.isStringSelectMenu() ? interaction.values?.[0] : interaction.customId.split('|')[2];
  const [phaseKind, weekRaw] = String(selected || '').includes(':')
    ? String(selected).split(':')
    : [phaseFromId, selected];
  const leagueId = resolveLeagueIdStrict(interaction.guildId);
  if (!leagueId) {
    await interaction.reply({ content: 'No league is mapped to this server yet. Run `/setup` and press Open Setup Dashboard.', ephemeral: true });
    return;
  }
  const snapshot = loadLeagueSnapshot(leagueId);
  const view = buildScheduleWeekView(snapshot, Number(weekRaw || 0), leagueId, phaseKind || null);
  await interaction.update({ embeds: [view.embed], components: view.components });
}

export default { customId, execute };
