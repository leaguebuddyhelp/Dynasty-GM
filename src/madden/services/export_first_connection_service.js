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

export function getLeagueConnectionStatus(guildId) {
  const connection = connectionRepository.getLeagueConnectionByGuildId(guildId);
  const latestSnapshot = connectionRepository.getLatestSnapshotByGuildId(guildId);
  return {
    connection,
    latestSnapshot,
  };
}

export function ingestImportedPayload({ token, rawPayload }) {
  const session = connectionRepository.getConnectSessionByToken(token);
  if (!session) {
    return { ok: false, code: 'invalid_token', message: 'This setup link is invalid.' };
  }
  if (session.status !== 'open') {
    return { ok: false, code: 'used_token', message: 'This setup link has already been used.' };
  }
  if (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now()) {
    return { ok: false, code: 'expired_token', message: 'This setup link has expired. Run /connectleague again.' };
  }

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
  const importJob = connectionRepository.createImportJob({
    guildId: session.guildId,
    connectSessionId: session.id,
    rawPayload: payload,
  });
  const snapshot = connectionRepository.createSnapshot({
    guildId: session.guildId,
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
  connectionRepository.consumeConnectSession(token);
  const connection = connectionRepository.upsertLeagueConnection({
    guildId: session.guildId,
    leagueName: summary.leagueName,
    leagueExternalId: summary.leagueExternalId,
    sourceType: 'export_import',
    status: 'connected',
    lastImportJobId: importJob.id,
    lastSnapshotId: snapshot.id,
    summary,
  });

  return {
    ok: true,
    session,
    connection,
    importJob,
    snapshot,
    summary,
  };
}

export default {
  beginLeagueConnection,
  getLeagueConnectionStatus,
  ingestImportedPayload,
};
