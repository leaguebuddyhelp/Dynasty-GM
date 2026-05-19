import { PLANS, SUBSCRIPTION_STATUSES } from './guild_store.js';
import { getFeature, normalizePlan, planRank } from './plans.js';
import planRepository from './repositories/guild_plan_repository.js';
import { getTestingBypassBilling } from './testing_bypass.js';

export const DEFAULT_DENY_MESSAGE = '🔒 This feature is not available on your current plan. Check pricing to upgrade.';
export const SETUP_INCOMPLETE_DENY_MESSAGE = '🔒 This feature is part of your package, but setup is not finished yet. Run `/setup` and complete the required steps first.';
export const SUBSCRIPTION_INACTIVE_DENY_MESSAGE = '🔒 This paid feature is not active on this server yet. Use `/setplan plan:Premium subscription_status:active` during private testing, then try again.';

export function getGuildPlan(guildId) {
    const bypass = getTestingBypassBilling(guildId);
    if (bypass) return normalizePlan(bypass.plan || PLANS.premium);
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
export function hasFeatureAccess(guildId, featureKey, { allowInactiveFree = true, requireSetup = true } = {}) {
    const bypass = getTestingBypassBilling(guildId);
    if (bypass) {
        const feature = getFeature(featureKey);
        if (!feature) {
            return {
                ok: false,
                reason: 'unknown_feature',
                plan: normalizePlan(bypass?.plan || PLANS.premium),
                feature,
                testingBypass: true,
            };
        }
        return {
            ok: true,
            reason: 'testing_bypass',
            plan: normalizePlan(bypass.plan || PLANS.premium),
            feature,
            testingBypass: true,
        };
    }

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

    const required = normalizePlan(feature.minPlan);
    if (planRank(plan) < planRank(required)) {
        return { ok: false, reason: 'plan_too_low', plan, feature };
    }

    // Setup gate. Check this after plan tier so Premium/Standard servers get the right reason.
    if (requireSetup && feature.requiresSetup) {
        if (!rec || rec.setupCompleted !== true) {
            return { ok: false, reason: 'setup_incomplete', plan, feature };
        }
    }

    return { ok: true, reason: 'ok', plan, feature };
}

export function featureAccessDenyMessage(check, {
    defaultMessage = DEFAULT_DENY_MESSAGE,
    setupMessage = SETUP_INCOMPLETE_DENY_MESSAGE,
    inactiveMessage = SUBSCRIPTION_INACTIVE_DENY_MESSAGE,
} = {}) {
    if (check?.reason === 'setup_incomplete') return setupMessage;
    if (check?.reason === 'subscription_inactive' && check?.plan !== PLANS.free) return inactiveMessage;
    return defaultMessage;
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
            const content = featureAccessDenyMessage(check, { defaultMessage: denyMessage });
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
