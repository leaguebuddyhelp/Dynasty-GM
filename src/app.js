import { Client, Events, GatewayIntentBits } from 'discord.js';
import { validateStartupConfig } from './leaguebuddy/startup_validation.js';
import { markHealthReady, startHealthcheckServer } from './leaguebuddy/healthcheck.js';
import { getSoloInteractionDenial, loadSoloCommands, loadSoloInteractionHandlers } from './leaguebuddy/solo_mode.js';
import { refreshApplicationEmojiMap } from './shared/application_emojis.js';

validateStartupConfig();
const healthServer = startHealthcheckServer();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = await loadSoloCommands();
client.interactionHandlers = await loadSoloInteractionHandlers();

if (String(process.env.MADDEN_CONNECT_ENABLED ?? 'true').toLowerCase() !== 'false') {
  const { startConnectServer } = await import('./madden/connect_server.js');
  startConnectServer(client);
}

async function replyError(interaction, content) {
  if (interaction.isAutocomplete()) return interaction.respond([]);
  if (interaction.deferred || interaction.replied) return interaction.editReply({ content, embeds: [], components: [] });
  return interaction.reply({ content, flags: 64 });
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    const denial = getSoloInteractionDenial({
      userId: interaction.user?.id,
      guildId: interaction.guildId,
      commandName: interaction.isChatInputCommand() || interaction.isAutocomplete() ? interaction.commandName : null,
    });
    if (denial) return await replyError(interaction, denial);
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command?.autocomplete) await command.autocomplete(interaction);
      else await interaction.respond([]);
      return;
    }
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return await replyError(interaction, 'That command is no longer available. Run `/help` for solo commands.');
      if (command.deferOnDispatch && !interaction.deferred && !interaction.replied) await interaction.deferReply(command.deferOnDispatch);
      await command.execute(interaction);
      return;
    }
    const handler = client.interactionHandlers.find(({ customId }) => {
      if (customId instanceof RegExp) {
        customId.lastIndex = 0;
        return customId.test(interaction.customId || '');
      }
      return customId === interaction.customId;
    });
    if (!handler) return await replyError(interaction, 'This control is no longer available. Run `/help` for solo commands.');
    await handler.execute(interaction);
  } catch (error) {
    console.error('[interaction] failed', error);
    if (error?.code !== 10062) await replyError(interaction, 'The request failed. Check the app logs and try again.').catch(() => {});
  }
});

client.once(Events.ClientReady, () => {
  markHealthReady(true);
  console.log(`[ready] Madden Franchise HQ connected as ${client.user.tag}`);
  refreshApplicationEmojiMap(client).catch((error) => console.warn('[emoji] refresh failed', error.message));
});
client.on(Events.ShardDisconnect, () => markHealthReady(false));
client.on(Events.ShardResume, () => markHealthReady(true));
client.on(Events.Error, (error) => console.error('[discord]', error));

function shutdown() {
  markHealthReady(false);
  client.destroy();
  healthServer?.close();
  process.exit(0);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
await client.login(process.env.DISCORD_TOKEN || process.env.TOKEN);
