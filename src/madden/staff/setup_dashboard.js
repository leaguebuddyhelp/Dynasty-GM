import fs from 'fs';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

import { buildActorFromInteraction } from '../../leaguebuddy/audit.js';
import { claimPlanForGuild } from '../../leaguebuddy/claim_service.js';
import { ensureGuildActivated, setSetupCompleted } from '../../leaguebuddy/guild_access_service.js';
import { getBillingSummary } from '../../leaguebuddy/manual_billing_service.js';
import { getMaddenLeagueSnapshotPath } from '../../leaguebuddy/paths.js';
import { displaySetupItemName, getSetupStatus } from '../../leaguebuddy/setup_status_service.js';
import { getExplicitLeagueForGuild } from '../madden_config.js';
import {
  buildSetupReadinessLines,
  inspectSetupReadiness,
} from './setup_readiness.js';
import connectionService from '../services/export_first_connection_service.js';

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Admin-only: set up this server.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption((o) =>
    o.setName('code')
      .setDescription('Optional claim code after checkout')
      .setRequired(false))
  .addStringOption((o) =>
    o.setName('payment_reference')
      .setDescription('Optional Stripe payment reference from your receipt')
      .setRequired(false));

export const deferOnDispatch = { flags: 64 };

function snapshotExists(leagueId) {
  if (!leagueId) return false;
  return fs.existsSync(getMaddenLeagueSnapshotPath(leagueId));
}

function formatMissingItems(items = []) {
  return items.map((item) => displaySetupItemName(item)).join(', ');
}

function buildClaimPrompt({ billing, billingOk }) {
  const plan = String(billing?.plan || 'free').toLowerCase();
  if (plan !== 'free' && !billingOk) {
    return `Run \`/setup code:<claim-code>\`, then press Check Again. Status: ${billing?.subscriptionStatus || 'inactive'}`;
  }

  return 'Paid plan is active.';
}

function buildCommissionerLines(tier = 'free') {
  const lines = [
    '`/member assign` coaches',
    '`/create-threads` to open the week',
    '`/weeklyupdate` after advance',
  ];
  if (String(tier).toLowerCase() === 'standard' || String(tier).toLowerCase() === 'premium') {
    lines.splice(1, 0, '`/member onboard` for coach DMs');
  }
  return lines.join('\n');
}

function buildCoachLines() {
  return [
    '`/help`',
    '`/schedule`',
    'Use your game thread',
  ].join('\n');
}

function buildLeagueSetupFacts(guildId) {
  const leagueStatus = connectionService.getLeagueConnectionStatus(guildId);
  const explicitLeagueId = getExplicitLeagueForGuild(guildId) || null;
  const connection = leagueStatus?.connection || null;
  const leagueId = explicitLeagueId || connection?.leagueExternalId || null;
  const connectionHealthy = Boolean(connection && leagueId && connection.status === 'connected');
  const snapshotOk = snapshotExists(leagueId);
  return {
    leagueId,
    snapshotOk,
    connection,
    connectionHealthy,
    syncError: connection?.summary?.lastSyncError ? String(connection.summary.lastSyncError) : '',
  };
}

function buildSetupDecision({ leagueId, snapshotOk, connection, connectionHealthy, readiness, status, billing, billingOk }) {
  // If plan is not free and billing is not active, require the claim code as the first step.
  if (!billingOk && (billing?.plan || 'free') !== 'free') {
    return {
      title: 'Activate Plan',
      action: 'Run `/setup code:<claim-code>`, then press Check Again.',
      details: `Status: ${billing?.subscriptionStatus || 'inactive'} • Plan: ${billing?.plan || 'unknown'}`,
    };
  }
  if (!readiness.hasRequiredPermissions) {
    return {
      title: 'Fix Permissions',
      action: 'Give LEAGUEbuddy the required Discord permissions, then press Check Again.',
      details: buildSetupReadinessLines(readiness),
    };
  }
  if (readiness.hierarchyWarning) {
    return {
      title: 'Move Bot Role',
      action: 'Move the LEAGUEbuddy role higher in Server Settings, then press Check Again.',
      details: readiness.hierarchyWarning,
    };
  }
  if (!leagueId || !connection) {
    return {
      title: 'Connect League',
      action: 'Press Open Setup Dashboard. It will walk you through EA login and league selection.',
      actionKey: 'connect',
    };
  }
  if (!connectionHealthy) {
    return {
      title: 'Finish League Connection',
      action: 'Press Open Setup Dashboard to reconnect EA or choose the league again, then press Check Again.',
      details: connection?.status === 'sync_error'
        ? `Last sync issue: ${String(connection?.summary?.lastSyncError || 'Initial sync failed.').slice(0, 220)}`
        : `Current league status: ${connection?.status || 'pending'}`,
      actionKey: 'connect',
    };
  }
  if (!snapshotOk) {
    return {
      title: 'Sync League',
      action: 'Press Check Again. If data is still not ready, run `/sync` once.',
      actionKey: 'refresh',
    };
  }
  if (!status.overlayStatus.exists || status.missingRequiredChannels.length > 0) {
    return {
      title: 'Create Channels',
      action: 'Press Create Channels.',
      details: status.missingRequiredChannels.length
        ? `Still missing: ${formatMissingItems(status.missingRequiredChannels)}`
        : '',
      actionKey: 'channels',
    };
  }
  if (status.missingRequiredPins.length > 0) {
    return {
      title: 'Create Pins',
      action: 'Press Create Pins.',
      details: `Still missing: ${formatMissingItems(status.missingRequiredPins)}`,
      actionKey: 'pins',
    };
  }
  if (status.missingRequiredRoles.length > 0) {
    return {
      title: 'Create Roles',
      action: 'Press Create Roles.',
      details: `Still missing: ${formatMissingItems(status.missingRequiredRoles)}`,
      actionKey: 'roles',
    };
  }
  if (status.syncNeeded || !status.setupCompleted) {
    return {
      title: 'Finish Setup',
      action: 'Press Check Again.',
      actionKey: 'refresh',
    };
  }
  return {
    title: 'Setup Complete',
    action: 'Setup is complete.',
    details: `League: ${leagueId} • Package: ${status.overlayStatus.tier || billing?.plan || 'free'}`,
  };
}

function buildSetupButtons({ decision, interaction }) {
  const rows = [];
  const buttons = [];
  const actionKey = decision?.actionKey || null;

  if (actionKey === 'connect') {
    const { setupUrl } = connectionService.beginLeagueConnection({
      guildId: interaction.guildId,
      guildName: interaction.guild?.name || null,
      createdByUserId: interaction.user.id,
    });
    buttons.push(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Open Setup Dashboard')
        .setURL(setupUrl),
    );
  }

  if (actionKey === 'channels') {
    buttons.push(
      new ButtonBuilder()
        .setCustomId('madden_setup|channels')
        .setStyle(ButtonStyle.Primary)
        .setLabel('Create Channels'),
    );
  }

  if (actionKey === 'pins') {
    buttons.push(
      new ButtonBuilder()
        .setCustomId('madden_setup|pins')
        .setStyle(ButtonStyle.Primary)
        .setLabel('Create Pins'),
    );
  }

  if (actionKey === 'roles') {
    buttons.push(
      new ButtonBuilder()
        .setCustomId('madden_setup|roles')
        .setStyle(ButtonStyle.Primary)
        .setLabel('Create Roles'),
    );
  }

  buttons.push(
    new ButtonBuilder()
      .setCustomId('madden_setup|refresh')
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Check Again'),
  );

  if (buttons.length) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(0, 5)));
  }
  return rows;
}

function loadSnapshotCoverage(leagueId) {
  if (!leagueId) return {};
  try {
    const raw = fs.readFileSync(getMaddenLeagueSnapshotPath(leagueId), 'utf8');
    const snapshot = JSON.parse(raw);
    return snapshot?.syncCoverage || {};
  } catch {
    return {};
  }
}

function buildStatusField({ leagueId, snapshotOk, tier, connection, connectionHealthy }) {
  const coverage = loadSnapshotCoverage(leagueId);
  const leagueName = connection?.leagueName || connection?.summary?.leagueName || leagueId || 'not connected';
  const syncError = connection?.summary?.lastSyncError ? String(connection.summary.lastSyncError) : '';
  const lines = [
    `Package: **${tier || 'free'}**`,
    `League: **${leagueName}**`,
    `Connection: **${connectionHealthy ? 'ready' : connection?.status || 'not connected'}**`,
    `Data: **${snapshotOk ? 'ready' : 'not ready'}**`,
  ];
  if (syncError) {
    lines.push(`Sync issue: ${syncError.slice(0, 160)}`);
  } else if (Array.isArray(coverage.missingBuckets) && coverage.missingBuckets.length) {
    lines.push(`Missing data: **${coverage.missingBuckets.length}** bucket${coverage.missingBuckets.length === 1 ? '' : 's'}`);
  }
  return {
    name: 'Status',
    value: lines.join('\n').slice(0, 1024),
  };
}

async function maybeSyncSetupState(interaction, setupIsComplete) {
  const guildId = interaction.guildId;
  const actor = buildActorFromInteraction(interaction);
  let status = getSetupStatus(guildId);
  const shouldSync = setupIsComplete !== status.setupCompleted;
  if (!shouldSync) return status;

  ensureGuildActivated(guildId, { actor, source: 'command:/setup' });
  setSetupCompleted(guildId, setupIsComplete, { actor, source: 'command:/setup' });
  return getSetupStatus(guildId);
}

async function maybeClaimPlanFromSetup(interaction) {
  const claimCode = interaction.options.getString('code');
  const paymentReference = interaction.options.getString('payment_reference');
  if (!claimCode && !paymentReference) return null;

  const actor = buildActorFromInteraction(interaction);
  const { claim, record } = await claimPlanForGuild({
    guildId: interaction.guildId,
    claimCode,
    paymentReference,
    actor,
    source: 'command:/setup',
  });

  return { claim, record };
}

export async function execute(interaction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.editReply({ content: 'This command can only be used in a server.' });
    return;
  }

  let claimedPlan = null;
  try {
    claimedPlan = await maybeClaimPlanFromSetup(interaction);
  } catch (error) {
    await interaction.editReply({
      content: '',
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle('Plan Claim Failed')
          .setDescription(error?.message || 'The plan could not be claimed right now.')
          .addFields({
            name: 'Next',
            value: 'Check the claim code or use the Stripe payment reference from your receipt.',
          }),
      ],
    });
    return;
  }

  const readiness = await inspectSetupReadiness(interaction.guild);
  const leagueFacts = buildLeagueSetupFacts(guildId);
  const setupIsComplete = Boolean(
    getSetupStatus(guildId).overlayStatus.isComplete
    && leagueFacts.connectionHealthy
    && leagueFacts.snapshotOk
  );
  const status = await maybeSyncSetupState(interaction, setupIsComplete);
  // Auto-sync after dashboard setup changes
  try {
    const { syncGuild } = await import('../../shared/guild_auto_sync.js');
    await syncGuild(guildId);
  } catch (e) {
    console.error('[AUTO_SYNC] Failed to sync after setup_dashboard:', e);
  }
  const billing = getBillingSummary(guildId);
  const billingOk = ['active', 'trialing'].includes(String(billing?.subscriptionStatus || 'inactive'));
  const decision = buildSetupDecision({
    leagueId: leagueFacts.leagueId,
    snapshotOk: leagueFacts.snapshotOk,
    connection: leagueFacts.connection,
    connectionHealthy: leagueFacts.connectionHealthy,
    readiness,
    status,
    billing,
    billingOk,
  });
  const setupComplete = decision.title === 'Setup Complete';
  const tier = status.overlayStatus.tier || billing?.plan || 'free';
  const claimPrompt = buildClaimPrompt({ billing, billingOk });
  const statusField = buildStatusField({
    leagueId: leagueFacts.leagueId,
    snapshotOk: leagueFacts.snapshotOk,
    tier,
    connection: leagueFacts.connection,
    connectionHealthy: leagueFacts.connectionHealthy,
  });

  // --- EARLY INFO: Paid Plan Activation Reminder ---
  let earlyInfo = null;
  if ((billing?.plan || 'free') !== 'free' && !billingOk) {
    earlyInfo = [
      'Paid plan is not active yet.',
      'Run `/setup code:<claim-code>`, then press Check Again.',
    ].join('\n');
  } else if (claimedPlan) {
    earlyInfo = `Plan claimed: **${claimedPlan.record.plan}**.`;
  }

  const embed = new EmbedBuilder()
    .setTitle(setupComplete ? 'Setup Complete' : `Setup: ${decision.title}`)
    .setColor(!readiness.hasRequiredPermissions || readiness.hierarchyWarning || status.missingRequiredRoles.length || status.syncNeeded
      ? 0xf1c40f
      : 0x57f287)
    .setDescription([
      earlyInfo,
      setupComplete
        ? 'Ready. Your league can start using LEAGUEbuddy.'
        : decision.action,
    ].filter(Boolean).join('\n\n'));

  if (setupComplete) {
    embed.addFields(
      statusField,
      {
        name: 'Commissioner',
        value: buildCommissionerLines(tier),
      },
      {
        name: 'Coaches',
        value: buildCoachLines(),
      },
    );
  } else {
    const fields = [];
    fields.push(statusField);
    if ((billing?.plan || 'free') !== 'free') {
      fields.push({
        name: 'Paid Plan',
        value: claimPrompt,
      });
    }
    fields.push({
      name: 'Reset',
      value: 'Use `/resetleague confirm:true` to restart the league connection. Use `/setup-reset` only if you also need to delete LEAGUEbuddy channels or roles.',
    });
    fields.push(
      ...(decision.details ? [{
        name: 'Details',
        value: decision.details,
      }] : []),
    );
    embed.addFields(...fields);
  }

  await interaction.editReply({
    embeds: [embed],
    content: '',
    components: setupComplete ? [] : buildSetupButtons({ decision, interaction }),
  });
}

export default { data, execute, deferOnDispatch };
