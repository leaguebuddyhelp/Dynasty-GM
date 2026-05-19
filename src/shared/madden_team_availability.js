import { getFullTeamName } from './madden_team_names.js';
import { getCoachAssignmentMap } from './madden_coach_assignments.js';

function normalizeName(name) {
  if (!name) return name;
  const lower = String(name).toLowerCase();
  if (lower === 'g-men' || lower === 'gmen') return 'Giants';
  if (lower === 'jags') return 'Jaguars';
  if (lower === 'vikes' || lower === 'vikings') return 'Vikings';
  if (lower === 'fins' || lower === 'fins up' || lower === 'phins' || lower === 'dolphins') return 'Dolphins';
  if (lower === 'bucs' || lower === 'buccs') return 'Buccaneers';
  if (lower === 'pats') return 'Patriots';
  if (lower === 'bolts') return 'Chargers';
  if (lower === 'pack') return 'Packers';
  return name;
}

export function normalizeTeamAvailabilityKey(name = '') {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function formatMaddenTeamName(team) {
  return getFullTeamName(team, `Team ${team?.teamId}`);
}

export function resolveMaddenCoachRoleIdForTeam(team, roleMap = {}) {
  const fullName = formatMaddenTeamName(team);
  const nick = normalizeName(team?.displayName) || normalizeName(team?.nickName) || '';
  const city = team?.cityName || '';
  const abbr = team?.abbrName || team?.teamAbbr || '';
  const mascot = String(nick || fullName).split(/\s+/).filter(Boolean).pop();

  const roleEntries = Object.entries(roleMap || {})
    .filter(([name, roleId]) => roleId && / coach$/i.test(name))
    .map(([name, roleId]) => ({
      name,
      roleId: String(roleId),
      norm: normalizeTeamAvailabilityKey(name),
    }));

  const candidates = [
    `${fullName} Coach`,
    `${nick} Coach`,
    `${city} ${nick} Coach`,
    `${normalizeName(city)} ${nick} Coach`,
    `${abbr} Coach`,
    `${mascot} Coach`,
    fullName,
    nick,
    abbr,
    mascot,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const norm = normalizeTeamAvailabilityKey(candidate);
    const exact = roleEntries.find((entry) => entry.norm === norm);
    if (exact) return exact.roleId;
  }

  for (const candidate of candidates) {
    const norm = normalizeTeamAvailabilityKey(candidate);
    if (!norm) continue;
    const found = roleEntries.find((entry) => entry.norm.includes(norm) || norm.includes(entry.norm));
    if (found) return found.roleId;
  }

  return null;
}

async function fetchGuildMembers(guild) {
  try {
    return await guild.members.fetch();
  } catch (error) {
    console.warn('[madden-availability] member fetch skipped:', error?.message || error);
    return null;
  }
}

function displayNameForMember(member) {
  return member?.displayName || member?.user?.username || member?.user?.tag || member?.id || null;
}

function assignmentKeysForTeam(team) {
  const fullName = formatMaddenTeamName(team);
  const nick = team?.displayName || team?.nickName || '';
  const mascot = String(fullName || '').split(/\s+/).filter(Boolean).pop();
  return [fullName, nick, mascot]
    .map((value) => normalizeTeamAvailabilityKey(value))
    .filter(Boolean);
}

export async function buildMaddenTeamAvailability({
  guild,
  guildId,
  teams = [],
  roleMap = {},
  members = null,
} = {}) {
  const guildMembers = members || (guild ? await fetchGuildMembers(guild) : null);
  const assignments = getCoachAssignmentMap({ guildId });
  const rows = [];

  for (const team of teams || []) {
    const teamName = formatMaddenTeamName(team);
    const roleId = resolveMaddenCoachRoleIdForTeam(team, roleMap);
    const memberMap = new Map();

    if (roleId) {
      if (guildMembers) {
        guildMembers.forEach((member) => {
          if (member?.roles?.cache?.has(String(roleId))) {
            memberMap.set(String(member.id), member);
          }
        });
      } else if (guild) {
        const role = guild.roles.cache.get(String(roleId)) || await guild.roles.fetch(String(roleId)).catch(() => null);
        role?.members?.forEach((member) => {
          memberMap.set(String(member.id), member);
        });
      }
    }

    for (const key of assignmentKeysForTeam(team)) {
      const assignedUserIds = assignments?.teamToUserIds?.get(key) || new Set();
      for (const userId of assignedUserIds) {
        const member = guildMembers?.get(String(userId)) || null;
        if (!member) continue;
        if (roleId && !member.roles.cache.has(String(roleId))) continue;
        memberMap.set(String(userId), member);
      }
    }

    const membersList = [...memberMap.values()];
    rows.push({
      team,
      teamName,
      rawTeam: String(team?.displayName || team?.nickName || teamName).trim(),
      roleId,
      assigned: membersList.length > 0,
      members: membersList,
      names: membersList.map(displayNameForMember).filter(Boolean),
    });
  }

  return {
    rows,
    members: guildMembers,
  };
}
