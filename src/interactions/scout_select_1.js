

export const customId = "scout_select_1";
export async function execute(interaction) {
    await interaction.reply({ content: 'Scouting is currently unavailable. Please contact an admin to enable this feature for Madden.', ephemeral: true });
}
