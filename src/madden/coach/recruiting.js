import { SlashCommandBuilder } from 'discord.js';
import { requireLeagueIdForGuild, loadLeagueSnapshot } from '../../../madden/madden_data.js';
import { safeLoadRecruiting, buildRecruitingEmbed } from '../../../madden/helpers/recruiting_helpers.js';
import { getMaddenDraftClassId } from '../../shared/madden_draft_class.js';
import { coachCommandDescription, coachErrorBlurb } from '../../shared/madden_coach_voice.js';

export const featureKey = 'scouting_draft';

export const data = new SlashCommandBuilder()
  .setName('recruiting')
  .setDescription(coachCommandDescription('recruiting'))
  .setDMPermission(false);

export async function execute(interaction) {
  const leagueId = requireLeagueIdForGuild(interaction.guildId);
  const snapshot = loadLeagueSnapshot(leagueId);
  const classId = getMaddenDraftClassId(snapshot);
  const recruits = safeLoadRecruiting(snapshot, classId);
  if (!recruits || !recruits.length) {
    await interaction.reply({ content: coachErrorBlurb('noRecruiting', 'No recruiting data found.'), ephemeral: true });
    return;
  }

  const { embed, row } = buildRecruitingEmbed(0, recruits, { classId });
  await interaction.reply({
    embeds: [embed],
    components: [row],
    ephemeral: true
  });
}

export default { data, featureKey, execute };
