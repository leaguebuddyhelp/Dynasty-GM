import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Collection, EmbedBuilder } from 'discord.js';
import {
  buildWeeklyProgressionRecommendations, buildOffseasonProgressionRecommendations,
  removeRookieRecapMessages, publishProgressionReports, buildProgressionCardEmbed,
} from '../src/madden/progression.js';
import { saveGuildMaddenConfig } from '../src/shared/madden_guild_config.js';
import { getMaddenDataFilePath } from '../src/leaguebuddy/paths.js';

if (!process.env.LB_DATA_ROOT) throw new Error('Run through npm test with an isolated data root.');
const rules = JSON.parse(await fs.readFile('config/madden_solo_rules.json', 'utf8')).progression;
const makePlayer = (rosterId, yearsPro, extra = {}) => ({
  rosterId, firstName: 'Test', lastName: rosterId, position: 'QB', yearsPro, playerBestOvr: 75,
  throwAccShortRating: 75, throwAccMidRating: 75, throwAccDeepRating: 75,
  playActionRating: 75, throwPowerRating: 75, awareRating: 75, ...extra,
});
const roster = [makePlayer('rookie', 0), makePlayer('young', 2), makePlayer('veteran', 7),
  makePlayer('bench', 0), makePlayer('injured', 0, { injuryLength: 4 }), makePlayer('unknown', undefined)];
function snapshot(games = 2, { mixed = false, invalidUsage = false } = {}) {
  return {
    leagueId: 'rookie-pipeline', syncId: `pipeline-${games}`, syncedAt: new Date().toISOString(), currentWeek: games + 1,
    info: { careerHubInfo: { seasonInfo: { calendarYear: 2026, seasonWeekType: 1 } } },
    teams: { leagueTeamInfoList: [{ teamId: 1, cityName: 'Arizona', nickName: 'Cardinals' }] },
    rosters: { teams: { 1: { rosterInfoList: structuredClone(roster) } } },
    schedule: { schedules: Array.from({ length: games }, (_, weekIndex) => ({ stageIndex: 1, weekIndex, status: 2, homeTeamId: 1, awayTeamId: 2 })) },
    weeklyStats: Array.from({ length: games }, (_, weekIndex) => ({
      weekIndex, stage: 1,
      passing: { playerPassingStatInfoList: ['rookie', 'young', 'veteran', 'unknown'].map((id) => ({
        rosterId: id, teamId: 1, position: 'QB', passAtt: invalidUsage ? 0 : 30, passComp: 24,
        passYds: mixed && weekIndex === 0 ? 100 : 400, passTDs: mixed && weekIndex === 0 ? 0 : 4,
        passInts: mixed && weekIndex === 0 ? 2 : 0, passLongest: 55,
      })) },
    })),
  };
}
const current = snapshot();
const result = buildWeeklyProgressionRecommendations(current, { weekIndex: 1, rules });
const find = (id, record = result) => record.recommendations.find((item) => item.playerKey === `roster:${id}`);
const rookie = find('rookie'), young = find('young'), veteran = find('veteran');
const pairedPoints = (yearsPro) => {
  const paired = structuredClone(current);
  paired.rosters.teams[1].rosterInfoList[0].yearsPro = yearsPro;
  return find('rookie', buildWeeklyProgressionRecommendations(paired, { weekIndex: 1, rules })).totalAttributePoints;
};
assert.ok(pairedPoints(0) > pairedPoints(2));
assert.ok(pairedPoints(2) > pairedPoints(7), 'Compare identical player evidence and attribute rotation');
assert.ok(rookie.selectionScore > young.selectionScore && young.selectionScore > veteran.selectionScore);
assert.equal(rookie.changeContext.rookieMomentum, true);
assert.equal(veteran.changeContext.eliteMomentum, true);
assert.ok(rookie.attributes.every((attribute) => attribute.points <= 5 && attribute.targetValue <= 99));
assert.ok(!find('unknown').changeContext.youngMomentum);
assert.ok(!find('unknown').changeContext.rookieMomentum);
assert.equal(result.rookieMonitoring.length, 3);
assert.equal(result.rookieMonitoring.find((item) => item.playerKey === 'roster:bench').status, 'no_current_stats');
assert.equal(result.rookieMonitoring.find((item) => item.playerKey === 'roster:injured').status, 'injured');
assert.ok(!find('bench') && !find('injured'));
for (const yearsPro of [-1, 0.5, false, null, 'unknown']) {
  const invalid = snapshot();
  invalid.rosters.teams[1].rosterInfoList[0].yearsPro = yearsPro;
  const tested = buildWeeklyProgressionRecommendations(invalid, { weekIndex: 1, rules });
  assert.ok(!find('rookie', tested).changeContext.rookieMomentum);
  assert.ok(!tested.rookieMonitoring.some((item) => item.playerKey === 'roster:rookie'));
}
for (const target of [snapshot(1), snapshot(2, { mixed: true })]) {
  const tested = buildWeeklyProgressionRecommendations(target, { weekIndex: target.currentWeek - 2, rules });
  const entry = find('rookie', tested);
  if (entry) assert.ok(!entry.changeContext.rookieMomentum && !entry.changeContext.eliteMomentum);
}
assert.equal(buildWeeklyProgressionRecommendations(snapshot(2, { invalidUsage: true }), { weekIndex: 1, rules }).recommendations.length, 0);
const crowdedRules = structuredClone(rules);
crowdedRules.weekly.maximumRecommendations = 1;
assert.equal(buildWeeklyProgressionRecommendations(current, { weekIndex: 1, rules: crowdedRules }).recommendations[0].playerKey, 'roster:rookie');
crowdedRules.weekly.maximumRecommendations = 0;
const crowded = buildWeeklyProgressionRecommendations(current, { weekIndex: 1, rules: crowdedRules });
assert.equal(crowded.rookieMonitoring.find((item) => item.playerKey === 'roster:rookie').status, 'eligible_not_selected');
assert.equal(crowded.rookieMonitoring.length, 3, 'Watch rookies even without a recommendation slot');
for (const [position, bucket, list, stats, fields] of [
  ['HB', 'rushing', 'playerRushingStatInfoList', { rushAtt: 20, rushYds: 150, rushTDs: 2 }, ['bCVRating', 'carryRating']],
  ['WR', 'receiving', 'playerReceivingStatInfoList', { recCatches: 8, recYds: 150, recTDs: 2, recLongest: 40 }, ['catchRating', 'routeRunShortRating', 'routeRunMedRating', 'routeRunDeepRating', 'specCatchRating']],
  ['CB', 'defense', 'playerDefensiveStatInfoList', { defTotalTackles: 10, defInts: 2, defPassDeflections: 3 }, ['tackleRating', 'zoneCoverRating', 'playRecRating', 'pursuitRating', 'manCoverRating']],
]) {
  const target = snapshot();
  const player = { ...makePlayer('rookie', 0), position, ...Object.fromEntries(fields.map((field) => [field, 75])) };
  target.rosters.teams[1].rosterInfoList = [player];
  for (const week of target.weeklyStats) {
    delete week.passing;
    week[bucket] = { [list]: [{ ...stats, rosterId: 'rookie', teamId: 1, position }] };
  }
  const paired = structuredClone(target);
  paired.rosters.teams[1].rosterInfoList[0].yearsPro = 7;
  const emerging = buildWeeklyProgressionRecommendations(target, { weekIndex: 1, rules }).recommendations[0];
  const established = buildWeeklyProgressionRecommendations(paired, { weekIndex: 1, rules }).recommendations[0];
  assert.equal(emerging.changeContext.rookieMomentum, true, `${position} rookie pipeline`);
  assert.ok(emerging.totalAttributePoints > established.totalAttributePoints, `${position} supported growth acceleration`);
}
// Outcomes are reversible performance trajectories, never random draft labels.
const poorGame = { passAtt: 30, passComp: 8, passYds: 65, passTDs: 0, passInts: 4 };
const averageGame = { passAtt: 30, passComp: 18, passYds: 220, passTDs: 1, passInts: 1 };
const greatGame = { passAtt: 30, passComp: 24, passYds: 400, passTDs: 4, passInts: 0 };
function evaluateRookieGames(games, metadata = { draftRound: 1 }, mutate = () => {}) {
  const past = { periods: {}, seasonAwards: {} };
  let record;
  for (let count = 1; count <= games.length; count++) {
    const target = snapshot(count);
    target.rosters.teams[1].rosterInfoList = [{ ...makePlayer('rookie', 0), ...metadata }];
    target.weeklyStats.forEach((week, index) => {
      week.passing.playerPassingStatInfoList = [{ rosterId: 'rookie', teamId: 1, position: 'QB', ...games[index] }];
    });
    mutate(target, past);
    record = buildWeeklyProgressionRecommendations(target, { weekIndex: count - 1, rules, history: past });
    past.periods[record.periodKey] = record;
  }
  return record;
}
const outcome = (record) => record.rookieMonitoring[0].performanceOutcome;
for (const count of [1, 2]) {
  const record = evaluateRookieGames(Array(count).fill(poorGame));
  assert.notEqual(outcome(record).trajectory, 'bust');
  assert.ok(!find('rookie', record), 'No premature rookie performance penalty');
}
const busted = evaluateRookieGames(Array(3).fill(poorGame));
const lateBust = evaluateRookieGames(Array(3).fill(poorGame), { draftRound: 6 });
assert.equal(outcome(busted).trajectory, 'bust');
assert.equal(outcome(busted).verifiedPoorStreak, 3);
assert.equal(find('rookie', busted).direction, 'downgrade');
assert.match(JSON.stringify(buildProgressionCardEmbed(busted, find('rookie', busted)).toJSON()), /Rookie bust trajectory/);
assert.ok(find('rookie', busted).selectionScore > find('rookie', lateBust).selectionScore);
assert.ok(find('rookie', busted).totalAttributePoints < find('rookie', lateBust).totalAttributePoints, 'Premium picks receive a stronger evidence-based penalty');
assert.equal(outcome(evaluateRookieGames(Array(3).fill(averageGame))).trajectory, 'average');
const booming = evaluateRookieGames(Array(2).fill(greatGame));
const lateBoom = evaluateRookieGames(Array(2).fill(greatGame), { draftRound: 6 });
assert.equal(outcome(booming).trajectory, 'boom');
assert.equal(find('rookie', booming).direction, 'upgrade');
assert.match(JSON.stringify(buildProgressionCardEmbed(booming, find('rookie', booming)).toJSON()), /Rookie boom trajectory/);
assert.ok(find('rookie', booming).selectionScore > find('rookie', lateBoom).selectionScore);
for (const metadata of [{}, { draftRound: 64, draftPick: 0 }, { draftRound: false }, { draftRound: 1, overallPick: 200 }]) {
  assert.equal(outcome(evaluateRookieGames(Array(3).fill(poorGame), metadata)).highPick, false);
}
assert.equal(outcome(evaluateRookieGames(Array(2).fill(greatGame), { draftYearRound: 2 })).highPick, true);
assert.equal(outcome(evaluateRookieGames(Array(2).fill(greatGame), { draftOverallPick: 5 })).highPick, true);
const recovered = evaluateRookieGames([...Array(3).fill(poorGame), greatGame, greatGame]);
assert.equal(outcome(recovered).trajectory, 'boom');
assert.equal(find('rookie', recovered).direction, 'upgrade');
const declining = evaluateRookieGames([...Array(4).fill(greatGame), ...Array(3).fill(poorGame)]);
assert.equal(outcome(declining).trajectory, 'bust');
assert.equal(find('rookie', declining).direction, 'downgrade', 'Sustained recent poor play overrides old excellent games');
for (const [metadata, mutate] of [
  [{ injuryLength: 2 }, () => {}],
  [{}, (target) => { target.weeklyStats.at(-1).passing.playerPassingStatInfoList[0].passAtt = 0; }],
  [{}, (target) => { target.schedule.schedules.at(-1).status = 1; }],
  [{}, (target, past) => { for (const record of Object.values(past.periods)) record.inactivityObservations = {}; }],
]) {
  const record = evaluateRookieGames(Array(3).fill(poorGame), metadata, mutate);
  assert.notEqual(outcome(record).trajectory, 'bust');
  assert.notEqual(find('rookie', record)?.direction, 'downgrade');
}
const capped = evaluateRookieGames(Array(8).fill(poorGame));
assert.ok(find('rookie', capped).attributes.every((attribute) => attribute.points >= -5 && attribute.targetValue >= 0));
console.log('PASS rookie boom/average/bust, draft expectations, sustained penalties, recovery, and evidence safeguards');

const history = { periods: {}, seasonAwards: {} };
for (let games = 1; games <= 6; games++) {
  const record = buildWeeklyProgressionRecommendations(snapshot(games), { weekIndex: games - 1, rules, history });
  const inactive = find('bench', record);
  assert.equal(Boolean(inactive), false, 'Missing-stat inactivity is not gameplay evidence for a rookie penalty');
  if (inactive) assert.equal(inactive.attributes[0].points, -1);
  assert.ok(!find('injured', record));
  history.periods[record.periodKey] = record;
}
const annual = buildOffseasonProgressionRecommendations(snapshot(9), { rules });
assert.equal(annual.rookieMonitoring.length, 3);
// Repeated publication preserves tracking without posting recap messages.
process.env.MADDEN_FRANCHISE_MANAGER_ROLE_ID = 'manager';
const role = { id: 'manager', mentionable: true };
const guild = { roles: { cache: new Map([['manager', role]]) }, members: { fetch: async () => ({ roles: { cache: new Map([['manager', role]]) } }) } };
let sequence = 0;
const channels = new Map();
const threads = new Collection();
const parentMessages = new Map();
const client = { user: { id: 'bot' }, channels: { fetch: async (id) => channels.get(id) } };
const lookup = (messages) => async (id) => {
  if (!messages.has(id)) throw Object.assign(new Error('Missing'), { code: 10008 });
  return messages.get(id);
};
function makeMessage(payload, messages) {
  const message = { id: `message-${++sequence}`, payload, pinned: true, author: { id: 'bot' },
    get embeds() { return (message.payload.embeds || []).map((embed) => ({ ...(embed.toJSON ? embed.toJSON() : embed), toJSON: () => embed.toJSON ? embed.toJSON() : embed })); },
    delete: async () => { messages.delete(message.id); },
    edit: async (next) => { message.payload = next; return message; }, pin: async () => {} };
  messages.set(message.id, message);
  return message;
}
const channel = {
  id: 'upgrades', guildId: 'pipeline-guild', guild, isTextBased: () => true,
  threads: { fetchActive: async () => ({ threads }), fetchArchived: async () => ({ threads: new Collection() }) },
  messages: { fetch: lookup(parentMessages) },
  send: async (payload) => {
    const message = makeMessage(payload, parentMessages);
    message.startThread = async ({ name }) => {
      const stored = new Map();
      const thread = { id: `thread-${++sequence}`, name, guildId: 'pipeline-guild', archived: false, stored,
        isThread: () => true, messages: { fetch: lookup(stored) }, send: async (next) => makeMessage(next, stored) };
      threads.set(thread.id, thread); channels.set(thread.id, thread); return thread;
    };
    return message;
  },
};
channels.set(channel.id, channel);
saveGuildMaddenConfig('pipeline-guild', { status: 'complete', compat: { maddenChannelMap: { 'Player Upgrades': 'upgrades' } } });
await publishProgressionReports({ client, guildId: 'pipeline-guild', snapshot: current });
const watchMessages = () => [...threads.values()].flatMap((thread) => [...thread.stored.values()]).filter((message) => message.payload.embeds?.some((embed) => embed.toJSON().title.includes('Rookie Pipeline')));
assert.equal(watchMessages().length, 0);
await publishProgressionReports({ client, guildId: 'pipeline-guild', snapshot: current });
assert.equal(watchMessages().length, 0);
assert.ok([...threads.values()].some((thread) => thread.stored.size), 'Normal recommendations still post');
assert.ok([...parentMessages.values()].every((message) => message.embeds.every((embed) =>
  !embed.toJSON().fields?.some((field) => field.name === 'Rookie pipeline'))));
const historyPath = getMaddenDataFilePath('progression_history/rookie-pipeline.json');
const stored = JSON.parse(await fs.readFile(historyPath, 'utf8'));
assert.equal(stored.periods.year_2026_week_2.rookieMonitoring.length, 3);
const beforeTargets = stored.periods.year_2026_week_2.recommendations.map((item) => item.attributes);
const manuallyChanged = structuredClone(current);
manuallyChanged.rosters.teams[1].rosterInfoList.forEach((player) => { player.throwAccShortRating = 95; });
await publishProgressionReports({ client, guildId: 'pipeline-guild', snapshot: manuallyChanged });
const stableWeekly = JSON.parse(await fs.readFile(historyPath, 'utf8'));
assert.deepEqual(stableWeekly.periods.year_2026_week_2.recommendations.map((item) => item.attributes), beforeTargets,
  'Repeated syncs after a manual Madden edit must not issue another boost for the same weekly evidence');
const registry = JSON.parse(await fs.readFile(getMaddenDataFilePath('progression_threads/pipeline-guild.json'), 'utf8'));
const [teamId, team] = Object.entries(registry.teams)[0];
const thread = channels.get(team.threadId);
thread.archived = true;
thread.setArchived = async (value) => { thread.archived = value; };
const legacy = makeMessage({ embeds: [new EmbedBuilder().setTitle('🌱 Rookie Pipeline')] }, thread.stored);
const otherUser = makeMessage({ embeds: [new EmbedBuilder().setTitle('🌱 Rookie Pipeline')] }, thread.stored);
otherUser.author.id = 'someone-else';
const normal = makeMessage({ embeds: [new EmbedBuilder().setTitle('Upgrade')] }, thread.stored);
const retry = makeMessage({ embeds: [new EmbedBuilder().setTitle('🌱 Rookie Pipeline')] }, thread.stored);
retry.delete = async () => { throw new Error('Temporary failure'); };
stored.periods.year_2026_week_2.rookieMessages = { [teamId]: [legacy.id, otherUser.id, normal.id, retry.id, 'missing'] };
await fs.writeFile(historyPath, JSON.stringify(stored));
const summary = parentMessages.get(registry.summaryMessageId);
summary.payload.embeds[0].addFields({ name: 'Rookie pipeline', value: 'Old recap' });
await removeRookieRecapMessages(client, 'other-guild');
assert.ok(thread.stored.has(legacy.id));
await removeRookieRecapMessages(client, 'pipeline-guild');
assert.ok(!thread.stored.has(legacy.id));
assert.ok(thread.stored.has(otherUser.id));
assert.ok(thread.stored.has(normal.id));
assert.ok(thread.stored.has(retry.id));
assert.ok(!summary.embeds[0].toJSON().fields.some((field) => field.name === 'Rookie pipeline'));
const cleaned = JSON.parse(await fs.readFile(historyPath, 'utf8'));
assert.deepEqual(cleaned.periods.year_2026_week_2.rookieMessages[teamId], [otherUser.id, normal.id, retry.id]);
assert.equal(cleaned.periods.year_2026_week_2.rookieMonitoring.length, 3);
retry.delete = async () => { thread.stored.delete(retry.id); };
await removeRookieRecapMessages(client, 'pipeline-guild');
assert.ok(!thread.stored.has(retry.id));
console.log('PASS rookie/young/elite acceleration, rookie tracking without recaps, safe legacy cleanup, and retry persistence');
