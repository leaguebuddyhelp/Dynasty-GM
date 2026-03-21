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
    '1. Run the one command shown below.',
    '2. Do only that one thing.',
    '3. Run `/setup` again.',
    '4. Repeat until `/setup` says complete.',
  ].join('\n');
}

function buildLaunchLines(tier = 'free') {
  const base = [
    '1. Assign coaches to their team roles with `/member assign`.',
    '2. Have coaches run `/help` to see their commands.',
    '3. Run `/create-threads` at the start of the week and `/delete-threads` when the week is done.',
    '4. Play the games.',
    '5. Run `/weeklyupdate` when the week is over.',
    '6. Repeat `/create-threads` -> games -> `/delete-threads` -> `/weeklyupdate` every week.',
  ];
  if (String(tier).toLowerCase() === 'standard' || String(tier).toLowerCase() === 'premium') {
    base.splice(1, 0, '2. Use `/member onboard` if you want the DM onboarding pack too.');
    base[2] = '3. Have coaches run `/help` to see their commands.';
    base[3] = '4. Run `/create-threads` at the start of the week and `/delete-threads` when the week is done.';
    base[4] = '5. Play the games.';
    base[5] = '6. Run `/weeklyupdate` when the week is over.';
    base[6] = '7. Repeat `/create-threads` -> games -> `/delete-threads` -> `/weeklyupdate` every week.';
  }
  return base.join('\n');
}

function buildSetupDecision({ leagueId, snapshotOk, readiness, status, billing, billingOk }) {
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
  if (!billingOk && (billing?.plan || 'free') !== 'free') {
    return {
      title: 'Activate paid access',
      action: 'Setup is complete. Activate billing or plan access before using paid features.',
      details: `Current billing status: ${billing?.subscriptionStatus || 'inactive'}`,
    };
  }
  return {
    title: 'Setup complete',
    action: 'Setup is complete. Run `/create-threads` or continue with your normal weekly workflow.',
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

  const readiness = await inspectSetupReadiness(interaction.guild);
  const status = await maybeSyncSetupState(interaction);
  const leagueId = getLeagueForGuild(guildId) || null;
  const snapshotOk = snapshotExists(leagueId);
  const billing = getBillingSummary(guildId);
  const billingOk = ['active', 'trialing'].includes(String(billing?.subscriptionStatus || 'inactive'));
  const decision = buildSetupDecision({ leagueId, snapshotOk, readiness, status, billing, billingOk });
  const setupComplete = decision.title === 'Setup complete';
  const tier = status.overlayStatus.tier || billing?.plan || 'free';

  const embed = new EmbedBuilder()
    .setTitle('LEAGUEbuddy Setup')
    .setColor(!readiness.hasRequiredPermissions || readiness.hierarchyWarning || status.missingRequiredRoles.length || status.syncNeeded
      ? 0xf1c40f
      : 0x57f287)
    .setDescription('Free quick start: invite LEAGUEbuddy, run `/connectleague`, then use `/setup` until it says complete.')
    .addFields(
      {
        name: 'Current Step',
        value: decision.title,
      },
      {
        name: 'Do This Next',
        value: decision.action,
      },
      {
        name: 'Why',
        value: decision.details,
      },
      {
        name: 'Repeat Loop',
        value: buildFlowLines(),
      },
      ...(setupComplete ? [{
        name: 'Start The League',
        value: buildLaunchLines(tier),
      }] : []),
    );

  await interaction.editReply({ embeds: [embed], content: '' });
}

export default { data, execute, deferOnDispatch };
