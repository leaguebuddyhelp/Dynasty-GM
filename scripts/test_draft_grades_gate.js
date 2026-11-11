#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  isDraftCompletionSync,
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
})), false);
assert.equal(isDraftReadyForGrades(snapshot({
  yearsPro: Array.from({ length: 32 }, () => 0),
  seasonInfo: { seasonWeekType: 3, isDraftActive: false },
})), true);
assert.equal(isDraftReadyForGrades(snapshot({
  yearsPro: Array.from({ length: 32 }, () => 0),
  seasonInfo: { seasonWeekType: 0, isDraftActive: false, isLeagueStarted: true },
})), true);
assert.equal(isDraftReadyForGrades(snapshot({
  yearsPro: Array.from({ length: 32 }, () => 0),
  seasonInfo: { seasonWeekType: 1, isDraftActive: false, isLeagueStarted: true },
})), false);
assert.equal(isDraftReadyForGrades(snapshot({
  yearsPro: Array.from({ length: 32 }, () => 0),
  seasonInfo: { seasonWeekType: 1, offSeasonStage: 1, isDraftActive: false, isLeagueStarted: true },
})), false);
assert.equal(isDraftReadyForGrades(snapshot({
  yearsPro: Array.from({ length: 31 }, () => 0),
  seasonInfo: { seasonWeekType: 3, isDraftActive: false },
})), false);
assert.equal(isDraftReadyForGrades(snapshot({
  yearsPro: Array.from({ length: 224 }, () => 0),
  seasonInfo: { seasonWeekType: 0, isDraftActive: false },
})), false);
const postDraft = snapshot({
  yearsPro: Array.from({ length: 32 }, () => 0),
  seasonInfo: { seasonWeekType: 0, isDraftActive: false, isLeagueStarted: true },
});
assert.equal(isDraftCompletionSync(null, postDraft), true);
assert.equal(isDraftCompletionSync(postDraft, postDraft), false);
console.log('PASS draft grades wait for authoritative completion or a full rookie class');
