import { getCoachAssignmentMap } from './madden_coach_assignments.js';
import { getFullTeamName } from './madden_team_names.js';

function normalizeTeamKey(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function snapshotTeams(snapshot = {}) {
  if (Array.isArray(snapshot?.teams?.leagueTeamInfoList)) return snapshot.teams.leagueTeamInfoList;
  if (Array.isArray(snapshot?.teams)) return snapshot.teams;
  return [];
}

function teamIdentityTokens(team = {}) {
  return [
    getFullTeamName(team, ''),
    team.teamName,
    team.displayName,
    team.nickName,
    team.abbrName,
    team.teamId,
    team.teamIndex,
  ].filter((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function teamTokenSet(team = {}) {
  return new Set(teamIdentityTokens(team).map(normalizeTeamKey).filter(Boolean));
}

export function resolveMaddenTeam(snapshot, teamLabel) {
  const target = normalizeTeamKey(teamLabel);
  if (!target) return null;
  const teams = snapshotTeams(snapshot);
  const exact = teams.find((team) => teamTokenSet(team).has(target));
  if (exact) return exact;

  // Mascots like "Jets" are safe only when they resolve to one team.
  const mascotMatches = teams.filter((team) => {
    const mascotKeys = [team.displayName, team.nickName, team.teamName]
      .map(normalizeTeamKey)
      .filter(Boolean);
    return mascotKeys.includes(target);
  });
  return mascotMatches.length === 1 ? mascotMatches[0] : null;
}

export function isSameMaddenTeam(snapshot, left, right) {
  const leftTeam = resolveMaddenTeam(snapshot, left);
  const rightTeam = resolveMaddenTeam(snapshot, right);
  if (leftTeam && rightTeam) {
    const leftIds = teamTokenSet(leftTeam);
    return [...teamTokenSet(rightTeam)].some((token) => leftIds.has(token));
  }
  return normalizeTeamKey(left) === normalizeTeamKey(right);
}

export function resolveMaddenCoachRoleId(teamName, snapshot, roleMap = {}) {
  const targetTeam = resolveMaddenTeam(snapshot, teamName);
  const targetTokens = targetTeam ? teamTokenSet(targetTeam) : new Set([normalizeTeamKey(teamName)].filter(Boolean));
  if (!targetTokens.size) return null;

  for (const [roleName, roleId] of Object.entries(roleMap || {})) {
    if (!roleId || !/ coach$/i.test(roleName)) continue;
    const base = roleName.replace(/ coach$/i, '').trim();
    if (targetTokens.has(normalizeTeamKey(base))) return String(roleId);
  }
  return null;
}

export async function resolveMaddenCoachMembersForTeam(guild, teamName, snapshot, roleMap = {}) {
  const membersById = new Map();
  if (!guild || !teamName) return [];

  const addMember = async (userId) => {
    if (!userId || membersById.has(String(userId))) return;
    const member = await guild.members.fetch(String(userId)).catch(() => null);
    if (member?.user?.id) membersById.set(String(member.user.id), member);
  };

  const assignmentMap = getCoachAssignmentMap({ guildId: guild.id });
  for (const [userId, assignments] of assignmentMap.userToTeams.entries()) {
    const matches = (assignments || []).some((entry) => isSameMaddenTeam(snapshot, entry?.teamName, teamName));
    if (matches) await addMember(userId);
  }

  const coachRoleId = resolveMaddenCoachRoleId(teamName, snapshot, roleMap);
  if (coachRoleId) {
    const role = await guild.roles.fetch(coachRoleId).catch(() => null);
    if (role) {
      if (role.members.size === 0) {
        await guild.members.fetch().catch(() => null);
      }
      role.members.forEach((member) => {
        if (member?.user?.id) membersById.set(String(member.user.id), member);
      });
    }
  }

  return [...membersById.values()];
}

export async function isMaddenCoachForTeam(guild, userId, teamName, snapshot, roleMap = {}) {
  if (!guild || !userId || !teamName) return false;
  const members = await resolveMaddenCoachMembersForTeam(guild, teamName, snapshot, roleMap);
  return members.some((member) => String(member.user?.id) === String(userId));
}
