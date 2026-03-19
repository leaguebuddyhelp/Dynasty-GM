import { PLANS, SUBSCRIPTION_STATUSES } from './guild_store.js';
import { normalizePlan } from './plans.js';
import auditRepository from './repositories/audit_log_repository.js';
import planRepository from './repositories/guild_plan_repository.js';

function safeString(v) {
    return v === null || v === undefined ? null : String(v);
}

function nowIso() {
    return new Date().toISOString();
}

export function setSubscriptionStatus(guildId, subscriptionStatus, { actor = null, source = 'manual' } = {}) {
    const before = planRepository.getGuild(guildId, { createIfMissing: true });
    const next = planRepository.upsertGuild(guildId, { subscriptionStatus: String(subscriptionStatus) });

    auditRepository.append({
        kind: 'subscription_status.set',
        source,
        guildId: String(guildId),
        actor,
        before: { subscriptionStatus: before?.subscriptionStatus || null },
        after: { subscriptionStatus: next?.subscriptionStatus || null },
    });

    return next;
}

export function setPlan(guildId, plan, { actor = null, source = 'manual', defaultStatusBehavior = 'auto' } = {}) {
    const before = planRepository.getGuild(guildId, { createIfMissing: true });

    const normalized = normalizePlan(plan);

    let subscriptionStatus = before?.subscriptionStatus || SUBSCRIPTION_STATUSES.inactive;

    if (defaultStatusBehavior === 'auto') {
        if (normalized === PLANS.free) {
            // keep current unless it's unset; most servers with free are inactive
            subscriptionStatus = subscriptionStatus || SUBSCRIPTION_STATUSES.inactive;
        } else {
            // paid plans should be active unless explicitly changed later
            if (!subscriptionStatus || subscriptionStatus === SUBSCRIPTION_STATUSES.inactive) {
                subscriptionStatus = SUBSCRIPTION_STATUSES.active;
            }
        }
    }

    const activatedAt = before?.activatedAt || nowIso();
    const next = planRepository.upsertGuild(guildId, {
        plan: normalized,
        subscriptionStatus,
        activatedAt,
    });

    auditRepository.append({
        kind: 'plan.set',
        source,
        guildId: String(guildId),
        actor,
        before: { plan: before?.plan || null, subscriptionStatus: before?.subscriptionStatus || null },
        after: { plan: next?.plan || null, subscriptionStatus: next?.subscriptionStatus || null },
    });

    return next;
}

export function setSetupCompleted(guildId, setupCompleted, { actor = null, source = 'manual' } = {}) {
    const before = planRepository.getGuild(guildId, { createIfMissing: true });
    const sc = !!setupCompleted;
    const next = planRepository.upsertGuild(guildId, {
        setupCompleted: sc,
        setupCompletedAt: sc ? nowIso() : null,
    });

    auditRepository.append({
        kind: 'setup_completed.set',
        source,
        guildId: String(guildId),
        actor,
        before: { setupCompleted: !!before?.setupCompleted },
        after: { setupCompleted: !!next?.setupCompleted },
    });

    return next;
}

export function ensureGuildActivated(guildId, { actor = null, source = 'manual' } = {}) {
    const before = planRepository.getGuild(guildId, { createIfMissing: true });
    if (before?.activatedAt) return before;

    const next = planRepository.upsertGuild(guildId, { activatedAt: nowIso() });
    auditRepository.append({
        kind: 'guild.activated',
        source,
        guildId: String(guildId),
        actor,
        before: { activatedAt: before?.activatedAt || null },
        after: { activatedAt: next?.activatedAt || null },
    });

    return next;
}

export function setBillingFields(guildId, billingPartial, { actor = null, source = 'manual' } = {}) {
    const before = planRepository.getGuild(guildId, { createIfMissing: true });
    const next = planRepository.upsertGuild(guildId, {
        billing: {
            ...(before?.billing || {}),
            ...(billingPartial || {}),
            customerId: safeString(billingPartial?.customerId) ?? before?.billing?.customerId ?? null,
            subscriptionId: safeString(billingPartial?.subscriptionId) ?? before?.billing?.subscriptionId ?? null,
            provider: safeString(billingPartial?.provider) ?? before?.billing?.provider ?? 'manual',
            currentPeriodEnd: safeString(billingPartial?.currentPeriodEnd) ?? before?.billing?.currentPeriodEnd ?? null,
            interval: safeString(billingPartial?.interval) ?? before?.billing?.interval ?? 'month',
        },
    });

    auditRepository.append({
        kind: 'billing.set',
        source,
        guildId: String(guildId),
        actor,
        before: { billing: before?.billing || null },
        after: { billing: next?.billing || null },
    });

    return next;
}
