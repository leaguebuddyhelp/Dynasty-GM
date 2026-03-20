import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

import { getLeaguebuddyMaddenConnectionsPath } from '../paths.js';

const EMPTY_STORE = {
  sessions: [],
  connections: [],
  exportSources: [],
  importJobs: [],
  snapshots: [],
};

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function loadStore() {
  const filePath = getLeaguebuddyMaddenConnectionsPath();
  ensureParent(filePath);
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      sessions: Array.isArray(parsed?.sessions) ? parsed.sessions : [],
      connections: Array.isArray(parsed?.connections) ? parsed.connections : [],
      exportSources: Array.isArray(parsed?.exportSources) ? parsed.exportSources : [],
      importJobs: Array.isArray(parsed?.importJobs) ? parsed.importJobs : [],
      snapshots: Array.isArray(parsed?.snapshots) ? parsed.snapshots : [],
    };
  } catch {
    return clone(EMPTY_STORE);
  }
}

function saveStore(store) {
  const filePath = getLeaguebuddyMaddenConnectionsPath();
  ensureParent(filePath);
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2));
  return store;
}

function newId(prefix) {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

export function createConnectSession({
  guildId,
  guildName,
  createdByUserId,
  expiresAt,
}) {
  const store = loadStore();
  const session = {
    id: newId('cs'),
    token: randomBytes(18).toString('base64url'),
    guildId: String(guildId),
    guildName: guildName ? String(guildName) : null,
    createdByUserId: createdByUserId ? String(createdByUserId) : null,
    status: 'open',
    expiresAt,
    createdAt: nowIso(),
    usedAt: null,
  };
  store.sessions.push(session);
  saveStore(store);
  return clone(session);
}

export function getConnectSessionByToken(token) {
  if (!token) return null;
  const store = loadStore();
  return clone(store.sessions.find((session) => session.token === String(token)) || null);
}

export function consumeConnectSession(token) {
  if (!token) return null;
  const store = loadStore();
  const session = store.sessions.find((entry) => entry.token === String(token));
  if (!session || session.status !== 'open') return null;
  session.status = 'used';
  session.usedAt = nowIso();
  saveStore(store);
  return clone(session);
}

export function upsertLeagueConnection({
  guildId,
  leagueName,
  leagueExternalId,
  sourceType,
  status,
  lastImportJobId = null,
  lastSnapshotId = null,
  summary = null,
}) {
  const store = loadStore();
  const existing = store.connections.find((entry) => entry.guildId === String(guildId));
  const ts = nowIso();
  if (existing) {
    existing.leagueName = leagueName;
    existing.leagueExternalId = leagueExternalId;
    existing.sourceType = sourceType;
    existing.status = status;
    existing.lastImportJobId = lastImportJobId;
    existing.lastSnapshotId = lastSnapshotId;
    existing.summary = summary;
    existing.updatedAt = ts;
    saveStore(store);
    return clone(existing);
  }
  const record = {
    id: newId('lc'),
    guildId: String(guildId),
    leagueName,
    leagueExternalId,
    sourceType,
    status,
    lastImportJobId,
    lastSnapshotId,
    summary,
    createdAt: ts,
    updatedAt: ts,
  };
  store.connections.push(record);
  saveStore(store);
  return clone(record);
}

export function getLeagueConnectionByGuildId(guildId) {
  if (!guildId) return null;
  const store = loadStore();
  return clone(store.connections.find((entry) => entry.guildId === String(guildId)) || null);
}

export function getLeagueConnectionById(connectionId) {
  if (!connectionId) return null;
  const store = loadStore();
  return clone(store.connections.find((entry) => entry.id === String(connectionId)) || null);
}

export function createExportSource({
  connectionId,
  guildId,
  label,
  exportUrl,
  leagueInfo = true,
  weeklyStats = true,
  roster = true,
  extraData = false,
  autoUpdate = false,
  status = 'active',
}) {
  const store = loadStore();
  const ts = nowIso();
  const record = {
    id: newId('es'),
    connectionId: String(connectionId),
    guildId: String(guildId),
    label: label || 'Primary Export Source',
    exportUrl,
    leagueInfo: Boolean(leagueInfo),
    weeklyStats: Boolean(weeklyStats),
    roster: Boolean(roster),
    extraData: Boolean(extraData),
    autoUpdate: Boolean(autoUpdate),
    status,
    lastImportStatus: 'never',
    lastImportAt: null,
    lastImportError: null,
    createdAt: ts,
    updatedAt: ts,
  };
  store.exportSources.push(record);
  saveStore(store);
  return clone(record);
}

export function getExportSourcesByGuildId(guildId) {
  if (!guildId) return [];
  const store = loadStore();
  return clone(store.exportSources.filter((entry) => entry.guildId === String(guildId)));
}

export function getExportSourceById(exportSourceId) {
  if (!exportSourceId) return null;
  const store = loadStore();
  return clone(store.exportSources.find((entry) => entry.id === String(exportSourceId)) || null);
}

export function updateExportSource(exportSourceId, updates = {}) {
  if (!exportSourceId) return null;
  const store = loadStore();
  const source = store.exportSources.find((entry) => entry.id === String(exportSourceId));
  if (!source) return null;
  Object.assign(source, updates, { updatedAt: nowIso() });
  saveStore(store);
  return clone(source);
}

export function createImportJob({
  guildId,
  connectSessionId,
  rawPayload,
}) {
  const store = loadStore();
  const job = {
    id: newId('ij'),
    guildId: String(guildId),
    connectSessionId: connectSessionId || null,
    status: 'processing',
    rawPayload,
    errorMessage: null,
    summary: null,
    createdAt: nowIso(),
    finishedAt: null,
  };
  store.importJobs.push(job);
  saveStore(store);
  return clone(job);
}

export function finishImportJob(jobId, {
  status,
  errorMessage = null,
  summary = null,
}) {
  const store = loadStore();
  const job = store.importJobs.find((entry) => entry.id === String(jobId));
  if (!job) return null;
  job.status = status;
  job.errorMessage = errorMessage;
  job.summary = summary;
  job.finishedAt = nowIso();
  saveStore(store);
  return clone(job);
}

export function createSnapshot({
  guildId,
  importJobId,
  leagueName,
  leagueExternalId,
  summary,
  payload,
}) {
  const store = loadStore();
  const snapshot = {
    id: newId('snap'),
    guildId: String(guildId),
    importJobId,
    leagueName,
    leagueExternalId,
    summary,
    payload,
    createdAt: nowIso(),
  };
  store.snapshots.push(snapshot);
  saveStore(store);
  return clone(snapshot);
}

export function getLatestSnapshotByGuildId(guildId) {
  if (!guildId) return null;
  const store = loadStore();
  const matches = store.snapshots.filter((entry) => entry.guildId === String(guildId));
  return clone(matches.at(-1) || null);
}

export default {
  createConnectSession,
  getConnectSessionByToken,
  consumeConnectSession,
  upsertLeagueConnection,
  getLeagueConnectionByGuildId,
  getLeagueConnectionById,
  createExportSource,
  getExportSourcesByGuildId,
  getExportSourceById,
  updateExportSource,
  createImportJob,
  finishImportJob,
  createSnapshot,
  getLatestSnapshotByGuildId,
};
