import fs from 'fs';
import path from 'path';
import { getMaddenDataFilePath } from '../leaguebuddy/paths.js';

const STORE_PATH = getMaddenDataFilePath('coach_assignments.json');

function safeReadJSON(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function normalizeName(name = '') {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function loadStore() {
  return safeReadJSON(STORE_PATH, {});
}

function saveStore(store) {
  writeJSON(STORE_PATH, store);
}

function ensureGuild(store, guildId) {
  const key = String(guildId || '');
  if (!store[key]) {
    store[key] = {
      users: {},
      updatedAt: 0,
    };
  }
  store[key].users = store[key].users || {};
  return store[key];
}

export function setCoachAssignment({
  guildId,
  userId,
  teamName,
  roleId = null,
  assignedByUserId = null,
  assignedByTag = null,
}) {
  if (!guildId || !userId || !teamName) return { ok: false, message: 'Missing coach assignment context.' };
  // Normalize: strip ' Coach' suffix if present (standardized)
  let cleanTeamName = teamName;
  if (typeof cleanTeamName === 'string' && cleanTeamName.trim().toLowerCase().endsWith(' coach')) {
    cleanTeamName = cleanTeamName.trim().slice(0, -6).trim();
  }
  const store = loadStore();
  const guildRoot = ensureGuild(store, guildId);
  const normalizedUserId = String(userId);
  const normalizedTeam = normalizeName(cleanTeamName);
  guildRoot.users[normalizedUserId] = guildRoot.users[normalizedUserId] || {
    teams: {},
    history: [],
  };
  guildRoot.users[normalizedUserId].teams = guildRoot.users[normalizedUserId].teams || {};
  guildRoot.users[normalizedUserId].history = guildRoot.users[normalizedUserId].history || [];
  guildRoot.users[normalizedUserId].teams[normalizedTeam] = {
    teamName: cleanTeamName,
    roleId: roleId ? String(roleId) : null,
    active: true,
    assignedAt: Date.now(),
    assignedByUserId: assignedByUserId ? String(assignedByUserId) : null,
    assignedByTag: assignedByTag || null,
  };
  guildRoot.users[normalizedUserId].history.push({
    action: 'assigned',
    teamName: cleanTeamName,
    roleId: roleId ? String(roleId) : null,
    at: Date.now(),
    assignedByUserId: assignedByUserId ? String(assignedByUserId) : null,
    assignedByTag: assignedByTag || null,
  });
  guildRoot.users[normalizedUserId].history = guildRoot.users[normalizedUserId].history.slice(-50);
  guildRoot.updatedAt = Date.now();
  saveStore(store);
  return { ok: true };
}

export function removeCoachAssignment({ guildId, userId, teamName = null, roleId = null }) {
  if (!guildId || !userId) return { ok: false, message: 'Missing coach assignment context.' };
  const store = loadStore();
  const guildRoot = ensureGuild(store, guildId);
  const userRoot = guildRoot.users?.[String(userId)];
  if (!userRoot?.teams) return { ok: false, message: 'No coach assignments found.' };
  const removed = [];
  for (const [normalizedTeam, entry] of Object.entries(userRoot.teams || {})) {
    const teamMatches = teamName ? normalizeName(entry?.teamName || normalizedTeam) === normalizeName(teamName) : true;
    const roleMatches = roleId ? String(entry?.roleId || '') === String(roleId) : true;
    if (!teamMatches || !roleMatches) continue;
    delete userRoot.teams[normalizedTeam];
    removed.push(entry?.teamName || normalizedTeam);
  }
  if (removed.length) {
    userRoot.history = userRoot.history || [];
    for (const removedTeam of removed) {
      userRoot.history.push({
        action: 'removed',
        teamName: removedTeam,
        roleId: roleId ? String(roleId) : null,
        at: Date.now(),
      });
    }
    userRoot.history = userRoot.history.slice(-50);
    guildRoot.updatedAt = Date.now();
    saveStore(store);
  }
  return { ok: removed.length > 0, removed };
}

export function getCoachAssignmentMap({ guildId }) {
  const store = loadStore();
  const guildRoot = store?.[String(guildId)] || {};
  const teamToUserIds = new Map();
  const userToTeams = new Map();
  for (const [userId, state] of Object.entries(guildRoot.users || {})) {
    const teams = Object.values(state?.teams || {}).filter((entry) => entry?.teamName);
    if (!teams.length) continue;
    userToTeams.set(String(userId), teams); // Store full assignment objects
    for (const entry of teams) {
      const key = normalizeName(entry.teamName);
      const current = teamToUserIds.get(key) || new Set();
      current.add(String(userId));
      teamToUserIds.set(key, current);
    }
  }
  return { teamToUserIds, userToTeams };
}
