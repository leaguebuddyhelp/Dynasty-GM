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
    '1. Start with `/setup`.',
    '2. If LEAGUEbuddy still needs your league, `/setup` will send you to `/connectleague` first.',
    '3. After each step, come back and run `/setup` again.',
    '4. Keep following the one next step until `/setup` says complete.',
  ].join('\n');
}

function buildLaunchLines(tier = 'free') {
  const base = [
    '1. Assign coaches to their team roles with `/member assign`.',
    '2. Have coaches run `/help` to see their commands.',
    '3. Start the week by running `/create-threads`.',
    '4. Have coaches play their games for the week.',
    '5. When the week is over, run `/delete-threads`.',
    '6. Then run `/weeklyupdate` to post results and advance the weekly content.',
    '7. Repeat steps 3 through 6 every week.',
  ];
  if (String(tier).toLowerCase() === 'standard' || String(tier).toLowerCase() === 'premium') {
    base.splice(1, 0, '2. Use `/member onboard` if you want the DM onboarding pack too.');
    base[2] = '3. Have coaches run `/help` to see their commands.';
    base[3] = '4. Start the week by running `/create-threads`.';
    base[4] = '5. Have coaches play their games for the week.';
    base[5] = '6. When the week is over, run `/delete-threads`.';
    base[6] = '7. Then run `/weeklyupdate` to post results and advance the weekly content.';
    base[7] = '8. Repeat steps 4 through 7 every week.';
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
    action: 'Setup is complete. Use the "Start The League" steps below for what to do next.',
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
    .setDescription('Run `/setup` first. LEAGUEbuddy will tell you the next step, including `/connectleague` when your league still needs to be linked.')
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
        name: 'Full Flow',
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
