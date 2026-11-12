import { SlashCommandBuilder } from 'discord.js';
import { requireLeagueIdForGuild, loadLeagueSnapshot } from '../madden_data.js';
import { classIdForSnapshot, buildPages } from '../helpers/bigboard_helpers.js';
import { commandDescription, errorBlurb } from '../../shared/madden_voice.js';


export const data = new SlashCommandBuilder()
  .setName('bigboard')
  .setDescription(commandDescription('bigboard'));

export async function execute(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    try { await interaction.deferReply({ flags: 64 }); } catch (_) { }
  }
  let leagueId;
  try {
    leagueId = requireLeagueIdForGuild(interaction.guildId);
  } catch {
    const payload = { content: errorBlurb('noLeague', 'No league is connected yet. Run `/setup` and press Open Setup Dashboard.') };
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
    else await interaction.reply({ ...payload, flags: 64 });
    return;
  }
  try {
    const snapshot = loadLeagueSnapshot(leagueId);
    const classId = classIdForSnapshot(snapshot);
    const { embeds, baseId } = buildPages(snapshot, classId, leagueId);

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
      await interaction.editReply({ content: errorBlurb('bigBoardFailed', 'Failed to load big board.', { guildId: interaction.guildId }) });
    } catch (_) { }
  }
}

export default { data, execute };
