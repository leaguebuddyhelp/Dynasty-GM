import { PLANS, SUBSCRIPTION_STATUSES } from './guild_store.js';
import { setSetupCompleted } from './guild_access_service.js';
import { loadGuildMaddenConfig, saveGuildMaddenConfig } from '../shared/madden_guild_config.js';
import { syncGuild } from '../shared/guild_auto_sync.js';

export const DEFAULT_PACKS = {
  free: ['core', 'threads', 'stats_light'],
  standard: ['core', 'threads', 'trades_basic', 'stats_light', 'scouting_draft', 'ops_light'],
  premium: ['core', 'threads', 'trades_basic', 'stats_light', 'scouting_draft', 'ops_light', 'ops_full', 'recognition', 'sportsbook'],
};

function nowIso() {
  return new Date().toISOString();
}

function normalizePlan(plan) {
  const value = String(plan || '').trim().toLowerCase();
  if (value === PLANS.standard || value === PLANS.premium || value === PLANS.free) return value;
  return PLANS.free;
}

function normalizeSubscriptionStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (
    value === SUBSCRIPTION_STATUSES.active ||
    value === SUBSCRIPTION_STATUSES.trialing ||
    value === SUBSCRIPTION_STATUSES.past_due ||
    value === SUBSCRIPTION_STATUSES.canceled ||
    value === SUBSCRIPTION_STATUSES.inactive
  ) {
    return value;
  }
  return SUBSCRIPTION_STATUSES.inactive;
}

export function resolveOverlayTier(plan, subscriptionStatus) {
  const normalizedPlan = normalizePlan(plan);
  const normalizedStatus = normalizeSubscriptionStatus(subscriptionStatus);
  const paidActive =
    normalizedPlan !== PLANS.free &&
    (
      normalizedStatus === SUBSCRIPTION_STATUSES.active ||
      normalizedStatus === SUBSCRIPTION_STATUSES.trialing
    );
  return paidActive ? normalizedPlan : PLANS.free;
}

export function syncOverlayToBillingState(guildId, { plan, subscriptionStatus } = {}) {
  const tier = resolveOverlayTier(plan, subscriptionStatus);
  const current = loadGuildMaddenConfig(guildId) || {};
  const packsEnabled = [...(DEFAULT_PACKS[tier] || DEFAULT_PACKS.free)];

  const nextConfig = {
    version: 2,
    status: 'incomplete',
    updatedAt: nowIso(),
    license: { tier },
    packsEnabled,
    compat: {
      maddenChannelMap:
        current?.compat?.maddenChannelMap && typeof current.compat.maddenChannelMap === 'object'
          ? current.compat.maddenChannelMap
          : {},
      maddenRoleMap:
        current?.compat?.maddenRoleMap && typeof current.compat.maddenRoleMap === 'object'
          ? current.compat.maddenRoleMap
          : {},
    },
    pins:
      current?.pins && typeof current.pins === 'object'
        ? current.pins
        : {},
  };

  saveGuildMaddenConfig(guildId, nextConfig);
  return nextConfig;
}

export async function resyncGuildAfterPlanChange(guildId, { plan, subscriptionStatus, actor = null, source = 'manual' } = {}) {
  const overlayConfig = syncOverlayToBillingState(guildId, { plan, subscriptionStatus });
  setSetupCompleted(guildId, false, { actor, source });
  await syncGuild(guildId);
  return overlayConfig;
}

export default {
  DEFAULT_PACKS,
  resolveOverlayTier,
  syncOverlayToBillingState,
  resyncGuildAfterPlanChange,
};
