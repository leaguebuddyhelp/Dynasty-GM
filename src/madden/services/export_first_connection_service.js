import connectionRepository from '../../leaguebuddy/repositories/madden_connection_repository.js';

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

function isLoopbackHttpUrl(value) {
  if (!safeString(value)) return false;
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
  } catch {
    return false;
  }
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

export function beginLeagueConnection({ guildId, createdByUserId }) {
  const session = connectionRepository.createConnectSession({
    guildId,
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

export function getLeagueConnectionStatus(guildId) {
  const connection = connectionRepository.getLeagueConnectionByGuildId(guildId);
  const latestSnapshot = connectionRepository.getLatestSnapshotByGuildId(guildId);
  const exportSources = connectionRepository.getExportSourcesByGuildId(guildId);
  return {
    connection,
    latestSnapshot,
    exportSources,
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
  if (!isLoopbackHttpUrl(normalizedUrl)) {
    return {
      ok: false,
      code: 'invalid_export_url',
      message: 'Export URL must be an http://127.0.0.1 or http://localhost URL.',
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
  getLeagueConnectionStatus,
  saveLeagueConnectionSetup,
  addLeagueExportSource,
  loadDemoLeague,
  ingestImportedPayload,
};
