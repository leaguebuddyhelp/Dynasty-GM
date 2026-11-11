import assert from 'node:assert/strict';
import { buildAllProEmbeds, buildAllProTeams, buildTop100Page, calculateSeasonTop100, publishTop100Boards } from '../src/madden/top100_boards.js';
import { saveGuildMaddenConfig } from '../src/shared/madden_guild_config.js';
import { computeWeeklyList } from '../src/madden/top_players.js';

const weekly = Array.from({ length: 100 }, (_, index) => ({
  id: `player-${index}`, name: `Player ${index}`, position: index < 3 ? 'QB' : 'WR',
  team: 'Atlanta Falcons', grade: 99 - index * 0.3,
}));
const report = { leagueId: 'test', seasonKey: 'year_2026', latestWeek: 0, weeks: { 0: weekly } };
const first = buildTop100Page(report, 'weekly', 0);
assert.match(first.embeds[0].toJSON().footer.text, /Page 1\/10/);
assert.equal(first.components[0].toJSON().components[0].disabled, true);
assert.equal(first.components[0].toJSON().components[1].disabled, false);
assert.match(buildTop100Page(report, 'weekly', 9).embeds[0].toJSON().description, /100\. Player 99/);
assert.equal(buildTop100Page(report, 'weekly', 9).components[0].toJSON().components[1].disabled, true);
assert.throws(() => buildTop100Page(report, 'weekly', 10), /Invalid/);
const fullSeason = Object.fromEntries(Array.from({ length: 18 }, (_, week) => [week, weekly]));
const yearly = calculateSeasonTop100(fullSeason);
assert.equal(yearly.length, 100);
assert.equal(yearly[0].seasonGrade, 99);
assert.equal(yearly[0].appearances, 18);
assert.equal(buildAllProTeams(yearly).find((slot) => slot.position === 'QB').second.id, 'player-1');
assert.equal(buildAllProTeams(yearly).find((slot) => slot.position === 'K').first, null);
const allProCandidates = [
  ...['WR', 'CB'].flatMap((position) => Array.from({ length: 5 }, (_, index) => ({
    id: `${position}-${index}`, name: `${position} ${index}`, position, team: 'Atlanta Falcons',
    seasonGrade: 90 - index, appearances: 18,
  }))),
  { id: 'fb', name: 'Fullback', position: 'FB', team: 'Atlanta Falcons', seasonGrade: 99, appearances: 18 },
];
const allPro = buildAllProTeams(allProCandidates);
assert.ok(!allPro.some((slot) => slot.position === 'FB'));
for (const position of ['WR', 'CB']) {
  const slots = allPro.filter((slot) => slot.position === position);
  assert.equal(slots.length, 2);
  assert.deepEqual(slots.map((slot) => slot.first.id), [`${position}-0`, `${position}-1`]);
  assert.deepEqual(slots.map((slot) => slot.second.id), [`${position}-2`, `${position}-3`]);
  const short = buildAllProTeams(allProCandidates.filter((player) => player.position !== position || player.id === `${position}-0`))
    .filter((slot) => slot.position === position);
  assert.equal(short[0].first.id, `${position}-0`);
  assert.equal(short[1].first, null);
  assert.ok(short.every((slot) => slot.second === null));
}
for (const embed of buildAllProEmbeds({ seasonKey: 'year_2026', seasonTop100: allProCandidates })) {
  const text = embed.toJSON().description;
  assert.equal((text.match(/\*\*WR\*\*/g) || []).length, 2);
  assert.equal((text.match(/\*\*CB\*\*/g) || []).length, 2);
  assert.doesNotMatch(text, /\*\*FB\*\*/);
}
const selectionPool = [
  ...Array.from({ length: 100 }, (_, index) => ({ id: `high-${index}`, name: `High ${index}`, position: 'QB', grade: 99 - index * 0.01 })),
  ...['WR', 'CB'].flatMap((position) => Array.from({ length: 4 }, (_, index) => ({
    id: `${position}-reserved-${index}`, name: `${position} ${index}`, position, grade: 60 - index,
  }))),
];
const reserved = calculateSeasonTop100({ 0: selectionPool });
for (const position of ['WR', 'CB']) {
  assert.equal(reserved.filter((player) => player.position === position).length, 4);
}
const fallback = calculateSeasonTop100({ 0: [weekly[0]], 1: [weekly[1]], 2: [weekly[1]] });
assert.equal(fallback[0].id, 'player-1', 'Repeated appearances should be rewarded');
assert.equal((await publishTop100Boards({ client: {}, guildId: 'guild', snapshot: { leagueId: 'league', info: { careerHubInfo: { seasonInfo: { seasonWeekType: 0 } } } } })).posted, false);
const sent = [];
const channels = new Map();
for (const id of ['weekly', 'yearly', 'allpro']) {
  const messages = new Map();
  const channel = {
    id, client: { user: { id: 'bot' } }, isTextBased: () => true,
    messages: {
      fetch: async (idOrOptions) => {
        if (typeof idOrOptions === 'object') return { find: () => null };
        if (!messages.has(idOrOptions)) throw Object.assign(new Error('Unknown message'), { code: 10008 });
        return messages.get(idOrOptions);
      },
      fetchPinned: async () => ({ find: () => null }),
    },
    send: async (payload) => {
      const message = {
        id: `${id}-${messages.size + 1}`, author: { id: 'bot' }, pinned: false, payload,
        pin: async () => { message.pinned = true; },
        edit: async (next) => { message.payload = next; },
      };
      sent.push(message);
      messages.set(message.id, message);
      return message;
    },
  };
  channels.set(id, channel);
}
saveGuildMaddenConfig('top100-guild', { compat: { maddenChannelMap: {
  'Weekly Top 100': 'weekly', 'Yearly Top 100': 'yearly', 'All-Pro Teams': 'allpro',
} } });
const client = { channels: { fetch: async (id) => channels.get(id) } };
const makeWeek = (weekIndex) => ({
  stage: 1, weekIndex,
  passing: { playerPassingStatInfoList: [{
    rosterId: 'qb', teamId: 1, position: 'QB', firstName: 'Test', lastName: 'Passer',
    passAtt: 30, passComp: 24, passYds: 300, passTDs: 3, passInts: 0,
  }] },
});
const snapshot = {
  leagueId: 'top100-test', currentWeek: 2,
  info: { careerHubInfo: { seasonInfo: { calendarYear: 2026, seasonWeekType: 1 } } },
  teams: { leagueTeamInfoList: [{ teamId: 1, cityName: 'Atlanta', nickName: 'Falcons' }] },
  rosters: { teams: { 1: { rosterInfoList: [{ rosterId: 'qb', firstName: 'Test', lastName: 'Passer', position: 'QB', playerBestOvr: 75 }] } } },
  weeklyStats: [makeWeek(0)],
};
const specialSnapshot = structuredClone(snapshot);
specialSnapshot.rosters.teams[1].rosterInfoList.push(
  { rosterId: 'k', position: 'K', firstName: 'Test', lastName: 'Kicker', playerBestOvr: 75 },
  { rosterId: 'p', position: 'P', firstName: 'Test', lastName: 'Punter', playerBestOvr: 75 },
  ...['LT', 'LG', 'C', 'RG', 'RT'].map((position) => ({ rosterId: `ol-${position}`, position, firstName: 'Test', lastName: position, playerBestOvr: 75 })),
  { rosterId: 'injured-lt', position: 'LT', firstName: 'Injured', lastName: 'Starter', playerBestOvr: 99, injuryLength: 3 },
);
specialSnapshot.weeklyStats[0].kicking = { playerKickingStatInfoList: [{ rosterId: 'k', teamId: 1, position: 'K', fGAtt: 2, fGMade: 2, fGLongest: 51 }] };
specialSnapshot.weeklyStats[0].punting = { playerPuntingStatInfoList: [{ rosterId: 'p', teamId: 1, position: 'P', puntAtt: 3, puntYds: 135, puntsIn20: 2 }] };
const specialResults = computeWeeklyList(specialSnapshot, 0).top100;
for (const position of ['K', 'P', 'LT', 'LG', 'C', 'RG', 'RT']) {
  assert.ok(specialResults.some((player) => player.position === position), `Missing ${position} from weekly grading`);
}
assert.ok(!specialResults.some((player) => player.name === 'Injured Starter'));
const missingEvidence = structuredClone(specialSnapshot);
delete missingEvidence.weeklyStats[0].kicking.playerKickingStatInfoList[0].fGMade;
delete missingEvidence.weeklyStats[0].punting.playerPuntingStatInfoList[0].puntYds;
missingEvidence.weeklyStats[0].passing.playerPassingStatInfoList[0].passAtt = 0;
const missingResults = computeWeeklyList(missingEvidence, 0).top100;
assert.ok(!missingResults.some((player) => ['K', 'P', 'LT', 'LG', 'C', 'RG', 'RT'].includes(player.position)));

const largeSnapshot = structuredClone(snapshot);
largeSnapshot.rosters.teams = {};
largeSnapshot.teams.leagueTeamInfoList = [];
const largeWeek = { stage: 1, weekIndex: 0, passing: { playerPassingStatInfoList: [] },
  rushing: { playerRushingStatInfoList: [] }, receiving: { playerReceivingStatInfoList: [] },
  defense: { playerDefensiveStatInfoList: [] }, kicking: { playerKickingStatInfoList: [] },
  punting: { playerPuntingStatInfoList: [] } };
for (let teamId = 1; teamId <= 6; teamId++) {
  largeSnapshot.teams.leagueTeamInfoList.push({ teamId, cityName: `Team ${teamId}`, nickName: 'Test' });
  const rosterInfoList = [];
  largeSnapshot.rosters.teams[teamId] = { rosterInfoList };
  const positions = ['QB', 'HB', 'HB', 'WR', 'WR', 'WR', 'WR', 'TE', 'LE', 'RE', 'DT', 'MLB', 'MLB', 'CB', 'CB', 'CB', 'FS', 'SS', 'LT', 'LG', 'C', 'RG', 'RT', 'K', 'P'];
  positions.forEach((position, index) => {
    const player = { rosterId: `${teamId}-${index}`, teamId, position, firstName: `Player${teamId}`, lastName: `${position}${index}`, playerBestOvr: 75 };
    rosterInfoList.push(player);
    if (position === 'QB') largeWeek.passing.playerPassingStatInfoList.push({ ...player, passAtt: 30, passComp: 20, passYds: 250, passTDs: 2 });
    else if (position === 'HB') largeWeek.rushing.playerRushingStatInfoList.push({ ...player, rushAtt: 12, rushYds: 75, rushTDs: 1 });
    else if (['WR', 'TE'].includes(position)) largeWeek.receiving.playerReceivingStatInfoList.push({ ...player, recCatches: 6, recYds: 80, recTDs: 1 });
    else if (position === 'K') largeWeek.kicking.playerKickingStatInfoList.push({ ...player, fGAtt: 2, fGMade: 2 });
    else if (position === 'P') largeWeek.punting.playerPuntingStatInfoList.push({ ...player, puntAtt: 3, puntYds: 135 });
    else if (!['LT', 'LG', 'C', 'RG', 'RT'].includes(position)) largeWeek.defense.playerDefensiveStatInfoList.push({ ...player, defTotalTackles: 7, defSacks: 1 });
  });
}
largeSnapshot.weeklyStats = [largeWeek];
const largeList = computeWeeklyList(largeSnapshot, 0).top100;
assert.equal(largeList.length, 100);
for (const position of ['LT', 'LG', 'C', 'RG', 'RT', 'K', 'P', 'DT']) {
  assert.ok(largeList.filter((player) => player.position === position).length >= 2, `Insufficient ${position} representation`);
}
const largeSeason = calculateSeasonTop100(Object.fromEntries(Array.from({ length: 18 }, (_, week) => [week, largeList])));
for (const position of ['LT', 'LG', 'C', 'RG', 'RT', 'K', 'P', 'DT']) {
  const slot = buildAllProTeams(largeSeason).find((entry) => entry.position === position);
  assert.ok(slot.first && slot.second, `Missing All-Pro selections for ${position}`);
  assert.notEqual(slot.first.id, slot.second.id);
  assert.ok(slot.first.seasonGrade >= slot.second.seasonGrade);
}
const largeReport = { ...report, weeks: { 0: largeList } };
for (let page = 0; page < 10; page++) {
  assert.equal((buildTop100Page(largeReport, 'weekly', page).embeds[0].toJSON().description.match(/\*\*\d+\./g) || []).length, 10);
}
const publication = await publishTop100Boards({ client, guildId: 'top100-guild', snapshot });
assert.equal(publication.weekNumber, 1);
assert.equal(sent.length, 1);
assert.match(sent[0].payload.embeds[0].toJSON().footer.text, /Week 1/);
await publishTop100Boards({ client, guildId: 'top100-guild', snapshot });
assert.equal(sent.length, 1, 'Repeat sync should edit the existing board');
snapshot.currentWeek = 19;
snapshot.info.careerHubInfo.seasonInfo.seasonWeekType = 2;
const incomplete = await publishTop100Boards({ client, guildId: 'top100-guild', snapshot });
assert.equal(incomplete.seasonPosted, false);
assert.equal(incomplete.missingWeeks.length, 17);
snapshot.weeklyStats = Array.from({ length: 18 }, (_, weekIndex) => makeWeek(weekIndex));
const complete = await publishTop100Boards({ client, guildId: 'top100-guild', snapshot });
assert.equal(complete.seasonPosted, true);
assert.equal(sent.length, 3);
assert.equal(sent[2].payload.embeds.length, 2);
console.log('PASS Top 100 pagination, season scoring, and All-Pro position selection');
