import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { getDataFilePath, getMaddenLeaguesDir } from '../leaguebuddy/paths.js';
import { getSoloModeConfig, isSoloModeEnabled } from '../leaguebuddy/solo_mode.js';
import { getMaddenChannelId, getMaddenSeasonKey } from '../shared/madden_metadata.js';
import { getFullTeamName } from '../shared/madden_team_names.js';
import { getTeamEmojiByName } from '../shared/madden_visuals.js';
import { stablePlayerKey } from './player_identity.js';
import { getLatestReliableRegularSeasonWeekIndex } from './top_players.js';

const RULES_PATH = path.resolve(
  process.env.MADDEN_SOLO_RULES_FILE || path.join(process.cwd(), 'config', 'madden_solo_rules.json'),
);
const AWARDS_PATH = getDataFilePath(path.join('madden', 'awards.json'));
const HISTORY_DIR = getDataFilePath(path.join('madden', 'progression_history'));
const THREADS_DIR = getDataFilePath(path.join('madden', 'progression_threads'));

const STAT_BUCKETS = [
  ['passing', 'playerPassingStatInfoList', ['passAtt', 'passComp', 'passYds', 'passTDs', 'passInts', 'passSacks']],
  ['rushing', 'playerRushingStatInfoList', ['rushAtt', 'rushYds', 'rushTDs', 'fumbles']],
  ['receiving', 'playerReceivingStatInfoList', ['recCatches', 'recYds', 'recTDs']],
  ['defense', 'playerDefensiveStatInfoList', [
    'defTotalTackles', 'defSoloTackles', 'defSacks', 'defTacklesForLoss', 'defInts',
    'defForcedFumbles', 'defRecoveredFumbles', 'defPassDeflections', 'defTDs',
  ]],
  ['kicking', 'playerKickingStatInfoList', ['fgMade', 'fgAtt', 'xpMade', 'xpAtt']],
  ['punting', 'playerPuntingStatInfoList', ['pntAtt', 'pntYds', 'pntInside20']],
];
const OFFENSIVE_LINE_POSITIONS = new Set(['LT', 'LG', 'C', 'RG', 'RT']);

function readRules() {
  const parsed = JSON.parse(readFileSync(RULES_PATH, 'utf8'));
  const progression = parsed?.progression;
  const weekly = progression?.weekly;
  const offseason = progression?.offseason;
  if (!weekly || !offseason || !progression?.discord) {
    throw new Error(`Missing solo progression rules in ${RULES_PATH}.`);
  }
  if (Math.abs(Number(weekly.performanceWeight) + Number(weekly.expectationWeight) - 1) > 0.000001) {
    throw new Error(`Progression performance weights must total 1 in ${RULES_PATH}.`);
  }
  if (Math.abs(Number(weekly.individualGameWeight) + Number(weekly.recentFourGameWeight) + Number(weekly.seasonToDateWeight) - 1) > 0.000001) {
    throw new Error(`Progression window weights must total 1 in ${RULES_PATH}.`);
  }
  for (const [position, rule] of Object.entries(weekly.positions || {})) {
    if (!(Number(rule.scale) > 0) || !rule.weights || !Array.isArray(rule.attributes)) {
      throw new Error(`Invalid progression rules for ${position} in ${RULES_PATH}.`);
    }
  }
  return parsed;
}

function safeId(value, label) {
  const id = String(value || '').trim();
  if (!id || id.includes('/') || id.includes('\\') || id === '.' || id === '..') {
    throw new Error(`Invalid ${label}.`);
  }
  return id;
}

function historyFile(leagueId) {
  return path.join(HISTORY_DIR, `${safeId(leagueId, 'Madden league ID')}.json`);
}

function threadsFile(guildId) {
  return path.join(THREADS_DIR, `${safeId(guildId, 'Discord guild ID')}.json`);
}

async function loadJsonFile(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function atomicJsonWrite(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), { flag: 'wx' });
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function loadHistory(leagueId) {
  const history = await loadJsonFile(historyFile(leagueId), {
    version: 1,
    periods: {},
    seasonAwards: {},
  });
  if (history.version !== 1 || !history.periods || typeof history.periods !== 'object') {
    throw new Error(`Invalid progression history format for league ${leagueId}.`);
  }
  history.seasonAwards ||= {};
  return history;
}

async function saveHistory(leagueId, history) {
  await atomicJsonWrite(historyFile(leagueId), history);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function playerName(player = {}) {
  return String(player.fullName
    || [player.firstName, player.lastName].filter(Boolean).join(' ')
    || player.displayName
    || player.name
    || 'Unknown Player');
}

function normalizedName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function playerAliases(player) {
  return [
    stablePlayerKey(player),
    player.rosterId,
    player.playerId,
    player.esnId,
    player.presentationId,
    player.presentationID,
  ].map((value) => String(value ?? '').trim()).filter(Boolean);
}

function getRosterPlayers(snapshot) {
  const teams = new Map((snapshot?.teams?.leagueTeamInfoList || []).map((team) => [
    String(team.teamId),
    team,
  ]));
  const playersByKey = new Map();
  const aliases = new Map();
  for (const [teamId, roster] of Object.entries(snapshot?.rosters?.teams || {})) {
    for (const player of roster?.rosterInfoList || roster?.rosterPlayerInfoList || []) {
      const key = stablePlayerKey(player);
      if (!key) continue;
      const playerRecord = {
        ...player,
        key,
        teamId: String(teamId),
        team: getFullTeamName(teams.get(String(teamId)) || {}, `Team ${teamId}`),
        name: playerName(player),
        position: String(player.position || '').toUpperCase(),
        ovr: numberOrNull(player.playerBestOvr),
      };
      playersByKey.set(key, playerRecord);
      for (const alias of playerAliases(player)) aliases.set(alias, key);
    }
  }
  return { players: [...playersByKey.values()], aliases };
}

function rosterKeyFor(statRow, aliases) {
  const key = stablePlayerKey(statRow);
  if (key && aliases.has(key)) return aliases.get(key);
  for (const alias of playerAliases(statRow)) {
    if (aliases.has(alias)) return aliases.get(alias);
  }
  return null;
}

function buildWeeklyPlayerStats(snapshot, aliases, { requestedWeekIndex = null, includePostseason = false } = {}) {
  const byWeek = new Map();
  for (const entry of snapshot?.weeklyStats || []) {
    const stage = Number(entry?.stage ?? entry?.stageIndex ?? 0);
    if (stage !== 1 && !(includePostseason && stage === 2)) continue;
    const sourceWeekIndex = Number(entry?.weekIndex);
    if (!Number.isInteger(sourceWeekIndex) || sourceWeekIndex < 0) continue;
    if (requestedWeekIndex !== null && sourceWeekIndex > requestedWeekIndex) continue;
    const weekIndex = sourceWeekIndex + (stage === 2 ? 1000 : 0);
    const week = byWeek.get(weekIndex) || new Map();
    const hasTotals = Array.isArray(entry.playerTotals) && entry.playerTotals.length > 0;
    const rows = hasTotals
      ? entry.playerTotals.map((player) => [player, Object.keys(player?.totals || {})])
      : STAT_BUCKETS.flatMap(([bucket, listKey, fields]) =>
        (entry?.[bucket]?.[listKey] || []).map((player) => [player, fields]));
    const touched = new Set();
    for (const [row, fields] of rows) {
      const key = rosterKeyFor(row, aliases);
      if (!key) continue;
      const target = week.get(key) || {
        playerKey: key,
        position: String(row.position || '').toUpperCase(),
        games: 0,
        totals: {},
      };
      if (hasTotals && row.totals) {
        for (const [field, raw] of Object.entries(row.totals)) {
          const value = numberOrNull(raw);
          if (value !== null) target.totals[field] = (target.totals[field] || 0) + value;
        }
      } else {
        for (const field of fields) {
          const value = numberOrNull(row?.[field]);
          if (value !== null) target.totals[field] = (target.totals[field] || 0) + value;
        }
      }
      week.set(key, target);
      touched.add(key);
    }
    for (const key of touched) week.get(key).games = 1;
    byWeek.set(weekIndex, week);
  }
  return byWeek;
}

function performanceRaw(stats, positionRule) {
  return Object.entries(positionRule?.weights || {}).reduce((total, [field, weight]) =>
    total + Number(stats?.[field] || 0) * Number(weight), 0);
}

function performanceMetrics(stats, ovr, positionRule, rules) {
  if (!positionRule) return null;
  const raw = Math.max(0, performanceRaw(stats, positionRule));
  const performance = clamp(raw / Number(positionRule.scale) * 100, 0, 100);
  const expected = Number(positionRule.expectedAt70)
    + Math.max(0, Number(ovr || 70) - 70) * Number(positionRule.expectedPerOvr);
  const expectation = expected > 0
    ? clamp(50 + ((raw / expected - 1) * 50), 0, 100)
    : 0;
  return {
    raw,
    performanceScore: performance,
    expectationScore: expectation,
    score: performance * Number(rules.performanceWeight) + expectation * Number(rules.expectationWeight),
  };
}

function getStrongPoorCounts(scores, weeklyRules) {
  return {
    strong: scores.filter((score) => score >= Number(weeklyRules.strongGameScore)).length,
    poor: scores.filter((score) => score <= Number(weeklyRules.poorGameScore)).length,
    average: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0,
    trend: scores.length > 1 ? scores.at(-1) - scores[0] : 0,
    observedGames: scores.length,
  };
}

function opportunityConfirmed(stats, position, rules) {
  const thresholds = rules.meaningfulOpportunityMinimums[position]
    || rules.meaningfulOpportunityMinimums.DEF;
  return Object.entries(thresholds || {}).some(([field, minimum]) =>
    Number(stats?.[field] || 0) >= Number(minimum));
}

function getEvidenceAttributes(stats, player, rules, positionRule, maxAttributes = 1) {
  const attrs = (positionRule?.attributes || [])
    .map((rule) => ({
      ...rule,
      evidenceValue: Number(stats?.[rule.evidence] || 0),
      currentValue: numberOrNull(player[rules.attributeFields?.[rule.attribute]]),
    }))
    .filter((rule) => rule.evidenceValue >= Number(rule.minimum)
      && rule.currentValue !== null
      && rule.currentValue >= 0
      && rule.currentValue <= 99)
    .sort((a, b) => (b.evidenceValue / Number(b.minimum)) - (a.evidenceValue / Number(a.minimum)))
    .slice(0, maxAttributes);
  return attrs.map((rule) => ({
    attribute: rule.attribute,
    field: rules.attributeFields[rule.attribute],
    evidence: rule.evidence,
    currentValue: rule.currentValue,
  }));
}

function getNegativeEvidence(stats, rules, position, games = 1) {
  const checks = rules.negativeEvidence?.[position]
    || rules.negativeEvidence?.DEF
    || [];
  for (const check of checks) {
    const opportunities = Number(stats?.[check.opportunityField] || 0);
    const minimumOpportunities = Number(check.minimumOpportunities || 0) * Math.max(1, games);
    if (opportunities < minimumOpportunities) continue;
    if (check.minimum !== undefined && Number(stats?.[check.field] || 0) < Number(check.minimum) * Math.max(1, games)) continue;
    if (check.minimumMisses !== undefined) {
      const attempts = Number(stats?.[check.attemptsField] || 0);
      const made = Number(stats?.[check.field] || 0);
      if (attempts - made < Number(check.minimumMisses)) continue;
    }
    if (check.maximumRate !== undefined) {
      const denominator = Number(stats?.[check.rateField] || 0);
      const rate = denominator > 0 ? Number(stats?.[check.field] || 0) / denominator : Number.POSITIVE_INFINITY;
      if (rate > Number(check.maximumRate)) continue;
    }
    const currentValueField = rules.attributeFields?.[check.attribute];
    if (!currentValueField) continue;
    return {
      attribute: check.attribute,
      field: currentValueField,
      evidence: check.field,
      currentValue: numberOrNull(stats.player?.[currentValueField]),
    };
  }
  return null;
}

function getTier(score, tiers, scoreKey) {
  return [...(tiers || [])]
    .sort((a, b) => Number(b[scoreKey]) - Number(a[scoreKey]))
    .find((tier) => score >= Number(tier[scoreKey])) || null;
}

function getNegativeTier(score, tiers) {
  return [...(tiers || [])]
    .sort((a, b) => Number(a.maximumScore) - Number(b.maximumScore))
    .find((tier) => score <= Number(tier.maximumScore)) || null;
}

function attributeAllocation(evidence, points) {
  if (!evidence || !points) return [];
  const targetValue = clamp(evidence.currentValue + points, 0, 99);
  const appliedPoints = targetValue - evidence.currentValue;
  if (!appliedPoints) return [];
  return [{
    ...evidence,
    points: appliedPoints,
    targetValue,
  }];
}

function awardIdentity(award, players, aliases) {
  const key = rosterKeyFor(award, aliases);
  if (key) return key;
  const name = normalizedName(award?.fullName || award?.name || award?.playerName);
  const teamId = String(award?.teamId ?? '');
  const matches = players.filter((player) =>
    normalizedName(player.name) === name && (!teamId || player.teamId === teamId));
  return matches.length === 1 ? matches[0].key : null;
}

function getWeeklyAwardPoints(winners, player, players, aliases, rules) {
  const categories = ['afc_offense', 'nfc_offense', 'afc_defense', 'nfc_defense', 'rookie_offense', 'rookie_defense'];
  const awardIds = new Set();
  for (const category of categories) {
    const winner = winners?.[category];
    if (winner && awardIdentity(winner, players, aliases) === player.key) awardIds.add(category);
  }
  return Math.min(
    awardIds.size * Number(rules.awardPoints.weeklyPlayerOfWeek),
    Number(rules.awardPoints.maximumPerPlayer),
  );
}

function readWeeklyAwardResults(leagueId, weekNumber) {
  try {
    const store = JSON.parse(readFileSync(AWARDS_PATH, 'utf8'));
    return store?.[String(leagueId)]?.[String(weekNumber)] || {};
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

function currentSeasonAwards(history, seasonKey, playerKey, rules) {
  const awards = history.seasonAwards?.[seasonKey] || [];
  const records = awards.filter((award) => award.playerKey === playerKey);
  const points = records.reduce((sum, award) => sum + Number(
    award.type === 'mvp' ? rules.awardPoints.mvp : rules.awardPoints.majorSeasonAward,
  ), 0);
  return {
    points: Math.min(points, Number(rules.awardPoints.maximumPerPlayer)),
    records: records.map((award) => award.name),
  };
}

function sumAttributePoints(history, seasonKey, playerKey, direction) {
  let total = 0;
  for (const period of Object.values(history.periods || {})) {
    if (period.seasonKey !== seasonKey) continue;
    for (const recommendation of period.recommendations || []) {
      if (recommendation.playerKey !== playerKey) continue;
      if (period.statusById?.[recommendation.recommendationId]?.status !== 'applied') continue;
      for (const attribute of recommendation.attributes) {
        const points = Number(attribute.points || 0);
        if (direction === 'positive' && points > 0) total += points;
        if (direction === 'negative' && points < 0) total += Math.abs(points);
      }
    }
  }
  return total;
}

function guidelineForOvr(ovr, offseasonRules) {
  return offseasonRules.attributePointGuidelinesByStartingOvr.find((range) =>
    ovr >= Number(range.minimumOvr) && ovr <= Number(range.maximumOvr)) || null;
}

function positiveSeasonPenalty(positivePoints, startingOvr, offseasonRules) {
  const guideline = guidelineForOvr(startingOvr, offseasonRules);
  if (!guideline) return { guideline: 'not configured', penalty: 0 };
  const midpoint = (Number(guideline.minimumPoints) + Number(guideline.maximumPoints)) / 2;
  return {
    guideline: `${guideline.minimumPoints}-${guideline.maximumPoints}`,
    penalty: Math.max(0, positivePoints - midpoint)
      * Number(offseasonRules.softPenaltyPerPointOverGuidelineMidpoint),
  };
}

function populationSnapshot(players, progressionRules) {
  const rated = players.filter((player) => player.ovr !== null);
  const quarterbacks = rated.filter((player) => player.position === 'QB');
  const targets = progressionRules.softBalancing;
  return {
    activeRosterPlayersWithOvr: rated.length,
    overall80Plus: rated.filter((player) => player.ovr >= 80).length,
    overall90Plus: rated.filter((player) => player.ovr >= 90).length,
    quarterbacks70Plus: quarterbacks.filter((player) => player.ovr >= 70).length,
    quarterbacks70To79: quarterbacks.filter((player) => player.ovr >= 70 && player.ovr < 80).length,
    quarterbacks80Plus: quarterbacks.filter((player) => player.ovr >= 80).length,
    xFactors: rated.filter((player) => Number(player.devTrait) === 3).length,
    superstars: rated.filter((player) => Number(player.devTrait) === 2).length,
    targets: {
      overall80Plus: targets.global80PlusTarget,
      overall90Plus: targets.global90PlusTarget,
      quarterbacks70Plus: targets.quarterback70PlusTarget,
      quarterbacks80Plus: targets.quarterback80PlusTarget,
      xFactors: progressionRules.monitoring.informationalXFactorTarget,
      superstars: progressionRules.monitoring.informationalSuperstarTarget,
    },
  };
}

function populationPenalty(player, population, rules) {
  const balance = rules.softBalancing;
  let penalty = 0;
  const perTarget = Number(balance.populationOverTargetPenalty);
  if (player.ovr >= 80 && population.overall80Plus > Number(balance.global80PlusTarget[1])) penalty += perTarget;
  if (player.ovr >= 90 && population.overall90Plus > Number(balance.global90PlusTarget[1])) penalty += perTarget;
  if (player.position === 'QB' && player.ovr >= 80
      && population.quarterbacks80Plus > Number(balance.quarterback80PlusTarget[1])) penalty += perTarget;
  if (player.position === 'QB' && player.ovr >= 70
      && population.quarterbacks70Plus > Number(balance.quarterback70PlusTarget[1])) penalty += perTarget;
  return penalty;
}

function makeRecord({
  snapshot,
  type,
  weekIndex,
  recommendations,
  population,
  rules,
}) {
  const seasonKey = getMaddenSeasonKey(snapshot);
  const weekNumber = weekIndex === null ? null : Number(weekIndex) + 1;
  return {
    version: 1,
    periodKey: type === 'weekly' ? `${seasonKey}_week_${weekNumber}` : `${seasonKey}_offseason`,
    type,
    leagueId: String(snapshot?.leagueId || ''),
    seasonKey,
    season: snapshot?.season ?? null,
    weekIndex,
    weekNumber,
    syncId: String(snapshot?.syncId || ''),
    generatedAt: new Date().toISOString(),
    population,
    recommendations,
    statusById: {},
    formulaVersion: rules.version,
    warning: 'Recommendations only. The operator must make each change in Madden; OVR and development traits are never edited by this app.',
  };
}

function recommendation({
  player,
  seasonKey,
  direction,
  performanceScore,
  selectionScore,
  selectionAdjustments,
  consistency,
  awardPoints = 0,
  stats,
  attributes,
  currentWeekScore = null,
  recentFourGameScore = null,
  seasonToDateScore = null,
  explanation,
}) {
  return {
    recommendationId: `${stableHash(`${seasonKey}|${player.key}|${direction}|${attributes.map((item) => item.attribute).join(',')}`)}`,
    playerKey: player.key,
    player: player.name,
    teamId: player.teamId,
    team: player.team,
    position: player.position,
    currentOvr: player.ovr,
    devTrait: numberOrNull(player.devTrait),
    yearsPro: numberOrNull(player.yearsPro),
    playerImage: player.imgUrl || player.imgURL || player.imageUrl || null,
    direction,
    performanceScore: Math.round(performanceScore * 10) / 10,
    selectionScore: Math.round(selectionScore * 10) / 10,
    selectionAdjustments,
    consistency,
    awardPoints,
    stats,
    windows: {
      currentGame: currentWeekScore === null ? null : Math.round(currentWeekScore * 10) / 10,
      recentFourGames: recentFourGameScore === null ? null : Math.round(recentFourGameScore * 10) / 10,
      seasonToDate: seasonToDateScore === null ? null : Math.round(seasonToDateScore * 10) / 10,
    },
    attributes,
    totalAttributePoints: attributes.reduce((sum, item) => sum + item.points, 0),
    explanation,
    status: 'pending',
  };
}

function stableHash(value) {
  let hash = 2166136261;
  let second = 0x9e3779b9;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
    second ^= character.charCodeAt(0) + (second << 6) + (second >> 2);
  }
  return `${(hash >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

function selectWithSoftBalance(candidates, rules, maximum) {
  const remaining = [...candidates];
  const selected = [];
  const teamCount = new Map();
  const positionCount = new Map();
  while (selected.length < maximum && remaining.length) {
    remaining.sort((a, b) => {
      const aPriority = a.selectionScore
        - Number(teamCount.get(a.teamId) || 0) * Number(rules.teamBalancePenalty)
        - Number(positionCount.get(a.position) || 0) * Number(rules.positionBalancePenalty);
      const bPriority = b.selectionScore
        - Number(teamCount.get(b.teamId) || 0) * Number(rules.teamBalancePenalty)
        - Number(positionCount.get(b.position) || 0) * Number(rules.positionBalancePenalty);
      return bPriority - aPriority || a.player.localeCompare(b.player);
    });
    const next = remaining.shift();
    const selectionScore = next.selectionScore
      - Number(teamCount.get(next.teamId) || 0) * Number(rules.teamBalancePenalty)
      - Number(positionCount.get(next.position) || 0) * Number(rules.positionBalancePenalty);
    if (selectionScore < Number(next.minimumSelectionScore)) continue;
    selected.push({ ...next, selectionScore: Math.round(selectionScore * 10) / 10 });
    teamCount.set(next.teamId, (teamCount.get(next.teamId) || 0) + 1);
    positionCount.set(next.position, (positionCount.get(next.position) || 0) + 1);
  }
  return selected;
}

function getPlayerWindowScores(playerKey, player, byWeek, endWeek, positionRules, weeklyRules) {
  const gameRows = [...byWeek.entries()]
    .filter(([weekIndex]) => weekIndex <= endWeek)
    .sort(([a], [b]) => a - b)
    .map(([weekIndex, players]) => ({ weekIndex, row: players.get(playerKey) }))
    .filter(({ row }) => row?.games);
  const positionRule = positionRules[player.position]
    || (OFFENSIVE_LINE_POSITIONS.has(player.position) ? null : positionRules.DEF);
  const metrics = gameRows.map(({ weekIndex, row }) => ({
    weekIndex,
    row,
    score: performanceMetrics(row.totals, player.ovr, positionRule, weeklyRules)?.score ?? 0,
  }));
  const recent = metrics.slice(-Number(weeklyRules.rollingGames));
  const seasonScores = metrics.map((item) => item.score);
  const recentScores = recent.map((item) => item.score);
  const latest = metrics.at(-1) || null;
  const currentScore = latest?.score ?? null;
  const recentScore = recentScores.length
    ? recentScores.reduce((sum, score) => sum + score, 0) / recentScores.length
    : null;
  const seasonScore = seasonScores.length
    ? seasonScores.reduce((sum, score) => sum + score, 0) / seasonScores.length
    : null;
  const performanceScore = latest && recentScore !== null && seasonScore !== null
    ? currentScore * Number(weeklyRules.individualGameWeight)
      + recentScore * Number(weeklyRules.recentFourGameWeight)
      + seasonScore * Number(weeklyRules.seasonToDateWeight)
    : seasonScore;
  return {
    latest,
    metrics,
    recent,
    recentScores,
    currentScore,
    recentScore,
    seasonScore,
    performanceScore: performanceScore ?? 0,
    consistency: getStrongPoorCounts(recentScores, weeklyRules),
    seasonConsistency: getStrongPoorCounts(seasonScores, weeklyRules),
  };
}

function selectNegativeAttribute(stats, player, position, rules, games = 1) {
  const checks = rules.negativeEvidence?.[position] || rules.negativeEvidence?.DEF || [];
  for (const check of checks) {
    const opportunities = Number(stats?.[check.opportunityField] || 0);
    if (opportunities < Number(check.minimumOpportunities || 0) * Math.max(1, games)) continue;
    if (check.minimum !== undefined
      && Number(stats?.[check.field] || 0) < Number(check.minimum) * Math.max(1, games)) continue;
    if (check.minimumMisses !== undefined) {
      const misses = Number(stats?.[check.attemptsField] || 0) - Number(stats?.[check.field] || 0);
      if (misses < Number(check.minimumMisses)) continue;
    }
    if (check.maximumRate !== undefined) {
      const denominator = Number(stats?.[check.rateField] || 0);
      const rate = denominator > 0 ? Number(stats?.[check.field] || 0) / denominator : Number.POSITIVE_INFINITY;
      if (rate > Number(check.maximumRate)) continue;
    }
    const field = rules.attributeFields?.[check.attribute];
    const currentValue = numberOrNull(player[field]);
    if (field && currentValue !== null && currentValue > 0 && currentValue <= 99) {
      return { attribute: check.attribute, field, evidence: check.field, currentValue };
    }
  }
  return null;
}

function allTotals(rows) {
  const totals = {};
  for (const row of rows) {
    for (const [field, value] of Object.entries(row.totals || {})) {
      totals[field] = (totals[field] || 0) + Number(value || 0);
    }
  }
  return totals;
}

function getPopulationSoftPenalty(player, population, rules) {
  const balance = rules.softBalancing;
  const penalty = Number(balance.populationOverTargetPenalty);
  let total = 0;
  if (player.ovr >= 80 && population.overall80Plus > balance.global80PlusTarget[1]) total += penalty;
  if (player.ovr >= 90 && population.overall90Plus > balance.global90PlusTarget[1]) total += penalty;
  if (player.position === 'QB' && player.ovr >= 80
      && population.quarterbacks80Plus > balance.quarterback80PlusTarget[1]) total += penalty;
  if (player.position === 'QB' && player.ovr >= 70
      && population.quarterbacks70Plus > balance.quarterback70PlusTarget[1]) total += penalty;
  return total;
}

export function buildWeeklyProgressionRecommendations(snapshot, {
  weekIndex,
  awardWinners = {},
  history = { periods: {}, seasonAwards: {} },
  startingOveralls = {},
  rules = readRules().progression,
} = {}) {
  const weeklyRules = rules.weekly;
  const seasonKey = getMaddenSeasonKey(snapshot);
  const weekNumber = Number(weekIndex) + 1;
  const { players, aliases } = getRosterPlayers(snapshot);
  const byWeek = buildWeeklyPlayerStats(snapshot, aliases);
  const weekPlayers = byWeek.get(Number(weekIndex)) || new Map();
  const population = populationSnapshot(players, rules);
  const candidates = [];
  for (const player of players) {
    if (player.ovr === null) continue;
    const positionRules = weeklyRules.positions;
    const positionRule = positionRules[player.position]
      || (OFFENSIVE_LINE_POSITIONS.has(player.position) ? null : positionRules.DEF);
    if (!positionRule) continue;
    const current = weekPlayers.get(player.key);
    if (!current || !opportunityConfirmed(current.totals, positionRules[player.position] ? player.position : 'DEF', weeklyRules)) continue;
    const windows = getPlayerWindowScores(player.key, player, byWeek, Number(weekIndex), positionRules, weeklyRules);
    const currentMetrics = performanceMetrics(current.totals, player.ovr, positionRule, weeklyRules);
    const currentAttributeEvidence = getEvidenceAttributes(
      current.totals,
      player,
      weeklyRules,
      positionRule,
      1,
    );
    const seasonKeyOvr = numberOrNull(startingOveralls[player.key]) ?? player.ovr;
    const positivePointsUsed = sumAttributePoints(history, seasonKey, player.key, 'positive');
    const negativePointsUsed = sumAttributePoints(history, seasonKey, player.key, 'negative');
    const soft = positiveSeasonPenalty(positivePointsUsed, seasonKeyOvr, rules.offseason);
    const populationAdjustment = getPopulationSoftPenalty(player, population, rules);
    const weeklyAwards = getWeeklyAwardPoints(awardWinners, player, players, aliases, weeklyRules);
    const consistencyBonus = Number(
      weeklyRules.consistencyBonusByStrongGames[String(windows.consistency.strong)] || 0,
    );
    const poorConsistencyBonus = Number(
      weeklyRules.consistencyBonusByPoorGames?.[String(windows.consistency.poor)] || 0,
    );
    const improvingTrendBonus = Math.max(0, windows.consistency.trend)
      * Number(weeklyRules.improvingTrendSelectionModifier || 0);
    const decliningTrendBonus = Math.max(0, -windows.consistency.trend)
      * Number(weeklyRules.decliningTrendSelectionModifier || 0);
    const exceptionalConsistencyBonus = windows.consistency.average >= Number(weeklyRules.exceptionalConsistencyAverage)
      ? Number(weeklyRules.exceptionalConsistencyBonus || 0)
      : 0;
    let direction = null;
    const selectionAdjustments = {
      consistency: consistencyBonus + improvingTrendBonus,
      awardPoints: weeklyAwards,
      teamAndPositionBalance: 0,
      seasonalGuidelineSoftPenalty: 0,
      ratingPopulationSoftPenalty: 0,
    };
    let points = 0;
    let evidence = null;
    let priorityBase = 0;
    if (windows.performanceScore >= Number(weeklyRules.minimumUpgradePerformanceScore)
      && currentAttributeEvidence.length) {
      const tier = getTier(windows.performanceScore, weeklyRules.positiveChangeTiers, 'minimumScore');
      if (tier) {
        direction = 'upgrade';
        points = Number(tier.attributePoints);
        evidence = currentAttributeEvidence[0];
        priorityBase = windows.performanceScore + consistencyBonus + improvingTrendBonus
            + exceptionalConsistencyBonus + weeklyAwards
          - soft.penalty - populationAdjustment;
      }
    } else if (windows.performanceScore <= Number(weeklyRules.maximumDowngradePerformanceScore)) {
      const negative = selectNegativeAttribute(
        current.totals,
        player,
        positionRules[player.position] ? player.position : 'DEF',
        weeklyRules,
      );
      const tier = getNegativeTier(windows.performanceScore, weeklyRules.negativeChangeTiers);
      if (negative && tier) {
        direction = 'downgrade';
        points = Number(tier.attributePoints);
        evidence = negative;
        priorityBase = 100 - windows.performanceScore + poorConsistencyBonus + decliningTrendBonus;
      }
    }
    if (!direction || !evidence || !points) continue;
    selectionAdjustments.consistency = direction === 'downgrade'
      ? poorConsistencyBonus + decliningTrendBonus
      : consistencyBonus + improvingTrendBonus + exceptionalConsistencyBonus;
    const allocation = attributeAllocation(evidence, points);
    if (!allocation.length) continue;
    const selected = recommendation({
      player,
      seasonKey,
      direction,
      performanceScore: windows.performanceScore,
      selectionScore: priorityBase,
      selectionAdjustments: {
        ...selectionAdjustments,
        seasonalGuidelineSoftPenalty: direction === 'upgrade' ? Math.round(soft.penalty * 10) / 10 : 0,
        ratingPopulationSoftPenalty: direction === 'upgrade' ? populationAdjustment : 0,
      },
      consistency: windows.consistency,
      awardPoints: direction === 'upgrade' ? weeklyAwards : 0,
      stats: current.totals,
      attributes: allocation,
      currentWeekScore: windows.currentScore,
      recentFourGameScore: windows.recentScore,
      seasonToDateScore: windows.seasonScore,
      explanation: direction === 'upgrade'
        ? `Performance score ${windows.performanceScore.toFixed(1)} combined the current game, recent played games, and season-to-date output.`
        : `Sustained or game-level underperformance score ${windows.performanceScore.toFixed(1)} with verified evidence for ${evidence.attribute}.`,
    });
    selected.minimumSelectionScore = direction === 'upgrade'
      ? Number(weeklyRules.minimumUpgradeSelectionScore)
      : Number(weeklyRules.minimumDowngradeSelectionPriority);
    selected.pointTracking = {
      positivePreviouslyConfirmed: positivePointsUsed,
      negativePreviouslyConfirmed: negativePointsUsed,
      softGuideline: soft.guideline,
    };
    candidates.push(selected);
  }
  const selected = selectWithSoftBalance(
    candidates,
    weeklyRules,
    Number(weeklyRules.maximumRecommendations),
  );
  return makeRecord({
    snapshot,
    type: 'weekly',
    weekIndex: Number(weekIndex),
    recommendations: selected,
    population,
    rules,
  });
}

function makeOffseasonAttributes(player, stats, rules, position, direction, tier, seasonGames) {
  const positionRule = rules.weekly.positions[position]
    || (OFFENSIVE_LINE_POSITIONS.has(position) ? null : rules.weekly.positions.DEF);
  if (!positionRule) return [];
  if (direction === 'upgrade') {
    const positives = getEvidenceAttributes(stats, player, rules.weekly, positionRule, 3);
    const allocations = [];
    for (const [index, points] of [
      Number(tier.primaryPoints),
      Number(tier.secondaryPoints),
      Number(tier.tertiaryPoints),
    ].entries()) {
      const evidence = positives[index];
      if (!evidence || !points) continue;
      allocations.push(...attributeAllocation(evidence, points));
    }
    return allocations;
  }
  const negative = selectNegativeAttribute(
    stats,
    player,
    rules.weekly.positions[position] ? position : 'DEF',
    rules.weekly,
    seasonGames,
  );
  if (!negative) return [];
  return attributeAllocation(negative, Number(tier.primaryPoints));
}

export function buildOffseasonProgressionRecommendations(snapshot, {
  history = { periods: {}, seasonAwards: {} },
  startingOveralls = {},
  rules = readRules().progression,
} = {}) {
  const seasonKey = getMaddenSeasonKey(snapshot);
  const { players, aliases } = getRosterPlayers(snapshot);
  const byWeek = buildWeeklyPlayerStats(snapshot, aliases, { includePostseason: true });
  const population = populationSnapshot(players, rules);
  const maxWeek = Math.max(-1, ...byWeek.keys());
  const candidates = [];
  for (const player of players) {
    if (player.ovr === null) continue;
    const positionRules = rules.weekly.positions;
    const positionRule = positionRules[player.position]
      || (OFFENSIVE_LINE_POSITIONS.has(player.position) ? null : positionRules.DEF);
    if (!positionRule) continue;
    const windows = getPlayerWindowScores(player.key, player, byWeek, maxWeek, positionRules, rules.weekly);
    const rows = windows.metrics.map((entry) => entry.row);
    if (!rows.length) continue;
    const totalStats = allTotals(rows);
    const games = rows.length;
    const avgStats = Object.fromEntries(Object.entries(totalStats).map(([field, value]) => [field, value / games]));
    const seasonMetrics = performanceMetrics(avgStats, player.ovr, positionRule, rules.weekly);
    const seasonScore = seasonMetrics.score;
    const youngBonus = Number(rules.offseason.experienceBonusByYearsPro[String(player.yearsPro)] || 0);
    const seasonAwards = currentSeasonAwards(history, seasonKey, player.key, rules.offseason);
    const weeklyAwards = Object.values(history.periods || {})
      .filter((period) => period.seasonKey === seasonKey)
      .flatMap((period) => period.recommendations || [])
      .filter((item) => item.playerKey === player.key && item.direction === 'upgrade')
      .reduce((sum, item) => sum + Number(item.awardPoints || 0), 0);
    const awards = Math.min(
      seasonAwards.points + weeklyAwards,
      Number(rules.offseason.awardPoints.maximumPerPlayer),
    );
    const startingOvr = numberOrNull(startingOveralls[player.key]) ?? player.ovr;
    const positiveUsed = sumAttributePoints(history, seasonKey, player.key, 'positive');
    const negativeUsed = sumAttributePoints(history, seasonKey, player.key, 'negative');
    const soft = positiveSeasonPenalty(positiveUsed, startingOvr, rules.offseason);
    const populationAdjustment = getPopulationSoftPenalty(player, population, rules);
    const consistency = windows.seasonConsistency;
    const selectionAdjustments = {
      youthExperience: youngBonus,
      awards: awards,
      seasonConsistency: Math.round(consistency.strong / Math.max(1, consistency.observedGames) * 10),
      seasonalGuidelineSoftPenalty: Math.round(soft.penalty * 10) / 10,
      ratingPopulationSoftPenalty: populationAdjustment,
    };
    const upgradeScore = seasonScore + youngBonus + awards
      + selectionAdjustments.seasonConsistency - soft.penalty - populationAdjustment;
    let direction = null;
    let tier = null;
    let priority = 0;
    if (seasonScore >= Number(rules.offseason.minimumUpgradePerformanceScore)) {
      tier = getTier(seasonScore, rules.offseason.positiveChangeTiers, 'minimumScore');
      if (tier) {
        direction = 'upgrade';
        priority = upgradeScore;
      }
    } else if (seasonScore <= Number(rules.offseason.maximumDowngradePerformanceScore)) {
      tier = getNegativeTier(seasonScore, rules.offseason.negativeChangeTiers);
      if (tier) {
        direction = 'downgrade';
        priority = 100 - seasonScore + consistency.poor;
      }
    }
    if (!direction) continue;
    const attributes = makeOffseasonAttributes(player, totalStats, rules, player.position, direction, tier, games);
    if (!attributes.length) continue;
    const minimumSelectionScore = direction === 'upgrade'
      ? Number(rules.offseason.minimumUpgradeSelectionScore)
      : Number(rules.offseason.minimumDowngradeSelectionPriority);
    if (priority < minimumSelectionScore) continue;
    candidates.push(recommendation({
      player,
      seasonKey,
      direction,
      performanceScore: seasonScore,
      selectionScore: priority,
      selectionAdjustments,
      consistency,
      awardPoints: direction === 'upgrade' ? awards : 0,
      stats: totalStats,
      attributes,
      currentGameScore: null,
      recentFourGameScore: windows.recentScore,
      seasonToDateScore: seasonScore,
      explanation: direction === 'upgrade'
        ? `Full-season performance score ${seasonScore.toFixed(1)}, including OVR-adjusted expectations and ${games} played games.`
        : `Full-season performance score ${seasonScore.toFixed(1)} with verified attribute-specific evidence for ${attributes[0].attribute}.`,
    }));
    candidates.at(-1).minimumSelectionScore = minimumSelectionScore;
    candidates.at(-1).pointTracking = {
      positivePreviouslyConfirmed: positiveUsed,
      negativePreviouslyConfirmed: negativeUsed,
      softGuideline: soft.guideline,
    };
  }
  const selected = selectWithSoftBalance(
    candidates,
    rules.offseason,
    Number(rules.offseason.maximumRecommendations),
  );
  return makeRecord({
    snapshot,
    type: 'offseason',
    weekIndex: null,
    recommendations: selected,
    population,
    rules,
  });
}

function recordEmbed(record, item) {
  const upgrade = item.direction === 'upgrade';
  const emoji = getTeamEmojiByName(item.team);
  const attributeLines = item.attributes.map((attribute) =>
    `**${attribute.attribute}** ${attribute.currentValue} → ${attribute.targetValue} (${attribute.points > 0 ? '+' : ''}${attribute.points})`).join('\n');
  const statistics = Object.entries(item.stats || {})
    .filter(([, value]) => Number.isFinite(Number(value)) && Number(value) !== 0)
    .map(([key, value]) => `${key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase())}: ${Math.round(Number(value) * 10) / 10}`)
    .slice(0, 5)
    .join(' • ') || 'No supported statistics';
  const status = record.statusById?.[item.recommendationId]?.status || 'pending';
  const embed = new EmbedBuilder()
    .setTitle(`${upgrade ? '📈 Upgrade' : '📉 Downgrade'} · ${item.player}`)
    .setDescription(`${emoji ? `${emoji} ` : ''}**${item.team}** · ${item.position} · ${item.currentOvr} OVR\n\n${attributeLines}`)
    .addFields(
      { name: 'Why', value: item.explanation.slice(0, 1024), inline: false },
      { name: 'Recent performance', value: statistics.slice(0, 1024), inline: false },
      { name: 'Status', value: status === 'applied' ? '✅ Applied in Madden' : status === 'skipped' ? '⏭️ Skipped' : '🕒 Waiting for your Madden update', inline: true },
    )
    .setColor(upgrade ? 0x2ecc71 : 0xe74c3c)
    .setFooter({ text: `${seasonLabel(record.seasonKey)} · ${record.weekNumber ? `Week ${record.weekNumber}` : 'Offseason'} · Changes are manual in Madden` })
    .setTimestamp(new Date(record.generatedAt));
  if (typeof item.playerImage === 'string' && /^https?:\/\//i.test(item.playerImage)) {
    embed.setThumbnail(item.playerImage);
  } else if (emoji) {
    embed.setAuthor({ name: `${emoji} ${item.team}` });
  }
  return embed;
}

function seasonLabel(value) {
  const match = /^year_(\d+)$/i.exec(String(value || ''));
  return match ? `Season ${match[1]}` : String(value || 'Season');
}

function populationSummaryEmbed(record) {
  const population = record.population || {};
  const recommendations = record.recommendations || [];
  const upgrades = recommendations.filter((item) => item.direction === 'upgrade').length;
  const downgrades = recommendations.length - upgrades;
  return new EmbedBuilder()
    .setTitle('🏈 Franchise Progression')
    .setDescription(`**${seasonLabel(record.seasonKey)} · ${record.weekNumber ? `Week ${record.weekNumber}` : 'Offseason'}**\n\n📈 **${upgrades}** upgrade${upgrades === 1 ? '' : 's'}　 ·　 📉 **${downgrades}** downgrade${downgrades === 1 ? '' : 's'}\n\nReview team threads below. Apply every change manually in Madden.`)
    .addFields(
      { name: 'Players rated 80+', value: String(population.overall80Plus ?? 0), inline: true },
      { name: 'Players rated 90+', value: String(population.overall90Plus ?? 0), inline: true },
    )
    .setColor(0x5865f2)
    .setFooter({ text: 'Dynasty GM · Updated after each sync' })
    .setTimestamp(new Date(record.generatedAt));
}

function progressionCardEmbed(record, item) {
  const upgrade = item.direction === 'upgrade';
  const emoji = getTeamEmojiByName(item.team);
  const attributes = item.attributes.map((attribute) =>
    `**${attribute.attribute}** ${attribute.currentValue} → ${attribute.targetValue} (${attribute.points > 0 ? '+' : ''}${attribute.points})`
  ).join('\n');
  const status = record.statusById?.[item.recommendationId]?.status || 'pending';
  const embed = new EmbedBuilder()
    .setTitle(`${upgrade ? '🟢 Upgrade' : '🟠 Downgrade'} · ${item.player}`)
    .setDescription(`${emoji ? `${emoji} ` : ''}**${item.team}** · ${item.position} · ${item.currentOvr} OVR\n\n${attributes}`)
    .setColor(upgrade ? 0x2ecc71 : 0xe67e22)
    .setFooter({ text: `${seasonLabel(record.seasonKey)} · ${record.weekNumber ? `Week ${record.weekNumber}` : 'Offseason'} · ${status === 'applied' ? 'Applied' : status === 'skipped' ? 'Skipped' : 'Needs review'}` })
    .setTimestamp(new Date(record.generatedAt));
  if (typeof item.playerImage === 'string' && /^https?:\/\//i.test(item.playerImage)) {
    embed.setThumbnail(item.playerImage);
  }
  return embed;
}

function controlsForRecommendations(record, teamId, page, entries) {
  const options = entries.map((item) => ({
    label: `${item.player} — ${item.position}`.slice(0, 100),
    value: item.recommendationId,
    description: `${item.direction === 'upgrade' ? 'Upgrade' : 'Downgrade'}: ${item.attributes.map((attr) => `${attr.points > 0 ? '+' : ''}${attr.points} ${attr.attribute}`).join(', ')}`.slice(0, 100),
  }));
  if (!options.length) return [];
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`madden_progression_select|${record.periodKey}|${teamId}|${page}`)
        .setPlaceholder('Choose a recommendation to manage')
        .addOptions(options),
    ),
  ];
}

function statusButtons(record, teamId, page, item) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`madden_progression_status|applied|${record.periodKey}|${item.recommendationId}`)
        .setLabel('Mark Applied')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`madden_progression_status|skipped|${record.periodKey}|${item.recommendationId}`)
        .setLabel('Mark Skipped')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`madden_progression_details|${record.periodKey}|${item.recommendationId}`)
        .setLabel('View Details')
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

function readRoleId(rules) {
  const envName = rules.discord.franchiseManagerRoleIdEnv;
  return String(process.env[envName] || '').trim();
}

async function resolveManagerRole(guild, rules) {
  const configuredId = readRoleId(rules);
  let managerRole;
  if (configuredId) {
    const configuredRole = guild.roles.cache.get(configuredId)
      || await guild.roles.fetch(configuredId).catch((error) => {
        if (error?.code === 10011) return null;
        throw error;
      });
    if (configuredRole) managerRole = configuredRole;
    else throw new Error(`${rules.discord.franchiseManagerRoleIdEnv} references a role that does not exist in this server.`);
  } else {
    const existing = guild.roles.cache.find((role) => role.name === rules.discord.notificationRoleName);
    managerRole = existing || await guild.roles.create({
      name: rules.discord.notificationRoleName,
      mentionable: true,
      reason: 'Madden Franchise HQ progression notifications',
    });
  }
  if (!managerRole.mentionable) {
    await managerRole.setMentionable(true, 'Madden Franchise HQ progression notifications');
  }
  const operatorId = getSoloModeConfig().userId;
  const operator = await guild.members.fetch(operatorId);
  if (!operator.roles.cache.has(managerRole.id)) {
    await operator.roles.add(managerRole, 'Authorized Madden Franchise HQ operator');
  }
  return managerRole;
}

async function ensureTeamThreads({ client, guildId, snapshot, rules }) {
  const channelId = getMaddenChannelId(rules.discord.playerUpgradesChannelKey, guildId);
  if (!channelId) throw new Error('Player Upgrades channel is not configured.');
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased() || !channel.threads) {
    throw new Error('Configured Player Upgrades channel does not support threads.');
  }
  const guild = channel.guild || await client.guilds.fetch(guildId);
  const managerRole = await resolveManagerRole(guild, rules);
  const file = threadsFile(guildId);
  const registry = await loadJsonFile(file, { version: 1, channelId, teams: {} });
  registry.teams ||= {};
  const active = await channel.threads.fetchActive();
  const activeByName = new Map(active.threads.map((thread) => [thread.name.toLowerCase(), thread]));
  const archived = await channel.threads.fetchArchived({ type: 'public', limit: 100 });
  const archivedByName = new Map(archived.threads.map((thread) => [thread.name.toLowerCase(), thread]));

  for (const team of snapshot?.teams?.leagueTeamInfoList || []) {
    const teamId = String(team.teamId);
    const teamName = getFullTeamName(team, `Team ${teamId}`);
    const existingId = registry.teams[teamId]?.threadId;
    let thread = existingId
      ? await client.channels.fetch(existingId).catch((error) => {
        if (error?.code === 10003) return null;
        throw error;
      })
      : null;
    if (!thread) {
      thread = activeByName.get(teamName.toLowerCase())
        || archivedByName.get(teamName.toLowerCase())
        || null;
    }
    if (thread?.archived) await thread.setArchived(false, 'Madden Franchise HQ progression thread recovery');
    if (!thread) {
      const starter = await channel.send({ content: `Permanent player-upgrades thread for **${teamName}**.` });
      thread = await starter.startThread({
        name: teamName,
        autoArchiveDuration: Number(rules.discord.threadAutoArchiveDuration),
        reason: 'Madden Franchise HQ team progression thread',
      });
    }
    registry.teams[teamId] = { teamName, threadId: thread.id };
    registry.channelId = channelId;
    registry.managerRoleId = managerRole.id;
    await atomicJsonWrite(file, registry);
  }
  return registry;
}

async function publishTeamThreadReports(client, guildId, snapshot, record, history, rules) {
  const registry = await ensureTeamThreads({ client, guildId, snapshot, rules });
  const byTeam = new Map();
  for (const item of record.recommendations) {
    const list = byTeam.get(item.teamId) || [];
    list.push(item);
    byTeam.set(item.teamId, list);
  }
  const managerRoleId = registry.managerRoleId;
  record.teamMessages ||= {};
  record.announcedTeamIds ||= [];
  const maxEmbeds = Number(rules.discord.recommendationsPerThreadMessage);
  const teamIds = new Set([...byTeam.keys(), ...Object.keys(record.teamMessages)]);
  for (const teamId of teamIds) {
    const recommendations = byTeam.get(teamId) || [];
    const threadId = registry.teams[teamId]?.threadId;
    if (!threadId) throw new Error(`No progression thread is registered for team ${teamId}.`);
    const thread = await client.channels.fetch(threadId);
    if (!thread?.isThread()) throw new Error(`Registered progression thread ${threadId} is unavailable.`);
    if (thread.archived) await thread.setArchived(false, 'New Madden progression recommendations');
    const previousMessages = record.teamMessages[teamId] || [];
    const messageIds = [];
    for (let offset = 0, page = 0; offset < recommendations.length; offset += maxEmbeds, page += 1) {
      const batch = recommendations.slice(offset, offset + maxEmbeds);
      const content = page === 0 && !record.announcedTeamIds.includes(teamId) && !previousMessages[page]
        ? `<@&${managerRoleId}> New progression recommendations for ${record.seasonKey}${record.weekNumber ? `, week ${record.weekNumber}` : ', offseason'}.`
        : undefined;
      const payload = {
        content,
        embeds: batch.map((item) => progressionCardEmbed(record, item)),
        components: controlsForRecommendations(record, teamId, page, batch),
        allowedMentions: content ? { parse: [], roles: [managerRoleId] } : { parse: [] },
      };
      const messageId = previousMessages[page];
      if (messageId) {
        try {
          const message = await thread.messages.fetch(messageId);
          await message.edit(payload);
          messageIds.push(message.id);
          record.teamMessages[teamId] = messageIds;
          await saveHistory(record.leagueId, history);
          continue;
        } catch (error) {
          if (error?.code !== 10008) throw error;
        }
      }
      const message = await thread.send(payload);
      messageIds.push(message.id);
      if (page === 0 && content) record.announcedTeamIds.push(teamId);
      record.teamMessages[teamId] = messageIds;
      await saveHistory(record.leagueId, history);
    }
    const activePageCount = Math.ceil(recommendations.length / maxEmbeds);
    for (const obsoleteId of previousMessages.slice(activePageCount)) {
      const obsolete = await thread.messages.fetch(obsoleteId).catch((error) => {
        if (error?.code === 10008) return null;
        throw error;
      });
      if (obsolete) {
        await obsolete.edit({
          content: 'This recommendation page is superseded by the latest evaluation.',
          embeds: [],
          components: [],
          allowedMentions: { parse: [] },
        });
      }
    }
    record.teamMessages[teamId] = messageIds;
    await saveHistory(record.leagueId, history);
  }
  record.threadRegistryFile = threadsFile(guildId);
  const upgradesChannel = await client.channels.fetch(registry.channelId);
  if (!upgradesChannel?.isTextBased()) throw new Error('Configured Player Upgrades channel is unavailable or not text-based.');
  const summaryMessage = registry.summaryMessageId
    ? await upgradesChannel.messages.fetch(registry.summaryMessageId).catch((error) => {
      if (error?.code === 10008) return null;
      throw error;
    })
    : null;
  const summaryPayload = {
    embeds: [populationSummaryEmbed(record)],
    allowedMentions: { parse: [] },
  };
  const persistedSummary = summaryMessage
    ? await summaryMessage.edit(summaryPayload)
    : await upgradesChannel.send(summaryPayload);
  if (!persistedSummary.pinned) await persistedSummary.pin();
  registry.summaryMessageId = persistedSummary.id;
  await atomicJsonWrite(threadsFile(guildId), registry);
  await saveHistory(record.leagueId, history);
  return {
    published: true,
    teamCount: byTeam.size,
    recommendationCount: record.recommendations.length,
    threadCount: Object.keys(registry.teams).length,
  };
}

function isOffseason(snapshot) {
  const info = snapshot?.info?.careerHubInfo?.seasonInfo || {};
  const weekType = Number(info.seasonWeekType ?? info.seasonWeekTypeId ?? snapshot?.stage ?? 1);
  return Number(info.offSeasonStage || 0) > 0
    || weekType === 3
    || weekType === 8
    || String(info.seasonTitle || '').toLowerCase().includes('offseason');
}

async function startingOveralls(leagueId, snapshot, seasonKey) {
  const file = path.join(getMaddenLeaguesDir(), 'history', safeId(leagueId, 'Madden league ID'), 'index.json');
  const index = await loadJsonFile(file, { records: [] });
  if (!Array.isArray(index.records)) throw new Error(`Invalid sync history index for league ${leagueId}.`);
  const snapshots = [];
  const directory = path.dirname(file);
  for (const entry of [...index.records].sort((a, b) => String(a.syncedAt || '').localeCompare(String(b.syncedAt || '')))) {
    if (!entry.syncId) continue;
    const archived = await loadJsonFile(path.join(directory, `${entry.syncId}.json`), null);
    if (archived) snapshots.push(archived);
  }
  snapshots.push(snapshot);
  const result = new Map();
  for (const prior of snapshots) {
    if (getMaddenSeasonKey(prior) !== seasonKey) continue;
    for (const player of getRosterPlayers(prior).players) {
      if (player.ovr !== null && !result.has(player.key)) result.set(player.key, player.ovr);
    }
  }
  return Object.fromEntries(result);
}

async function publishProgression({ client, guildId, snapshot, type, weekIndex = null, awardWinners = null }) {
  const leagueId = safeId(snapshot?.leagueId, 'Madden league ID');
  const history = await loadHistory(leagueId);
  const rules = readRules().progression;
  const seasonKey = getMaddenSeasonKey(snapshot);
  const starting = await startingOveralls(leagueId, snapshot, seasonKey);
  const current = type === 'weekly'
    ? buildWeeklyProgressionRecommendations(snapshot, {
      weekIndex,
      awardWinners: awardWinners || readWeeklyAwardResults(leagueId, Number(weekIndex) + 1),
      history,
      startingOveralls: starting,
      rules,
    })
    : buildOffseasonProgressionRecommendations(snapshot, {
      history,
      startingOveralls: starting,
      rules,
    });
  const old = history.periods[current.periodKey];
  let record;
  if (old && Object.values(old.statusById || {}).some((status) => status.status === 'applied')) {
    record = {
      ...old,
      latestSyncId: current.syncId,
      syncIds: [...new Set([...(old.syncIds || [old.syncId]), current.syncId].filter(Boolean))],
      updatedAt: new Date().toISOString(),
    };
  } else {
    record = {
      ...old,
      ...current,
      statusById: old?.statusById || {},
      teamMessages: old?.teamMessages || {},
      syncIds: [...new Set([...(old?.syncIds || []), current.syncId].filter(Boolean))],
      createdAt: old?.createdAt || current.generatedAt,
      updatedAt: new Date().toISOString(),
    };
  }
  history.periods[record.periodKey] = record;
  await saveHistory(leagueId, history);
  const output = await publishTeamThreadReports(client, guildId, snapshot, record, history, rules);
  return {
    ...output,
    published: record.recommendations.length > 0,
    ...(record.recommendations.length ? {} : { reason: 'No players met the configured evidence threshold.' }),
    periodKey: record.periodKey,
    type: record.type,
  };
}

export async function publishProgressionReports({ client, guildId, snapshot }) {
  if (!isSoloModeEnabled()) return { published: false, reason: 'Solo mode is disabled.' };
  if (!snapshot?.leagueId || !snapshot?.syncId) throw new Error('Progression requires a synced franchise snapshot.');
  if (isOffseason(snapshot)) return publishProgression({ client, guildId, snapshot, type: 'offseason' });
  const weekIndex = getLatestReliableRegularSeasonWeekIndex(snapshot);
  if (weekIndex === null) {
    const registry = await ensureTeamThreads({
      client,
      guildId,
      snapshot,
      rules: readRules().progression,
    });
    return {
      published: false,
      reason: 'No reliable completed regular-season stats are available.',
      threadCount: Object.keys(registry.teams).length,
    };
  }
  return publishProgression({ client, guildId, snapshot, type: 'weekly', weekIndex });
}

export async function refreshProgressionForAwardChange({ client, guildId, leagueId, snapshot, weekNumber, winners }) {
  const weekIndex = Number(weekNumber) - 1;
  if (!Number.isInteger(weekIndex) || weekIndex < 0) return { published: false, reason: 'Invalid award week.' };
  return publishProgression({
    client,
    guildId,
    snapshot,
    type: 'weekly',
    weekIndex,
    awardWinners: winners,
  });
}

export async function refreshProgressionForSeasonAwardChange({ client, guildId, snapshot }) {
  if (!isOffseason(snapshot)) {
    return { published: false, reason: 'Season awards are saved for the next offseason evaluation.' };
  }
  return publishProgression({ client, guildId, snapshot, type: 'offseason' });
}

export async function recordSeasonAwards({ leagueId, seasonKey, awards }) {
  const history = await loadHistory(leagueId);
  const byId = new Map((history.seasonAwards[seasonKey] || []).map((award) => [award.awardId, award]));
  for (const award of awards || []) {
    if (!award?.playerKey || !award?.awardId || !['mvp', 'major'].includes(award.type)) continue;
    byId.set(award.awardId, award);
  }
  history.seasonAwards[seasonKey] = [...byId.values()];
  await saveHistory(leagueId, history);
  return history.seasonAwards[seasonKey];
}

async function loadPeriod(leagueId, periodKey) {
  const history = await loadHistory(leagueId);
  const record = history.periods[periodKey];
  if (!record) throw new Error(`Progression report ${periodKey} was not found.`);
  return { history, record };
}

export async function loadProgressionPeriod(leagueId, periodKey, recommendationId = null) {
  const { record } = await loadPeriod(leagueId, periodKey);
  if (!recommendationId) return record;
  const item = record.recommendations.find((entry) => entry.recommendationId === recommendationId);
  if (!item) throw new Error('Progression recommendation was not found.');
  return { record, recommendation: item };
}

export async function updateProgressionStatus({ leagueId, periodKey, recommendationId, status, userId }) {
  const config = getSoloModeConfig();
  if (!config.enabled || String(userId) !== config.userId) {
    throw new Error('Only the authorized solo operator can manage progression recommendations.');
  }
  if (!['applied', 'skipped'].includes(status)) throw new Error('Invalid progression status.');
  const { history, record } = await loadPeriod(leagueId, periodKey);
  if (!record.recommendations.some((item) => item.recommendationId === recommendationId)) {
    throw new Error('Progression recommendation was not found.');
  }
  record.statusById ||= {};
  record.statusById[recommendationId] = {
    status,
    updatedBy: String(userId),
    updatedAt: new Date().toISOString(),
  };
  record.updatedAt = new Date().toISOString();
  await saveHistory(leagueId, history);
  return record;
}

export async function refreshProgressionMessages({ client, guildId, leagueId, periodKey }) {
  const { record } = await loadPeriod(leagueId, periodKey);
  const rules = readRules().progression;
  const registry = await loadJsonFile(threadsFile(guildId), null);
  if (!registry?.teams) throw new Error('Player Upgrades team-thread registry was not found.');
  const byTeam = new Map();
  for (const item of record.recommendations) {
    const list = byTeam.get(item.teamId) || [];
    list.push(item);
    byTeam.set(item.teamId, list);
  }
  const maxEmbeds = Number(rules.discord.recommendationsPerThreadMessage);
  for (const [teamId, messageIds] of Object.entries(record.teamMessages || {})) {
    const threadId = registry.teams[teamId]?.threadId;
    if (!threadId) continue;
    const thread = await client.channels.fetch(threadId);
    if (!thread?.isThread()) throw new Error(`Registered progression thread ${threadId} is unavailable.`);
    const recommendations = byTeam.get(teamId) || [];
    for (let page = 0; page < messageIds.length; page += 1) {
      const message = await thread.messages.fetch(messageIds[page]);
      const batch = recommendations.slice(page * maxEmbeds, (page + 1) * maxEmbeds);
      await message.edit({
        content: message.content,
        embeds: batch.map((item) => progressionCardEmbed(record, item)),
        components: controlsForRecommendations(record, teamId, page, batch),
        allowedMentions: { parse: [] },
      });
    }
  }
  return record;
}

export function buildRecommendationEmbed(record, item) {
  return recordEmbed(record, item);
}

export function buildRecommendationStatusButtons(record, item) {
  return statusButtons(record, null, null, item);
}

export function buildRecommendationSelect(record, teamId, page, entries) {
  return controlsForRecommendations(record, teamId, page, entries);
}

export default {
  buildOffseasonProgressionRecommendations,
  buildRecommendationEmbed,
  buildRecommendationSelect,
  buildRecommendationStatusButtons,
  buildWeeklyProgressionRecommendations,
  loadProgressionPeriod,
  publishProgressionReports,
  recordSeasonAwards,
  refreshProgressionForAwardChange,
  refreshProgressionForSeasonAwardChange,
  refreshProgressionMessages,
  updateProgressionStatus,
};
