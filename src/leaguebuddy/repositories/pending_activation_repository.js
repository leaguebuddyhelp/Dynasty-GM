import fs from 'fs';
import path from 'path';

import { getLeaguebuddyClaimsStorePath } from '../paths.js';

const STORE_FILE = getLeaguebuddyClaimsStorePath();

function nowIso() {
  return new Date().toISOString();
}

function defaultStore() {
  return {
    version: 1,
    updatedAt: nowIso(),
    claims: {},
  };
}

function safeReadJSON(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function atomicWriteJSON(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

export function loadStore() {
  const store = safeReadJSON(STORE_FILE, null);
  if (!store || typeof store !== 'object') return defaultStore();
  if (!store.claims || typeof store.claims !== 'object') store.claims = {};
  if (!store.version) store.version = 1;
  if (!store.updatedAt) store.updatedAt = nowIso();
  return store;
}

export function saveStore(store) {
  const next = store && typeof store === 'object' ? store : defaultStore();
  next.updatedAt = nowIso();
  if (!next.claims || typeof next.claims !== 'object') next.claims = {};
  atomicWriteJSON(STORE_FILE, next);
}

export function listClaims() {
  return Object.values(loadStore().claims || {});
}

export function getClaimById(claimId) {
  if (!claimId) return null;
  return loadStore().claims[String(claimId)] || null;
}

export function getClaimByCode(claimCode) {
  if (!claimCode) return null;
  const normalize = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const normalized = normalize(claimCode);
  const claims = listClaims();
  return claims.find((claim) => normalize(claim?.claimCode) === normalized) || null;
}

export function getClaimByPaymentReference(paymentReference) {
  if (!paymentReference) return null;
  const normalized = String(paymentReference).trim();
  const claims = listClaims();
  const found = claims.find((claim) => {
    if (String(claim?.paymentReference || '').trim() === normalized) return true;
    if (Array.isArray(claim?.paymentReferences)) {
      return claim.paymentReferences.some((ref) => String(ref || '').trim() === normalized);
    }
    return false;
  }) || null;
  return found;
}

export function upsertClaim(claimId, partial) {
  if (!claimId) throw new Error('Missing claimId');
  const store = loadStore();
  const key = String(claimId);
  const current = store.claims[key] && typeof store.claims[key] === 'object'
    ? store.claims[key]
    : { claimId: key, createdAt: nowIso() };

  const next = {
    ...current,
    ...partial,
    claimId: key,
    updatedAt: nowIso(),
  };

  store.claims[key] = next;
  saveStore(store);
  return next;
}

export default {
  loadStore,
  saveStore,
  listClaims,
  getClaimById,
  getClaimByCode,
  getClaimByPaymentReference,
  upsertClaim,
};
