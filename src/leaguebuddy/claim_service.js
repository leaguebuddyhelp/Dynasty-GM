import crypto from 'crypto';

import auditRepository from './repositories/audit_log_repository.js';
import claimRepository from './repositories/pending_activation_repository.js';
import { PLANS } from './guild_store.js';
import { activatePlanManually } from './manual_billing_service.js';

const CLAIM_STATUSES = {
  unclaimed: 'unclaimed',
  claimed: 'claimed',
  expired: 'expired',
};

const CLAIM_TTL_MS = 1000 * 60 * 60 * 24 * 30;

function nowIso() {
  return new Date().toISOString();
}

function addMs(ts, delta) {
  return new Date(new Date(ts).getTime() + delta).toISOString();
}

function actorRef(actor) {
  if (!actor || typeof actor !== 'object') return null;
  return actor.userId || actor.tag || actor.username || null;
}

function normalizePlan(plan) {
  const value = String(plan || '').trim().toLowerCase();
  if (value === PLANS.standard || value === PLANS.premium || value === PLANS.free) return value;
  return null;
}

export function normalizeClaimCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function generateClaimCode() {
  const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `LB-${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

function generateClaimId() {
  return crypto.randomUUID();
}

function inferPlanFromPaymentLink(paymentLinkId) {
  const normalized = String(paymentLinkId || '').trim();
  if (!normalized) return null;

  // Stripe can surface payment links as just the id (plink_*) or as a full URL.
  // Normalize to the id when possible.
  let id = normalized;
  if (/^https?:\/\//i.test(normalized)) {
    try {
      const parsed = new URL(normalized);
      const parts = parsed.pathname.split('/').filter(Boolean);
      const maybe = parts.find((part) => part.startsWith('plink_'));
      if (maybe) id = maybe;
    } catch {
      // ignore
    }
  }

  if (id === String(process.env.LB_STRIPE_PAYMENT_LINK_ID_STANDARD || '').trim()) return PLANS.standard;
  if (id === String(process.env.LB_STRIPE_PAYMENT_LINK_ID_PREMIUM || '').trim()) return PLANS.premium;
  return null;
}

function inferPlanFromAmount(amountTotal) {
  const amount = Number(amountTotal);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const standard = Number(process.env.LB_STRIPE_STANDARD_AMOUNT_CENTS || 0);
  const premium = Number(process.env.LB_STRIPE_PREMIUM_AMOUNT_CENTS || 0);
  if (standard > 0 && amount === standard) return PLANS.standard;
  if (premium > 0 && amount === premium) return PLANS.premium;
  return null;
}

export function inferPlanFromStripeCheckoutSession(session = {}) {
  const metadata = session?.metadata || {};
  const metadataPlan = normalizePlan(metadata.lb_plan || metadata.plan || '');
  if (metadataPlan) return metadataPlan;

  const clientRef = String(session?.client_reference_id || '').trim();
  if (clientRef.startsWith('lb_plan:')) {
    const inferred = normalizePlan(clientRef.split(':')[1]);
    if (inferred) return inferred;
  }

  const paymentLinkPlan = inferPlanFromPaymentLink(session?.payment_link);
  if (paymentLinkPlan) return paymentLinkPlan;

  // Fall back to amount checks. Some session payloads expose subtotal instead.
  const totalPlan = inferPlanFromAmount(session?.amount_total);
  if (totalPlan) return totalPlan;
  return inferPlanFromAmount(session?.amount_subtotal);
}

export function createPendingClaim({
  paymentReference,
  alternatePaymentReferences = null,
  plan,
  paymentSource = 'stripe_webhook',
  stripeEventId = null,
  stripeSessionId = null,
  paymentLinkId = null,
  amountTotal = null,
  currency = null,
  customerEmail = null,
  customerName = null,
  metadata = null,
  source = 'stripe_webhook',
} = {}) {
  const normalizedPlan = normalizePlan(plan);
  if (!normalizedPlan || normalizedPlan === PLANS.free) {
    throw new Error('Claim creation requires a paid plan.');
  }

  const allRefs = [
    paymentReference ? String(paymentReference).trim() : null,
    ...(Array.isArray(alternatePaymentReferences)
      ? alternatePaymentReferences.map((ref) => (ref == null ? null : String(ref).trim()))
      : []),
  ].filter(Boolean);

  for (const ref of allRefs) {
    const existing = claimRepository.getClaimByPaymentReference(ref);
    if (existing) return existing;
  }

  let claimCode = null;
  do {
    claimCode = generateClaimCode();
  } while (claimRepository.getClaimByCode(claimCode));

  const createdAt = nowIso();
  const claim = claimRepository.upsertClaim(generateClaimId(), {
    claimCode,
    // Keep `paymentReference` for backward compatibility, but allow multiple references.
    // This makes it easy for users to paste either `pi_...` or `cs_...` into /claim-plan.
    paymentReference: allRefs[0] || null,
    paymentReferences: allRefs,
    paymentSource,
    stripeEventId: stripeEventId ? String(stripeEventId) : null,
    stripeSessionId: stripeSessionId ? String(stripeSessionId) : null,
    paymentLinkId: paymentLinkId ? String(paymentLinkId) : null,
    plan: normalizedPlan,
    amountTotal: amountTotal == null ? null : Number(amountTotal),
    currency: currency ? String(currency).toLowerCase() : null,
    customerEmail: customerEmail ? String(customerEmail) : null,
    customerName: customerName ? String(customerName) : null,
    metadata: metadata && typeof metadata === 'object' ? metadata : null,
    status: CLAIM_STATUSES.unclaimed,
    createdAt,
    expiresAt: addMs(createdAt, CLAIM_TTL_MS),
    claimedGuildId: null,
    claimedAt: null,
    claimedBy: null,
  });

  auditRepository.append({
    kind: 'billing.claim_created',
    source,
    paymentReference: claim.paymentReference,
    after: {
      claimId: claim.claimId,
      claimCode: claim.claimCode,
      plan: claim.plan,
      status: claim.status,
      stripeEventId: claim.stripeEventId,
      stripeSessionId: claim.stripeSessionId,
      paymentLinkId: claim.paymentLinkId,
    },
  });

  return claim;
}

function ensureClaimUsable(claim) {
  if (!claim) throw new Error('No matching paid claim was found yet. Wait a minute and try again, or use the Stripe payment reference from your receipt.');
  if (claim.status === CLAIM_STATUSES.claimed) throw new Error('That claim has already been used.');
  if (claim.expiresAt && new Date(claim.expiresAt).getTime() < Date.now()) throw new Error('That claim has expired.');
  if (!normalizePlan(claim.plan) || claim.plan === PLANS.free) throw new Error('This claim does not map to a paid plan.');
}

export function claimPlanForGuild({
  guildId,
  claimCode = null,
  paymentReference = null,
  actor = null,
  source = 'command:/claim-plan',
} = {}) {
  if (!guildId) throw new Error('Missing guildId');
  const normalizedCode = normalizeClaimCode(claimCode);
  const ref = String(paymentReference || '').trim() || null;
  const claim = normalizedCode
    ? claimRepository.getClaimByCode(normalizedCode)
    : claimRepository.getClaimByPaymentReference(ref);

  ensureClaimUsable(claim);

  const record = activatePlanManually(guildId, {
    plan: claim.plan,
    subscriptionStatus: 'active',
    paymentReference: claim.paymentReference || ref,
    paymentSource: claim.paymentSource || 'stripe_claim',
    billingNote: claim.claimCode ? `Claimed via ${claim.claimCode}` : 'Claimed via Stripe payment reference',
    actor,
    source,
  });

  const updatedClaim = claimRepository.upsertClaim(claim.claimId, {
    status: CLAIM_STATUSES.claimed,
    claimedGuildId: String(guildId),
    claimedAt: nowIso(),
    claimedBy: actorRef(actor),
  });

  auditRepository.append({
    kind: 'billing.claim_redeemed',
    source,
    guildId: String(guildId),
    actor,
    before: {
      claimId: claim.claimId,
      status: claim.status,
      claimedGuildId: claim.claimedGuildId || null,
    },
    after: {
      claimId: updatedClaim.claimId,
      status: updatedClaim.status,
      claimedGuildId: updatedClaim.claimedGuildId,
      plan: record.plan,
      subscriptionStatus: record.subscriptionStatus,
    },
  });

  return {
    claim: updatedClaim,
    record,
  };
}

export function getPendingClaimByPaymentReference(paymentReference) {
  const ref = String(paymentReference || '').trim();
  if (!ref) return null;
  return claimRepository.getClaimByPaymentReference(ref);
}

export function isClaimUsable(claim) {
  try {
    ensureClaimUsable(claim);
    return true;
  } catch {
    return false;
  }
}

export default {
  normalizeClaimCode,
  inferPlanFromStripeCheckoutSession,
  createPendingClaim,
  getPendingClaimByPaymentReference,
  isClaimUsable,
  claimPlanForGuild,
};
