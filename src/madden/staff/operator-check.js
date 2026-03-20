import fs from 'fs';
import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { getBillingSummary } from '../../leaguebuddy/manual_billing_service.js';
import { getMaddenLeagueSnapshotPath } from '../../leaguebuddy/paths.js';
import { getSetupStatus } from '../../leaguebuddy/setup_status_service.js';
import { getLeagueForGuild } from '../madden_config.js';

function configured(value) {
  return String(value || '').trim().length > 0;
}

function readyMissing(flag, ready = 'ready', missing = 'missing') {
  return flag ? ready : missing;
}

function icon(flag) {
  return flag ? '✅' : '❌';
}

function snapshotExists(leagueId) {
  if (!leagueId) return false;
  return fs.existsSync(getMaddenLeagueSnapshotPath(leagueId));
}

function nextSteps({ tokenOk, stripeStandardOk, stripePremiumOk, leagueId, setupStatus, billing }) {
  if (!leagueId) return 'Run `/set-league`.';
  if (!snapshotExists(leagueId)) return 'Run `/auth`, then `/sync`.';
  if (!setupStatus.overlayStatus.exists) return 'Run `/setup-channels`.';
  if (setupStatus.syncNeeded) return 'Run `/syncsetupstatus`.';
  if (!setupStatus.overlayStatus.isComplete || !setupStatus.setupCompleted) return 'Run `/setup-roles`, then `/syncsetupstatus`.';
  if ((billing?.plan || 'free') === 'free') return 'Ready on free. Run `/plan` to review the customer view.';
  if (!['active', 'trialing'].includes(String(billing?.subscriptionStatus || 'inactive'))) return 'Run `/activateplan`.';
  return 'Ready. Run `/plan` to verify the customer view.';
}

function buildReadyLines({ leagueId, snapshotOk, setupOk, billingOk }) {
  return [
    `${icon(!!leagueId)} League connected`,
    `${icon(snapshotOk)} League synced`,
    `${icon(setupOk)} Setup finished`,
    `${icon(billingOk)} Paid access active`,
  ].join('\n');
}

function buildQuickStatus({ leagueId, setupStatus, billing }) {
  return [
    `League: **${leagueId || 'not set'}**`,
    `Setup: **${setupStatus.syncNeeded ? 'needs sync' : setupStatus.setupCompleted ? 'done' : 'not done'}**`,
    `Plan: **${billing?.plan || 'free'}**`,
    `Billing: **${billing?.subscriptionStatus || 'inactive'}**`,
    ...(billing?.testingBypass ? ['Testing bypass: **on**'] : []),
  ].join('\n');
}

export const data = new SlashCommandBuilder()
  .setName('server-check')
  .setDescription('Admin-only: quick server readiness check.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export const deferOnDispatch = { flags: 64 };

export async function execute(interaction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.editReply({ content: 'This command can only be used in a server.' });
    return;
  }

  const tokenOk = configured(process.env.DISCORD_TOKEN || process.env.TOKEN);
  const stripeStandardOk = configured(process.env.LB_UPGRADE_URL_STANDARD || process.env.LB_UPGRADE_URL);
  const stripePremiumOk = configured(process.env.LB_UPGRADE_URL_PREMIUM || process.env.LB_UPGRADE_URL);
  const leagueId = getLeagueForGuild(guildId) || null;
  const billing = getBillingSummary(guildId);
  const setupStatus = getSetupStatus(guildId);
  const snapshotOk = snapshotExists(leagueId);
  const setupOk = setupStatus.overlayStatus.exists && setupStatus.overlayStatus.isComplete && setupStatus.setupCompleted && !setupStatus.syncNeeded;
  const billingOk = ['active', 'trialing'].includes(String(billing?.subscriptionStatus || 'inactive'));

  const statusColor = !leagueId || !snapshotOk || setupStatus.syncNeeded
    ? 0xf39c12
    : billingOk
      ? 0x2ecc71
      : 0x5865f2;

  const embed = new EmbedBuilder()
    .setColor(statusColor)
    .setTitle('Server Check')
    .setDescription('Quick server check for the owner or commissioner.')
    .addFields(
      {
        name: 'Ready?',
        value: buildReadyLines({ leagueId, snapshotOk, setupOk, billingOk }),
        inline: false,
      },
      {
        name: 'Current',
        value: buildQuickStatus({ leagueId, setupStatus, billing }),
        inline: false,
      },
      {
        name: 'Do This Next',
        value: nextSteps({ tokenOk, stripeStandardOk, stripePremiumOk, leagueId, setupStatus, billing }),
        inline: false,
      },
    );

  await interaction.editReply({ embeds: [embed], content: '' });
}

export default { data, execute };
