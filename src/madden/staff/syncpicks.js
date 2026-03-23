import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import {
  getDefaultStartFirstRoundOverrides,
  seedDefaultStartFirstRoundOverrides,
} from '../pick_overrides_store.js';

export const data = new SlashCommandBuilder()
  .setName('syncpicks')
  .setDescription('Admin-only: seed the built-in Madden default draft pick trades for a normal franchise start.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addBooleanOption((o) =>
    o.setName('replace')
      .setDescription('Replace existing first-round overrides before seeding the built-in baseline.')
      .setRequired(false),
  );

export const deferOnDispatch = { flags: 64 };

export async function execute(interaction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.editReply({ content: 'This command can only be used in a server.' });
    return;
  }

  const replaceExisting = interaction.options.getBoolean('replace') === true;
  const seeded = seedDefaultStartFirstRoundOverrides({ replaceExisting });
  const baseline = getDefaultStartFirstRoundOverrides();

  const lines = [
    '**Draft pick baseline synced**',
    replaceExisting
      ? 'Existing first-round overrides were replaced with the built-in default-start preset.'
      : 'The built-in default-start preset was merged into the existing first-round overrides.',
    '',
    '**Included baseline overrides**',
    ...baseline.map((entry) => `• ${entry.year} Round 1: ${entry.from} → ${entry.to}`),
    '',
    `Stored first-round override rows: ${seeded.filter((entry) => Number(entry.round || 1) === 1).length}`,
    '',
    'Next:',
    '• Run `/mockdraft` again so the corrected pick ownership shows up.',
    '• Future approved trade proofs will continue updating the pick overrides automatically.',
  ];

  await interaction.editReply({ content: lines.join('\n') });
}

export default { data, execute, deferOnDispatch };
