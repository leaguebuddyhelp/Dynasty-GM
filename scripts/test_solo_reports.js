#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildSoloReportSnapshot, SOLO_POSITION_ORDER } from '../src/madden/solo_reports.js';

const teams = Array.from({ length: 32 }, (_, index) => ({
  teamId: index + 1,
  cityName: `City${index + 1}`,
  displayName: `Team${index + 1}`,
}));
const offenseSlots = { QB: 1, HB: 1, FB: 1, WR: 3, TE: 1, LT: 1, LG: 1, C: 1, RG: 1, RT: 1 };
const defenseSlots = { LE: 1, RE: 1, DT: 2, LOLB: 1, MLB: 1, ROLB: 1, CB: 2, FS: 1, SS: 1 };
let rosterId = 1;
const rosterInfoList = [];
for (const [position, count] of Object.entries({ ...offenseSlots, ...defenseSlots, K: 1, P: 1 })) {
  for (let index = 0; index < count * 2; index += 1) {
    rosterInfoList.push({
      rosterId: rosterId++,
      firstName: position,
      lastName: `Player${index}`,
      position,
      playerBestOvr: 70 + index,
      kickReturnRating: position === 'HB' || position === 'WR' ? 80 - index : undefined,
    });
  }
}
const snapshot = {
  syncId: 'snapshot-1',
  syncedAt: '2026-11-10T00:00:00.000Z',
  leagueId: 'league-1',
  currentWeek: 3,
  teams: { leagueTeamInfoList: teams },
  rosters: { teams: { '1': { rosterInfoList } } },
};
const report = buildSoloReportSnapshot(snapshot);
assert.equal(report.teamOveralls.length, 32);
assert.equal(report.teamOveralls.filter((team) => team.complete).length, 1);
assert.equal(report.teamOveralls[0].teamId, '1');
assert.equal(
  Math.abs(report.teamOveralls[0].total - (
    report.teamOveralls[0].offense * 0.45
    + report.teamOveralls[0].defense * 0.45
    + report.teamOveralls[0].specialTeams * 0.1
  )) < 1e-10,
  true,
);
assert.deepEqual(Object.keys(report.leaderboards), SOLO_POSITION_ORDER);
assert.equal(report.leaderboards.QB.length, 2);
assert.equal(report.leaderboards.QB[0].ovr > report.leaderboards.QB[1].ovr, true);
assert.equal(report.sourceValidation.teamCount, 32);
console.log('PASS 32-team output, configured team formula, and 21 distinct positional leaderboards');
