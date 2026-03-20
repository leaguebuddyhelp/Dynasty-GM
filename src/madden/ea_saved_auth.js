import fs from 'fs';

import { getMaddenDataFilePath } from '../leaguebuddy/paths.js';
import { YEAR } from './ea_constants.js';
import { loadTokens as loadTokensDb } from './madden_db.js';
import {
  createEAClientForGuild,
  getGuildEATokens,
  listGuildAccountLeagues,
} from './ea_guild_auth.js';

const TOKEN_FILE = getMaddenDataFilePath('tokens.json');

function loadLegacySavedEATokens() {
  const dbTokens = loadTokensDb();
  if (dbTokens?.accessToken && dbTokens?.refreshToken) {
    if (dbTokens?.gameYear && `${dbTokens.gameYear}` !== `${YEAR}`) return null;
    return dbTokens;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    if (parsed?.gameYear && `${parsed.gameYear}` !== `${YEAR}`) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function loadSavedEATokens(guildId = null) {
  if (guildId) {
    return getGuildEATokens(guildId) || loadLegacySavedEATokens();
  }
  return loadLegacySavedEATokens();
}

export async function createEAClientFromSavedTokens(guildId = null) {
  if (guildId) {
    return createEAClientForGuild(guildId);
  }
  const tokens = loadSavedEATokens();
  if (!tokens?.accessToken || !tokens?.refreshToken) return null;
  const { createEAClientFromEnv } = await import('./ea_client.js');
  return createEAClientFromEnv({
    ...process.env,
    EA_ACCESS_TOKEN: tokens.accessToken,
    EA_REFRESH_TOKEN: tokens.refreshToken,
    EA_ACCESS_TOKEN_EXPIRES_AT: tokens.expiry,
    EA_CONSOLE: tokens.console,
    EA_BLAZE_ID: tokens.blazeId,
    EA_GAME_YEAR: tokens.gameYear || YEAR,
  });
}

export async function listSavedAccountLeagues(guildId = null) {
  if (guildId) {
    return listGuildAccountLeagues(guildId);
  }
  const client = await createEAClientFromSavedTokens();
  if (!client) return null;
  return client.getLeagues();
}

export default {
  loadSavedEATokens,
  createEAClientFromSavedTokens,
  listSavedAccountLeagues,
};
