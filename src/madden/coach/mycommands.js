import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
export const data = new SlashCommandBuilder().setName('help').setDescription('Show your solo Madden franchise tools.');
export async function execute(interaction) {
  await interaction.reply({ flags: 64, embeds: [new EmbedBuilder()
    .setTitle('Dynasty GM · Franchise HQ')
    .setColor(0x5865f2)
    .setDescription('Your personal franchise assistant. Advance in Madden, then sync to refresh your data.')
    .addFields(
      { name: 'Setup and Connection', value: '`/setup` · `/league-status` · `/disconnectleague confirm:true` to reset your connection' },
      { name: 'Full-season simulation', value: 'Before Week 1, run `/sync mode:full-season` to save your starting ratings. Sim Weeks 1–18, then run it again in the first playoff week for all weekly awards and one combined attribute list. Optional checkpoint syncs preserve earlier stats.' },
      { name: 'Franchise Data', value: '`/sync` · `/schedule` · `/roster` · `/playersearch` · `/awards`' },
      { name: 'Draft', value: '`/bigboard` · `/mockdraft` · `/draftexport`' },
      { name: 'Progression', value: 'Review recommendations in `#player-upgrades`. Apply changes manually in Madden, then mark each recommendation Applied or Skipped.' },
      { name: 'Connection Check', value: '`/ping`' },
    )] });
}
export default { data, execute };
