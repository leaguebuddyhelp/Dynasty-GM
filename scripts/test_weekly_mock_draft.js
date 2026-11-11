import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getMaddenConfigPath, getMaddenLeagueSnapshotPath } from '../src/leaguebuddy/paths.js';
import { saveGuildMaddenConfig } from '../src/shared/madden_guild_config.js';
import { loadMaddenDraftClassArray } from '../src/shared/madden_draft_class_files.js';
import { getNewlyCompletedMockWeek, publishWeeklyMockDraft } from '../src/madden/weekly_mock_draft.js';
import { execute as mockDraft } from '../src/madden/coach/mockdraft.js';

if (!process.env.LB_DATA_ROOT) throw new Error('Set LB_DATA_ROOT to an isolated test directory.');
const leagueId = 'weekly-mock-test';
const guildId = 'weekly-mock-guild';
const teams = Array.from({ length: 32 }, (_, index) => ({
  teamId: index + 1, cityName: `City${index + 1}`, nickName: `Club${index + 1}`,
}));
const snapshot = {
  leagueId, syncId: 'week1', currentWeek: 2,
  info: { careerHubInfo: { seasonInfo: { calendarYear: 2025, seasonYear: 0, seasonWeekType: 1 } } },
  teams: { leagueTeamInfoList: teams },
  standings: { teamStandingInfoList: teams.map((team) => ({ teamId: team.teamId, totalWins: 0, totalLosses: 1 })) },
  rosters: { teams: {} },
  weeklyStats: [{
    stage: 1, weekIndex: 0,
    passing: { playerPassingStatInfoList: [{ rosterId: 1, teamId: 1, passAtt: 30, passYds: 200 }] },
  }],
};
fs.mkdirSync(path.dirname(getMaddenConfigPath()), { recursive: true });
fs.writeFileSync(getMaddenConfigPath(), JSON.stringify({ guilds: { [guildId]: leagueId } }));
fs.mkdirSync(path.dirname(getMaddenLeagueSnapshotPath(leagueId)), { recursive: true });
fs.writeFileSync(getMaddenLeagueSnapshotPath(leagueId), JSON.stringify(snapshot));
saveGuildMaddenConfig(guildId, { compat: { maddenChannelMap: { 'Mock Draft': 'mock-channel' } } });

let commandPayload;
await mockDraft({ guildId, user: { id: 'operator' }, deferred: true, editReply: async (value) => { commandPayload = value; } });
assert.ok(commandPayload.embeds?.length, 'First-year /mockdraft should render');
const board = loadMaddenDraftClassArray('CUS01');
const mockDescription = commandPayload.embeds[0].toJSON().description;
assert.ok(board.some((prospect) => mockDescription.includes(prospect.name)), 'Mock picks must come from the supplied CUS01 class');
assert.equal(mockDescription.split('\n').length, 32);
const secondSeason = structuredClone(snapshot);
secondSeason.info.careerHubInfo.seasonInfo.seasonYear = 1;
secondSeason.info.careerHubInfo.seasonInfo.calendarYear = 2026;
fs.writeFileSync(getMaddenLeagueSnapshotPath(leagueId), JSON.stringify(secondSeason));
await mockDraft({ guildId, user: { id: 'operator' }, deferred: true, editReply: async (value) => { commandPayload = value; } });
const secondBoard = loadMaddenDraftClassArray('CUS02');
assert.ok(secondBoard.some((prospect) => commandPayload.embeds[0].toJSON().description.includes(prospect.name)));
fs.writeFileSync(getMaddenLeagueSnapshotPath(leagueId), JSON.stringify(snapshot));

const emptyPrevious = { ...snapshot, weeklyStats: [] };
assert.equal(getNewlyCompletedMockWeek(snapshot, null), 1);
assert.equal(getNewlyCompletedMockWeek(snapshot, emptyPrevious), 1);
assert.equal(getNewlyCompletedMockWeek(snapshot, snapshot), 1);
assert.equal(getNewlyCompletedMockWeek(secondSeason, snapshot), 1);
assert.equal(getNewlyCompletedMockWeek(emptyPrevious, null), null);
const sent = [];
let failSend = true;
const channel = { isTextBased: () => true, send: async (payload) => {
  if (failSend) {
    failSend = false;
    throw new Error('Simulated Discord outage');
  }
  sent.push(payload);
  return { id: `message-${sent.length}` };
} };
const client = { channels: { fetch: async () => channel } };
await assert.rejects(publishWeeklyMockDraft({ client, guildId, snapshot, previousSnapshot: emptyPrevious }), /Simulated Discord outage/);
const first = await publishWeeklyMockDraft({ client, guildId, snapshot, previousSnapshot: snapshot });
assert.equal(first.posted, true);
assert.equal(first.weekNumber, 1);
assert.ok(board.some((prospect) => sent[0].embeds[0].toJSON().description.includes(prospect.name)));
const repeat = await publishWeeklyMockDraft({ client, guildId, snapshot, previousSnapshot: snapshot });
assert.equal(repeat.duplicate, true);
assert.equal(sent.length, 1);
const weekTwo = structuredClone(snapshot);
weekTwo.syncId = 'week2';
weekTwo.weeklyStats.push({ ...weekTwo.weeklyStats[0], weekIndex: 1 });
fs.writeFileSync(getMaddenLeagueSnapshotPath(leagueId), JSON.stringify(weekTwo));
assert.equal((await publishWeeklyMockDraft({ client, guildId, snapshot: weekTwo, previousSnapshot: snapshot })).weekNumber, 2);
assert.equal(sent.length, 2);

console.log('PASS first-year class mock command, automatic first week, retry, and duplicate protection');
