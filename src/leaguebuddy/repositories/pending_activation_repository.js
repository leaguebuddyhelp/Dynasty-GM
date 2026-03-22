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
  // Debug: log when claims store is loaded
  try {
    if (store && store.claims) {
      const claimCodes = Object.values(store.claims).map(c => c.claimCode);
      console.log('[pending_activation_repository] loadStore: loaded claims:', claimCodes);
    } else {
      console.log('[pending_activation_repository] loadStore: no claims found');
    }
  } catch (e) {
    console.log('[pending_activation_repository] loadStore: error logging claims', e);
  }
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
  const normalized = String(claimCode).trim().toUpperCase();
  const claims = listClaims();
  let found = null;
  for (const claim of claims) {
    const claimCodeRaw = claim?.claimCode;
    const claimCodeNorm = String(claimCodeRaw || '').toUpperCase();
    console.log('[getClaimByCode] Comparing:', {
      input: { value: claimCode, normalized, type: typeof claimCode },
      claim: { value: claimCodeRaw, normalized: claimCodeNorm, type: typeof claimCodeRaw }
    });
    if (claimCodeNorm === normalized) {
      found = claim;
      break;
    }
  }
  // Debug: log claim code lookup result
  console.log('[pending_activation_repository] getClaimByCode:', claimCode, 'normalized:', normalized, 'found:', !!found);
  return found;
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
  // Debug: log payment reference lookup
  console.log('[pending_activation_repository] getClaimByPaymentReference:', paymentReference, 'normalized:', normalized, 'found:', !!found);
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
