import { PLANS, SUBSCRIPTION_STATUSES } from './guild_store.js';
import { getFeature, normalizePlan, planRank } from './plans.js';
import planRepository from './repositories/guild_plan_repository.js';

export const DEFAULT_DENY_MESSAGE = '🔒 This feature is not available on your current plan. Check pricing to upgrade.';

export function getGuildPlan(guildId) {
    const rec = planRepository.getGuild(guildId, { createIfMissing: false });
    return normalizePlan(rec?.plan || PLANS.free);
}

/**
 * Feature access check.
 *
 * Rules:
 * - If there's no guild record, default is free & inactive (no premium).
 * - subscriptionStatus must be active/trialing for paid plans to count.
 * - requiresSetup features require setupCompleted.
 */
export function hasFeatureAccess(guildId, featureKey, { allowInactiveFree = true } = {}) {
    const rec = planRepository.getGuild(guildId, { createIfMissing: false });
    const feature = getFeature(featureKey);

    // Unknown feature => deny by default (safer).
    if (!feature) {
        return {
            ok: false,
            reason: 'unknown_feature',
            plan: normalizePlan(rec?.plan || PLANS.free),
            feature,
        };
    }

    const plan = normalizePlan(rec?.plan || PLANS.free);
    const status = String(rec?.subscriptionStatus || SUBSCRIPTION_STATUSES.inactive);

    // Free plan can be used even if subscriptionStatus is inactive.
    const paidPlan = plan !== PLANS.free;
    if (paidPlan) {
        const active = status === SUBSCRIPTION_STATUSES.active || status === SUBSCRIPTION_STATUSES.trialing;
        if (!active) {
            return { ok: false, reason: 'subscription_inactive', plan, feature };
        }
    } else if (!allowInactiveFree && status !== SUBSCRIPTION_STATUSES.active && status !== SUBSCRIPTION_STATUSES.trialing) {
        return { ok: false, reason: 'subscription_inactive', plan, feature };
    }

    // Setup gate.
    if (feature.requiresSetup) {
        if (!rec || rec.setupCompleted !== true) {
            return { ok: false, reason: 'setup_incomplete', plan, feature };
        }
    }

    const required = normalizePlan(feature.minPlan);
    if (planRank(plan) < planRank(required)) {
        return { ok: false, reason: 'plan_too_low', plan, feature };
    }

    return { ok: true, reason: 'ok', plan, feature };
}

/**
 * Middleware-style wrapper for commands.
 *
 * Usage:
 * export async function execute(interaction) { ... }
 * export default { data, execute: withFeatureGuard('scouting_draft', execute) }
 */
export function withFeatureGuard(featureKey, executeFn, { denyMessage = DEFAULT_DENY_MESSAGE } = {}) {
    return async (interaction, ...rest) => {
        const guildId = interaction?.guildId;
        if (!guildId) {
            // Not in a guild; deny.
            try {
                if (interaction?.replied || interaction?.deferred) {
                    await interaction.editReply({ content: denyMessage });
                } else {
                    await interaction.reply({ content: denyMessage, ephemeral: true });
                }
            } catch { }
            return;
        }

        const check = hasFeatureAccess(guildId, featureKey);
        if (!check.ok) {
            const content = denyMessage;
            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.editReply({ content });
                } else {
                    await interaction.reply({ content, ephemeral: true });
                }
            } catch { }
            return;
        }

        return executeFn(interaction, ...rest);
    };
}

export function activateGuild({ guildId, plan = PLANS.free, status = SUBSCRIPTION_STATUSES.inactive } = {}) {
    const rec = planRepository.getGuild(guildId, { createIfMissing: true });
    const activatedAt = rec?.activatedAt || new Date().toISOString();
    return planRepository.upsertGuild(guildId, {
        plan: normalizePlan(plan),
        subscriptionStatus: status,
        activatedAt,
    });
}

export function markSetupCompleted(guildId, setupCompleted = true) {
    const ts = setupCompleted ? new Date().toISOString() : null;
    return planRepository.upsertGuild(guildId, {
        setupCompleted: !!setupCompleted,
        setupCompletedAt: ts,
    });
}
