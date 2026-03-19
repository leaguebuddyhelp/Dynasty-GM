import fs from 'fs';
import path from 'path';
import { getLeaguebuddyDir, getLeaguebuddyGuildStorePath } from './paths.js';

// JSON persistence for per-guild LEAGUEbuddy state.
//
// Design goals:
// - One file, keyed by guildId, easy to backup and edit.
// - Swappable later for SQLite/Stripe without changing callers.
// - Safe-ish writes (write tmp -> rename).

const STORE_DIR = getLeaguebuddyDir();
const STORE_FILE = getLeaguebuddyGuildStorePath();

export const PLANS = /** @type {const} */ ({
    free: 'free',
    standard: 'standard',
    premium: 'premium',
});

export const SUBSCRIPTION_STATUSES = /** @type {const} */ ({
    inactive: 'inactive',
    active: 'active',
    past_due: 'past_due',
    canceled: 'canceled',
    trialing: 'trialing',
});

function nowIso() {
    return new Date().toISOString();
}

function safeReadJSON(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return fallback;
    }
}

function atomicWriteJSON(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
}

function defaultStore() {
    return {
        version: 1,
        updatedAt: nowIso(),
        guilds: {},
    };
}

/**
 * @returns {{version:number,updatedAt:string,guilds:Record<string, any>}}
 */
export function loadGuildStore() {
    const store = safeReadJSON(STORE_FILE, null);
    if (!store || typeof store !== 'object') return defaultStore();
    if (!store.guilds || typeof store.guilds !== 'object') store.guilds = {};
    if (!store.version) store.version = 1;
    if (!store.updatedAt) store.updatedAt = nowIso();
    return store;
}

export function saveGuildStore(store) {
    const next = store && typeof store === 'object' ? store : defaultStore();
    next.updatedAt = nowIso();
    if (!next.guilds || typeof next.guilds !== 'object') next.guilds = {};
    atomicWriteJSON(STORE_FILE, next);
}

export function buildDefaultGuildRecord(guildId) {
    const id = String(guildId);
    const ts = nowIso();
    return {
        guildId: id,
        plan: PLANS.free,
        subscriptionStatus: SUBSCRIPTION_STATUSES.inactive,
        activatedAt: null,
        setupCompleted: false,
        setupCompletedAt: null,
        // Future billing automation plugs in here.
        billing: {
            provider: 'manual',
            customerId: null,
            subscriptionId: null,
            currentPeriodEnd: null,
            interval: 'month',
            paymentReference: null,
            billingNote: null,
            activatedBy: null,
            activatedAt: null,
            lastPlanChangeAt: null,
            paymentSource: null,
            internalNote: null,
        },
        config: {
            // reserved for later (server-level settings not specific to Madden overlay)
            leagueId: null,
            notes: null,
        },
        createdAt: ts,
        updatedAt: ts,
    };
}

export function getGuildRecord(guildId, { createIfMissing = false } = {}) {
    if (!guildId) return null;
    const store = loadGuildStore();
    const key = String(guildId);
    let rec = store.guilds[key] || null;

    if (!rec && createIfMissing) {
        rec = buildDefaultGuildRecord(key);
        store.guilds[key] = rec;
        saveGuildStore(store);
        return rec;
    }

    // Basic shape normalization for older records.
    if (rec && typeof rec === 'object') {
        if (!rec.guildId) rec.guildId = key;
        if (!rec.plan) rec.plan = PLANS.free;
        if (!rec.subscriptionStatus) rec.subscriptionStatus = SUBSCRIPTION_STATUSES.inactive;
        if (rec.activatedAt === undefined) rec.activatedAt = null;
        if (rec.setupCompleted === undefined) rec.setupCompleted = false;
        if (rec.setupCompletedAt === undefined) rec.setupCompletedAt = null;
        if (!rec.billing || typeof rec.billing !== 'object') rec.billing = { provider: 'manual', interval: 'month' };
        if (rec.billing.paymentReference === undefined) rec.billing.paymentReference = null;
        if (rec.billing.billingNote === undefined) rec.billing.billingNote = null;
        if (rec.billing.activatedBy === undefined) rec.billing.activatedBy = null;
        if (rec.billing.activatedAt === undefined) rec.billing.activatedAt = null;
        if (rec.billing.lastPlanChangeAt === undefined) rec.billing.lastPlanChangeAt = null;
        if (rec.billing.paymentSource === undefined) rec.billing.paymentSource = null;
        if (rec.billing.internalNote === undefined) rec.billing.internalNote = null;
        if (!rec.config || typeof rec.config !== 'object') rec.config = {};
    }

    return rec;
}

export function upsertGuildRecord(guildId, partial) {
    if (!guildId) throw new Error('Missing guildId');
    const store = loadGuildStore();
    const key = String(guildId);
    const current = store.guilds[key] && typeof store.guilds[key] === 'object'
        ? store.guilds[key]
        : buildDefaultGuildRecord(key);

    const next = {
        ...current,
        ...partial,
        guildId: key,
        updatedAt: nowIso(),
        billing: {
            ...(current.billing || {}),
            ...(partial?.billing || {}),
        },
        config: {
            ...(current.config || {}),
            ...(partial?.config || {}),
        },
    };

    store.guilds[key] = next;
    saveGuildStore(store);
    return next;
}

export function listGuildRecords() {
    const store = loadGuildStore();
    return Object.values(store.guilds || {});
}
