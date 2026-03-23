import fs from 'fs';
import {
  EmbedBuilder,
  MessageFlags,
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
  buildSetupReadinessNextSteps,
  inspectSetupReadiness,
} from './setup_readiness.js';

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Admin-only: the main LEAGUEbuddy setup dashboard and next-step guide.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export const deferOnDispatch = { flags: MessageFlags.Ephemeral };

function snapshotExists(leagueId) {
  if (!leagueId) return false;
  return fs.existsSync(getMaddenLeagueSnapshotPath(leagueId));
}

function formatMissingItems(items = []) {
  return items.map((item) => displaySetupItemName(item)).join(', ');
}

function buildFlowLines() {
  return [
    '1. Do the one next step below.',
    '2. Run `/setup` again.',
    '3. Repeat until setup is complete.',
  ].join('\n');
}

function buildClaimPrompt({ billing, billingOk }) {
  const plan = String(billing?.plan || 'free').toLowerCase();
  if (plan === 'free' || billingOk) return null;
  return [
    'This server has a paid LEAGUEbuddy plan that is not active yet.',
    `Current billing status: ${billing?.subscriptionStatus || 'inactive'} • Plan: ${billing?.plan || 'unknown'}`,
    'Before anything else, run `/claim-plan` in this server.',
    'After the claim succeeds, rerun `/setup` and continue the normal setup flow.',
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
      action: 'Run `/connectleague`, finish the dashboard flow, then rerun `/setup`.',
      details: 'For a free server, this is the main first step after inviting LEAGUEbuddy.',
    };
  }
  if (!snapshotOk) {
    return {
      title: 'Wait for a healthy snapshot',
      action: 'Run `/league-status`. Once the league snapshot looks healthy, rerun `/setup`.',
      details: 'Pins and role setup depend on current league data.',
    };
  }
  if (!status.overlayStatus.exists || status.missingRequiredChannels.length > 0) {
    return {
      title: 'Create or repair the channels',
      action: 'Run `/setup-channels`, then rerun `/setup`.',
      details: status.missingRequiredChannels.length
        ? `Still missing: ${formatMissingItems(status.missingRequiredChannels)}`
        : 'The LEAGUEbuddy channel layout has not been created yet.',
    };
  }
  if (status.missingRequiredPins.length > 0) {
    return {
      title: 'Seed the pins',
      action: 'Run `/setup-pins`, then rerun `/setup`.',
      details: `Still missing: ${formatMissingItems(status.missingRequiredPins)}`,
    };
  }
  if (status.missingRequiredRoles.length > 0) {
    return {
      title: 'Create the final roles',
      action: 'Run `/setup-roles`, then rerun `/setup`.',
      details: `Still missing: ${formatMissingItems(status.missingRequiredRoles)}`,
    };
  }
  if (status.syncNeeded || !status.setupCompleted) {
    return {
      title: 'Finish setup',
      action: 'Rerun `/setup` once more to finalize access sync automatically.',
      details: 'LEAGUEbuddy will mark setup complete during this final pass.',
    };
  }
  return {
    title: 'Setup complete',
    action: 'Setup is complete.',
    details: `League: ${leagueId} • Package: ${status.overlayStatus.tier || billing?.plan || 'free'}`,
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

  // DEBUG: Print billing summary and guildId for Stripe sandbox troubleshooting (ESM compatible)
  try {
    const billingSummary = getBillingSummary(guildId);
    console.log(`[SETUP_DASHBOARD DEBUG] guildId: ${guildId}`);
    console.log('[SETUP_DASHBOARD DEBUG] billing summary:', JSON.stringify(billingSummary, null, 2));
  } catch (e) {
    console.error('[SETUP_DASHBOARD DEBUG] Failed to print billing summary:', e);
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
      '💡 **Paid Plan Setup:**',
      'This server is set for a paid plan, but it is not yet active.',
      'Run `/claim-plan` to activate your paid plan for this server as soon as possible.',
      'You can do this at any time, even before fixing permissions.',
      '',
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
        : 'Use `/setup` as your guide. Do the next step below, then come back to `/setup`.',
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
    if (claimPrompt) {
      embed.addFields(
        {
          name: 'Before Anything Else',
          value: claimPrompt,
        },
        {
          name: 'Next Step',
          value: decision.action,
        },
        {
          name: 'Repeat',
          value: buildFlowLines(),
        },
      );
    } else {
      embed.addFields(
        {
          name: 'Next Step',
          value: decision.action,
        },
        {
          name: 'Repeat',
          value: buildFlowLines(),
        },
      );
    }
  }

  await interaction.editReply({ embeds: [embed], content: '' });
}

export default { data, execute, deferOnDispatch };
