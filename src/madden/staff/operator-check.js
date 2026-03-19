import fs from 'fs';
import path from 'path';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { getBillingSummary } from '../../leaguebuddy/manual_billing_service.js';
import { getSetupStatus } from '../../leaguebuddy/setup_status_service.js';
import { getLeagueForGuild } from '../../../madden/madden_config.js';

const LEAGUE_DIR = path.join(process.cwd(), 'data', 'madden', 'leagues');

function configured(value) {
  return String(value || '').trim().length > 0;
}

function yesNo(flag) {
  return flag ? 'configured' : 'missing';
}

function snapshotExists(leagueId) {
  if (!leagueId) return false;
  return fs.existsSync(path.join(LEAGUE_DIR, `${leagueId}.json`));
}

function nextSteps({ tokenOk, stripeStandardOk, stripePremiumOk, leagueId, setupStatus, billing }) {
  if (!tokenOk) return 'Set `DISCORD_TOKEN` before running the bot.';
  if (!stripeStandardOk || !stripePremiumOk) return 'Set `LB_UPGRADE_URL_STANDARD` and `LB_UPGRADE_URL_PREMIUM` for the customer upgrade flow.';
  if (!leagueId) return 'Run `/madden-set-league` in this server.';
  if (!setupStatus.overlayStatus.exists) return 'Run `/setup` to create the Madden overlay config.';
  if (!setupStatus.overlayStatus.isComplete || !setupStatus.setupCompleted) return 'Finish setup and run `/madden-setup-check` plus `/syncsetupstatus`.';
  if ((billing?.plan || 'free') === 'free') return 'Run `/pricing` to verify upgrade links or keep the guild on the free tier.';
  if (!['active', 'trialing'].includes(String(billing?.subscriptionStatus || 'inactive'))) return 'Activate the plan with `/activateplan` after payment is confirmed.';
  return 'Run `/plan` and `/madden-setup-check` to verify the final customer-facing state.';
}

export const data = new SlashCommandBuilder()
  .setName('operator-check')
  .setDescription('Admin-only: show self-hosting setup status for this server.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

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

  await interaction.editReply({
    content: [
      '**Operator Check**',
      `Guild: **${guildId}**`,
      '',
      '**Environment**',
      `Bot token: **${yesNo(tokenOk)}**`,
      `Stripe Standard URL: **${yesNo(stripeStandardOk)}**`,
      `Stripe Premium URL: **${yesNo(stripePremiumOk)}**`,
      '',
      '**League Mapping**',
      `Mapped league: **${leagueId || '(not set)'}**`,
      `League snapshot: **${yesNo(snapshotExists(leagueId))}**`,
      '',
      '**Setup State**',
      `Overlay exists: **${setupStatus.overlayStatus.exists ? 'yes' : 'no'}**`,
      `Overlay complete: **${setupStatus.overlayStatus.isComplete ? 'yes' : 'no'}**`,
      `LEAGUEbuddy setupCompleted: **${setupStatus.setupCompleted ? 'yes' : 'no'}**`,
      `Sync needed: **${setupStatus.syncNeeded ? 'yes' : 'no'}**`,
      '',
      '**Billing / Access**',
      `Plan: **${billing?.plan || 'free'}**`,
      `Subscription: **${billing?.subscriptionStatus || 'inactive'}**`,
      `packsEnabled: **${setupStatus.packsEnabled.length ? setupStatus.packsEnabled.join(', ') : '(none)'}**`,
      '',
      '**Operator Checklist**',
      '1. Configure bot token',
      '2. Configure Stripe links',
      '3. Run `/madden-set-league`',
      '4. Run `/setup`',
      '5. Run `/plan`',
      '6. Run `/madden-setup-check`',
      '',
      '**Next step**',
      nextSteps({ tokenOk, stripeStandardOk, stripePremiumOk, leagueId, setupStatus, billing }),
    ].join('\n'),
  });
}

export default { data, execute };
