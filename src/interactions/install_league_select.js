import { EmbedBuilder, StringSelectMenuInteraction } from 'discord.js';

import { setGuildLeague } from '../madden/madden_config.js';
import { saveLeague as saveLeagueDb } from '../madden/madden_db.js';

export const customId = /^install_league_select\|/;

export async function execute(interaction) {
  if (!(interaction instanceof StringSelectMenuInteraction)) return;

  const [, ownerId] = String(interaction.customId || '').split('|');
  if (ownerId && interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'Only the person who started this install flow can use this menu.', flags: 64 });
    return;
  }

  const leagueId = interaction.values?.[0];
  if (!leagueId || !interaction.guildId) {
    await interaction.reply({ content: 'No league selection was received.', flags: 64 });
    return;
  }

  setGuildLeague(interaction.guildId, leagueId);
  saveLeagueDb(leagueId);

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('League Connected')
    .setDescription(`This server is now mapped to league \`${leagueId}\`.`)
    .addFields({
      name: 'Next Steps',
      value: '1. Run `/sync`\n2. Run `/setup-channels`\n3. Run `/setup-roles`\n4. Run `/syncsetupstatus`',
    });

  await interaction.update({
    embeds: [embed],
    components: [],
    content: '',
  });
}

export default { customId, execute };
