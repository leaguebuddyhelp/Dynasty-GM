import fs from 'fs';
import path from 'path';
import { getGuildOverlayConfigPath, getGuildsRoot } from '../leaguebuddy/paths.js';

const GUILDS_ROOT = getGuildsRoot();

export function guildConfigPath(guildId) {
    return getGuildOverlayConfigPath(guildId);
}

function safeReadJSON(filePath, fallback = null) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return fallback;
    }
}

function safeWriteJSON(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

export function loadGuildMaddenConfig(guildId) {
    const filePath = guildConfigPath(guildId);
    if (!filePath || !fs.existsSync(filePath)) return null;
    const cfg = safeReadJSON(filePath, null);
    if (!cfg || typeof cfg !== 'object') return null;
    return cfg;
}

export function loadGuildMaddenConfigIfComplete(guildId) {
    const cfg = loadGuildMaddenConfig(guildId);
    if (!cfg) return null;
    if (String(cfg.status || '').toLowerCase() !== 'complete') return null;
    return cfg;
}

export function saveGuildMaddenConfig(guildId, cfg) {
    const filePath = guildConfigPath(guildId);
    if (!filePath) throw new Error('Missing guildId');
    safeWriteJSON(filePath, cfg);
    return filePath;
}

export function upsertGuildPin(guildId, key, messageId) {
    if (!guildId || !key) return false;
    const current = loadGuildMaddenConfig(guildId) || {
        version: 2,
        status: 'incomplete',
        updatedAt: new Date().toISOString(),
        license: { tier: 'free' },
        packsEnabled: [],
        compat: { maddenChannelMap: {}, maddenRoleMap: {} },
        pins: {},
    };
    if (!current.pins || typeof current.pins !== 'object') current.pins = {};
    current.pins[String(key)] = messageId ? String(messageId) : null;
    current.updatedAt = new Date().toISOString();
    // Don't force status to complete here; setup command controls that.
    saveGuildMaddenConfig(guildId, current);
    return true;
}

export function getGuildChannelMap(guildId) {
    const cfg = loadGuildMaddenConfigIfComplete(guildId);
    const map = cfg?.compat?.maddenChannelMap;
    return map && typeof map === 'object' ? map : null;
}

export function getGuildRoleMap(guildId) {
    const cfg = loadGuildMaddenConfigIfComplete(guildId);
    const map = cfg?.compat?.maddenRoleMap;
    return map && typeof map === 'object' ? map : null;
}

export function getGuildPinsMap(guildId) {
    const cfg = loadGuildMaddenConfigIfComplete(guildId);
    const map = cfg?.pins;
    return map && typeof map === 'object' ? map : null;
}

export function getGuildLicense(guildId) {
    const cfg = loadGuildMaddenConfigIfComplete(guildId) || loadGuildMaddenConfig(guildId);
    return cfg?.license || null;
}

export function tierRank(tier) {
    const t = String(tier || '').toLowerCase();
    if (t === 'pro') return 2;
    if (t === 'starter') return 1;
    return 0;
}

export function isPackEnabled(guildId, packId) {
    const cfg = loadGuildMaddenConfigIfComplete(guildId);
    if (!cfg) return false;
    const list = Array.isArray(cfg.packsEnabled) ? cfg.packsEnabled : [];
    return list.includes(String(packId));
}

export function getGuildCompatMaps(guildId) {
    const cfg = loadGuildMaddenConfigIfComplete(guildId);
    return {
        channelMap: (cfg?.compat?.maddenChannelMap && typeof cfg.compat.maddenChannelMap === 'object') ? cfg.compat.maddenChannelMap : null,
        roleMap: (cfg?.compat?.maddenRoleMap && typeof cfg.compat.maddenRoleMap === 'object') ? cfg.compat.maddenRoleMap : null,
        pins: (cfg?.pins && typeof cfg.pins === 'object') ? cfg.pins : null,
        cfg,
    };
}

export function normalizeTier(tier) {
    const t = String(tier || '').trim().toLowerCase();
    if (t === 'pro') return 'pro';
    if (t === 'starter') return 'starter';
    return 'free';
}

export default {
    loadGuildMaddenConfig,
    loadGuildMaddenConfigIfComplete,
    saveGuildMaddenConfig,
    getGuildChannelMap,
    getGuildRoleMap,
    getGuildPinsMap,
    getGuildLicense,
    getGuildCompatMaps,
    normalizeTier,
    upsertGuildPin,
    tierRank,
    isPackEnabled,
};
