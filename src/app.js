// LEAGUEbuddy: Modern Discord bot entry
import dotenv from 'dotenv';
import fs, { readdirSync, createWriteStream } from 'fs';
import { Client, GatewayIntentBits, Collection, ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import * as submitScore from './interactions/submit_score.js';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { startAuthServer } from './madden/auth_server.js';
import { startExportWebhook } from './madden/export_webhook.js';
import { startAutoSync } from './madden/auto_sync.js';
import { startLocalSidecar } from './madden/local_sidecar.js';
import { initNotifier, backfillAndRunPendingThreadReminders } from './shared/madden_thread_notifier.js';
import { appendMaddenStaffLog, postMaddenStaffLog, initMaddenStoryScheduler } from './shared/madden_staff_ops.js';
import { updateFairSimBoard } from './shared/fairsim_board.js';
import { inferRecognitionContext, recordRecognitionCommandUse, recordRecognitionThreadReply } from './shared/league_recognition.js';
import { ensureSportsbookWeekPosted, refreshSportsbookHeaders } from './shared/madden_sportsbook.js';
import { collectParticipation, getThreadState, hydrateThreadStateFromLiveThread, listThreadStates } from './shared/madden_thread_notifier.js';
import { hasFeatureAccess, DEFAULT_DENY_MESSAGE } from './leaguebuddy/access.js';
import overlayRepository from './leaguebuddy/repositories/guild_overlay_repository.js';
import { resolveInteractionAccess } from './leaguebuddy/interaction_access_resolver.js';
import { validateStartupConfig } from './leaguebuddy/startup_validation.js';
import { markHealthReady, startHealthcheckServer } from './leaguebuddy/healthcheck.js';

// For self-hosted / multi-server distribution, keep logs quiet by default.
// Opt-in when you actually want the extra noise.
const LB_VERBOSE_LOGS = String(process.env.LB_VERBOSE_LOGS ?? 'false').toLowerCase() === 'true';
const LB_STAFF_LOGS_ENABLED = String(process.env.LB_STAFF_LOGS_ENABLED ?? 'false').toLowerCase() === 'true';

function hasPackEnabled(guildId, featureKey) {
  if (!guildId || !featureKey) return false;
  return overlayRepository.hasPackEnabled(guildId, featureKey);
}

async function denyInteraction(interaction, message = DEFAULT_DENY_MESSAGE) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message, embeds: [], components: [] }).catch(() => { });
      return;
    }
    if (typeof interaction.deferReply === 'function') {
      // Prefer a defer+edit for reliability on buttons.
      await interaction.deferReply({ flags: 64 }).catch(() => { });
      await interaction.editReply({ content: message, embeds: [], components: [] }).catch(() => { });
      return;
    }
    if (typeof interaction.reply === 'function') {
      await interaction.reply({ content: message, flags: 64 }).catch(() => { });
    }
  } catch {
    // swallow
  }
}

dotenv.config();
validateStartupConfig();
startHealthcheckServer();

// Productization toggle: run Madden-only to simplify deployments and avoid loading 2K features.
// Default: true (Madden-only) unless explicitly disabled.
const MADDEN_ONLY = String(process.env.MADDEN_ONLY ?? 'true').toLowerCase() !== 'false';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ]
});
client.commands = new Collection();
client.interactionHandlers = [];

// Start local Madden auth server (for EA login) unless disabled
const enableAuthServer = process.env.MADDEN_AUTH_ENABLED !== 'false' && process.env.MADDEN_AUTH_ENABLED !== '0';
if (enableAuthServer) {
  try {
    startAuthServer();
  } catch (err) {
    console.warn(`[madden-auth] Failed to start auth server: ${err.message}`);
  }
}
try {
  startExportWebhook();
} catch (err) {
  console.warn(`[madden-export] Failed to start export webhook: ${err.message}`);
}
try {
  startAutoSync();
} catch (err) {
  console.warn(`[madden-auto-sync] Failed to start auto sync: ${err.message}`);
}
try {
  startLocalSidecar();
} catch (err) {
  console.warn(`[madden-sidecar] Failed to start local sidecar: ${err.message}`);
}

// Register startseason_confirm button handler
import * as startseasonConfirm from './interactions/startseason_confirm.js';
// Dynamically load all interaction handlers from src/interactions
const interactionsPath = join(process.cwd(), 'src', 'interactions');
const interactionFiles = readdirSync(interactionsPath).filter(f => f.endsWith('.js'));
for (const file of interactionFiles) {
  const filePath = join(interactionsPath, file);
  const handlerModule = await import(pathToFileURL(filePath).href);
  const handler = handlerModule.default || handlerModule;
  // Register main button/select handlers
  if (handler.customId && typeof handler.execute === 'function') {
    client.interactionHandlers.push({ customId: handler.customId, execute: handler.execute });
  }
  // Register modal customIds if present
  for (const key of Object.keys(handler)) {
    if (key.startsWith('customId_')) {
      const customIdValue = handler[key];
      const suffix = key.replace('customId_', '');
      const executeFn = handler[`execute_${suffix}`] || handler.execute;
      if (typeof executeFn === 'function') {
        client.interactionHandlers.push({ customId: customIdValue, execute: executeFn });
      }
    }
  }
}

// OCR and image handling removed for simplified score flow

// Handle interactions (commands and autocomplete)
client.on('interactionCreate', async interaction => {

  // All interactions are now routed through the generic handler system below

  // Handle slash commands
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) {
      console.error(`❌ No command handler found for /${interaction.commandName}`);
      await interaction.reply({ content: 'Command not found.', flags: 64 });
      return;
    }
    // Lightweight command audit log
    if (LB_VERBOSE_LOGS) console.log(`[CMD] ${interaction.user.tag} used /${interaction.commandName}`);

    // ---- Central plan enforcement gate ----
    // We currently map plan enforcement to the existing Madden v2 packsEnabled keys.
    // Commands can opt-in by exporting `featureKey`.
    // Otherwise we fall back to a small name->feature mapping for known pack-like features.
    try {
      const guildId = interaction.guildId;
      if (guildId) {
        const packs = overlayRepository.getPacksEnabled(guildId);

        /** @type {Record<string, string>} */
        const COMMAND_FEATURE_MAP = {
          // scouting/draft tools
          draftprimer: 'scouting_draft',
          draftexport: 'scouting_draft',
          // league recognition system
          recognition: 'recognition',
          // sportsbook system
          sportsbook: 'sportsbook',
        };

        const featureKey = command.featureKey || COMMAND_FEATURE_MAP[interaction.commandName] || null;
        if (featureKey && !packs.includes(featureKey)) {
          const check = hasFeatureAccess(guildId, featureKey);
          if (!check.ok) {
            const msg = DEFAULT_DENY_MESSAGE;
            if (interaction.deferred || interaction.replied) {
              await interaction.editReply({ content: msg });
            } else {
              await interaction.reply({ content: msg, flags: 64 });
            }
            return;
          }
        }
      }
    } catch (e) {
      console.warn('[plans] command gate failed', e?.message || e);
      // Fail open to avoid breaking production if the gate throws for a corner case.
    }

    try {
      if (command.deferOnDispatch && !interaction.deferred && !interaction.replied) {
        await interaction.deferReply(command.deferOnDispatch);
      }
    } catch (error) {
      console.error(`❌ Failed to defer command /${interaction.commandName}:`, error);
      return;
    }
    try {
      // Madden-only now; track all slash command usage for recognition analytics.
      recordRecognitionCommandUse({
        guildId: interaction.guildId,
        league: 'madden',
        userId: interaction.user.id,
        commandName: interaction.commandName,
      });
    } catch (e) {
      console.warn('[recognition] command usage track failed', e?.message || e);
    }
    if (LB_STAFF_LOGS_ENABLED) {
      appendMaddenStaffLog({
        type: 'command',
        guildId: interaction.guildId,
        userId: interaction.user.id,
        username: interaction.user.tag,
        command: interaction.commandName,
      });
      postMaddenStaffLog(
        client,
        interaction.guildId,
        'Madden Command Used',
        `<@${interaction.user.id}> used \`/${interaction.commandName}\`.`,
      ).catch(() => null);
    }
    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`❌ Error executing command /${interaction.commandName}:`, error);
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ content: 'There was an error while executing this command!' });
        } else {
          await interaction.reply({ content: 'There was an error while executing this command!', flags: 64 });
        }
      } catch (replyError) {
        console.error('❌ Failed to send error message:', replyError);
      }
    }
    return;
  }

  // Handle autocomplete interactions for slash commands
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (!command || typeof command.autocomplete !== 'function') {
      console.error(`❌ No autocomplete handler found for /${interaction.commandName}`);
      try { await interaction.respond([]); } catch { }
      return;
    }
    try {
      await command.autocomplete(interaction);
    } catch (error) {
      console.error(`❌ Error in autocomplete for /${interaction.commandName}:`, error);
      try { await interaction.respond([{ name: 'Error loading options', value: 'none' }]); } catch { }
    }
    return;
  }

  // Improved logging for other interaction types
  if (interaction.isButton()) {
    if (LB_VERBOSE_LOGS) console.log(`[INTERACTION] Button pressed: customId=${interaction.customId}, user=${interaction.user?.id}, channel=${interaction.channel?.id}, thread=${interaction.channel?.isThread ? interaction.channel.id : 'N/A'}`);
    const customId = String(interaction.customId || '').toLowerCase();
    const isMaddenButton =
      customId.includes('madden') ||
      customId.startsWith('trade_') ||
      customId.startsWith('builder_') ||
      customId.startsWith('fairsim') ||
      customId.startsWith('forcewin') ||
      customId.startsWith('staff_strike');
    if (isMaddenButton && LB_STAFF_LOGS_ENABLED) {
      appendMaddenStaffLog({
        type: 'button',
        guildId: interaction.guildId,
        userId: interaction.user?.id,
        username: interaction.user?.tag,
        customId: interaction.customId,
        channelId: interaction.channel?.id,
      });
      postMaddenStaffLog(
        client,
        interaction.guildId,
        'Madden Button Used',
        `<@${interaction.user.id}> pressed \`${interaction.customId}\`.`,
        [{ name: 'Channel', value: interaction.channel?.id ? `<#${interaction.channel.id}>` : 'Unknown', inline: true }],
      ).catch(() => null);
    }
  } else if (interaction.isStringSelectMenu()) {
    if (LB_VERBOSE_LOGS) console.log(`[INTERACTION] StringSelectMenu used: customId=${interaction.customId}, user=${interaction.user?.id}`);
  } else if (interaction.isAutocomplete()) {
    // Handle trade and progression buttons, and generic interaction handlers as before
  }

  // ---- Central plan enforcement gate (interactions) ----
  // Slash commands are already gated above. This closes the loophole where a guild can
  // interact with previously-posted buttons/modals without the plan.
  try {
    const accessMatch = resolveInteractionAccess(interaction);
    if (accessMatch?.featureKey) {
      const { featureKey, ruleId, customId } = accessMatch;
      if (!hasPackEnabled(interaction.guildId, featureKey)) {
        const check = hasFeatureAccess(interaction.guildId, featureKey);
        if (!check.ok) {
          if (LB_VERBOSE_LOGS) {
            console.log('[plans] interaction denied', {
              guildId: interaction.guildId,
              ruleId,
              featureKey,
              customId,
              reason: check.reason,
            });
          }
          await denyInteraction(interaction, DEFAULT_DENY_MESSAGE);
          return;
        }
      }
    }
  } catch (e) {
    console.warn('[plans] interaction gate failed', {
      customId: interaction?.customId || null,
      message: e?.message || e,
    });
    // Fail open.
  }

  // --- REGEX/GENERIC BUTTONS: robust customId matching ---
  if (interaction.customId) {
    // Wire up progression OVR modal handler
    if (interaction.isModalSubmit() && interaction.customId.startsWith('progression_ovr_modal_')) {
      const progressionApproveDeny = await import('./interactions/progression_approve_deny.js');
      const handleOvrModal = progressionApproveDeny.handleOvrModal || progressionApproveDeny.default?.handleOvrModal;
      if (typeof handleOvrModal === 'function') {
        await handleOvrModal(interaction);
      } else {
        console.error('❌ handleOvrModal is not a function. Check exports in progression_approve_deny.js');
      }
      return;
    }
    // Route Madden set_game_info_ legacy modal submits
    if (interaction.isModalSubmit() && interaction.customId.startsWith('set_game_info_modal_')) {
      const setGameInfo = await import('./interactions/set_game_info.js');
      await setGameInfo.execute_modal_set_game_info(interaction);
      return;
    }
    // Route 2K set_game_info| modals/buttons (disabled in Madden-only mode)
    if (!MADDEN_ONLY) {
      if (interaction.isModalSubmit() && interaction.customId.startsWith('set_game_info_modal|')) {
        console.log('[router] 2K set_game_info modal', interaction.customId);
        const setGameInfo2k = await import('./2k/set_game_info.js');
        await setGameInfo2k.execute_modal(interaction);
        return;
      }
      if (interaction.isButton() && interaction.customId.startsWith('set_game_info|')) {
        console.log('[router] 2K set_game_info button', interaction.customId);
        const setGameInfo2k = await import('./2k/set_game_info.js');
        await setGameInfo2k.execute(interaction);
        return;
      }
    }

    // Route Madden live mock draft pick select menu (search results)
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('madden_mockdraft_pick|')) {
      const mod = await import('./interactions/madden_mockdraft_live.js');
      const handler = mod.default || mod;
      if (typeof handler.execute !== 'function') {
        throw new TypeError('mockdraft_live interaction handler missing execute()');
      }
      await handler.execute(interaction);
      return;
    }
    let foundHandler = null;
    for (const handler of client.interactionHandlers) {
      if (!handler || typeof handler.execute !== 'function') continue;
      if (typeof handler.customId === 'string' && handler.customId === interaction.customId) {
        foundHandler = handler;
        break;
      }
      if (handler.customId instanceof RegExp && handler.customId.test(interaction.customId)) {
        foundHandler = handler;
        break;
      }
    }
    if (!foundHandler) {
      console.error(`❌ No interaction handler matching ${interaction.customId} was found.`);
      return;
    }
    try {
      await foundHandler.execute(interaction);
    } catch (error) {
      console.error(`❌ Error executing interaction ${interaction.customId}:`, error);
      // If Discord says the interaction is unknown/expired, we can't respond.
      if (error?.code === 10062) {
        return;
      }
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ content: 'There was an error while executing this interaction!' });
        } else {
          await interaction.reply({ content: 'There was an error while executing this interaction!', flags: 64 });
        }
      } catch (replyError) {
        // Avoid noisy follow-up errors when the interaction was already acknowledged/expired.
        if (replyError?.code !== 40060 && replyError?.code !== 10062) {
          console.error('❌ Failed to send error message:', replyError);
        }
      }
    }
    return;
  }
});

client.on('messageCreate', async (message) => {
  if (!message.guild || message.author?.bot || !message.channel?.isThread?.()) return;
  let info = getThreadState(message.channel.id);
  if (!info || info.status !== 'pending') return;
  info = (await hydrateThreadStateFromLiveThread(message.channel, info).catch(() => null)) || info;
  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member) return;
  const roleIds = new Set(member.roles?.cache?.keys?.() || []);
  const trackedRoleIds = [...new Set([...(info.awayRoleIds || []), ...(info.homeRoleIds || [])].filter(Boolean))];
  const isTrackedCoach = trackedRoleIds.some((roleId) => roleIds.has(roleId));
  if (!isTrackedCoach) return;
  const context = inferRecognitionContext('madden', message.guild.id);
  const seasonKey = info.seasonKey || context?.seasonKey || null;
  const weekKey = Number.isFinite(Number(info?.weekIndex)) ? `week_${Number(info.weekIndex) + 1}` : (context?.weekKey || null);
  if (!seasonKey || !weekKey) return;
  try {
    recordRecognitionThreadReply({
      guildId: message.guild.id,
      league: 'madden',
      seasonKey,
      weekKey,
      userId: message.author.id,
    });
  } catch (e) {
    console.warn('[recognition] thread reply track failed', e?.message || e);
  }
});

async function backfillRecognitionThreadReplies(client, guild) {
  const context = inferRecognitionContext('madden', guild?.id);
  const threadStates = listThreadStates().filter((info) => {
    const createdAt = Number(info?.created || 0);
    return createdAt > 0 && (Date.now() - createdAt) <= (7 * 24 * 60 * 60 * 1000);
  });
  if (!threadStates.length) return;
  let scanned = 0;
  let respondersProcessed = 0;
  for (const info of threadStates) {
    const thread = await client.channels.fetch(info.threadId).catch(() => null);
    if (!thread?.isThread?.() || thread.guildId !== guild.id) continue;
    const hydratedInfo = (await hydrateThreadStateFromLiveThread(thread, info).catch(() => null)) || info;
    const seasonKey = hydratedInfo.seasonKey || context?.seasonKey || null;
    const weekKey = Number.isFinite(Number(hydratedInfo?.weekIndex))
      ? `week_${Number(hydratedInfo.weekIndex) + 1}`
      : (context?.weekKey || null);
    if (!seasonKey || !weekKey) continue;
    const participation = await collectParticipation(thread, hydratedInfo).catch(() => null);
    if (!participation) continue;
    scanned += 1;
    for (const userId of [...new Set([...(participation.awayResponderIds || []), ...(participation.homeResponderIds || [])])]) {
      recordRecognitionThreadReply({
        guildId: guild.id,
        league: 'madden',
        seasonKey,
        weekKey,
        userId,
      });
      respondersProcessed += 1;
    }
  }
  if (scanned > 0) {
    console.log('[recognition] thread reply backfill scanned', { guildId: guild.id, scanned, respondersProcessed });
  }
}

// Bot clientReady event (Discord.js v15+)
client.once('clientReady', (readyClient) => {
  markHealthReady(true);
  const appEnv = process.env.APP_ENV || process.env.NODE_ENV || 'undefined';
  console.log(`ENVIRONMENT: ${appEnv}`);
  console.log(`APP FLAGS: MADDEN_ONLY=${MADDEN_ONLY}`);
  console.log('🏀 LEAGUEbuddy is online!');
  console.log(`📊 Logged in as ${readyClient.user.tag}`);
  console.log(`🏟️  Serving ${readyClient.guilds.cache.size} server(s)`);
  console.log(`⚡ Loaded ${client.commands.size} commands`);
  try { initNotifier(client); } catch (e) { console.warn('[notifier] init failed', e?.message || e); }
  try { backfillAndRunPendingThreadReminders(client).catch(() => null); } catch (e) { console.warn('[notifier] startup backfill failed', e?.message || e); }
  try { initMaddenStoryScheduler(client); } catch (e) { console.warn('[story scheduler] init failed', e?.message || e); }
  for (const guild of readyClient.guilds.cache.values()) {
    appendMaddenStaffLog({ type: 'lifecycle', guildId: guild.id, state: 'online' });
    postMaddenStaffLog(client, guild.id, 'Bot Online', 'LEAGUEbuddy Madden services are online.').catch(() => null);
    updateFairSimBoard(client, guild.id).catch((e) => {
      console.warn('[fairsim_board] startup refresh failed', guild.id, e?.message || e);
    });
    // Sportsbook channel is deprecated (Franchise Hub is the entry point), so we no longer
    // post or refresh public sportsbook headers on startup.
    backfillRecognitionThreadReplies(client, guild).catch((e) => {
      console.warn('[recognition] thread reply backfill failed', guild.id, e?.message || e);
    });
  }
});


// Load all commands from src/commands/2k/{coach,staff} and src/commands/madden
async function loadCommands() {
  const commandFolders = MADDEN_ONLY
    ? [
      ['madden'],
      ['madden', 'coach'],
      ['madden', 'staff'],
    ]
    : [
      ['2k', 'coach'],
      ['2k', 'staff'],
      ['madden'],
      ['madden', 'coach'],
      ['madden', 'staff'],
    ];
  // Only scan the primary command directories (old src/commands stubs are ignored)
  const roots = [
    join(process.cwd(), 'src'),
  ];

  for (const parts of commandFolders) {
    for (const root of roots) {
      const commandsPath = join(root, ...parts);
      if (!fs.existsSync(commandsPath)) continue;
      const commandFiles = readdirSync(commandsPath).filter(file => file.endsWith('.js'));
      for (const file of commandFiles) {
        const filePath = join(commandsPath, file);
        const fileURL = pathToFileURL(filePath).href;
        try {
          const commandModule = await import(fileURL);
          const cmd = commandModule.default;
          if (cmd && cmd.data && cmd.execute) {
            client.commands.set(cmd.data.name, cmd);
          }
        } catch (err) {
          console.error(`❌ Error importing ${file}:`, err);
        }
      }
    }
  }
}

const token = process.env.DISCORD_TOKEN || process.env.TOKEN;
if (!token) {
  console.error('❌ DISCORD_TOKEN is not set in environment. Exiting.');
  process.exit(1);
}


// Robust handleImageOCR implementation
async function handleImageOCR(message) {
  // Only process if in a thread
  if (!message.channel || !message.channel.isThread()) return;
  // Only process if thread is marked as pending
  const threadKey = `${message.channel.id}:${message.channel.expectedTeam || ''}`;
  if (!submitScore.pendingScoreThreads || !submitScore.pendingScoreThreads.has(threadKey)) return;
  // Only process if there is an attachment
  if (!message.attachments || message.attachments.size === 0) return;
  // Determine expected image type
  const imageType = message.channel.expectedImageType;
  if (imageType === 'box_score' && typeof submitScore.handleBoxScoreImage === 'function') {
    await submitScore.handleBoxScoreImage(message);
  } else if (imageType === 'team_comparison' && typeof submitScore.handleTeamComparisonImage === 'function') {
    await submitScore.handleTeamComparisonImage(message);
  } else {
    // Fallback: log and ignore
  }
}

(async () => {
  try {
    await loadCommands();
    await client.login(token);
  } catch (err) {
    console.error('❌ Failed to start bot:', err);
    process.exit(1);
  }
})();

async function logLifecycle(state) {
  for (const guild of client.guilds.cache.values()) {
    appendMaddenStaffLog({ type: 'lifecycle', guildId: guild.id, state });
    await postMaddenStaffLog(client, guild.id, state === 'offline' ? 'Bot Offline' : 'Bot Lifecycle', `LEAGUEbuddy Madden services marked \`${state}\`.`).catch(() => null);
  }
}

process.on('SIGINT', () => {
  markHealthReady(false);
  logLifecycle('offline').finally(() => process.exit(0));
});
process.on('SIGTERM', () => {
  markHealthReady(false);
  logLifecycle('offline').finally(() => process.exit(0));
});
