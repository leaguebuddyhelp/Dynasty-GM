#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { persistSyncHistory, findSyncByRequestId, validateFranchiseSnapshot } from '../src/madden/madden_sync_history.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'leaguebuddy-sync-history-'));
const previousDataRoot = process.env.LB_DATA_ROOT;
process.env.LB_DATA_ROOT = root;

try {
  const teams = Array.from({ length: 32 }, (_, index) => ({ teamId: index + 1 }));
  const snapshot = {
    syncId: 'sync-1',
    syncedAt: '2026-11-10T00:00:00.000Z',
    leagueId: 'league-1',
    season: 1,
    week: 2,
    teams: { leagueTeamInfoList: teams },
    standings: { teamStandingInfoList: [] },
    rosters: { teams: {} },
  };
  assert.deepEqual(validateFranchiseSnapshot(snapshot).valid, true);
  assert.equal(validateFranchiseSnapshot({ ...snapshot, teams: { leagueTeamInfoList: teams.slice(1) } }).has32Teams, false);

  const summary = { leagueId: 'league-1', teamsCount: 32 };
  assert.equal(await persistSyncHistory({
    leagueId: 'league-1',
    requestId: 'guild-1:interaction-1',
    snapshot,
    summary,
  }), null);
  const duplicate = await findSyncByRequestId('league-1', 'guild-1:interaction-1');
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.syncId, 'sync-1');

  const archivePath = path.join(root, 'madden', 'leagues', 'history', 'league-1', 'sync-1.json');
  assert.equal(JSON.parse(await fs.readFile(archivePath, 'utf8')).syncId, 'sync-1');
  console.log('PASS snapshot validation, immutable history, and request deduplication');
} finally {
  if (previousDataRoot === undefined) delete process.env.LB_DATA_ROOT;
  else process.env.LB_DATA_ROOT = previousDataRoot;
  await fs.rm(root, { recursive: true, force: true });
}
