import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { requireLeagueIdForGuild, loadLeagueSnapshot } from '../../../madden/madden_data.js';
import { coachCommandDescription, coachErrorBlurb } from '../../shared/madden_coach_voice.js';
import {
  getMaddenDraftClassNumber,
  formatMaddenDraftClassLock,
} from '../../shared/madden_draft_class.js';
import { getLeagueBuddyLogoEmoji } from '../../shared/application_emojis.js';

export const featureKey = 'scouting_draft';

const OFFICIAL_CLASS_NAMES = {
  1: 'LEAGUEbuddy CUS01',
  2: 'LEAGUEbuddy CUS02',
  3: 'LEAGUEbuddy CUS03',
};

const OFFICIAL_CLASS_CREATOR = 'biccboyyy';

export const data = new SlashCommandBuilder()
  .setName('draftclass')
  .setDescription(coachCommandDescription('draftclass'))
  .setDMPermission(false);

function buildPublishedEmbed(snapshot) {
  const classNumber = getMaddenDraftClassNumber(snapshot);
  const officialName = OFFICIAL_CLASS_NAMES[classNumber];
  const classLock = formatMaddenDraftClassLock(snapshot);
  const logo = getLeagueBuddyLogoEmoji();

  return new EmbedBuilder()
    .setColor(0x1e90ff)
    .setTitle(`${logo ? `${logo} ` : ''}Official LEAGUEbuddy Draft Class`)
    .setDescription([
      `**${classLock}**`,
      '',
      `Search/download: **${officialName}**`,
      `Creator/User ID: **${OFFICIAL_CLASS_CREATOR}**`,
    ].join('\n'))
    .addFields(
      {
        name: 'Use This Before Scouting',
        value: [
          '`/scout`',
          '`/myscouts`',
          '`/bigboard`',
          '`/draftprimer`',
          '`/mockdraft`',
          '`/recruiting`',
        ].join(' • '),
      },
      {
        name: 'Important',
        value: 'Scouting only works with official LEAGUEbuddy draft classes. Generated classes and third-party classes will not work.',
      },
      {
        name: 'Season 1 Note',
        value: 'If your league started from the base Madden point and you are now entering the first offseason after the Super Bowl, you should be using **LEAGUEbuddy CUS01**.',
      },
    );
}

function buildUnpublishedEmbed(snapshot) {
  const classNumber = getMaddenDraftClassNumber(snapshot);
  const classLock = formatMaddenDraftClassLock(snapshot);
  const logo = getLeagueBuddyLogoEmoji();

  return new EmbedBuilder()
    .setColor(0xffa726)
    .setTitle(`${logo ? `${logo} ` : ''}Official LEAGUEbuddy Draft Class`)
    .setDescription([
      `**${classLock}**`,
      '',
      'That official LEAGUEbuddy draft class is not published in the app copy yet.',
    ].join('\n'))
    .addFields(
      {
        name: 'What To Do',
        value: `Ask staff for the official **CUS${String(classNumber).padStart(2, '0')}** download name before using scouting tools.`,
      },
      {
        name: 'Important',
        value: 'Scouting only works with official LEAGUEbuddy draft classes. Generated classes and third-party classes will not work.',
      },
    );
}

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  let leagueId;
  try {
    leagueId = requireLeagueIdForGuild(interaction.guildId);
  } catch {
    await interaction.editReply({
      content: coachErrorBlurb('noLeague', 'No league is connected yet. Run `/setup` and press Open Setup Dashboard.'),
    });
    return;
  }

  try {
    const snapshot = loadLeagueSnapshot(leagueId);
    const classNumber = getMaddenDraftClassNumber(snapshot);
    const embed = OFFICIAL_CLASS_NAMES[classNumber]
      ? buildPublishedEmbed(snapshot)
      : buildUnpublishedEmbed(snapshot);

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[draftclass] failed:', error);
    await interaction.editReply({
      content: coachErrorBlurb('draftClassLookupFailed', 'Could not load the current draft class info from this league snapshot.'),
    });
  }
}

export default { data, featureKey, execute };
