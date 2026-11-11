#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  computeDraftGrades,
  getDraftClassStateKey,
  hasPostedDraftGrades,
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

const postDraftInfo = { seasonWeekType: 8, offSeasonStage: 10, isDraftActive: false, calendarYear: 2026 };
assert.equal(isDraftReadyForGrades(snapshot({ yearsPro: [0], seasonInfo: postDraftInfo })), true);
for (const weekType of [0, 1, 2, 3]) {
  assert.equal(isDraftReadyForGrades(snapshot({
    yearsPro: [0], seasonInfo: { ...postDraftInfo, seasonWeekType: weekType },
  })), false, `week type ${weekType} must not post grades`);
}
assert.equal(isDraftReadyForGrades(snapshot({
  yearsPro: [0], seasonInfo: { ...postDraftInfo, isDraftActive: true },
})), false);
assert.equal(isDraftReadyForGrades(snapshot({
  yearsPro: [0], seasonInfo: { ...postDraftInfo, offSeasonStage: 9 },
})), false);
assert.equal(isDraftReadyForGrades(snapshot({ yearsPro: [0], seasonInfo: {} })), false);
assert.equal(isDraftReadyForGrades(snapshot({ yearsPro: [1, 2, 3], seasonInfo: postDraftInfo })), false);
assert.equal(isDraftReadyForGrades(snapshot({ yearsPro: [null], seasonInfo: postDraftInfo })), false);
const rookieFlagSnapshot = snapshot({
  seasonInfo: postDraftInfo,
});
rookieFlagSnapshot.rosters.teams['1'].rosterInfoList = [{ isRookie: true }];
assert.equal(isDraftReadyForGrades(rookieFlagSnapshot), true);
const rookieFlagWithExperienceSnapshot = snapshot({
  seasonInfo: postDraftInfo,
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
const firstClass = snapshot({ yearsPro: [0, 0], seasonInfo: postDraftInfo });
firstClass.rosters.teams['1'].rosterInfoList[0].rosterId = 1001;
firstClass.rosters.teams['1'].rosterInfoList[1].rosterId = 1002;
const reorderedClass = snapshot({ yearsPro: [0, 0], seasonInfo: postDraftInfo });
reorderedClass.rosters.teams['1'].rosterInfoList[0].rosterId = 1002;
reorderedClass.rosters.teams['1'].rosterInfoList[1].rosterId = 1001;
const secondClass = snapshot({ yearsPro: [0, 0], seasonInfo: { ...postDraftInfo, calendarYear: 2027 } });
secondClass.rosters.teams['1'].rosterInfoList[0].rosterId = 2001;
secondClass.rosters.teams['1'].rosterInfoList[1].rosterId = 2002;
assert.equal(getDraftClassStateKey(firstClass), getDraftClassStateKey(reorderedClass));
assert.notEqual(getDraftClassStateKey(firstClass), getDraftClassStateKey(secondClass));
const sameYearChangedRookies = snapshot({ yearsPro: [0], seasonInfo: postDraftInfo });
assert.equal(getDraftClassStateKey(firstClass), getDraftClassStateKey(sameYearChangedRookies));
const classKey = getDraftClassStateKey(firstClass);
assert.equal(hasPostedDraftGrades({ [`${classKey}_oldfingerprint`]: { posted: true } }, sameYearChangedRookies), true);
assert.equal(hasPostedDraftGrades({ [classKey]: { posted: true, formulaVersion: 1 } }, sameYearChangedRookies), true);
assert.equal(hasPostedDraftGrades({ [classKey]: { posted: true } }, secondClass), false);
console.log('PASS draft grades exclude preseason and deduplicate by draft year');
