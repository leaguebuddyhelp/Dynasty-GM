#!/usr/bin/env node
import assert from 'node:assert/strict';
import { collectDraft, draftCsvRows } from '../src/madden/staff/draftexport.js';

const teams = [
  { teamId: 1, cityName: 'Alpha', displayName: 'Owls' },
  { teamId: 2, cityName: 'Beta', displayName: 'Bears' },
];
const previous = {
  season: 2025,
  teams: { leagueTeamInfoList: teams },
  rosters: {
    teams: {
      1: {
        rosterInfoList: [{
          rosterId: 1001,
          firstName: 'Avery',
          lastName: 'Test',
          yearsPro: 0,
          position: 'QB',
          college: 'Test, College',
          playerBestOvr: 74,
          devTrait: 1,
          draftRound: 1,
          draftPick: 7,
          overallPick: 7,
          draftTeamId: 1,
          height: 76,
          weight: 218,
          age: 21,
        }],
      },
    },
  },
};
const current = {
  season: 2025,
  teams: { leagueTeamInfoList: teams },
  rosters: {
    teams: {
      2: {
        rosterInfoList: [{
          rosterId: 1001,
          firstName: 'Avery',
          lastName: 'Test',
          yearsPro: 0,
          position: 'QB',
          college: 'Test, College',
          playerBestOvr: 76,
          devTrait: 1,
          draftRound: 1,
          draftPick: 7,
          overallPick: 7,
          draftTeamId: 1,
        }, {
          rosterId: 2002,
          firstName: 'Rookie',
          lastName: 'Unresolved',
          yearsPro: 0,
          position: 'WR',
          college: 'New College',
          playerBestOvr: 68,
          devTrait: 0,
          draftRound: 2,
          draftPick: 5,
          height: 72,
          weight: 195,
          age: 22,
        }],
      },
    },
  },
};

const draft = collectDraft([previous, current]);
assert.equal(draft.length, 2);
const tradedRookie = draft.find((player) => player.rosterId === 1001);
assert.equal(tradedRookie.draftingTeam, 'Alpha Owls');
assert.equal(tradedRookie.currentTeam, 'Beta Bears');
assert.equal(tradedRookie.overallPick, 7);
assert.equal(tradedRookie.devLabel, 'Star');

const unresolved = draft.find((player) => player.rosterId === 2002);
assert.equal(unresolved.overallPick, null);
assert.equal(unresolved.pickVerification, 'Round/pick available; overall pick unresolved');
assert.equal(unresolved.devLabel, 'Normal');

const csv = draftCsvRows(draft);
assert.match(csv, /^"Round","Pick","R\/P","Team","Player","Pos","OVR","Dev Trait","College","Height","Weight","Age"/);
assert.match(csv, /"Test, College"/);
assert.match(csv, /"Alpha Owls"/);
assert.match(csv, /"6'4""/);
assert.doesNotMatch(csv, /Draft Grade|Roster ID|Pick Verification|Presentation ID/);
assert.equal(csv.split('\r\n').length, 3);

const released = collectDraft([previous, { ...current, rosters: { teams: {} } }]);
assert.equal(released[0].currentRosterStatus, 'Not on current roster; last seen team shown');

const otherSeason = {
  season: 2024,
  teams: { leagueTeamInfoList: teams },
  rosters: {
    teams: {
      1: {
        rosterInfoList: [{
          rosterId: 3003,
          firstName: 'Earlier',
          lastName: 'Class',
          yearsPro: 0,
          position: 'WR',
        }],
      },
    },
  },
};
const currentSeasonExport = collectDraft([otherSeason, previous, current]);
assert.equal(currentSeasonExport.length, 2);
assert.equal(currentSeasonExport.some((player) => player.rosterId === 3003), false);
console.log('PASS draft export identity, trade/current-team distinction, unresolved picks, and CSV escaping');
