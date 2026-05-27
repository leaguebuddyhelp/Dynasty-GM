// Guild Auto-Sync System for LEAGUEbuddy
// This module manages per-guild auto-sync of league data, assignments, and draft classes.
// Call syncGuild(guildId) after any relevant change (assignment, claim, connect, file upload, etc).

import { loadLeagueSnapshot, resolveLeagueIdWithConfig } from '../madden/madden_data.js';
import { getCoachAssignmentMap } from './madden_coach_assignments.js';
import { getAllDraftClasses } from './draft_class_utils.js';

// In-memory cache per guild
const guildCache = new Map();

export async function syncGuild(guildId) {
    if (!guildId) return;
    // Reload league snapshot
    let leagueSnapshot = null;
    const leagueId = resolveLeagueIdWithConfig(guildId, 'guild_auto_sync') || null;
    try {
        if (leagueId) {
            leagueSnapshot = loadLeagueSnapshot(leagueId);
        }
    } catch (e) {
        console.error(`[AUTO_SYNC] Failed to load league snapshot for guild ${guildId} / league ${leagueId}:`, e.message);
    }
    // Reload coach assignments
    let coachAssignments = null;
    try {
        coachAssignments = getCoachAssignmentMap({ guildId });
    } catch (e) {
        console.error(`[AUTO_SYNC] Failed to load coach assignments for guild ${guildId}:`, e.message);
    }
    // Reload draft classes
    let draftClasses = null;
    try {
        draftClasses = getAllDraftClasses(guildId);
    } catch (e) {
        console.error(`[AUTO_SYNC] Failed to load draft classes for guild ${guildId}:`, e.message);
    }
    guildCache.set(guildId, {
        leagueId,
        leagueSnapshot,
        coachAssignments,
        draftClasses,
        lastSync: new Date().toISOString(),
    });
    console.log(`[AUTO_SYNC] Guild ${guildId} synced at ${new Date().toISOString()}`);
}

export function getGuildCache(guildId) {
    return guildCache.get(guildId) || {};
}

// Optionally, export a function to force sync all guilds
export async function syncAllGuilds(guildIds) {
    for (const gid of guildIds) {
        await syncGuild(gid);
    }
}
