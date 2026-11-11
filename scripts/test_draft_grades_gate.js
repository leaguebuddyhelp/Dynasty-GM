#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  isDraftReadyForGrades,
} from '../src/madden/draft_grades_auto.js';

function snapshot({ yearsPro = [], seasonInfo = {} } = {}) {
  return {
    stage: 1,
    info: { careerHubInfo: { seasonInfo } },
    rosters: {
      teams: {
        '1': { rosterInfoList: yearsPro.map((yearsProValue) => ({ yearsPro: yearsProValue })) },
      },
    },
  };
}

assert.equal(isDraftReadyForGrades(snapshot({
  yearsPro: Array.from({ length: 224 }, () => 0),
  seasonInfo: { seasonWeekType: 1, isDraftActive: true },
})), true);
assert.equal(isDraftReadyForGrades(snapshot({
  yearsPro: [0],
  seasonInfo: { seasonWeekType: 1, isDraftActive: false },
})), true);
assert.equal(isDraftReadyForGrades(snapshot({
  yearsPro: [0],
  seasonInfo: { isDraftActive: false },
})), true);
assert.equal(isDraftReadyForGrades(snapshot({
  yearsPro: [0],
  seasonInfo: {},
})), true);
assert.equal(isDraftReadyForGrades(snapshot({
  yearsPro: [0],
  seasonInfo: { isDraftActive: true },
})), true);
assert.equal(isDraftReadyForGrades(snapshot({
  yearsPro: [1, 2, 3],
  seasonInfo: { isDraftActive: false },
})), false);
assert.equal(isDraftReadyForGrades(snapshot({
  yearsPro: [1],
  seasonInfo: { isDraftActive: true },
})), false);
assert.equal(isDraftReadyForGrades(snapshot({
  yearsPro: [null],
  seasonInfo: { isDraftActive: false },
})), false);
const rookieFlagSnapshot = snapshot({
  seasonInfo: { isDraftActive: false },
});
rookieFlagSnapshot.rosters.teams['1'].rosterInfoList = [{ isRookie: true }];
assert.equal(isDraftReadyForGrades(rookieFlagSnapshot), true);
console.log('PASS draft grades post-ready after any rookie appears and the draft is not active');
