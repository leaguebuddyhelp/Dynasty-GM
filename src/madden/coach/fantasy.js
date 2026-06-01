import { SlashCommandBuilder } from 'discord.js';
import { requireLeagueIdForGuild, loadLeagueSnapshot } from '../../../madden/madden_data.js';
import { coachCommandDescription, coachErrorBlurb } from '../../shared/madden_coach_voice.js';
import {
  buildFantasyHubPayload,
  ensureFantasyLeague,
  getFantasyLeagueKey,
  mutateFantasyLeague,
  resolveCoachTeamIds,
  upsertFantasyManager,
  FANTASY_ACCESS_ROLE_ID,
} from '../../shared/madden_fantasy.js';

export const data = new SlashCommandBuilder()
  .setName('fantasy')
  .setDescription(coachCommandDescription('fantasy', 'Open the Madden fantasy league hub.'))
  .setDMPermission(false);

export async function execute(interaction) {
  await interaction.deferReply({ flags: 64 });

  if (!interaction.member?.roles?.cache?.has?.(FANTASY_ACCESS_ROLE_ID)) {
    await interaction.editReply({ content: 'You need the fantasy role to use `/fantasy`.' });
    return;
  }

  let leagueId;
  try {
    leagueId = requireLeagueIdForGuild(interaction.guildId);
  } catch {
    await interaction.editReply({ content: coachErrorBlurb('noLeague') });
    return;
  }

  const snapshot = loadLeagueSnapshot(leagueId);
  if (!snapshot) {
    await interaction.editReply({ content: coachErrorBlurb('noSnapshot') });
    return;
  }

  const seasonKey = getFantasyLeagueKey(snapshot);
  ensureFantasyLeague({ guildId: interaction.guildId, seasonKey });
  const maddenTeamIds = resolveCoachTeamIds(interaction.member, snapshot);
  const league = mutateFantasyLeague({ guildId: interaction.guildId, seasonKey }, (draftLeague) => (
    upsertFantasyManager(draftLeague, interaction.member, maddenTeamIds)
  ));

  await interaction.editReply(buildFantasyHubPayload(league, snapshot, interaction.user.id));
}

export default { data, execute };
