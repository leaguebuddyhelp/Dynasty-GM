import fs from 'node:fs/promises';
import path from 'node:path';
import { getMaddenLeaguesDir } from '../leaguebuddy/paths.js';

function historyPaths(leagueId) {
  const safeLeagueId = String(leagueId || '').trim();
  if (!safeLeagueId || safeLeagueId.includes('/') || safeLeagueId.includes('\\') || safeLeagueId === '.' || safeLeagueId === '..') {
    throw new Error('Invalid Madden league ID for sync history.');
  }
  const directory = path.join(getMaddenLeaguesDir(), 'history', safeLeagueId);
  return {
    directory,
    index: path.join(directory, 'index.json'),
  };
}

async function readIndex(indexPath) {
  try {
    const parsed = JSON.parse(await fs.readFile(indexPath, 'utf8'));
    if (!Array.isArray(parsed.records)) {
      throw new Error(`Invalid sync history index format: ${indexPath}`);
    }
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') return { version: 1, records: [] };
    throw error;
  }
}

async function atomicWrite(filePath, data) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, data, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

export function validateFranchiseSnapshot(snapshot, expectedLeagueId = null) {
  const leagueId = String(snapshot?.leagueId || '');
  const teams = snapshot?.teams?.leagueTeamInfoList;
  const teamIds = Array.isArray(teams)
    ? teams.map((team) => String(team?.teamId ?? '')).filter(Boolean)
    : [];
  const issues = [];

  if (!leagueId) issues.push('missing_league_id');
  if (expectedLeagueId && leagueId !== String(expectedLeagueId)) issues.push('league_id_mismatch');
  if (!Array.isArray(teams) || teams.length === 0) issues.push('missing_team_list');
  if (teamIds.length !== teams?.length) issues.push('missing_team_ids');
  if (new Set(teamIds).size !== teamIds.length) issues.push('duplicate_team_ids');

  return {
    valid: issues.length === 0,
    issues,
    teamCount: teamIds.length,
    has32Teams: teamIds.length === 32,
    rosterTeamCount: Object.keys(snapshot?.rosters?.teams || {}).length,
    hasStandings: Array.isArray(snapshot?.standings?.teamStandingInfoList)
      && snapshot.standings.teamStandingInfoList.length > 0,
  };
}

export async function findSyncByRequestId(leagueId, requestId) {
  if (!requestId) return null;
  const paths = historyPaths(leagueId);
  const index = await readIndex(paths.index);
  const entry = index.records.find((record) => record.requestId === String(requestId));
  if (!entry) return null;
  return entry.summary ? { ...entry.summary, duplicate: true } : null;
}

export async function loadSyncSnapshot(leagueId, syncId) {
  const paths = historyPaths(leagueId);
  return JSON.parse(await fs.readFile(path.join(paths.directory, `${String(syncId)}.json`), 'utf8'));
}

export async function persistSyncHistory({ leagueId, requestId = null, snapshot, summary }) {
  const validation = validateFranchiseSnapshot(snapshot, leagueId);
  if (!validation.valid) {
    throw new Error(`Refusing to persist invalid Madden snapshot: ${validation.issues.join(', ')}`);
  }
  const paths = historyPaths(leagueId);
  await fs.mkdir(paths.directory, { recursive: true });

  const duplicate = await findSyncByRequestId(leagueId, requestId);
  if (duplicate) return duplicate;

  const syncId = String(snapshot.syncId || '');
  if (!syncId) throw new Error('Madden sync snapshot is missing its sync ID.');
  const snapshotPath = path.join(paths.directory, `${syncId}.json`);
  await atomicWrite(snapshotPath, JSON.stringify(snapshot, null, 2));

  const index = await readIndex(paths.index);
  if (requestId && index.records.some((record) => record.requestId === String(requestId))) {
    await fs.rm(snapshotPath, { force: true });
    const existing = index.records.find((record) => record.requestId === String(requestId));
    if (!existing?.summary) {
      throw new Error(`Sync request ${requestId} was already recorded without a summary.`);
    }
    return { ...existing.summary, duplicate: true };
  }
  index.records.push({
    syncId,
    requestId: requestId ? String(requestId) : null,
    syncedAt: snapshot.syncedAt,
    season: snapshot.season ?? null,
    week: snapshot.week ?? null,
    validation,
    summary: { ...summary, syncId, syncedAt: snapshot.syncedAt, validation },
  });
  await atomicWrite(paths.index, JSON.stringify(index, null, 2));
  return null;
}

export default {
  findSyncByRequestId,
  loadSyncSnapshot,
  persistSyncHistory,
  validateFranchiseSnapshot,
};
