import { SlashCommandBuilder } from 'discord.js';
import { requireLeagueIdForGuild, loadLeagueSnapshot } from '../../../madden/madden_data.js';
import { classIdForSnapshot, buildPages } from '../../../madden/helpers/bigboard_helpers.js';
import { coachCommandDescription, coachErrorBlurb } from '../../shared/madden_coach_voice.js';
import { normalizeMaddenDraftClassId } from '../../shared/madden_draft_class_files.js';

export const featureKey = 'scouting_draft';

const TEST_DRAFT_CLASS_CHOICES = [
  { name: 'CUS01 / 2026 Draft', value: 'cus_01' },
  { name: 'CUS02 / 2027 Draft', value: 'cus_02' },
  { name: 'CUS03 / 2028 Draft', value: 'cus_03' },
];

export const data = new SlashCommandBuilder()
  .setName('bigboard')
  .setDescription(coachCommandDescription('bigboard'))
  .addStringOption(option => option
    .setName('draft_class')
    .setDescription('Testing only: choose which draft class to use.')
    .setRequired(false)
    .addChoices(...TEST_DRAFT_CLASS_CHOICES));

export async function execute(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    try { await interaction.deferReply({ flags: 64 }); } catch (_) { }
  }
  let leagueId;
  try {
    leagueId = requireLeagueIdForGuild(interaction.guildId);
  } catch {
    const payload = { content: coachErrorBlurb('noLeague', 'No league is connected yet. Run `/setup` and press Open Setup Dashboard.') };
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
    else await interaction.reply({ ...payload, flags: 64 });
    return;
  }
  try {
    const snapshot = loadLeagueSnapshot(leagueId);
    const requestedClassRaw = interaction.options?.getString('draft_class');
    const manualClassId = requestedClassRaw ? normalizeMaddenDraftClassId(requestedClassRaw) : null;
    const classId = manualClassId || classIdForSnapshot(snapshot);
    const { embeds, baseId } = buildPages(snapshot, classId, leagueId, {
      manualClassOverride: Boolean(manualClassId),
    });

    const components = [];
    if (embeds.length > 1) {
      const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = await import('discord.js');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${baseId}_0`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(`${baseId}_1`).setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(embeds.length <= 1),
      );
      components.push(row);
    }

    await interaction.editReply({ embeds: [embeds[0]], components });
  } catch (err) {
    console.error('[madden-bigboard] failed:', err);
    try {
      await interaction.editReply({ content: coachErrorBlurb('bigBoardFailed', 'Failed to load big board.', { guildId: interaction.guildId }) });
    } catch (_) { }
  }
}

export default { data, execute };
