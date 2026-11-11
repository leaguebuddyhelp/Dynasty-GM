import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { getMaddenDataFilePath } from '../src/leaguebuddy/paths.js';
import { saveGuildMaddenConfig } from '../src/shared/madden_guild_config.js';
import { publishWeeklyAwards } from '../src/madden/awards.js';
import { readWeeklyAwardResults } from '../src/madden/progression.js';

saveGuildMaddenConfig('awards-guild', {
  status: 'complete',
  compat: { maddenChannelMap: { Awards: 'awards-channel' } },
});

const sent = [];
let shouldFail = false;
const client = {
  channels: {
    fetch: async (id) => {
      assert.equal(id, 'awards-channel');
      return {
        isTextBased: () => true,
        send: async (payload) => {
          if (shouldFail) throw new Error('Discord send failed');
          sent.push(payload);
          return { id: `message-${sent.length}` };
        },
      };
    },
  },
};

function week(index, yards = 320) {
  return {
    stage: 1,
    weekIndex: index,
    passing: {
      playerPassingStatInfoList: [{
        rosterId: `player-${index}`, teamId: 1, position: 'QB',
        firstName: 'Test', lastName: 'Quarterback',
        passYds: yards, passTDs: 3, passInts: 0,
      }],
    },
  };
}

function snapshot({ year = 2026, currentWeek = 2, weeklyStats = [week(0)], weekType = 1 } = {}) {
  return {
    leagueId: 'award-league',
    syncId: 'sync-1',
    currentWeek,
    info: { careerHubInfo: { seasonInfo: { calendarYear: year, seasonWeekType: weekType } } },
    teams: { leagueTeamInfoList: [{ teamId: 1, cityName: 'Test', nickName: 'Team', divisionName: 'AFC East' }] },
    rosters: { teams: {} },
    weeklyStats,
  };
}

const publish = (data) => publishWeeklyAwards({ client, guildId: 'awards-guild', snapshot: data });
assert.equal((await publish(snapshot({ currentWeek: 1 }))).posted, false);
assert.equal((await publish(snapshot({ weekType: 0 }))).posted, false);
assert.equal((await publish(snapshot({ weeklyStats: [] }))).posted, false);

const first = await publish(snapshot({ weeklyStats: [week(0), week(1, 900)] }));
assert.equal(first.posted, true);
assert.equal(first.weekNumber, 1);
assert.ok(readWeeklyAwardResults('award-league', 1, 'year_2026').afc_offense);
assert.deepEqual(readWeeklyAwardResults('award-league', 1, 'year_2027'), {});
assert.deepEqual(readWeeklyAwardResults('award-league', 2, 'year_2026'), {});
assert.equal(sent.length, 1);
const firstEmbed = sent[0].embeds[0].toJSON();
assert.match(firstEmbed.title, /Week 1/);
assert.match(JSON.stringify(firstEmbed.fields), /320/);
assert.doesNotMatch(JSON.stringify(firstEmbed.fields), /900/);
assert.equal((await publish(snapshot())).duplicate, true);
assert.equal(sent.length, 1);

const secondSnapshot = snapshot({ currentWeek: 3, weeklyStats: [week(0), week(1)] });
shouldFail = true;
await assert.rejects(() => publish(secondSnapshot), /Discord send failed/);
shouldFail = false;
const [second, concurrent] = await Promise.all([publish(secondSnapshot), publish(secondSnapshot)]);
assert.equal(second.posted, true);
assert.equal(concurrent.messageId, second.messageId);
assert.equal(sent.length, 2);
assert.equal((await publish(secondSnapshot)).duplicate, true);

const wildCard = { ...week(18, 455), stage: 2 };
const playoffSnapshot = snapshot({ currentWeek: 20, weekType: 2, weeklyStats: [week(18, 900), wildCard] });
const playoff = await publish(playoffSnapshot);
assert.equal(playoff.posted, true);
assert.equal(playoff.weekNumber, 19);
const playoffEmbed = sent.at(-1).embeds[0].toJSON();
assert.match(playoffEmbed.title, /Week 19.*Playoffs/);
assert.match(JSON.stringify(playoffEmbed.fields), /455/);
assert.doesNotMatch(JSON.stringify(playoffEmbed.fields), /900|Rookie of the Week/);
assert.equal((await publish(playoffSnapshot)).duplicate, true);
const unfinished = snapshot({ currentWeek: 19, weekType: 2, weeklyStats: [wildCard] });
assert.equal((await publish(unfinished)).posted, false);

const superBowl = { ...week(22, 400), stage: 2 };
const offseason = snapshot({ currentWeek: 0, weekType: 8, weeklyStats: [superBowl] });
offseason.schedule = { schedules: [{ stageIndex: 2, weekIndex: 22, homeScore: 0, awayScore: 0, status: 1 }] };
assert.equal((await publish(offseason)).posted, false);
offseason.schedule.schedules[0] = { stageIndex: 2, weekIndex: 22, homeScore: 27, awayScore: 14, status: 2 };
const final = await publish(offseason);
assert.equal(final.posted, true);
assert.equal(final.weekNumber, 23);
assert.match(sent.at(-1).embeds[0].toJSON().title, /Week 23.*Playoffs/);
assert.equal((await publish(offseason)).duplicate, true);

const nextYear = await publish(snapshot({ year: 2027 }));
assert.equal(nextYear.posted, true);
assert.equal(sent.length, 5);
const saved = JSON.parse(await fs.readFile(getMaddenDataFilePath('awards.json'), 'utf8'));
assert.ok(saved['award-league']['1']);
assert.equal(saved['award-league']['2'], undefined);

saveGuildMaddenConfig('no-awards-guild', { compat: { maddenChannelMap: {} } });
const missing = await publishWeeklyAwards({ client, guildId: 'no-awards-guild', snapshot: snapshot() });
assert.equal(missing.posted, false);
assert.match(missing.reason, /channel/i);
console.log('PASS weekly awards timing, deduplication, retry, season rollover, and publication');
