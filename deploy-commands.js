import dotenv from 'dotenv';
import { REST, Routes } from 'discord.js';

dotenv.config({ path: process.env.dotenv_config_path || '.env' });
const { validateSoloModeConfig, loadSoloCommands } = await import('./src/leaguebuddy/solo_mode.js');

try {
  const { guildId } = validateSoloModeConfig();
  const commands = await loadSoloCommands();
  const body = [...commands.values()].map((command) => command.data.toJSON());
  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify({ guildId, commands: body }, null, 2));
  } else {
    const token = process.env.DISCORD_TOKEN || process.env.TOKEN;
    if (!token || !process.env.CLIENT_ID) throw new Error('DISCORD_TOKEN and CLIENT_ID are required to deploy commands.');
    const rest = new REST({ version: '10' }).setToken(token);
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId), { body });
    // Remove the former public command catalog as part of the solo conversion.
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });
    console.log(`Registered ${body.length} solo commands for ${guildId}; removed global commands.`);
  }
} catch (error) {
  console.error('[deploy] failed:', error);
  process.exitCode = 1;
}
