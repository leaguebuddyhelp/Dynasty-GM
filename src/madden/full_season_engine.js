import { isolateSeasonStats } from './season_stat_isolation.js';
import { stablePlayerKey } from './player_identity.js';
import { buildWeeklyProgressionRecommendations } from './progression.js';
import { getMaddenSeasonKey } from '../shared/madden_metadata.js';

const BUCKETS = [['passing', 'playerPassingStatInfoList'], ['rushing', 'playerRushingStatInfoList'],
  ['receiving', 'playerReceivingStatInfoList'], ['defense', 'playerDefensiveStatInfoList'],
  ['kicking', 'playerKickingStatInfoList'], ['punting', 'playerPuntingStatInfoList']];
export function regularSeasonWeeks(snapshot) {
  const weeks = {};
  for (const source of isolateSeasonStats(snapshot.weeklyStats, snapshot)) {
    const index = Number(source.weekIndex);
    if (Number(source.stage ?? source.stageIndex) !== 1 || !Number.isInteger(index) || index < 0 || index > 17) continue;
    const target = weeks[index] ||= { weekIndex: index, stage: 1 };
    for (const [bucket, list] of BUCKETS) {
      const players = new Map((target[bucket]?.[list] || []).map((player) => [String(player.rosterId ?? stablePlayerKey(player)), player]));
      for (const player of source[bucket]?.[list] || []) players.set(String(player.rosterId ?? stablePlayerKey(player)), player);
      if (players.size) target[bucket] = { [list]: [...players.values()] };
    }
  }
  return weeks;
}
export function seasonCoverage(snapshot, weeks = regularSeasonWeeks(snapshot)) {
  const missingWeeks = [], missingTeams = {};
  const teamIds = new Set((snapshot.teams?.leagueTeamInfoList || []).map((team) => String(team.teamId)));
  for (let index = 0; index < 18; index++) {
    const games = (snapshot.schedule?.schedules || []).filter((game) => Number(game.stageIndex ?? game.stage) === 1 && Number(game.weekIndex) === index && teamIds.has(String(game.homeTeamId)) && teamIds.has(String(game.awayTeamId)));
    const played = new Set(games.filter((game) => Number(game.status) >= 2).flatMap((game) => [game.homeTeamId, game.awayTeamId]).filter((id) => id != null).map(String));
    const passing = new Set((weeks[index]?.passing?.playerPassingStatInfoList || []).filter((row) => Number(row.passAtt) > 0).map((row) => String(row.teamId)));
    const defense = new Set((weeks[index]?.defense?.playerDefensiveStatInfoList || []).filter((row) => ['defTotalTackles', 'defSacks', 'defInts', 'defPassDeflections'].some((field) => Number(row[field]) > 0)).map((row) => String(row.teamId)));
    const missing = [...played].filter((id) => !passing.has(id) || !defense.has(id));
    if (!games.length || games.some((game) => !(Number(game.status) >= 2)) || !played.size || !passing.size || missing.length) {
      missingWeeks.push(index + 1);
      if (missing.length) missingTeams[index + 1] = missing;
    }
  }
  return { complete: missingWeeks.length === 0, completedWeeks: 18 - missingWeeks.length, missingWeeks, missingTeams };
}
function rosterPlayers(snapshot) {
  const result = [];
  for (const [teamId, roster] of Object.entries(snapshot.rosters?.teams || {})) {
    for (const player of roster.rosterInfoList || roster.rosterPlayerInfoList || []) result.push({ player, teamId });
  }
  const assigned = new Set(result.map(({ player }) => stablePlayerKey(player)));
  for (const player of (Array.isArray(snapshot.rosters?.freeAgents) ? snapshot.rosters.freeAgents : snapshot.rosters?.freeAgents?.rosterInfoList || [])) {
    const key = stablePlayerKey(player);
    if (!assigned.has(key)) { result.push({ player, teamId: null }); assigned.add(key); }
  }
  return result;
}
export function collectSeasonTotals(weeks) {
  const players = new Map();
  let positivePoints = 0, negativePoints = 0, upgradeEvents = 0, downgradeEvents = 0;
  for (const week of Object.values(weeks).sort((a, b) => a.weekIndex - b.weekIndex)) {
    for (const recommendation of week.recommendations) {
      recommendation.direction === 'upgrade' ? upgradeEvents++ : downgradeEvents++;
      const player = players.get(recommendation.playerKey) || { playerKey: recommendation.playerKey, player: recommendation.player,
        teamId: recommendation.teamId, team: recommendation.team, position: recommendation.position, attributes: {} };
      for (const attribute of recommendation.attributes) {
        const value = player.attributes[attribute.field] ||= { attribute: attribute.attribute, field: attribute.field, positive: 0, negative: 0, net: 0, weeks: [] };
        if (attribute.points > 0) { value.positive += attribute.points; positivePoints += attribute.points; }
        else { value.negative += Math.abs(attribute.points); negativePoints += Math.abs(attribute.points); }
        value.net += attribute.points;
        value.weeks.push(week.weekIndex + 1);
      }
      players.set(recommendation.playerKey, player);
    }
  }
  return { players: [...players.values()], positivePoints, negativePoints, netPoints: positivePoints - negativePoints, upgradeEvents, downgradeEvents };
}
export async function replayFullSeason({ baseline, snapshot, weeks = regularSeasonWeeks(snapshot), rules, computeAwards, onWeek = null }) {
  const coverage = seasonCoverage(snapshot, weeks);
  if (!coverage.complete) throw new Error(`Full-season stats are incomplete. Missing weeks: ${coverage.missingWeeks.join(', ')}.`);
  const virtual = structuredClone(baseline);
  const indexed = new Map();
  const aliases = new Map();
  for (const { player, teamId } of rosterPlayers(virtual)) {
    const key = stablePlayerKey(player);
    if (!key) continue;
    indexed.set(key, { player, teamId });
    aliases.set(key, key);
    if (player.rosterId != null) aliases.set(`roster:${player.rosterId}`, key);
  }
  for (const { player } of rosterPlayers(snapshot)) {
    const key = stablePlayerKey(player);
    if (indexed.has(key) && player.rosterId != null) aliases.set(`roster:${player.rosterId}`, key);
  }
  const normalizedWeeks = structuredClone(weeks);
  for (const week of Object.values(normalizedWeeks)) for (const [bucket, list] of BUCKETS) for (const row of week[bucket]?.[list] || []) {
    const key = aliases.get(row.rosterId != null ? `roster:${row.rosterId}` : '') || aliases.get(stablePlayerKey(row));
    if (key && indexed.get(key).player.rosterId != null) row.rosterId = indexed.get(key).player.rosterId;
  }
  const history = { projected: true, periods: {}, seasonAwards: {}, weeklyAwardWinners: {} };
  const computed = {};
  const unmatched = new Map();
  const startingOveralls = Object.fromEntries([...indexed].map(([key, { player }]) => [key, player.playerBestOvr]));
  const seasonKey = getMaddenSeasonKey(baseline);
  for (let weekIndex = 0; weekIndex < 18; weekIndex++) {
    const current = normalizedWeeks[weekIndex];
    for (const [bucket, list] of BUCKETS) for (const row of current[bucket]?.[list] || []) {
      const key = aliases.get(row.rosterId != null ? `roster:${row.rosterId}` : '') || aliases.get(stablePlayerKey(row));
      if (key && row.teamId != null) indexed.get(key).teamId = String(row.teamId);
      else if (!key) unmatched.set(String(row.rosterId ?? stablePlayerKey(row)), { player: row.fullName || `${row.firstName || ''} ${row.lastName || ''}`.trim() || String(row.rosterId), teamId: row.teamId, reason: 'No starting baseline for this player' });
    }
    virtual.rosters.teams = {};
    for (const { player, teamId } of indexed.values()) {
      if (teamId == null) continue;
      (virtual.rosters.teams[teamId] ||= { rosterInfoList: [] }).rosterInfoList.push(player);
    }
    const view = { ...virtual, currentWeek: weekIndex + 2, stage: 1,
      info: { ...virtual.info, careerHubInfo: { ...virtual.info?.careerHubInfo,
        seasonInfo: { ...virtual.info?.careerHubInfo?.seasonInfo, seasonWeekType: 1 } } },
      weeklyStats: Object.values(normalizedWeeks).filter((week) => week.weekIndex <= weekIndex),
      standings: { teamStandingInfoList: [] },
      schedule: { schedules: (snapshot.schedule?.schedules || []).filter((game) => Number(game.stageIndex ?? game.stage) === 1 && Number(game.weekIndex) <= weekIndex) },
    };
    const awardWinners = await computeAwards(view, weekIndex + 1);
    history.weeklyAwardWinners[weekIndex + 1] = awardWinners;
    const record = buildWeeklyProgressionRecommendations(view, { weekIndex, rules, history, startingOveralls, awardWinners });
    record.issuedAsAggregate = true;
    record.awardWinners = awardWinners;
    record.ratingSource = 'virtual_season_replay';
    record.attributeTotals = record.recommendations.flatMap((item) => item.attributes).reduce((totals, attribute) => {
      if (attribute.points > 0) totals.positive += attribute.points;
      else totals.negative += Math.abs(attribute.points);
      return totals;
    }, { positive: 0, negative: 0 });
    computed[weekIndex + 1] = record;
    history.periods[`${seasonKey}_week_${weekIndex + 1}`] = record;
    for (const recommendation of record.recommendations) {
      const player = indexed.get(recommendation.playerKey)?.player;
      if (player) for (const attribute of recommendation.attributes) player[attribute.field] = attribute.targetValue;
    }
    if (onWeek) await onWeek(weekIndex + 1, record);
  }
  return { weeks: computed, totals: collectSeasonTotals(computed), unmatchedPlayers: [...unmatched.values()] };
}
export function buildSeasonApplication({ totals, baseline, snapshot, applicationMode }) {
  if (!['add_net', 'baseline_targets'].includes(applicationMode)) throw new Error('Choose the full-season application method.');
  const initial = new Map(rosterPlayers(baseline).map(({ player }) => [stablePlayerKey(player), player]));
  const latest = new Map(rosterPlayers(snapshot).map(({ player, teamId }) => [stablePlayerKey(player), { player, teamId }]));
  return totals.players.map((record) => {
    const start = initial.get(record.playerKey), current = latest.get(record.playerKey);
    return { ...record, teamId: current?.teamId ?? null, attributes: Object.values(record.attributes).map((attribute) => {
      const rating = (value) => value == null || value === '' || typeof value === 'boolean' ? null : Number(value);
      const currentValue = rating(current?.player[attribute.field]);
      const baselineValue = rating(start?.[attribute.field]);
      const valid = currentValue !== null && Number.isFinite(currentValue) && currentValue >= 0 && currentValue <= 99;
      const target = applicationMode === 'add_net' ? currentValue + attribute.net : baselineValue + attribute.net;
      const targetValue = valid ? Math.max(0, Math.min(99, target)) : null;
      return { ...attribute, baselineValue, currentValue: valid ? currentValue : null, targetValue,
        pointsToApply: targetValue === null ? null : targetValue - currentValue, needsReview: !valid };
    }) };
  });
}
