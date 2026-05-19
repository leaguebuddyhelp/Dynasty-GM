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
import { ensureGuildActivated, setSetupCompleted } from '../../leaguebuddy/guild_access_service.js';
import { getBillingSummary } from '../../leaguebuddy/manual_billing_service.js';
import { getMaddenLeagueSnapshotPath } from '../../leaguebuddy/paths.js';
import { displaySetupItemName, getSetupStatus } from '../../leaguebuddy/setup_status_service.js';
import { getLeagueForGuild } from '../madden_config.js';
import { getGuildEATokens } from '../ea_guild_auth.js';
import {
  buildSetupReadinessLines,
  inspectSetupReadiness,
} from './setup_readiness.js';
import connectionService from '../services/export_first_connection_service.js';

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Admin-only: set up this server.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

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
    return `Run \`/claim-plan\`, then press Refresh Setup. Status: ${billing?.subscriptionStatus || 'inactive'}`;
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

function buildSetupDecision({ leagueId, snapshotOk, readiness, status, billing, billingOk }) {
  // If plan is not free and billing is not active, require /claim-plan as the very first step
  if (!billingOk && (billing?.plan || 'free') !== 'free') {
    return {
      title: 'Activate Plan',
      action: 'Run `/claim-plan`, then press Refresh Setup.',
      details: `Status: ${billing?.subscriptionStatus || 'inactive'} • Plan: ${billing?.plan || 'unknown'}`,
    };
  }
  if (!readiness.hasRequiredPermissions) {
    return {
      title: 'Fix Permissions',
      action: 'Give LEAGUEbuddy the required Discord permissions, then press Refresh Setup.',
      details: buildSetupReadinessLines(readiness),
    };
  }
  if (readiness.hierarchyWarning) {
    return {
      title: 'Move Bot Role',
      action: 'Move the LEAGUEbuddy role higher in Server Settings, then press Refresh Setup.',
      details: readiness.hierarchyWarning,
    };
  }
  if (!leagueId) {
    return {
      title: 'Connect League',
      action: 'Open the dashboard, connect EA, pick your league, then press Refresh Setup.',
      actionKey: 'connect',
    };
  }
  if (!snapshotOk) {
    return {
      title: 'Sync League',
      action: 'Press Refresh Setup. If data is still not ready, run `/sync` once.',
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
      action: 'Press Refresh Setup.',
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
        .setLabel('Connect League')
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
      .setLabel('Refresh Setup'),
  );

  if (buttons.length) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(0, 5)));
  }
  return rows;
}

function formatSnapshotAge(leagueId) {
  if (!leagueId) return 'none';
  try {
    const filePath = getMaddenLeagueSnapshotPath(leagueId);
    const stat = fs.statSync(filePath);
    return `<t:${Math.floor(stat.mtimeMs / 1000)}:R>`;
  } catch {
    return 'none';
  }
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

function buildConnectionHealthField(guildId, leagueId, snapshotOk) {
  const status = connectionService.getLeagueConnectionStatus(guildId);
  const connection = status?.connection || null;
  const tokens = getGuildEATokens(guildId);
  const coverage = loadSnapshotCoverage(leagueId);
  const leagueName = connection?.leagueName || connection?.summary?.leagueName || leagueId || 'not connected';
  const syncError = connection?.summary?.lastSyncError ? String(connection.summary.lastSyncError) : '';
  const lines = [
    `League: **${leagueName}**`,
    `EA: **${tokens?.accessToken && tokens?.refreshToken ? 'connected' : 'not connected'}**${tokens?.personaName ? ` (${tokens.personaName})` : ''}`,
    `Data: **${snapshotOk ? 'ready' : 'not ready'}** (${formatSnapshotAge(leagueId)})`,
  ];
  if (syncError) {
    lines.push(`Sync issue: ${syncError.slice(0, 160)}`);
  } else if (Array.isArray(coverage.missingBuckets) && coverage.missingBuckets.length) {
    lines.push(`Missing data: **${coverage.missingBuckets.length}** bucket${coverage.missingBuckets.length === 1 ? '' : 's'}`);
  }
  return {
    name: 'Connection',
    value: lines.join('\n').slice(0, 1024),
  };
}

async function maybeSyncSetupState(interaction) {
  const guildId = interaction.guildId;
  const actor = buildActorFromInteraction(interaction);
  let status = getSetupStatus(guildId);
  const shouldSync = status.overlayStatus.isComplete !== status.setupCompleted;
  if (!shouldSync) return status;

  ensureGuildActivated(guildId, { actor, source: 'command:/setup' });
  setSetupCompleted(guildId, status.overlayStatus.isComplete, { actor, source: 'command:/setup' });
  return getSetupStatus(guildId);
}

export async function execute(interaction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.editReply({ content: 'This command can only be used in a server.' });
    return;
  }

  const readiness = await inspectSetupReadiness(interaction.guild);
  const status = await maybeSyncSetupState(interaction);
  // Auto-sync after dashboard setup changes
  try {
    const { syncGuild } = await import('../../shared/guild_auto_sync.js');
    await syncGuild(guildId);
  } catch (e) {
    console.error('[AUTO_SYNC] Failed to sync after setup_dashboard:', e);
  }
  const leagueId = getLeagueForGuild(guildId) || null;
  const snapshotOk = snapshotExists(leagueId);
  const billing = getBillingSummary(guildId);
  const billingOk = ['active', 'trialing'].includes(String(billing?.subscriptionStatus || 'inactive'));
  const decision = buildSetupDecision({ leagueId, snapshotOk, readiness, status, billing, billingOk });
  const setupComplete = decision.title === 'Setup Complete';
  const tier = status.overlayStatus.tier || billing?.plan || 'free';
  const claimPrompt = buildClaimPrompt({ billing, billingOk });
  const connectionHealthField = buildConnectionHealthField(guildId, leagueId, snapshotOk);

  // --- EARLY INFO: Paid Plan Activation Reminder ---
  let earlyInfo = null;
  if ((billing?.plan || 'free') !== 'free' && !billingOk) {
    earlyInfo = [
      'Paid plan is not active yet.',
      'Run `/claim-plan`, then press Refresh Setup.',
    ].join('\n');
  }

  const embed = new EmbedBuilder()
    .setTitle('LEAGUEbuddy Setup')
    .setColor(!readiness.hasRequiredPermissions || readiness.hierarchyWarning || status.missingRequiredRoles.length || status.syncNeeded
      ? 0xf1c40f
      : 0x57f287)
    .setDescription([
      earlyInfo,
      setupComplete
        ? 'Ready.'
        : 'Do the next action below.',
    ].filter(Boolean).join('\n\n'));

  if (setupComplete) {
    embed.addFields(
      connectionHealthField,
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
    fields.push(connectionHealthField);
    if ((billing?.plan || 'free') !== 'free') {
      fields.push({
        name: 'Paid Plan',
        value: claimPrompt,
      });
    }
    fields.push(
      {
        name: decision.title,
        value: decision.action,
      },
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
