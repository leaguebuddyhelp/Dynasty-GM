import { buildRecruitingEmbed, safeLoadRecruiting } from '../madden/helpers/recruiting_helpers.js';
import { requireLeagueIdForGuild, loadLeagueSnapshot } from '../../madden/madden_data.js';
import { getMaddenDraftClassId } from '../shared/madden_draft_class.js';
import { normalizeMaddenDraftClassId } from '../shared/madden_draft_class_files.js';

// Regex customId picked up by the interaction router
export const customId = /^madden_recruiting_page_(\d+)(?:_([a-z0-9_]+))?$/;

export async function execute(interaction) {
  if (!interaction.isButton()) return;
  const match = interaction.customId.match(customId);
  if (!match) return;

  const leagueId = requireLeagueIdForGuild(interaction.guildId);
  const snapshot = loadLeagueSnapshot(leagueId);
  const classIdRaw = match[2] || 'auto';
  const manualClassOverride = classIdRaw && classIdRaw !== 'auto';
  const classId = manualClassOverride ? normalizeMaddenDraftClassId(classIdRaw) : getMaddenDraftClassId(snapshot);
  const recruits = safeLoadRecruiting(snapshot, classId);
  if (!recruits || !recruits.length) {
    await interaction.update({ content: 'No recruiting data found.', embeds: [], components: [] });
    return;
  }

  const targetPageNum = Number(match[1]);
  const targetIndex = Math.max(0, targetPageNum - 1);
  const { embed, row } = buildRecruitingEmbed(targetIndex, recruits, { classId, manualClassOverride });

  await interaction.update({ embeds: [embed], components: [row] });
}

export default { execute, customId };
