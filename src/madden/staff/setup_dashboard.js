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
import {
  buildSetupReadinessLines,
  inspectSetupReadiness,
} from './setup_readiness.js';
import connectionService from '../services/export_first_connection_service.js';

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Admin-only: the main LEAGUEbuddy setup dashboard and next-step guide.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export const deferOnDispatch = { flags: 64 };

function snapshotExists(leagueId) {
  if (!leagueId) return false;
  return fs.existsSync(getMaddenLeagueSnapshotPath(leagueId));
}

function formatMissingItems(items = []) {
  return items.map((item) => displaySetupItemName(item)).join(', ');
}

function buildFlowLines() {
  return [
    'Use the button below, then press Refresh Setup.',
    'If a button is unavailable, fix the item shown above and refresh.',
  ].join('\n');
}

function buildClaimPrompt({ billing, billingOk }) {
  const plan = String(billing?.plan || 'free').toLowerCase();
  if (plan !== 'free' && !billingOk) {
    return [
      `Run \`/claim-plan\` now to activate this server's paid LEAGUEbuddy plan.`,
      `Current billing status: ${billing?.subscriptionStatus || 'inactive'} • Plan: ${billing?.plan || 'unknown'}`,
      'After the claim succeeds, rerun `/setup` and continue the normal setup flow.',
    ].join('\n');
  }

  return [
    'If you just bought Standard or Premium, run `/claim-plan` in this server before continuing setup.',
    'If this is still a free server, skip this and follow the next step below.',
  ].join('\n');
}

function buildCommissionerLines(tier = 'free') {
  const lines = [
    '1. Assign coaches with `/member assign`.',
    '2. Start the week with `/create-threads`.',
    '3. End the week with `/delete-threads`.',
    '4. Run `/weeklyupdate`.',
    '5. Repeat each week.',
  ];
  if (String(tier).toLowerCase() === 'standard' || String(tier).toLowerCase() === 'premium') {
    lines.splice(1, 0, '2. Use `/member onboard` if you want the DM onboarding pack too.');
  }
  return lines.join('\n');
}

function buildCoachLines() {
  return [
    '1. Run `/help`.',
    '2. Find your game thread.',
    '3. Play your game.',
    '4. Repeat each week.',
  ].join('\n');
}

function buildSetupDecision({ leagueId, snapshotOk, readiness, status, billing, billingOk }) {
  // If plan is not free and billing is not active, require /claim-plan as the very first step
  if (!billingOk && (billing?.plan || 'free') !== 'free') {
    return {
      title: 'Activate your paid plan',
      action: 'Run `/claim-plan` to activate your paid plan for this server, then rerun `/setup`.',
      details: `Current billing status: ${billing?.subscriptionStatus || 'inactive'} • Plan: ${billing?.plan || 'unknown'}`,
    };
  }
  if (!readiness.hasRequiredPermissions) {
    return {
      title: 'Fix Discord bot permissions',
      action: 'A server admin needs to fix the LEAGUEbuddy bot role permissions in Discord, then rerun `/setup`.',
      details: buildSetupReadinessLines(readiness),
    };
  }
  if (readiness.hierarchyWarning) {
    return {
      title: 'Move the LEAGUEbuddy role higher',
      action: 'Move the LEAGUEbuddy role above `Admin` or any protected roles, then rerun `/setup`.',
      details: readiness.hierarchyWarning,
    };
  }
  if (!leagueId) {
    return {
      title: 'Connect the league',
      action: 'Open the league dashboard, connect EA, choose the league, then come back here.',
      details: 'This is the main first step after inviting LEAGUEbuddy.',
      actionKey: 'connect',
    };
  }
  if (!snapshotOk) {
    return {
      title: 'Import league data',
      action: 'Wait a moment, then press Refresh Setup. If it still is not ready, run `/sync` once.',
      details: 'Pins and role setup need a current league snapshot.',
      actionKey: 'refresh',
    };
  }
  if (!status.overlayStatus.exists || status.missingRequiredChannels.length > 0) {
    return {
      title: 'Create or repair the channels',
      action: 'Press Create Channels, then refresh setup.',
      details: status.missingRequiredChannels.length
        ? `Still missing: ${formatMissingItems(status.missingRequiredChannels)}`
        : 'The LEAGUEbuddy channel layout has not been created yet.',
      actionKey: 'channels',
    };
  }
  if (status.missingRequiredPins.length > 0) {
    return {
      title: 'Seed the pins',
      action: 'Press Create Pins, then refresh setup.',
      details: `Still missing: ${formatMissingItems(status.missingRequiredPins)}`,
      actionKey: 'pins',
    };
  }
  if (status.missingRequiredRoles.length > 0) {
    return {
      title: 'Create the final roles',
      action: 'Press Create Roles, then refresh setup.',
      details: `Still missing: ${formatMissingItems(status.missingRequiredRoles)}`,
      actionKey: 'roles',
    };
  }
  if (status.syncNeeded || !status.setupCompleted) {
    return {
      title: 'Finish setup',
      action: 'Press Refresh Setup to finalize access sync.',
      details: 'LEAGUEbuddy will mark setup complete during this final pass.',
      actionKey: 'refresh',
    };
  }
  return {
    title: 'Setup complete',
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
  const setupComplete = decision.title === 'Setup complete';
  const tier = status.overlayStatus.tier || billing?.plan || 'free';
  const claimPrompt = buildClaimPrompt({ billing, billingOk });

  // --- EARLY INFO: Paid Plan Activation Reminder ---
  let earlyInfo = null;
  if ((billing?.plan || 'free') !== 'free' && !billingOk) {
    earlyInfo = [
      'This server is set for a paid plan, but it is not active yet.',
      'Run `/claim-plan` first, then come back to `/setup`.',
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
        ? 'Setup is complete. Use the steps below to start your league.'
        : 'Use this dashboard as your setup home. Do the next action below, then refresh.',
    ].filter(Boolean).join('\n\n'));

  if (setupComplete) {
    embed.addFields(
      {
        name: 'Commissioner Next',
        value: buildCommissionerLines(tier),
      },
      {
        name: 'Coaches Next',
        value: buildCoachLines(),
      },
    );
  } else {
    const fields = [];
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
        name: 'Why',
        value: decision.details,
      }] : []),
      {
        name: 'Repeat',
        value: buildFlowLines(),
      },
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
