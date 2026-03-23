// Helper for reliably getting a user's assigned team in a guild
import { getCoachAssignmentMap } from './madden_coach_assignments.js'; // standardized import

/**
 * Returns the first team assigned to a user in a guild, or null if none.
 * @param {string} guildId - Discord guild/server ID
 * @param {string} userId - Discord user ID
 * @returns {string|null} Team name or null
 */
export function getUserTeam(guildId, userId) {
    if (!guildId || !userId) return null;
    const { userToTeams } = getCoachAssignmentMap({ guildId }); // standardized
    const teams = userToTeams.get(String(userId));
    if (Array.isArray(teams) && teams.length > 0) return teams[0];
    return null;
}

/**
 * Returns all teams assigned to a user in a guild (array, may be empty)
 * @param {string} guildId
 * @param {string} userId
 * @returns {string[]}
 */
export function getAllUserTeams(guildId, userId) {
    if (!guildId || !userId) return [];
    const { userToTeams } = getCoachAssignmentMap({ guildId });
    const teams = userToTeams.get(String(userId));
    return Array.isArray(teams) ? teams : [];
}
