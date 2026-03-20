import { PLANS, SUBSCRIPTION_STATUSES } from './guild_store.js';
import { normalizePlan } from './plans.js';
import planRepository from './repositories/guild_plan_repository.js';
import { getTestingBypassBilling } from './testing_bypass.js';
import auditRepository from './repositories/audit_log_repository.js';
import {
  ensureGuildActivated,
  setBillingFields,
  setPlan,
  setSubscriptionStatus,
} from './guild_access_service.js';

function nowIso() {
  return new Date().toISOString();
}

function safeString(value) {
  return value === null || value === undefined || value === '' ? null : String(value);
}

function actorRef(actor) {
  if (!actor || typeof actor !== 'object') return null;
  return actor.userId || actor.tag || actor.username || null;
}

function normalizeStatusForPlan(plan, status) {
  if (status) return String(status);
  return plan === PLANS.free ? SUBSCRIPTION_STATUSES.inactive : SUBSCRIPTION_STATUSES.active;
}

export function activatePlanManually(guildId, {
  plan,
  subscriptionStatus = null,
  paymentReference = null,
  paymentSource = null,
  billingNote = null,
  internalNote = null,
  actor = null,
  source = 'manual',
} = {}) {
  const normalizedPlan = normalizePlan(plan);
  const normalizedStatus = normalizeStatusForPlan(normalizedPlan, subscriptionStatus);
  const before = planRepository.getGuild(guildId, { createIfMissing: true });
  const ts = nowIso();

  ensureGuildActivated(guildId, { actor, source });
  let rec = setPlan(guildId, normalizedPlan, { actor, source });
  if (normalizedStatus !== rec.subscriptionStatus) {
    rec = setSubscriptionStatus(guildId, normalizedStatus, { actor, source });
  }

  const billingPatch = {
    provider: 'manual',
    activatedBy: actorRef(actor),
    activatedAt: ts,
    lastPlanChangeAt: ts,
  };
  if (paymentReference !== null) billingPatch.paymentReference = safeString(paymentReference);
  if (paymentSource !== null) billingPatch.paymentSource = safeString(paymentSource);
  if (billingNote !== null) billingPatch.billingNote = safeString(billingNote);
  if (internalNote !== null) billingPatch.internalNote = safeString(internalNote);
  rec = setBillingFields(guildId, billingPatch, { actor, source });

  auditRepository.append({
    kind: 'billing.manual_activation',
    source,
    guildId: String(guildId),
    actor,
    before: {
      plan: before?.plan || null,
      subscriptionStatus: before?.subscriptionStatus || null,
      billing: before?.billing || null,
    },
    after: {
      plan: rec?.plan || null,
      subscriptionStatus: rec?.subscriptionStatus || null,
      billing: rec?.billing || null,
    },
  });

  return rec;
}

export function deactivatePlanManually(guildId, {
  subscriptionStatus = SUBSCRIPTION_STATUSES.canceled,
  billingNote = null,
  internalNote = null,
  actor = null,
  source = 'manual',
} = {}) {
  const before = planRepository.getGuild(guildId, { createIfMissing: true });
  const ts = nowIso();
  let rec = setSubscriptionStatus(guildId, subscriptionStatus, { actor, source });
  rec = setBillingFields(guildId, {
    provider: 'manual',
    billingNote: billingNote !== null ? safeString(billingNote) : before?.billing?.billingNote ?? null,
    internalNote: internalNote !== null ? safeString(internalNote) : before?.billing?.internalNote ?? null,
    lastPlanChangeAt: ts,
  }, { actor, source });

  auditRepository.append({
    kind: 'billing.manual_deactivation',
    source,
    guildId: String(guildId),
    actor,
    before: {
      subscriptionStatus: before?.subscriptionStatus || null,
      billing: before?.billing || null,
    },
    after: {
      subscriptionStatus: rec?.subscriptionStatus || null,
      billing: rec?.billing || null,
    },
  });

  return rec;
}

export function attachPaymentReference(guildId, {
  paymentReference,
  paymentSource = null,
  billingNote = null,
  internalNote = null,
  actor = null,
  source = 'manual',
} = {}) {
  const before = planRepository.getGuild(guildId, { createIfMissing: true });
  const rec = setBillingFields(guildId, {
    provider: 'manual',
    paymentReference: safeString(paymentReference),
    paymentSource: paymentSource !== null ? safeString(paymentSource) : before?.billing?.paymentSource ?? null,
    billingNote: billingNote !== null ? safeString(billingNote) : before?.billing?.billingNote ?? null,
    internalNote: internalNote !== null ? safeString(internalNote) : before?.billing?.internalNote ?? null,
  }, { actor, source });

  auditRepository.append({
    kind: 'billing.payment_reference_attached',
    source,
    guildId: String(guildId),
    actor,
    before: {
      paymentReference: before?.billing?.paymentReference || null,
      paymentSource: before?.billing?.paymentSource || null,
    },
    after: {
      paymentReference: rec?.billing?.paymentReference || null,
      paymentSource: rec?.billing?.paymentSource || null,
    },
  });

  return rec;
}

export function getBillingSummary(guildId) {
  const bypass = getTestingBypassBilling(guildId);
  if (bypass) return bypass;
  const rec = planRepository.getGuild(guildId, { createIfMissing: false });
  return {
    guildId: String(guildId),
    plan: rec?.plan || PLANS.free,
    subscriptionStatus: rec?.subscriptionStatus || SUBSCRIPTION_STATUSES.inactive,
    activatedAt: rec?.activatedAt || null,
    billing: rec?.billing || null,
    testingBypass: false,
  };
}

export default {
  activatePlanManually,
  deactivatePlanManually,
  attachPaymentReference,
  getBillingSummary,
};
