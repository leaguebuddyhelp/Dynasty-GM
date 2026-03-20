import connectionRepository from '../../leaguebuddy/repositories/madden_connection_repository.js';
import {
  consumeAuthState,
  createEAClientForGuild,
  getGuildAuthStartUrl,
  getGuildEATokens,
  saveGuildEATokens,
} from '../ea_guild_auth.js';
import {
  exchangeLoginCode,
  exchangePersonaToken,
  extractValidPersonas,
  fetchEntitlements,
  fetchPersonas,
  fetchTokenInfo,
} from '../ea_personas.js';

const CONNECT_SESSION_TTL_MS = 1000 * 60 * 60 * 24;

function nowPlus(ms) {
  return new Date(Date.now() + ms).toISOString();
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
    return { ok: false, code: 'expired_token', message: 'This setup link has expired. Run /connectleague again.' };
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
  let availableLeagues = [];
  let leagueFetchError = null;

  if (guildTokens) {
    try {
      const client = await createEAClientForGuild(dashboard.session.guildId);
      const leagues = await client.getLeagues();
      availableLeagues = Array.isArray(leagues) ? leagues : [];
    } catch (error) {
      leagueFetchError = error?.message || 'Could not load leagues from EA right now.';
    }
  }

  return {
    ...dashboard,
    authUrl: getGuildAuthStartUrl(dashboard.session.guildId),
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

export function saveLeagueConnectionSetup({
  token,
  leagueName,
  leagueExternalId,
}) {
  const dashboard = getLeagueConnectionDashboard(token);
  if (!dashboard.ok) return dashboard;

  const normalizedLeagueName = safeString(leagueName);
  if (!normalizedLeagueName) {
    return { ok: false, code: 'missing_league_name', message: 'League name is required.' };
  }

  const existingSummary = dashboard.connection?.summary || {};
  const connection = connectionRepository.upsertLeagueConnection({
    guildId: dashboard.session.guildId,
    leagueName: normalizedLeagueName,
    leagueExternalId: safeString(leagueExternalId),
    sourceType: dashboard.connection?.sourceType || 'dashboard_export',
    status: dashboard.connection?.status || 'pending_exports',
    lastImportJobId: dashboard.connection?.lastImportJobId || null,
    lastSnapshotId: dashboard.connection?.lastSnapshotId || null,
    summary: {
      ...existingSummary,
      leagueName: normalizedLeagueName,
      leagueExternalId: safeString(leagueExternalId),
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
  if (!normalizedUrl.startsWith('http://127.0.0.1')) {
    return {
      ok: false,
      code: 'invalid_redirect_url',
      message: 'Paste the full URL that starts with http://127.0.0.1 after EA login finishes.',
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

    saveGuildEATokens(dashboard.session.guildId, {
      accessToken: personaToken.access_token,
      refreshToken: personaToken.refresh_token,
      expiry: Date.now() + (personaToken.expires_in || 0) * 1000,
      console: chosen.systemConsole || 'ps5',
      blazeId: `${chosen.personaId}`,
      gameYear: process.env.EA_GAME_YEAR || '2026',
      personaName: chosen.displayName,
      entitlement: chosen.entitlement,
      namespace: chosen.namespaceName,
    });

    connectionRepository.updateConnectSessionByToken(token, {
      authDraft: null,
      selectedPersona: {
        personaId: `${chosen.personaId}`,
        displayName: chosen.displayName,
        namespaceName: chosen.namespaceName,
        entitlement: chosen.entitlement,
        systemConsole: chosen.systemConsole,
      },
    });

    return {
      ok: true,
      message: 'EA account connected. Choose your league below.',
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
    const client = await createEAClientForGuild(dashboard.session.guildId);
    const leagues = await client.getLeagues();
    const selectedLeague = (Array.isArray(leagues) ? leagues : []).find((league) => {
      const summary = summarizeLeagueRecord(league);
      return summary.leagueId === normalizedLeagueId;
    });

    if (!selectedLeague) {
      return { ok: false, code: 'missing_league', message: 'That league was not found on the connected EA account.' };
    }

    const summary = summarizeLeagueRecord(selectedLeague);
    const connection = connectionRepository.upsertLeagueConnection({
      guildId: dashboard.session.guildId,
      leagueName: summary.leagueName,
      leagueExternalId: summary.leagueId,
      sourceType: 'ea_dashboard',
      status: 'connected',
      lastImportJobId: dashboard.connection?.lastImportJobId || null,
      lastSnapshotId: dashboard.connection?.lastSnapshotId || null,
      summary: {
        ...(dashboard.connection?.summary || {}),
        ...summary,
        eaConnected: true,
      },
    });

    const snapshot = connectionRepository.createSnapshot({
      guildId: dashboard.session.guildId,
      importJobId: null,
      leagueName: summary.leagueName,
      leagueExternalId: summary.leagueId,
      summary: {
        ...summary,
        teams: Array.isArray(selectedLeague?.teams) ? selectedLeague.teams.length : 0,
      },
      payload: selectedLeague,
    });

    const updatedConnection = connectionRepository.upsertLeagueConnection({
      guildId: dashboard.session.guildId,
      leagueName: summary.leagueName,
      leagueExternalId: summary.leagueId,
      sourceType: 'ea_dashboard',
      status: 'connected',
      lastImportJobId: dashboard.connection?.lastImportJobId || null,
      lastSnapshotId: snapshot.id,
      summary: {
        ...(dashboard.connection?.summary || {}),
        ...summary,
        teams: Array.isArray(selectedLeague?.teams) ? selectedLeague.teams.length : 0,
        eaConnected: true,
      },
    });

    connectionRepository.updateConnectSessionByToken(token, {
      selectedLeague: {
        leagueId: summary.leagueId,
        leagueName: summary.leagueName,
      },
    });

    return {
      ok: true,
      connection: updatedConnection,
      snapshot,
      message: 'League connected. Go back to Discord and run /league-status.',
    };
  } catch (error) {
    return {
      ok: false,
      code: 'league_select_failed',
      message: error?.message || 'Could not load or save that league.',
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
  saveLeagueConnectionSetup,
  submitEaRedirectUrl,
  submitEaPersona,
  selectEaLeague,
  addLeagueExportSource,
  loadDemoLeague,
  importFromExportSource,
  ingestImportedPayload,
};
