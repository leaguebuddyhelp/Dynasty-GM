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

function icon(flag) {
  return flag ? '✅' : '❌';
}

function buildStageLines({ leagueId, snapshotOk, status }) {
  return [
    `${icon(!!leagueId)} League connected`,
    `${icon(status.overlayStatus.exists)} Channels setup started`,
    `${icon(status.missingRequiredChannels.length === 0 && status.overlayStatus.exists)} Channels created`,
    `${icon(status.overlayStatus.exists)} Pins ready to seed or refresh`,
    `${icon(status.missingRequiredRoles.length === 0)} Roles created`,
    `${icon(status.overlayStatus.isComplete)} Final role-based setup complete`,
    `${icon(!status.syncNeeded && status.setupCompleted)} LEAGUEbuddy access synced`,
    `${icon(snapshotOk)} League snapshot available`,
  ].join('\n');
}

function buildCurrentSummary({ leagueId, snapshotOk, status, billing }) {
  return [
    `League: **${leagueId || 'not connected'}**`,
    `Snapshot: **${snapshotOk ? 'ready' : 'missing'}**`,
    `Package: **${status.overlayStatus.tier || billing?.plan || 'free'}**`,
    `Plan: **${billing?.plan || 'free'}**`,
    `Billing: **${billing?.subscriptionStatus || 'inactive'}**`,
  ].join('\n');
}

function buildNextStep({ leagueId, snapshotOk, readiness, status, billingOk }) {
  if (!readiness.hasRequiredPermissions) {
    return buildSetupReadinessNextSteps(readiness);
  }
  if (readiness.hierarchyWarning) {
    return [
      'The invite link is already correct.',
      'Discord still requires one manual step: move the LEAGUEbuddy role higher in Server Settings > Roles.',
      'Then rerun `/setup`.',
    ].join('\n');
  }
  if (!leagueId) return 'Run `/connectleague`, finish the dashboard flow, then rerun `/setup`.';
  if (!snapshotOk) return 'Run `/league-status` and wait for a healthy snapshot, then rerun `/setup`.';
  if (!status.overlayStatus.exists) return 'Run `/setup-channels` next.';
  if (status.missingRequiredChannels.length > 0) return 'Run `/setup-channels` again to finish creating the package channels.';
  if (status.missingRequiredRoles.length > 0) return 'Run `/setup-roles` next to finish the final LEAGUEbuddy role setup.';
  if (status.syncNeeded || !status.setupCompleted) return 'Setup is ready to finalize. Rerun `/setup` once more if needed, then continue to `/create-threads`.';
  if (!billingOk && (billing?.plan || 'free') !== 'free') return 'Setup is done. Activate billing or plan access before using paid features.';
  return 'Setup is complete. Continue with `/create-threads` or your normal weekly workflow.';
}

function buildFlowLines() {
  return [
    '1. `/connectleague`',
    '2. `/league-status`',
    '3. `/setup-channels`',
    '4. `/setup-pins`',
    '5. `/setup-roles`',
    '6. Rerun `/setup` to confirm everything is synced',
    '7. `/create-threads`',
  ].join('\n');
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

  const embed = new EmbedBuilder()
    .setTitle('LEAGUEbuddy Setup')
    .setColor(!readiness.hasRequiredPermissions || readiness.hierarchyWarning || status.missingRequiredRoles.length || status.syncNeeded
      ? 0xf1c40f
      : 0x57f287)
    .setDescription(buildNextStep({ leagueId, snapshotOk, readiness, status, billing, billingOk }))
    .addFields(
      {
        name: 'Setup Progress',
        value: buildStageLines({ leagueId, snapshotOk, status }),
      },
      {
        name: 'Current',
        value: buildCurrentSummary({ leagueId, snapshotOk, status, billing }),
      },
      {
        name: 'Permissions And Hierarchy',
        value: buildSetupReadinessLines(readiness),
      },
      {
        name: 'Main Flow',
        value: buildFlowLines(),
      },
    );

  if (status.missingRequiredChannels.length || status.missingRequiredRoles.length) {
    embed.addFields({
      name: 'Missing Final Setup Items',
      value: [
        status.missingRequiredChannels.length ? `Channels: ${formatMissingItems(status.missingRequiredChannels)}` : 'Channels: none',
        status.missingRequiredRoles.length ? `Roles: ${formatMissingItems(status.missingRequiredRoles)}` : 'Roles: none',
      ].join('\n'),
    });
  }

  await interaction.editReply({ embeds: [embed], content: '' });
}

export default { data, execute, deferOnDispatch };
