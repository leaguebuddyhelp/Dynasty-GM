import fs from 'fs';

import connectionRepository from '../../leaguebuddy/repositories/madden_connection_repository.js';
import { getMaddenLeagueSnapshotPath } from '../../leaguebuddy/paths.js';
import {
  consumeAuthState,
  createEAClientForGuild,
  deleteGuildEATokens,
  getGuildAuthStartUrl,
  getGuildEATokens,
  saveGuildEATokens,
} from '../ea_guild_auth.js';
import { ephemeralClientFromToken } from '../ea_client.js';
import { APP_REDIRECT_URL, REDIRECT_URL } from '../ea_constants.js';
import {
  exchangeLoginCode,
  exchangePersonaToken,
  extractValidPersonas,
  fetchEntitlements,
  fetchPersonas,
  fetchTokenInfo,
} from '../ea_personas.js';
import { clearGuildLeague, setGuildLeague } from '../madden_config.js';
import { loadLeagueSnapshot } from '../madden_data.js';
import { runSync } from '../sync.js';
import { SnallabotProvider } from '../providers/SnallabotProvider.js';

const CONNECT_SESSION_TTL_MS = 1000 * 60 * 60 * 24;
const LEAGUE_FETCH_TIMEOUT_MS = 12000;

function nowPlus(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function nowIso() {
  return new Date().toISOString();
}

function safeString(value) {
  const trimmed = String(value || '').trim();
  return trimmed || null;
}

function parseJsonPayload(raw) {
  if (typeof raw !== 'string') return raw;
  return JSON.parse(raw);
}

function isHttpUrl(value) {
  if (!safeString(value)) return false;
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseUrl(value) {
  try {
    return new URL(String(value));
  } catch {
    return null;
  }
}

function isPrivateHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return true;
  if (host === '::1') return true;
  if (host.endsWith('.local')) return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) return true;
  return false;
}

function getExportUrlReachabilityError(value) {
  const parsed = parseUrl(value);
  if (!parsed) {
    return 'Export URL must be a real http:// or https:// link.';
  }
  if (!(parsed.protocol === 'http:' || parsed.protocol === 'https:')) {
    return 'Export URL must be a real http:// or https:// link.';
  }
  if (isPrivateHost(parsed.hostname)) {
    return 'This link points to your local or private network. LEAGUEbuddy runs on Railway and can only import from public internet-reachable URLs.';
  }
  return null;
}

function isPlaceholderUrl(value) {
  return /^(YOUR_|OFFICIAL_|REPLACE_ME|PASTE_|EXAMPLE_)/i.test(String(value || '').trim());
}

function objectKeysCount(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).length
    : 0;
}

function summarizePayload(payload) {
  const leagueName = safeString(
    payload?.leagueName
    || payload?.league?.name
    || payload?.franchise?.leagueName
    || payload?.metadata?.leagueName
    || payload?.name,
  ) || 'Imported League';

  const leagueExternalId = safeString(
    payload?.leagueId
    || payload?.league?.id
    || payload?.franchise?.leagueId
    || payload?.metadata?.leagueId,
  );

  const week = safeString(
    payload?.week
    || payload?.currentWeek
    || payload?.seasonInfo?.currentWeek
    || payload?.metadata?.currentWeek,
  );

  const teams = Array.isArray(payload?.teams)
    ? payload.teams.length
    : Array.isArray(payload?.league?.teams)
      ? payload.league.teams.length
      : 0;

  return {
    leagueName,
    leagueExternalId,
    week,
    teams,
    topLevelKeys: objectKeysCount(payload),
  };
}

function summarizeLeagueRecord(league) {
  const leagueId = safeString(
    league?.leagueId
    || league?.id
    || league?.league?.leagueId
    || league?.league?.id,
  );
  const leagueName = safeString(
    league?.leagueName
    || league?.name
    || league?.league?.name
    || league?.league?.leagueName
    || league?.displayName,
  ) || `League ${leagueId || 'Unknown'}`;
  const week = safeString(
    league?.currentWeek
    || league?.week
    || league?.weekIndex
    || league?.seasonInfo?.currentWeek,
  );
  const season = safeString(
    league?.seasonName
    || league?.seasonText
    || league?.seasonInfo?.currentSeason
    || league?.seasonInfo?.season,
  );
  const stage = safeString(
    league?.stage
    || league?.seasonInfo?.stage
    || league?.seasonStage,
  );

  return {
    leagueId,
    leagueName,
    week,
    season,
    stage,
  };
}

function summarizeLiveSnapshot(snapshot, leagueSummary = {}) {
  const teams = Array.isArray(snapshot?.teams?.leagueTeamInfoList)
    ? snapshot.teams.leagueTeamInfoList.length
    : Array.isArray(snapshot?.teams)
      ? snapshot.teams.length
      : 0;

  return {
    leagueId: safeString(snapshot?.leagueId) || leagueSummary.leagueId || null,
    leagueName: safeString(
      snapshot?.info?.careerHubInfo?.leagueName
      || snapshot?.leagueName
      || leagueSummary.leagueName,
    ) || leagueSummary.leagueName || 'Connected League',
    week: safeString(snapshot?.currentWeek) || leagueSummary.week || null,
    season: safeString(
      snapshot?.info?.careerHubInfo?.seasonInfo?.seasonYear
      || leagueSummary.season,
    ) || leagueSummary.season || null,
    stage: safeString(
      snapshot?.stage
      || snapshot?.info?.careerHubInfo?.seasonInfo?.seasonWeekType
      || leagueSummary.stage,
    ) || leagueSummary.stage || null,
    teams,
    lastSyncedAt: safeString(snapshot?.fetchedAt) || new Date().toISOString(),
    eaConnected: true,
  };
}

function updateSessionSyncProgress(token, updates = {}) {
  if (!token) return;
  const current = connectionRepository.getConnectSessionByToken(token);
  const existing = current?.syncProgress || {};
  connectionRepository.updateConnectSessionByToken(token, {
    syncProgress: {
      ...existing,
      ...updates,
      updatedAt: nowIso(),
    },
  });
}

async function performInitialLeagueSync({ token, guildId, leagueId, leagueSummary }) {
  const useSnallabot = (process.env.MADDEN_SYNC_USE_SNALLABOT ?? 'true').toLowerCase() !== 'false';
  const provider = useSnallabot ? new SnallabotProvider() : null;
  const syncResult = await runSync(leagueId, provider, {
    guildId,
    onProgress: async (phase, detail) => {
      updateSessionSyncProgress(token, {
        status: 'running',
        phase,
        detail,
      });
    },
  });
  const liveSnapshot = loadLeagueSnapshot(leagueId);
  const summary = summarizeLiveSnapshot(liveSnapshot, leagueSummary);
  const repositorySnapshot = connectionRepository.createSnapshot({
    guildId,
    importJobId: null,
    leagueName: summary.leagueName,
    leagueExternalId: summary.leagueId,
    summary,
    payload: liveSnapshot,
  });
  return {
    syncResult,
    summary,
    repositorySnapshot,
  };
}

function uniquePersonas(personas = []) {
  const seen = new Set();
  return personas.filter((persona) => {
    const key = `${persona.personaId}|${persona.namespaceName}|${persona.entitlement}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function buildPersonaChoices(loginAccessToken) {
  const tokenInfo = await fetchTokenInfo(loginAccessToken);
  const pid = tokenInfo?.pid_id;
  if (!pid) {
    throw new Error('No pid_id returned from EA tokeninfo.');
  }

  const entRes = await fetchEntitlements(pid, loginAccessToken);
  const entitlements = entRes?.entitlements?.entitlement || [];
  const personaResponses = await Promise.all(
    entitlements.map(async (ent) => ({
      ent,
      personas: await fetchPersonas(ent.pidUri, loginAccessToken),
    })),
  );

  const personas = uniquePersonas(extractValidPersonas(entRes, personaResponses, 'Default'));
  if (!personas.length) {
    throw new Error('No valid Madden personas were found for this EA account.');
  }
  return personas;
}

function publicBaseUrl() {
  const explicit = safeString(process.env.LB_PUBLIC_BASE_URL);
  if (explicit) return explicit.replace(/\/+$/, '');
  const callbackUrl = safeString(process.env.EA_REDIRECT_URL);
  if (callbackUrl) {
    const parsed = new URL(callbackUrl);
    return parsed.origin;
  }
  if (safeString(process.env.PORT)) {
    return 'http://127.0.0.1:8080';
  }
  return 'http://127.0.0.1:8080';
}

function sameCallbackUrl(a, b) {
  const left = parseUrl(a);
  const right = parseUrl(b);
  return Boolean(
    left
    && right
    && left.protocol === right.protocol
    && left.hostname === right.hostname
    && left.port === right.port
    && left.pathname === right.pathname
  );
}

function isExpectedEaCallbackUrl(value) {
  const parsed = parseUrl(value);
  if (!parsed) return false;
  const isLoopback = Boolean(
    parsed
    && parsed.protocol === 'http:'
    && parsed.hostname === '127.0.0.1'
    && parsed.pathname === '/success'
  );
  return isLoopback || sameCallbackUrl(parsed.toString(), REDIRECT_URL) || sameCallbackUrl(parsed.toString(), APP_REDIRECT_URL);
}

async function withTimeout(task, ms, message) {
  let timeoutId;
  try {
    return await Promise.race([
      task,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function fetchLeaguesWithClient(client) {
  return withTimeout(
    Promise.resolve().then(() => client.getLeagues()),
    LEAGUE_FETCH_TIMEOUT_MS,
    'EA is taking too long to load your league list. Refresh the page and try again.',
  );
}

function createSnapshotForGuild({
  guildId,
  connectSessionId = null,
  payload,
  sourceType = 'dashboard_export',
}) {
  const summary = summarizePayload(payload);
  const importJob = connectionRepository.createImportJob({
    guildId,
    connectSessionId,
    rawPayload: payload,
  });
  const snapshot = connectionRepository.createSnapshot({
    guildId,
    importJobId: importJob.id,
    leagueName: summary.leagueName,
    leagueExternalId: summary.leagueExternalId,
    summary,
    payload,
  });
  connectionRepository.finishImportJob(importJob.id, {
    status: 'succeeded',
    summary,
  });
  const connection = connectionRepository.upsertLeagueConnection({
    guildId,
    leagueName: summary.leagueName,
    leagueExternalId: summary.leagueExternalId,
    sourceType,
    status: 'connected',
    lastImportJobId: importJob.id,
    lastSnapshotId: snapshot.id,
    summary,
  });
  return {
    summary,
    importJob,
    snapshot,
    connection,
  };
}

function demoPayloadForGuild(guildId) {
  const suffix = String(guildId).slice(-4);
  return {
    leagueName: `Demo League ${suffix}`,
    leagueId: `demo-${suffix}`,
    currentWeek: 7,
    seasonInfo: {
      currentWeek: 7,
      currentSeason: 2026,
      stage: 'regular_season',
    },
    teams: [
      { name: 'Baltimore Ravens', user: 'ShotyMcFly', record: '4-2' },
      { name: 'Kansas City Chiefs', user: 'ionpoltic', record: '4-2' },
      { name: 'Detroit Lions', user: 'FxForceYT', record: '3-3' },
      { name: 'Miami Dolphins', user: 'kosmiChurro', record: '4-2' },
    ],
  };
}

export function beginLeagueConnection({ guildId, guildName, createdByUserId }) {
  const session = connectionRepository.createConnectSession({
    guildId,
    guildName,
    createdByUserId,
    expiresAt: nowPlus(CONNECT_SESSION_TTL_MS),
  });
  const baseUrl = publicBaseUrl();
  const setupUrl = `${baseUrl}/madden/connect?token=${encodeURIComponent(session.token)}`;
  const importUrl = `${baseUrl}/madden/import?token=${encodeURIComponent(session.token)}`;
  return {
    session,
    setupUrl,
    importUrl,
  };
}

export function getLeagueConnectionDashboard(token) {
  const session = connectionRepository.getConnectSessionByToken(token);
  if (!session) {
    return { ok: false, code: 'invalid_token', message: 'This setup link is invalid.' };
  }
  if (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now()) {
    return { ok: false, code: 'expired_token', message: 'This setup link has expired. Run /setup again.' };
  }

  const connection = connectionRepository.getLeagueConnectionByGuildId(session.guildId);
  const exportSources = connectionRepository.getExportSourcesByGuildId(session.guildId);
  const latestSnapshot = connectionRepository.getLatestSnapshotByGuildId(session.guildId);

  return {
    ok: true,
    session,
    connection,
    exportSources,
    latestSnapshot,
  };
}

export async function getLeagueConnectionDashboardState(token) {
  const dashboard = getLeagueConnectionDashboard(token);
  if (!dashboard.ok) return dashboard;

  const guildTokens = getGuildEATokens(dashboard.session.guildId);
  const authDraft = dashboard.session?.authDraft || null;
  let authUrl = null;
  let authUrlError = null;
  try {
    authUrl = getGuildAuthStartUrl(dashboard.session.guildId);
  } catch (error) {
    authUrlError = error?.message || 'Could not prepare the EA login link right now.';
    console.error('[madden-connect] failed to build auth url', {
      guildId: dashboard.session.guildId,
      error: authUrlError,
    });
  }
  let availableLeagues = Array.isArray(dashboard.session?.availableLeagues)
    ? dashboard.session.availableLeagues
    : [];
  let leagueFetchError = dashboard.session?.leagueFetchError || null;

  if (guildTokens && !availableLeagues.length && !dashboard.session?.selectedLeague) {
    try {
      const client = await createEAClientForGuild(dashboard.session.guildId);
      const leagues = await fetchLeaguesWithClient(client);
      availableLeagues = Array.isArray(leagues) ? leagues : [];
      connectionRepository.updateConnectSessionByToken(token, {
        availableLeagues,
        leagueFetchError: null,
      });
      leagueFetchError = null;
    } catch (error) {
      leagueFetchError = error?.message || 'Could not load leagues from EA right now.';
      connectionRepository.updateConnectSessionByToken(token, {
        leagueFetchError,
      });
    }
  }

  return {
    ...dashboard,
    authUrl,
    authUrlError,
    guildTokens,
    authDraft,
    availableLeagues,
    leagueFetchError,
  };
}

export function getLeagueConnectionStatus(guildId) {
  const connection = connectionRepository.getLeagueConnectionByGuildId(guildId);
  const latestSnapshot = connectionRepository.getLatestSnapshotByGuildId(guildId);
  const exportSources = connectionRepository.getExportSourcesByGuildId(guildId);
  const guildTokens = getGuildEATokens(guildId);
  return {
    connection,
    latestSnapshot,
    exportSources,
    guildTokens,
  };
}

function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore missing files
  }
}

export function resetLeagueConnectionByGuild(guildId, { keepSessionToken = null } = {}) {
  if (!guildId) {
    return { ok: false, code: 'missing_guild', message: 'Guild ID is required.' };
  }

  const connection = connectionRepository.getLeagueConnectionByGuildId(guildId);
  const leagueId = connection?.leagueExternalId || null;

  connectionRepository.resetGuildConnectionData(guildId, { keepSessionToken });
  deleteGuildEATokens(guildId);
  clearGuildLeague(guildId);

  if (leagueId) {
    safeUnlink(getMaddenLeagueSnapshotPath(leagueId));
  }

  return {
    ok: true,
    guildId: String(guildId),
    leagueId,
  };
}

export function resetLeagueConnectionByToken(token) {
  const dashboard = getLeagueConnectionDashboard(token);
  if (!dashboard.ok) return dashboard;

  resetLeagueConnectionByGuild(dashboard.session.guildId, {
    keepSessionToken: token,
  });

  return {
    ok: true,
    session: connectionRepository.getConnectSessionByToken(token),
    message: 'Setup reset. Reconnect EA and choose the league again.',
  };
}

export function saveLeagueConnectionSetup({
  token,
  leagueName,
  leaguePassword,
}) {
  const dashboard = getLeagueConnectionDashboard(token);
  if (!dashboard.ok) return dashboard;

  const normalizedLeagueName = safeString(leagueName);
  const normalizedLeaguePassword = safeString(leaguePassword);
  if (!normalizedLeagueName) {
    return { ok: false, code: 'missing_league_name', message: 'League name is required.' };
  }

  const existingSummary = dashboard.connection?.summary || {};
  const connection = connectionRepository.upsertLeagueConnection({
    guildId: dashboard.session.guildId,
    leagueName: normalizedLeagueName,
    leagueExternalId: dashboard.connection?.leagueExternalId || null,
    leaguePassword: normalizedLeaguePassword,
    sourceType: dashboard.connection?.sourceType || 'dashboard_export',
    status: dashboard.connection?.status || 'pending_exports',
    lastImportJobId: dashboard.connection?.lastImportJobId || null,
    lastSnapshotId: dashboard.connection?.lastSnapshotId || null,
    summary: {
      ...existingSummary,
      leagueName: normalizedLeagueName,
      leaguePassword: normalizedLeaguePassword,
    },
  });

  return {
    ok: true,
    session: dashboard.session,
    connection,
  };
}

export async function submitEaRedirectUrl({
  token,
  redirectUrl,
}) {
  const dashboard = getLeagueConnectionDashboard(token);
  if (!dashboard.ok) return dashboard;

  const normalizedUrl = safeString(redirectUrl);
  if (!normalizedUrl) {
    return { ok: false, code: 'missing_redirect_url', message: 'Paste the full URL from the browser after EA login.' };
  }
  if (!isExpectedEaCallbackUrl(normalizedUrl)) {
    return {
      ok: false,
      code: 'invalid_redirect_url',
      message: 'Paste the full returned EA URL from the browser address bar. It should include ?code= and ?state=.',
    };
  }

  try {
    const parsed = new URL(normalizedUrl);
    const stateId = safeString(parsed.searchParams.get('state'));
    const state = stateId ? consumeAuthState(stateId) : null;
    if (!state?.guildId || String(state.guildId) !== String(dashboard.session.guildId)) {
      return {
        ok: false,
        code: 'invalid_auth_state',
        message: 'That EA login result does not match this Discord server. Start the login again from this dashboard.',
      };
    }

    const loginTokens = await exchangeLoginCode(normalizedUrl);
    const personas = await buildPersonaChoices(loginTokens.access_token);
    connectionRepository.updateConnectSessionByToken(token, {
      authDraft: {
        createdAt: new Date().toISOString(),
        loginAccessToken: loginTokens.access_token,
        loginRefreshToken: loginTokens.refresh_token,
        loginExpiry: Date.now() + (loginTokens.expires_in || 0) * 1000,
        personas,
      },
    });
    return {
      ok: true,
      message: 'EA login captured. Choose your Madden account/persona below.',
      personas,
    };
  } catch (error) {
    return {
      ok: false,
      code: 'ea_redirect_exchange_failed',
      message: error?.message || 'Could not exchange the EA redirect URL.',
    };
  }
}

export async function submitEaPersona({
  token,
  personaId,
}) {
  const dashboard = getLeagueConnectionDashboard(token);
  if (!dashboard.ok) return dashboard;

  const authDraft = dashboard.session?.authDraft;
  if (!authDraft?.loginAccessToken || !Array.isArray(authDraft?.personas) || !authDraft.personas.length) {
    return { ok: false, code: 'missing_auth_draft', message: 'Start with Connect EA first.' };
  }

  const chosen = authDraft.personas.find((persona) => String(persona.personaId) === String(personaId));
  if (!chosen) {
    return { ok: false, code: 'missing_persona', message: 'That Madden account/persona was not found.' };
  }

  try {
    const personaToken = await exchangePersonaToken(
      authDraft.loginAccessToken,
      chosen.personaId,
      chosen.namespaceName,
    );

    const savedTokens = {
      accessToken: personaToken.access_token,
      refreshToken: personaToken.refresh_token,
      expiry: Date.now() + (personaToken.expires_in || 0) * 1000,
      console: chosen.systemConsole || 'ps5',
      blazeId: `${chosen.personaId}`,
      gameYear: process.env.EA_GAME_YEAR || '2026',
      personaName: chosen.displayName,
      entitlement: chosen.entitlement,
      namespace: chosen.namespaceName,
    };

    saveGuildEATokens(dashboard.session.guildId, {
      ...savedTokens,
    });

    let availableLeagues = [];
    let leagueFetchError = null;
    try {
      const client = await ephemeralClientFromToken({
        accessToken: savedTokens.accessToken,
        refreshToken: savedTokens.refreshToken,
        expiry: new Date(Number(savedTokens.expiry)),
        console: savedTokens.console,
        blazeId: savedTokens.blazeId,
        gameYear: savedTokens.gameYear,
      });
      const leagues = await fetchLeaguesWithClient(client);
      availableLeagues = Array.isArray(leagues) ? leagues : [];
    } catch (error) {
      leagueFetchError = error?.message || 'EA connected, but the league list could not be loaded yet.';
    }

    connectionRepository.updateConnectSessionByToken(token, {
      authDraft: null,
      selectedPersona: {
        personaId: `${chosen.personaId}`,
        displayName: chosen.displayName,
        namespaceName: chosen.namespaceName,
        entitlement: chosen.entitlement,
        systemConsole: chosen.systemConsole,
      },
      availableLeagues,
      leagueFetchError,
    });

    return {
      ok: true,
      message: availableLeagues.length
        ? 'EA account connected. Choose your league below.'
        : 'EA account connected. If your leagues do not appear right away, refresh this page and try again.',
    };
  } catch (error) {
    return {
      ok: false,
      code: 'persona_exchange_failed',
      message: error?.message || 'Could not save that Madden persona.',
    };
  }
}

export async function selectEaLeague({
  token,
  leagueId,
}) {
  const dashboard = getLeagueConnectionDashboard(token);
  if (!dashboard.ok) return dashboard;

  const normalizedLeagueId = safeString(leagueId);
  if (!normalizedLeagueId) {
    return { ok: false, code: 'missing_league_id', message: 'Choose a league first.' };
  }

  try {
    const leagues = Array.isArray(dashboard.session?.availableLeagues) && dashboard.session.availableLeagues.length
      ? dashboard.session.availableLeagues
      : await (async () => {
        const client = await createEAClientForGuild(dashboard.session.guildId);
        return fetchLeaguesWithClient(client);
      })();
    const selectedLeague = (Array.isArray(leagues) ? leagues : []).find((league) => {
      const summary = summarizeLeagueRecord(league);
      return summary.leagueId === normalizedLeagueId;
    });

    if (!selectedLeague) {
      return { ok: false, code: 'missing_league', message: 'That league was not found on the connected EA account.' };
    }

    const summary = summarizeLeagueRecord(selectedLeague);
    setGuildLeague(dashboard.session.guildId, summary.leagueId);

    connectionRepository.upsertLeagueConnection({
      guildId: dashboard.session.guildId,
      leagueName: summary.leagueName,
      leagueExternalId: summary.leagueId,
      sourceType: 'ea_dashboard',
      status: 'syncing',
      lastImportJobId: dashboard.connection?.lastImportJobId || null,
      lastSnapshotId: dashboard.connection?.lastSnapshotId || null,
      summary: {
        ...(dashboard.connection?.summary || {}),
        ...summary,
        eaConnected: true,
      },
    });

    connectionRepository.updateConnectSessionByToken(token, {
      selectedLeague: {
        leagueId: summary.leagueId,
        leagueName: summary.leagueName,
      },
      availableLeagues: Array.isArray(leagues) ? leagues : [],
      leagueFetchError: null,
      syncProgress: {
        status: 'running',
        phase: 'Starting sync',
        detail: 'LEAGUEbuddy is opening your league and pulling the first data snapshot.',
        updatedAt: nowIso(),
      },
    });

    void (async () => {
      try {
        const initialSync = await performInitialLeagueSync({
          token,
          guildId: dashboard.session.guildId,
          leagueId: summary.leagueId,
          leagueSummary: summary,
        });

        connectionRepository.upsertLeagueConnection({
          guildId: dashboard.session.guildId,
          leagueName: initialSync.summary.leagueName,
          leagueExternalId: summary.leagueId,
          sourceType: 'ea_dashboard',
          status: 'connected',
          lastImportJobId: dashboard.connection?.lastImportJobId || null,
          lastSnapshotId: initialSync.repositorySnapshot.id,
          summary: {
            ...(dashboard.connection?.summary || {}),
            ...initialSync.summary,
            syncStatus: 'succeeded',
          },
        });

        updateSessionSyncProgress(token, {
          status: 'succeeded',
          phase: 'First sync complete',
          detail: 'League data is ready. Return to Discord and run /setup.',
        });
      } catch (error) {
        connectionRepository.upsertLeagueConnection({
          guildId: dashboard.session.guildId,
          leagueName: summary.leagueName,
          leagueExternalId: summary.leagueId,
          sourceType: 'ea_dashboard',
          status: 'sync_error',
          lastImportJobId: dashboard.connection?.lastImportJobId || null,
          lastSnapshotId: dashboard.connection?.lastSnapshotId || null,
          summary: {
            ...(dashboard.connection?.summary || {}),
            ...summary,
            eaConnected: true,
            syncStatus: 'failed',
            lastSyncError: error?.message || 'Initial sync failed.',
          },
        });

        updateSessionSyncProgress(token, {
          status: 'failed',
          phase: 'First sync failed',
          detail: error?.message || 'The first sync failed.',
        });
      }
    })();

    return {
      ok: true,
      message: 'League connected. LEAGUEbuddy is now pulling your first data snapshot. Stay on this page while it updates.',
      syncing: true,
    };
  } catch (error) {
    return {
      ok: false,
      code: 'league_select_failed',
      message: error?.message || 'Could not load or save that league.',
    };
  }
}

export async function quickReconnectLeagueByToken(token) {
  const dashboard = getLeagueConnectionDashboard(token);
  if (!dashboard.ok) return dashboard;

  const guildId = dashboard.session?.guildId;
  const connection = dashboard.connection;
  const savedLeagueId = safeString(
    connection?.leagueExternalId
    || connection?.summary?.leagueId
    || dashboard.session?.selectedLeague?.leagueId,
  );
  const savedLeagueName = safeString(
    connection?.leagueName
    || connection?.summary?.leagueName
    || dashboard.session?.selectedLeague?.leagueName,
  ) || 'Connected League';

  if (!guildId) {
    return { ok: false, code: 'missing_guild', message: 'This setup session is missing a Discord server.' };
  }
  if (!savedLeagueId || !connection) {
    return { ok: false, code: 'missing_saved_league', message: 'No saved league was found. Use the normal setup flow once, then Quick Reconnect will be available.' };
  }
  if (!getGuildEATokens(guildId)) {
    return { ok: false, code: 'missing_tokens', message: 'No saved EA login was found. Use Open EA Login once, then choose the saved league.' };
  }

  const previousSummary = connection?.summary || {};
  const baseSummary = {
    ...previousSummary,
    leagueId: savedLeagueId,
    leagueName: savedLeagueName,
    eaConnected: true,
  };

  try {
    const client = await createEAClientForGuild(guildId);
    let leagueSummary = baseSummary;
    let availableLeagues = Array.isArray(dashboard.session?.availableLeagues)
      ? dashboard.session.availableLeagues
      : [];

    try {
      const leagues = await fetchLeaguesWithClient(client);
      availableLeagues = Array.isArray(leagues) ? leagues : [];
      const selected = availableLeagues.find((league) => summarizeLeagueRecord(league).leagueId === savedLeagueId);
      if (selected) leagueSummary = { ...baseSummary, ...summarizeLeagueRecord(selected) };
    } catch (error) {
      // A valid saved token can still have a slow league-list response. The sync below is the source of truth.
      leagueSummary = {
        ...leagueSummary,
        leagueFetchWarning: error?.message || 'League list could not be refreshed before reconnect.',
      };
    }

    setGuildLeague(guildId, savedLeagueId);
    connectionRepository.upsertLeagueConnection({
      guildId,
      leagueName: leagueSummary.leagueName || savedLeagueName,
      leagueExternalId: savedLeagueId,
      sourceType: 'ea_dashboard',
      status: 'syncing',
      lastImportJobId: connection.lastImportJobId || null,
      lastSnapshotId: connection.lastSnapshotId || null,
      summary: {
        ...baseSummary,
        ...leagueSummary,
        syncStatus: 'running',
        lastSyncError: null,
      },
    });
    connectionRepository.updateConnectSessionByToken(token, {
      selectedLeague: {
        leagueId: savedLeagueId,
        leagueName: leagueSummary.leagueName || savedLeagueName,
      },
      selectedPersona: dashboard.session?.selectedPersona || {
        personaId: safeString(getGuildEATokens(guildId)?.blazeId),
        displayName: safeString(getGuildEATokens(guildId)?.personaName),
        systemConsole: safeString(getGuildEATokens(guildId)?.console),
        entitlement: safeString(getGuildEATokens(guildId)?.entitlement),
      },
      availableLeagues,
      leagueFetchError: null,
      syncProgress: {
        status: 'running',
        phase: 'Quick reconnect started',
        detail: 'LEAGUEbuddy is reusing the saved EA account and saved league, then pulling a fresh snapshot.',
        updatedAt: nowIso(),
      },
    });

    void (async () => {
      try {
        const initialSync = await performInitialLeagueSync({
          token,
          guildId,
          leagueId: savedLeagueId,
          leagueSummary,
        });

        connectionRepository.upsertLeagueConnection({
          guildId,
          leagueName: initialSync.summary.leagueName || leagueSummary.leagueName || savedLeagueName,
          leagueExternalId: savedLeagueId,
          sourceType: 'ea_dashboard',
          status: 'connected',
          lastImportJobId: connection.lastImportJobId || null,
          lastSnapshotId: initialSync.repositorySnapshot.id,
          summary: {
            ...baseSummary,
            ...initialSync.summary,
            syncStatus: 'succeeded',
            lastSyncError: null,
          },
        });

        updateSessionSyncProgress(token, {
          status: 'succeeded',
          phase: 'Quick reconnect complete',
          detail: 'League data is refreshed. Return to Discord and run /setup or /weeklyupdate.',
        });
      } catch (error) {
        connectionRepository.upsertLeagueConnection({
          guildId,
          leagueName: leagueSummary.leagueName || savedLeagueName,
          leagueExternalId: savedLeagueId,
          sourceType: 'ea_dashboard',
          status: 'sync_error',
          lastImportJobId: connection.lastImportJobId || null,
          lastSnapshotId: connection.lastSnapshotId || null,
          summary: {
            ...baseSummary,
            ...leagueSummary,
            syncStatus: 'failed',
            lastSyncError: error?.message || 'Quick reconnect sync failed.',
          },
        });

        updateSessionSyncProgress(token, {
          status: 'failed',
          phase: 'Quick reconnect failed',
          detail: error?.message || 'The saved league could not be refreshed.',
        });
      }
    })();

    return {
      ok: true,
      message: 'Quick reconnect started with the saved EA account and saved league. Stay on this page while it refreshes.',
      syncing: true,
    };
  } catch (error) {
    const message = error?.message || 'Quick reconnect could not start.';
    connectionRepository.upsertLeagueConnection({
      guildId,
      leagueName: savedLeagueName,
      leagueExternalId: savedLeagueId,
      sourceType: connection.sourceType || 'ea_dashboard',
      status: 'sync_error',
      lastImportJobId: connection.lastImportJobId || null,
      lastSnapshotId: connection.lastSnapshotId || null,
      summary: {
        ...baseSummary,
        syncStatus: 'failed',
        lastSyncError: message,
      },
    });
    return {
      ok: false,
      code: 'quick_reconnect_failed',
      message: /refresh token|session expired|Reconnect EA|100105/i.test(message)
        ? 'Saved EA login expired. Use Open EA Login once, then press Quick Reconnect again.'
        : message,
    };
  }
}

export function addLeagueExportSource({
  token,
  label,
  exportUrl,
  leagueInfo,
  weeklyStats,
  roster,
  extraData,
  autoUpdate,
}) {
  const dashboard = getLeagueConnectionDashboard(token);
  if (!dashboard.ok) return dashboard;
  if (!dashboard.connection) {
    return { ok: false, code: 'missing_connection', message: 'Set the league details first.' };
  }

  const normalizedUrl = safeString(exportUrl);
  if (!normalizedUrl) {
    return { ok: false, code: 'missing_export_url', message: 'Export URL is required.' };
  }
  if (isPlaceholderUrl(normalizedUrl) || !isHttpUrl(normalizedUrl)) {
    return {
      ok: false,
      code: 'invalid_export_url',
      message: 'Export URL must be a real http:// or https:// link.',
    };
  }
  const reachabilityError = getExportUrlReachabilityError(normalizedUrl);
  if (reachabilityError) {
    return {
      ok: false,
      code: 'unreachable_export_url',
      message: reachabilityError,
    };
  }

  const exportSource = connectionRepository.createExportSource({
    connectionId: dashboard.connection.id,
    guildId: dashboard.session.guildId,
    label: safeString(label) || `Export Source ${dashboard.exportSources.length + 1}`,
    exportUrl: normalizedUrl,
    leagueInfo,
    weeklyStats,
    roster,
    extraData,
    autoUpdate,
  });

  const summary = {
    ...(dashboard.connection.summary || {}),
    exportSources: dashboard.exportSources.length + 1,
  };
  const connection = connectionRepository.upsertLeagueConnection({
    guildId: dashboard.session.guildId,
    leagueName: dashboard.connection.leagueName,
    leagueExternalId: dashboard.connection.leagueExternalId,
    sourceType: 'dashboard_export',
    status: 'connected',
    lastImportJobId: dashboard.connection.lastImportJobId,
    lastSnapshotId: dashboard.connection.lastSnapshotId,
    summary,
  });

  return {
    ok: true,
    session: dashboard.session,
    connection,
    exportSource,
  };
}

export async function importFromExportSource({
  token,
  exportSourceId,
}) {
  const dashboard = getLeagueConnectionDashboard(token);
  if (!dashboard.ok) return dashboard;
  if (!dashboard.connection) {
    return { ok: false, code: 'missing_connection', message: 'Save the league name first.' };
  }

  const exportSource = connectionRepository.getExportSourceById(exportSourceId);
  if (!exportSource || exportSource.guildId !== dashboard.session.guildId) {
    return { ok: false, code: 'missing_export_source', message: 'That export link was not found for this server.' };
  }

  const reachabilityError = getExportUrlReachabilityError(exportSource.exportUrl);
  if (reachabilityError) {
    connectionRepository.updateExportSource(exportSource.id, {
      lastImportStatus: 'failed',
      lastImportAt: new Date().toISOString(),
      lastImportError: reachabilityError,
    });
    return {
      ok: false,
      code: 'unreachable_export_url',
      message: reachabilityError,
    };
  }

  try {
    const response = await fetch(exportSource.exportUrl, {
      headers: {
        accept: 'application/json,text/plain,*/*',
      },
    });

    if (!response.ok) {
      connectionRepository.updateExportSource(exportSource.id, {
        lastImportStatus: 'failed',
        lastImportAt: new Date().toISOString(),
        lastImportError: `HTTP ${response.status}`,
      });
      return {
        ok: false,
        code: 'fetch_failed',
        message: `Export link returned HTTP ${response.status}.`,
      };
    }

    const bodyText = await response.text();
    const payload = parseJsonPayload(bodyText);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      connectionRepository.updateExportSource(exportSource.id, {
        lastImportStatus: 'failed',
        lastImportAt: new Date().toISOString(),
        lastImportError: 'Export did not return a JSON object.',
      });
      return {
        ok: false,
        code: 'invalid_export_payload',
        message: 'Export link did not return a valid JSON object.',
      };
    }

    const result = createSnapshotForGuild({
      guildId: dashboard.session.guildId,
      connectSessionId: dashboard.session.id,
      payload,
      sourceType: 'dashboard_export',
    });

    connectionRepository.updateExportSource(exportSource.id, {
      lastImportStatus: 'succeeded',
      lastImportAt: result.snapshot.createdAt,
      lastImportError: null,
    });

    return {
      ok: true,
      session: dashboard.session,
      connection: result.connection,
      snapshot: result.snapshot,
      summary: result.summary,
      exportSource: connectionRepository.getExportSourceById(exportSource.id),
    };
  } catch (error) {
    connectionRepository.updateExportSource(exportSource.id, {
      lastImportStatus: 'failed',
      lastImportAt: new Date().toISOString(),
      lastImportError: error?.message || 'Unknown import error',
    });
    return {
      ok: false,
      code: 'import_failed',
      message: `Import failed: ${error?.message || 'Unknown error'}`,
    };
  }
}

export async function refreshExportSourceForGuild(guildId) {
  if (!guildId) {
    return { ok: false, code: 'missing_guild', message: 'Guild ID is required.' };
  }

  const connection = connectionRepository.getLeagueConnectionByGuildId(guildId);
  if (!connection) {
    return { ok: false, code: 'missing_connection', message: 'No league connection was found for this server.' };
  }

  const exportSource = connectionRepository
    .getExportSourcesByGuildId(guildId)
    .find((source) => String(source?.status || 'active') === 'active');

  if (!exportSource) {
    return { ok: false, code: 'missing_export_source', message: 'No active export source is saved for this server.' };
  }

  const reachabilityError = getExportUrlReachabilityError(exportSource.exportUrl);
  if (reachabilityError) {
    connectionRepository.updateExportSource(exportSource.id, {
      lastImportStatus: 'failed',
      lastImportAt: new Date().toISOString(),
      lastImportError: reachabilityError,
    });
    return {
      ok: false,
      code: 'unreachable_export_url',
      message: reachabilityError,
    };
  }

  try {
    const response = await fetch(exportSource.exportUrl, {
      headers: {
        accept: 'application/json,text/plain,*/*',
      },
    });

    if (!response.ok) {
      connectionRepository.updateExportSource(exportSource.id, {
        lastImportStatus: 'failed',
        lastImportAt: new Date().toISOString(),
        lastImportError: `HTTP ${response.status}`,
      });
      return {
        ok: false,
        code: 'fetch_failed',
        message: `Export link returned HTTP ${response.status}.`,
      };
    }

    const bodyText = await response.text();
    const payload = parseJsonPayload(bodyText);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      connectionRepository.updateExportSource(exportSource.id, {
        lastImportStatus: 'failed',
        lastImportAt: new Date().toISOString(),
        lastImportError: 'Export did not return a JSON object.',
      });
      return {
        ok: false,
        code: 'invalid_export_payload',
        message: 'Export link did not return a valid JSON object.',
      };
    }

    const result = createSnapshotForGuild({
      guildId: String(guildId),
      connectSessionId: null,
      payload,
      sourceType: connection?.sourceType || 'dashboard_export',
    });

    connectionRepository.updateExportSource(exportSource.id, {
      lastImportStatus: 'succeeded',
      lastImportAt: result.snapshot.createdAt,
      lastImportError: null,
    });

    return {
      ok: true,
      connection: result.connection,
      snapshot: result.snapshot,
      summary: result.summary,
      exportSource: connectionRepository.getExportSourceById(exportSource.id),
    };
  } catch (error) {
    connectionRepository.updateExportSource(exportSource.id, {
      lastImportStatus: 'failed',
      lastImportAt: new Date().toISOString(),
      lastImportError: error?.message || 'Unknown import error',
    });
    connectionRepository.upsertLeagueConnection({
      guildId: String(guildId),
      leagueName: connection.leagueName,
      leagueExternalId: connection.leagueExternalId,
      sourceType: connection.sourceType || 'dashboard_export',
      status: 'sync_error',
      lastImportJobId: connection.lastImportJobId || null,
      lastSnapshotId: connection.lastSnapshotId || null,
      summary: {
        ...(connection.summary || {}),
        lastSyncError: error?.message || 'Unknown import error',
      },
    });
    return {
      ok: false,
      code: 'import_failed',
      message: `Import failed: ${error?.message || 'Unknown error'}`,
    };
  }
}

export function loadDemoLeague(token) {
  const dashboard = getLeagueConnectionDashboard(token);
  if (!dashboard.ok) return dashboard;

  const existingConnection = dashboard.connection;
  const leagueName = existingConnection?.leagueName || `Demo League ${String(dashboard.session.guildId).slice(-4)}`;
  const leagueExternalId = existingConnection?.leagueExternalId || `demo-${String(dashboard.session.guildId).slice(-4)}`;

  const connection = connectionRepository.upsertLeagueConnection({
    guildId: dashboard.session.guildId,
    leagueName,
    leagueExternalId,
    sourceType: existingConnection?.sourceType || 'dashboard_export',
    status: 'pending_exports',
    lastImportJobId: existingConnection?.lastImportJobId || null,
    lastSnapshotId: existingConnection?.lastSnapshotId || null,
    summary: existingConnection?.summary || { leagueName, leagueExternalId },
  });

  if (!dashboard.exportSources.length) {
    connectionRepository.createExportSource({
      connectionId: connection.id,
      guildId: dashboard.session.guildId,
      label: 'Demo Export Source',
      exportUrl: 'http://127.0.0.1:4010/demo-export',
      leagueInfo: true,
      weeklyStats: true,
      roster: true,
      extraData: true,
      autoUpdate: true,
    });
  }

  const payload = demoPayloadForGuild(dashboard.session.guildId);
  payload.leagueName = leagueName;
  payload.leagueId = leagueExternalId;

  const result = createSnapshotForGuild({
    guildId: dashboard.session.guildId,
    connectSessionId: dashboard.session.id,
    payload,
    sourceType: 'dashboard_export',
  });

  return {
    ok: true,
    session: dashboard.session,
    connection: result.connection,
    snapshot: result.snapshot,
    summary: result.summary,
  };
}

export function ingestImportedPayload({ token, rawPayload }) {
  const dashboard = getLeagueConnectionDashboard(token);
  if (!dashboard.ok) return dashboard;

  let payload;
  try {
    payload = parseJsonPayload(rawPayload);
  } catch {
    return { ok: false, code: 'invalid_json', message: 'Import payload must be valid JSON.' };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, code: 'invalid_payload', message: 'Import payload must be a JSON object.' };
  }

  const summary = summarizePayload(payload);
  const result = createSnapshotForGuild({
    guildId: dashboard.session.guildId,
    connectSessionId: dashboard.session.id,
    payload,
    sourceType: dashboard.connection?.sourceType || 'dashboard_export',
  });

  return {
    ok: true,
    session: dashboard.session,
    connection: result.connection,
    importJob: result.importJob,
    snapshot: result.snapshot,
    summary,
  };
}

export default {
  beginLeagueConnection,
  getLeagueConnectionDashboard,
  getLeagueConnectionDashboardState,
  getLeagueConnectionStatus,
  resetLeagueConnectionByGuild,
  resetLeagueConnectionByToken,
  saveLeagueConnectionSetup,
  submitEaRedirectUrl,
  submitEaPersona,
  selectEaLeague,
  quickReconnectLeagueByToken,
  addLeagueExportSource,
  loadDemoLeague,
  importFromExportSource,
  refreshExportSourceForGuild,
  ingestImportedPayload,
};
