import { PLANS } from './guild_store.js';

// Plan + feature mapping.
//
// IMPORTANT:
// - Do not redesign pricing/tiers here.
// - This file implements the enforcement layer only.
// - Feature keys are intentionally stable strings so you can gate commands/modules
//   without scattering plan logic across the codebase.

export const PLAN_ORDER = /** @type {const} */ ([PLANS.free, PLANS.standard, PLANS.premium]);

export function normalizePlan(plan) {
    const p = String(plan || '').trim().toLowerCase();
    if (p === PLANS.premium) return PLANS.premium;
    if (p === PLANS.standard) return PLANS.standard;
    return PLANS.free;
}

export function planRank(plan) {
    const p = normalizePlan(plan);
    return PLAN_ORDER.indexOf(p);
}

// Feature registry.
// If you later want a different breakdown, only change this file.
//
// For now we derive from the existing Madden v2 packs list in `madden-setup.js`.
// These pack-like keys are the closest existing "feature breakdown" in-repo.
export const FEATURES = /** @type {const} */ ({
    // baseline
    core: { minPlan: PLANS.free, requiresSetup: true, label: 'Core league utilities' },
    threads: { minPlan: PLANS.free, requiresSetup: true, label: 'Game threads / scheduling helpers' },
    trades_basic: { minPlan: PLANS.free, requiresSetup: true, label: 'Trade workflows (basic)' },
    stats_light: { minPlan: PLANS.free, requiresSetup: true, label: 'Stats + pins (light)' },

    scouting_draft: { minPlan: PLANS.standard, requiresSetup: true, label: 'Scouting + draft tools' },
    ops_light: { minPlan: PLANS.standard, requiresSetup: true, label: 'Staff ops (light)' },

    ops_full: { minPlan: PLANS.premium, requiresSetup: true, label: 'Staff ops (full)' },
    recognition: { minPlan: PLANS.premium, requiresSetup: true, label: 'Recognition system' },
    sportsbook: { minPlan: PLANS.premium, requiresSetup: true, label: 'Sportsbook' },
});

/**
 * @param {string} featureKey
 * @returns {{minPlan:string,requiresSetup?:boolean,label?:string}|null}
 */
export function getFeature(featureKey) {
    const key = String(featureKey || '').trim();
    // @ts-ignore
    return FEATURES[key] || null;
}

export function featureMinPlan(featureKey) {
    const f = getFeature(featureKey);
    return normalizePlan(f?.minPlan);
}
