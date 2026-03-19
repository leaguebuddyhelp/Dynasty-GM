import fs from 'fs';
import path from 'path';
import { saveLeague as saveLeagueDb, loadLeague as loadLeagueDb } from './madden_db.js';
import { getMaddenConfigPath } from '../leaguebuddy/paths.js';

const CONFIG_PATH = getMaddenConfigPath();

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return { globalDefault: null, guilds: {} };
  }
}

function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

export function setGuildLeague(guildId, leagueId) {
  const cfg = readConfig();
  cfg.guilds = cfg.guilds || {};
  cfg.guilds[guildId] = `${leagueId}`;
  cfg.globalDefault = cfg.globalDefault || `${leagueId}`;
  writeConfig(cfg);
  saveLeagueDb(leagueId);
  return cfg;
}

export function getLeagueForGuild(guildId) {
  const cfg = readConfig();
  // Prefer guild-specific mapping first
  if (guildId && cfg.guilds && cfg.guilds[guildId]) return cfg.guilds[guildId];
  // Then fallback to DB-stored default
  const dbLeague = loadLeagueDb();
  if (dbLeague) return dbLeague;
  // Finally global default in config
  return cfg.globalDefault || null;
}

export function getExplicitLeagueForGuild(guildId) {
  const cfg = readConfig();
  if (guildId && cfg.guilds && cfg.guilds[guildId]) return cfg.guilds[guildId];
  return null;
}

export function setGlobalDefault(leagueId) {
  const cfg = readConfig();
  cfg.globalDefault = `${leagueId}`;
  writeConfig(cfg);
  saveLeagueDb(leagueId);
  return cfg;
}

export function getConfigSnapshot() {
  return readConfig();
}
