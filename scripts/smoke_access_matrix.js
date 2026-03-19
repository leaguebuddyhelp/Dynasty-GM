#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { hasFeatureAccess } from '../src/leaguebuddy/access.js';
import { resolveInteractionAccess } from '../src/leaguebuddy/interaction_access_resolver.js';
import planRepository from '../src/leaguebuddy/repositories/guild_plan_repository.js';
import overlayRepository from '../src/leaguebuddy/repositories/guild_overlay_repository.js';
import { activatePlanManually, attachPaymentReference, deactivatePlanManually } from '../src/leaguebuddy/manual_billing_service.js';
import { buildUpgradeReply, pricingLinkFor } from '../src/leaguebuddy/upgrade_ux.js';
import { requireLeagueIdForGuild } from '../src/madden/madden_data.js';

const guildIdArgIndex = process.argv.indexOf('--guildId');
const customIdArgIndex = process.argv.indexOf('--customId');
const guildId = guildIdArgIndex >= 0 ? String(process.argv[guildIdArgIndex + 1] || '') : 'smoke-test-guild';
const customIdArg = customIdArgIndex >= 0 ? String(process.argv[customIdArgIndex + 1] || '') : null;

const overlayPath = path.join(process.cwd(), 'data', 'guilds', guildId, 'madden.config.json');
const storePath = path.join(process.cwd(), 'data', 'leaguebuddy', 'guilds.json');

function snapshotFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function restoreFile(filePath, before) {
  if (before === null) {
    fs.rmSync(filePath, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, before);
}

function cleanupEmptyGuildDir(filePath) {
  const dir = path.dirname(filePath);
  try {
    const entries = fs.readdirSync(dir);
    if (!entries.length) fs.rmdirSync(dir);
  } catch {
    // ignore
  }
}

function assertResult(condition, label) {
  if (!condition) {
    console.error(`FAIL ${label}`);
    return false;
  }
  console.log(`PASS ${label}`);
  return true;
}

function fakeInteraction(customId, type = 'button') {
  return {
    guildId,
    customId,
    isButton: () => type === 'button',
    isStringSelectMenu: () => type === 'stringSelect',
    isModalSubmit: () => type === 'modal',
  };
}

function shouldAllowInteractionForFeature(guildId, featureKey) {
  if (overlayRepository.getPacksEnabled(guildId).includes(featureKey)) return true;
  return hasFeatureAccess(guildId, featureKey).ok;
}

const beforeStore = snapshotFile(storePath);
const beforeOverlay = snapshotFile(overlayPath);
let failed = false;

try {
  planRepository.upsertGuild(guildId, {
    plan: 'free',
    subscriptionStatus: 'inactive',
    setupCompleted: false,
    activatedAt: null,
  });
  overlayRepository.saveGuildConfig(guildId, {
    version: 2,
    status: 'incomplete',
    updatedAt: new Date().toISOString(),
    license: { tier: 'free' },
    packsEnabled: [],
    compat: { maddenChannelMap: {}, maddenRoleMap: {} },
    pins: {},
  });

  failed ||= !assertResult(hasFeatureAccess(guildId, 'trades_basic').ok === false, 'setup-required free feature is blocked before setup');
  failed ||= !assertResult((() => {
    try {
      requireLeagueIdForGuild(guildId);
      return false;
    } catch {
      return true;
    }
  })(), 'strict league resolver rejects unmapped guild');

  planRepository.upsertGuild(guildId, { setupCompleted: true });
  failed ||= !assertResult(hasFeatureAccess(guildId, 'trades_basic').ok === true, 'free plan gets trades_basic after setup');
  failed ||= !assertResult(hasFeatureAccess(guildId, 'scouting_draft').reason === 'plan_too_low', 'free plan blocks scouting_draft by plan');

  planRepository.upsertGuild(guildId, { plan: 'standard', subscriptionStatus: 'inactive', setupCompleted: true });
  failed ||= !assertResult(hasFeatureAccess(guildId, 'scouting_draft').reason === 'subscription_inactive', 'paid feature requires active subscription');

  planRepository.upsertGuild(guildId, { subscriptionStatus: 'active' });
  failed ||= !assertResult(hasFeatureAccess(guildId, 'scouting_draft').ok === true, 'active standard plan unlocks scouting_draft');

  const activated = activatePlanManually(guildId, {
    plan: 'premium',
    paymentReference: 'pi_test_123',
    paymentSource: 'stripe_payment_link',
    billingNote: 'manual activation smoke',
    source: 'smoke',
  });
  failed ||= !assertResult(activated.plan === 'premium' && activated.subscriptionStatus === 'active', 'manual activation sets premium active state');
  failed ||= !assertResult(activated.billing?.paymentReference === 'pi_test_123', 'manual activation stores payment reference');

  const attached = attachPaymentReference(guildId, {
    paymentReference: 'pi_test_456',
    paymentSource: 'stripe_payment_link',
    billingNote: 'updated ref',
    source: 'smoke',
  });
  failed ||= !assertResult(attached.billing?.paymentReference === 'pi_test_456', 'attachPaymentReference updates billing metadata without breaking record');

  const deactivated = deactivatePlanManually(guildId, {
    subscriptionStatus: 'canceled',
    source: 'smoke',
  });
  failed ||= !assertResult(deactivated.subscriptionStatus === 'canceled', 'manual deactivation updates subscription status');
  failed ||= !assertResult(hasFeatureAccess(guildId, 'sportsbook').reason === 'subscription_inactive', 'canceled paid plan blocks paid access');

  planRepository.upsertGuild(guildId, { plan: 'free', subscriptionStatus: 'inactive', setupCompleted: false });
  overlayRepository.saveGuildConfig(guildId, {
    version: 2,
    status: 'incomplete',
    updatedAt: new Date().toISOString(),
    license: { tier: 'free' },
    packsEnabled: ['sportsbook'],
    compat: { maddenChannelMap: {}, maddenRoleMap: {} },
    pins: {},
  });
  failed ||= !assertResult(shouldAllowInteractionForFeature(guildId, 'sportsbook') === true, 'packsEnabled overrides plan gate before access check');

  const registryChecks = [
    ['madden_sportsbook_open|123', 'button', 'sportsbook'],
    ['madden_myscouts_page|1', 'button', 'scouting_draft'],
    ['trade_builder_add|yours|draft1', 'button', 'trades_basic'],
    ['trade_builder_pick_modal|yours|draft1', 'modal', 'trades_basic'],
    ['trade_select_partner', 'stringSelect', 'trades_basic'],
    ['madden_content_review|approve|abc', 'button', 'recognition'],
    ['madden_franchisehub_spend|activity', 'button', 'recognition'],
    ['madden_franchisehub_buy|impact|draftWarRoomIntel', 'button', 'recognition'],
    ['madden_franchisehub_confirm|impact|draftWarRoomIntel', 'button', 'recognition'],
    ['madden_franchisehub_pick|doubleOrNothing|activity', 'button', 'recognition'],
  ];

  for (const [id, type, expected] of registryChecks) {
    const resolved = resolveInteractionAccess(fakeInteraction(id, type));
    failed ||= !assertResult(resolved?.featureKey === expected, `resolver maps ${id} -> ${expected}`);
  }

  const upgradeReply = buildUpgradeReply({ targetPlan: 'premium', guildId });
  failed ||= !assertResult(Array.isArray(upgradeReply.embeds) && upgradeReply.embeds.length >= 2, 'upgrade helper returns pricing + post-payment embeds');
  failed ||= !assertResult(pricingLinkFor('premium') === null || typeof pricingLinkFor('premium') === 'string', 'pricing link helper returns a string or null');

  if (customIdArg) {
    const inferredType = customIdArg.startsWith('trade_builder_pick_modal|') || customIdArg === 'trade_modal_submit'
      ? 'modal'
      : customIdArg.startsWith('trade_select_')
        ? 'stringSelect'
        : 'button';
    const resolved = resolveInteractionAccess(fakeInteraction(customIdArg, inferredType));
    console.log('CUSTOM', JSON.stringify({ guildId, customId: customIdArg, resolved }, null, 2));
    failed ||= !assertResult(!!resolved, `resolver returns a mapping for customId ${customIdArg}`);
  }
} catch (error) {
  console.error('FAIL smoke script threw', error);
  failed = true;
} finally {
  restoreFile(storePath, beforeStore);
  restoreFile(overlayPath, beforeOverlay);
  cleanupEmptyGuildDir(overlayPath);
}

process.exit(failed ? 1 : 0);
