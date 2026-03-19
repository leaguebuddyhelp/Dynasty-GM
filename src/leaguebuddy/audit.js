import fs from 'fs';
import path from 'path';
import { getLeaguebuddyAuditLogPath } from './paths.js';

const AUDIT_FILE = getLeaguebuddyAuditLogPath();

function safeJson(value) {
    try {
        return JSON.stringify(value);
    } catch {
        return JSON.stringify(String(value));
    }
}

/**
 * Append-only audit log.
 * One JSON object per line (JSONL).
 */
export function appendAuditEvent(event) {
    try {
        fs.mkdirSync(path.dirname(AUDIT_FILE), { recursive: true });
        const line = safeJson({
            ts: new Date().toISOString(),
            ...event,
        });
        fs.appendFileSync(AUDIT_FILE, `${line}\n`);
        return true;
    } catch {
        return false;
    }
}

export function buildActorFromInteraction(interaction) {
    try {
        const user = interaction?.user;
        return {
            type: 'discord',
            userId: user?.id || null,
            username: user?.username || null,
            tag: user?.tag || null,
        };
    } catch {
        return { type: 'unknown' };
    }
}

export function listRecentAuditEvents({ guildId = null, kinds = null, limit = 10 } = {}) {
    try {
        const raw = fs.readFileSync(AUDIT_FILE, 'utf8');
        const rows = raw
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
                try { return JSON.parse(line); } catch { return null; }
            })
            .filter(Boolean);
        return rows
            .filter((row) => !guildId || String(row.guildId || '') === String(guildId))
            .filter((row) => !Array.isArray(kinds) || !kinds.length || kinds.includes(String(row.kind || '')))
            .slice(-Math.max(1, Number(limit || 10)))
            .reverse();
    } catch {
        return [];
    }
}
