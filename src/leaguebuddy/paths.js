import path from 'path';

function cleanRoot(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return path.resolve(raw);
}

export function getDataRoot() {
  return cleanRoot(process.env.LB_DATA_ROOT) || path.join(process.cwd(), 'data');
}

export function getLeaguebuddyDir() {
  return path.join(getDataRoot(), 'leaguebuddy');
}

export function getLeaguebuddyGuildStorePath() {
  return path.join(getLeaguebuddyDir(), 'guilds.json');
}

export function getLeaguebuddyAuditLogPath() {
  return path.join(getLeaguebuddyDir(), 'audit.log');
}

export function getGuildsRoot() {
  return path.join(getDataRoot(), 'guilds');
}

export function getGuildOverlayConfigPath(guildId) {
  if (!guildId) return null;
  return path.join(getGuildsRoot(), String(guildId), 'madden.config.json');
}

export function getMaddenRoot() {
  return path.join(getDataRoot(), 'madden');
}

export function getMaddenLeaguesDir() {
  return path.join(getMaddenRoot(), 'leagues');
}

export function getMaddenLeagueSnapshotPath(leagueId) {
  if (!leagueId) return null;
  return path.join(getMaddenLeaguesDir(), `${leagueId}.json`);
}

export function getMaddenConfigPath() {
  return path.join(getMaddenRoot(), 'config.json');
}

export default {
  getDataRoot,
  getLeaguebuddyDir,
  getLeaguebuddyGuildStorePath,
  getLeaguebuddyAuditLogPath,
  getGuildsRoot,
  getGuildOverlayConfigPath,
  getMaddenRoot,
  getMaddenLeaguesDir,
  getMaddenLeagueSnapshotPath,
  getMaddenConfigPath,
};
