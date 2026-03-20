import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

import {
  getGuildEATokensPath,
  getMaddenAuthStatePath,
} from '../leaguebuddy/paths.js';
import { createEAClientFromEnv } from './ea_client.js';
import { APP_REDIRECT_URL, REDIRECT_URL, YEAR, buildEaAuthUrl } from './ea_constants.js';

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeTokens(tokens) {
  if (!tokens?.accessToken || !tokens?.refreshToken) return null;
  if (tokens?.gameYear && `${tokens.gameYear}` !== `${YEAR}`) return null;
  return tokens;
}

export function getGuildAuthStartUrl(guildId) {
  const state = createAuthState({ guildId });
  const authUrl = buildEaAuthUrl({ state: state.id });
  console.log('[ea-auth] generated auth URL', {
    guildId,
    redirectUri: REDIRECT_URL,
    authUrl,
  });
  return authUrl;
}

export function getGuildEATokens(guildId) {
  const tokenPath = getGuildEATokensPath(guildId);
  if (!tokenPath) return null;
  try {
    return normalizeTokens(JSON.parse(fs.readFileSync(tokenPath, 'utf8')));
  } catch {
    return null;
  }
}

export function saveGuildEATokens(guildId, tokens) {
  const tokenPath = getGuildEATokensPath(guildId);
  if (!tokenPath) return null;
  ensureParent(tokenPath);
  const serializable = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiry: tokens.expiry ? Number(tokens.expiry) : null,
    console: tokens.console,
    blazeId: tokens.blazeId,
    gameYear: tokens.gameYear || YEAR,
    serviceOverride: tokens.serviceOverride,
    productOverride: tokens.productOverride,
    personaName: tokens.personaName,
    entitlement: tokens.entitlement,
    namespace: tokens.namespace,
  };
  fs.writeFileSync(tokenPath, JSON.stringify(serializable, null, 2));
  return serializable;
}

export function deleteGuildEATokens(guildId) {
  const tokenPath = getGuildEATokensPath(guildId);
  if (!tokenPath) return;
  try {
    fs.unlinkSync(tokenPath);
  } catch {
    // ignore
  }
}

export async function createEAClientForGuild(guildId) {
  const tokens = getGuildEATokens(guildId);
  if (!tokens) return null;
  return createEAClientFromEnv({
    ...process.env,
    EA_ACCESS_TOKEN: tokens.accessToken,
    EA_REFRESH_TOKEN: tokens.refreshToken,
    EA_ACCESS_TOKEN_EXPIRES_AT: tokens.expiry,
    EA_CONSOLE: tokens.console,
    EA_BLAZE_ID: tokens.blazeId,
    EA_GAME_YEAR: tokens.gameYear || YEAR,
    EA_SERVICE_OVERRIDE: tokens.serviceOverride,
    EA_PRODUCT_OVERRIDE: tokens.productOverride,
  }, {
    persistTokenUpdate: (updatedTokens) => saveGuildEATokens(guildId, updatedTokens),
  });
}

export async function listGuildAccountLeagues(guildId) {
  const client = await createEAClientForGuild(guildId);
  if (!client) return null;
  return client.getLeagues();
}

export function createAuthState({ guildId }) {
  const id = randomBytes(18).toString('base64url');
  const statePath = getMaddenAuthStatePath(id);
  ensureParent(statePath);
  const payload = {
    id,
    guildId: String(guildId),
    createdAt: new Date().toISOString(),
    redirectUrl: APP_REDIRECT_URL,
  };
  fs.writeFileSync(statePath, JSON.stringify(payload, null, 2));
  return payload;
}

export function consumeAuthState(id) {
  const statePath = getMaddenAuthStatePath(id);
  if (!statePath) return null;
  try {
    const payload = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    try {
      fs.unlinkSync(statePath);
    } catch {
      // ignore
    }
    return payload;
  } catch {
    return null;
  }
}

export default {
  getGuildAuthStartUrl,
  getGuildEATokens,
  saveGuildEATokens,
  deleteGuildEATokens,
  createEAClientForGuild,
  listGuildAccountLeagues,
  createAuthState,
  consumeAuthState,
};
