import http from 'http';
import url from 'url';

import {
  APP_REDIRECT_URL,
  AUTH_SOURCE,
  CLIENT_ID,
  CLIENT_SECRET,
  YEAR,
} from './ea_constants.js';
import {
  exchangePersonaToken,
  extractValidPersonas,
  fetchEntitlements,
  fetchPersonas,
  fetchTokenInfo,
} from './ea_personas.js';
import {
  consumeAuthState,
  getGuildAuthStartUrl,
  saveGuildEATokens,
} from './ea_guild_auth.js';
import { registerHttpRoute, startHealthcheckServer } from '../leaguebuddy/healthcheck.js';

const PORT = Number(process.env.MADDEN_AUTH_PORT || 4001);
const HOST = process.env.MADDEN_AUTH_HOST || '127.0.0.1';
const USE_SHARED_HTTP = String(process.env.PORT || '').trim().length > 0;

function html(body) {
  return `<!doctype html><html><head><title>Madden Auth</title></head><body style="font-family: sans-serif; max-width: 680px; margin: 40px auto;">${body}</body></html>`;
}

async function exchangeCode(code) {
  const body = `authentication_source=${AUTH_SOURCE}&client_secret=${CLIENT_SECRET}&grant_type=authorization_code&code=${code}&redirect_uri=${APP_REDIRECT_URL}&release_type=prod&client_id=${CLIENT_ID}`;
  const res = await fetch('https://accounts.ea.com/connect/token', {
    method: 'POST',
    headers: {
      'Accept-Charset': 'UTF-8',
      'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 13; sdk_gphone_x86_64 Build/TE1A.220922.031)',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Accept-Encoding': 'gzip',
    },
    body,
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error(`EA token exchange failed: ${JSON.stringify(json)}`);
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiry: Date.now() + (json.expires_in || 0) * 1000,
  };
}

function chooseBestPersona(personas) {
  const score = (p) => {
    let s = 0;
    const ent = `${p.entitlement || ''}`.toUpperCase();
    const ns = `${p.namespaceName || ''}`.toUpperCase();
    if (p.systemConsole?.toLowerCase() === 'ps5') s += 5;
    if (p.systemConsole?.toLowerCase() === 'xbsx') s += 4;
    if (ent.includes('MADDEN_26')) s += 3;
    if (ns.includes('MADDEN')) s += 1;
    return s;
  };
  return [...personas].sort((a, b) => score(b) - score(a))[0] || null;
}

async function buildPersonaScopedTokens(code) {
  const loginTokens = await exchangeCode(code);
  const tokenInfo = await fetchTokenInfo(loginTokens.accessToken);
  const pid = tokenInfo?.pid_id;
  if (!pid) {
    throw new Error('No pid_id returned from tokeninfo.');
  }

  const entRes = await fetchEntitlements(pid, loginTokens.accessToken);
  const entitlements = entRes?.entitlements?.entitlement || [];
  const personaResponses = await Promise.all(
    entitlements.map(async (ent) => ({
      ent,
      personas: await fetchPersonas(ent.pidUri, loginTokens.accessToken),
    })),
  );
  const personas = extractValidPersonas(entRes, personaResponses, 'Default');
  if (!personas.length) {
    throw new Error('No valid Madden personas found for this EA account.');
  }

  const chosen = chooseBestPersona(personas);
  if (!chosen) {
    throw new Error('Could not resolve a Madden persona to save.');
  }

  const personaToken = await exchangePersonaToken(
    loginTokens.accessToken,
    chosen.personaId,
    chosen.namespaceName,
  );

  return {
    accessToken: personaToken.access_token,
    refreshToken: personaToken.refresh_token,
    expiry: Date.now() + (personaToken.expires_in || 0) * 1000,
    console: chosen.systemConsole || 'ps5',
    blazeId: `${chosen.personaId}`,
    gameYear: YEAR,
    personaName: chosen.displayName,
    entitlement: chosen.entitlement,
    namespace: chosen.namespaceName,
  };
}

export function startAuthServer() {
  const handler = async (req, res) => {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname || '';

    if (pathname === '/madden/auth') {
      const guildId = String(parsed.query.guild_id || '').trim();
      res.writeHead(200, { 'Content-Type': 'text/html' });
      if (!guildId) {
        res.end(html('<h2>Missing server</h2><p>No guild_id was provided. Start from <code>/setup</code> in Discord so LEAGUEbuddy can tie the dashboard setup back to the correct server.</p>'));
        return;
      }
      const loginUrl = getGuildAuthStartUrl(guildId);
      res.end(html(`
        <h2>League Account Connection</h2>
        <p>This redirect flow will be saved for Discord server <strong>${guildId}</strong>.</p>
        <p><a href="${loginUrl}">Open connection link</a></p>
      `));
      return;
    }

    if (pathname === '/madden/callback') {
      const code = String(parsed.query.code || '').trim();
      const stateId = String(parsed.query.state || '').trim();
      res.writeHead(200, { 'Content-Type': 'text/html' });
      if (!code) {
        res.end(html('<h3>Missing code</h3><p>No `?code=` value was found in the callback URL.</p>'));
        return;
      }
      const state = consumeAuthState(stateId);
      if (!state?.guildId) {
        res.end(html('<h3>Missing auth state</h3><p>This redirect session could not be tied back to a Discord server. Start the flow again from <code>/setup</code> inside the target server.</p>'));
        return;
      }
      try {
        const tokens = await buildPersonaScopedTokens(code);
        saveGuildEATokens(state.guildId, tokens);
        res.end(html(`
          <h3>League Connection Saved</h3>
          <p>Saved successfully for Discord server <strong>${state.guildId}</strong>.</p>
          <p><strong>Console:</strong> ${tokens.console}</p>
          <p><strong>Persona:</strong> ${tokens.personaName} (${tokens.blazeId})</p>
          <p>You can close this tab and go back to Discord. Run <code>/install-league</code> next.</p>
        `));
      } catch (e) {
        res.end(html(`<h3>Exchange failed</h3><pre>${e.message}</pre>`));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  };

  if (USE_SHARED_HTTP) {
    registerHttpRoute({ method: 'GET', path: '/madden/auth', handler });
    registerHttpRoute({ method: 'GET', path: '/madden/callback', handler });
    startHealthcheckServer();
    console.log(`[madden-auth] Registered shared routes for ${APP_REDIRECT_URL}`);
    return null;
  }

  const server = http.createServer(handler);

  server.on('error', (err) => {
    console.error(`[madden-auth] Failed to listen on http://${HOST}:${PORT}: ${err?.message || err}`);
  });

  server.listen(PORT, HOST, () => {
    console.log(`[madden-auth] Listening on http://${HOST}:${PORT}/madden/auth`);
  });

  return server;
}
