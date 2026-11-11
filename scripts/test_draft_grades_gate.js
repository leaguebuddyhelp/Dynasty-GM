#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  computeDraftGrades,
  getDraftClassStateKey,
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
const rookieFlagWithExperienceSnapshot = snapshot({
  seasonInfo: { isDraftActive: false },
});
rookieFlagWithExperienceSnapshot.rosters.teams['1'].rosterInfoList = [{ yearsPro: 1, isRookie: true }];
assert.equal(isDraftReadyForGrades(rookieFlagWithExperienceSnapshot), false);
const gradeSnapshot = snapshot({ yearsPro: [0] });
gradeSnapshot.teams = { leagueTeamInfoList: [{ teamId: 1, displayName: 'Test' }] };
gradeSnapshot.rosters.teams['1'].rosterInfoList[0].playerBestOvr = 70;
const currentGrades = computeDraftGrades(gradeSnapshot);
gradeSnapshot.rosters.teams['1'].rosterInfoList.push({
  yearsPro: 1, isRookie: true, playerBestOvr: 99,
});
assert.deepEqual(computeDraftGrades(gradeSnapshot), currentGrades);
const firstClass = snapshot({ yearsPro: [0, 0] });
firstClass.rosters.teams['1'].rosterInfoList[0].rosterId = 1001;
firstClass.rosters.teams['1'].rosterInfoList[1].rosterId = 1002;
const reorderedClass = snapshot({ yearsPro: [0, 0] });
reorderedClass.rosters.teams['1'].rosterInfoList[0].rosterId = 1002;
reorderedClass.rosters.teams['1'].rosterInfoList[1].rosterId = 1001;
const secondClass = snapshot({ yearsPro: [0, 0] });
secondClass.rosters.teams['1'].rosterInfoList[0].rosterId = 2001;
secondClass.rosters.teams['1'].rosterInfoList[1].rosterId = 2002;
assert.equal(getDraftClassStateKey(firstClass), getDraftClassStateKey(reorderedClass));
assert.notEqual(getDraftClassStateKey(firstClass), getDraftClassStateKey(secondClass));
console.log('PASS draft grading identifies current rookies and ignores stale rookie flags');
