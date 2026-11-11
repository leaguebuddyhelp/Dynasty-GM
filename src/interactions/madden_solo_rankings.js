import { componentsForSoloReport, loadSoloReport, buildLeaderboardEmbed, SOLO_POSITION_ORDER } from '../madden/solo_reports.js';
import { resolveLeagueIdWithConfig } from '../madden/madden_data.js';

export const customId = /^madden_solo_rankings_/;

export async function execute(interaction) {
  const match = /^madden_solo_rankings_(position|page)\|([^|]+)(?:\|(\d+))?$/.exec(interaction.customId);
  if (!match) {
    await interaction.reply({ content: 'This rankings control is not recognized.', flags: 64 });
    return;
  }
  const [, action, syncId, rawIndex] = match;
  const positionIndex = action === 'position'
    ? Number(interaction.values?.[0] ?? 0)
    : Number(rawIndex ?? 0);
  if (!Number.isInteger(positionIndex) || positionIndex < 0 || positionIndex >= SOLO_POSITION_ORDER.length) {
    await interaction.reply({ content: 'That leaderboard position is invalid.', flags: 64 });
    return;
  }
  const leagueId = resolveLeagueIdWithConfig(interaction.guildId, 'solo:rankings-interaction');
  if (!leagueId) {
    await interaction.reply({ content: 'The Madden franchise connection is unavailable.', flags: 64 });
    return;
  }
  try {
    const report = await loadSoloReport(leagueId, syncId);
    await interaction.update({
      embeds: [buildLeaderboardEmbed(report, positionIndex)],
      components: componentsForSoloReport(report, positionIndex),
    });
  } catch (error) {
    console.error('[solo-rankings] failed to load report snapshot', error);
    const message = 'This leaderboard snapshot is unavailable. Run `/sync` to refresh the player overalls board.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: message, flags: 64 });
    } else {
      await interaction.reply({ content: message, flags: 64 });
    }
  }
}

export default { customId, execute };
