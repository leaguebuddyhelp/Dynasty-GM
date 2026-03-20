import path from 'path';

function cleanRoot(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return path.resolve(raw);
}

export function getDataRoot() {
  return cleanRoot(process.env.LB_DATA_ROOT) || path.join(process.cwd(), 'data');
}

export function getDataFilePath(filename) {
  if (!filename) return getDataRoot();
  return path.join(getDataRoot(), String(filename));
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

export function getLeaguebuddyClaimsStorePath() {
  return path.join(getLeaguebuddyDir(), 'claims.json');
}

export function getGuildsRoot() {
  return path.join(getDataRoot(), 'guilds');
}

export function getGuildOverlayConfigPath(guildId) {
  if (!guildId) return null;
  return path.join(getGuildsRoot(), String(guildId), 'madden.config.json');
}

export function getGuildMaddenDir(guildId) {
  if (!guildId) return null;
  return path.join(getGuildsRoot(), String(guildId), 'madden');
}

export function getGuildEATokensPath(guildId) {
  const guildDir = getGuildMaddenDir(guildId);
  if (!guildDir) return null;
  return path.join(guildDir, 'ea_tokens.json');
}

export function getMaddenRoot() {
  return path.join(getDataRoot(), 'madden');
}

export function getMaddenDataFilePath(filename) {
  if (!filename) return getMaddenRoot();
  return path.join(getMaddenRoot(), String(filename));
}

export function getMaddenLeaguesDir() {
  return path.join(getMaddenRoot(), 'leagues');
}

export function getMaddenAuthStatesDir() {
  return path.join(getMaddenRoot(), 'auth_states');
}

export function getMaddenAuthStatePath(stateId) {
  if (!stateId) return null;
  return path.join(getMaddenAuthStatesDir(), `${stateId}.json`);
}

export function getMaddenLeagueSnapshotPath(leagueId) {
  if (!leagueId) return null;
  return path.join(getMaddenLeaguesDir(), `${leagueId}.json`);
}

export function getMaddenConfigPath() {
  return path.join(getMaddenRoot(), 'config.json');
}

export function getLeaguebuddyRecognitionStorePath() {
  return path.join(getDataRoot(), 'leaguebuddy_recognition.json');
}

export default {
  getDataRoot,
  getDataFilePath,
  getLeaguebuddyDir,
  getLeaguebuddyGuildStorePath,
  getLeaguebuddyAuditLogPath,
  getLeaguebuddyClaimsStorePath,
  getLeaguebuddyRecognitionStorePath,
  getGuildsRoot,
  getGuildOverlayConfigPath,
  getGuildMaddenDir,
  getGuildEATokensPath,
  getMaddenRoot,
  getMaddenDataFilePath,
  getMaddenLeaguesDir,
  getMaddenLeagueSnapshotPath,
  getMaddenAuthStatesDir,
  getMaddenAuthStatePath,
  getMaddenConfigPath,
};
