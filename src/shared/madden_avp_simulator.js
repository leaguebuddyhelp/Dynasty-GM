import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getMaddenDataFilePath } from '../leaguebuddy/paths.js';

const AVP_FILE = getMaddenDataFilePath('madden_avp.json');
const SIMULATION_COUNT = 1000;
const SIMULATION_DEPTH = 64;

function normalizeKey(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function prospectKey(prospect = {}) {
  const nameKey = normalizeKey(prospect.name || '');
  const posKey = String(prospect.position || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return nameKey && posKey ? `${nameKey}_${posKey}` : null;
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sortedNeeds(needs = {}) {
  return Object.keys(needs || {}).sort().reduce((acc, key) => {
    const value = needs[key];
    acc[key] = Array.isArray(value) ? [...value].sort() : value;
    return acc;
  }, {});
}

function seededRand(seedStr, salt, max) {
  const str = `${seedStr}|${salt}`;
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return max > 0 ? h % max : 0;
}

function seededFloat(seed, salt) {
  return seededRand(seed, salt, 1_000_000) / 1_000_000;
}

function percentile(sortedValues, pct) {
  if (!sortedValues.length) return null;
  const idx = Math.max(0, Math.min(sortedValues.length - 1, Math.round((sortedValues.length - 1) * pct)));
  return sortedValues[idx];
}

function buildCacheKey({ classId, draftYear, order, prospects, teamNeeds }) {
  return stableHash({
    version: 2,
    simulations: SIMULATION_COUNT,
    depth: SIMULATION_DEPTH,
    classId: String(classId || '').toLowerCase(),
    draftYear: Number(draftYear || 0),
    order: (order || []).map((slot) => ({
      name: slot?.name || '',
      nick: slot?.nick || '',
      via: slot?.via || '',
    })),
    needs: sortedNeeds(teamNeeds || {}),
    prospects: (prospects || []).slice(0, SIMULATION_DEPTH + 32).map((p) => ({
      key: prospectKey(p),
      rank: Number(p?.rank || 0),
      position: p?.position || '',
      overall: Number(p?.overall || 0),
      school: p?.school || '',
    })),
  });
}

function chooseProspect({ available, slot, pickNumber, teamNeeds, sessionContext, seed, helpers }) {
  const prospectGroup = helpers.prospectGroup;
  const findNeedsForTeam = helpers.findNeedsForTeam;
  const premiumPositionValue = helpers.premiumPositionValue;
  const strengthVerdict = helpers.strengthVerdict;
  const needs = findNeedsForTeam(slot?.name, teamNeeds || {}, slot?.nick);
  const needSet = new Set((needs || []).slice(0, 4));
  const window = Math.min(available.length, pickNumber <= 8 ? 24 : pickNumber <= 20 ? 32 : 42);
  const candidates = [];

  for (let idx = 0; idx < window; idx += 1) {
    const prospect = available[idx];
    const group = prospectGroup(prospect);
    const overall = Number(prospect?.overall || 0);
    const needRank = needs.indexOf(group);
    const premium = premiumPositionValue(group);
    const boardRank = Number(prospect?.rank || idx + 1);
    const boardPenalty = idx * 5.4 + Math.max(0, boardRank - pickNumber) * 0.28;
    const needBonus = needRank === 0 ? 27 : needRank === 1 ? 19 : needRank === 2 ? 12 : needRank === 3 ? 7 : 0;
    const premiumBonus = premium * 2.25;
    const talentBonus = overall >= 86 ? 16 : overall >= 82 ? 10 : overall >= 78 ? 5 : 0;
    let score = boardPenalty - needBonus - premiumBonus - talentBonus;

    if (needSet.has(group)) score -= 8;
    if (['RB', 'HB', 'TE'].includes(group) && pickNumber <= 16 && !needSet.has(group)) score += 18;
    if (group === 'QB' && !needSet.has('QB')) score += pickNumber <= 12 ? 42 : 22;

    const strength = strengthVerdict(sessionContext, slot?.name, group);
    if (strength?.strong && needRank === -1) {
      score += group === 'QB' ? 70 : pickNumber <= 16 ? 32 : 18;
    }

    const volatility = 8 + Math.min(10, Math.max(0, boardRank - 1) / 4);
    score += (seededFloat(seed, `${pickNumber}|${idx}|noise`) - 0.5) * volatility;
    score += seededRand(seed, `${pickNumber}|${prospect?.name}|tie`, 1000) / 10000;
    candidates.push({ idx, score, prospect });
  }

  candidates.sort((a, b) => a.score - b.score || a.idx - b.idx);
  if (!candidates.length) return available[0] || null;
  const pool = candidates.filter((entry, idx) => idx < 7 && entry.score <= candidates[0].score + 12);
  const weights = [12, 8, 5, 3, 2, 1, 1].slice(0, pool.length);
  let roll = seededRand(seed, `${pickNumber}|pool`, weights.reduce((sum, weight) => sum + weight, 0));
  for (let idx = 0; idx < pool.length; idx += 1) {
    roll -= weights[idx];
    if (roll < 0) return pool[idx].prospect;
  }
  return pool[0]?.prospect || available[0] || null;
}

export function ensureStableMockAvpStore({ guildId, leagueId, classId, draftYear, order, prospects, teamNeeds, teamStrengths, helpers }) {
  const cacheKey = buildCacheKey({ classId, draftYear, order, prospects, teamNeeds });
  try {
    if (fs.existsSync(AVP_FILE)) {
      const existing = JSON.parse(fs.readFileSync(AVP_FILE, 'utf8'));
      if (
        existing?.source === 'mock_simulation'
        && existing?.cacheKey === cacheKey
        && Number(existing?.simulations || 0) >= SIMULATION_COUNT
        && existing?.prospects
      ) {
        return existing;
      }
    }
  } catch {
    // Regenerate below.
  }

  const prospectPool = (prospects || []).slice(0, Math.max(SIMULATION_DEPTH + 32, 96));
  const tracked = new Map();
  for (const prospect of prospectPool) {
    const key = prospectKey(prospect);
    if (key) tracked.set(key, { prospect, picks: [] });
  }

  const sessionContext = { order, teamNeeds, teamStrengths };
  const baseSeed = `${leagueId || guildId || 'league'}|${classId}|${draftYear}|${cacheKey}`;
  for (let sim = 0; sim < SIMULATION_COUNT; sim += 1) {
    const available = prospectPool.map((p) => ({ ...p }));
    const simSeed = `${baseSeed}|sim_${sim}`;
    for (let pickNumber = 1; pickNumber <= SIMULATION_DEPTH && available.length; pickNumber += 1) {
      const slot = order[(pickNumber - 1) % Math.max(1, order.length)] || order[0] || { name: 'Team' };
      const chosen = chooseProspect({ available, slot, pickNumber, teamNeeds, sessionContext, seed: simSeed, helpers });
      if (!chosen) break;
      const chosenIdx = available.findIndex((p) => p.id === chosen.id);
      if (chosenIdx >= 0) available.splice(chosenIdx, 1);
      const key = prospectKey(chosen);
      if (tracked.has(key)) tracked.get(key).picks.push(pickNumber);
    }
  }

  const prospectsOut = {};
  for (const [key, row] of tracked.entries()) {
    const picks = row.picks.slice().sort((a, b) => a - b);
    const boardRank = Number(row.prospect?.rank || 999);
    const avp = picks.length
      ? picks.reduce((sum, value) => sum + value, 0) / picks.length
      : Math.max(boardRank, SIMULATION_DEPTH + 1);
    prospectsOut[key] = {
      name: row.prospect?.name || 'Unknown',
      position: row.prospect?.position || '',
      school: row.prospect?.school || '',
      boardRank,
      avp: Number(avp.toFixed(1)),
      medianPick: picks.length ? percentile(picks, 0.5) : null,
      p10: picks.length ? percentile(picks, 0.1) : null,
      p90: picks.length ? percentile(picks, 0.9) : null,
      samples: picks.length,
      source: 'mock_simulation',
    };
  }

  const store = {
    generatedAt: Date.now(),
    source: 'mock_simulation',
    cacheKey,
    classId,
    draftYear,
    simulations: SIMULATION_COUNT,
    depth: SIMULATION_DEPTH,
    note: 'Stable AVP generated from 1000 deterministic mock draft simulations. Regenerates only when class/order/needs/board cache key changes.',
    prospects: prospectsOut,
  };
  fs.mkdirSync(path.dirname(AVP_FILE), { recursive: true });
  fs.writeFileSync(AVP_FILE, JSON.stringify(store, null, 2));
  console.log('[madden-avp] generated stable mock simulation AVP', {
    classId,
    draftYear,
    simulations: SIMULATION_COUNT,
    prospects: Object.keys(prospectsOut).length,
    cacheKey,
  });
  return store;
}
