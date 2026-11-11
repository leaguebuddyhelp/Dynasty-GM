import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { getDataFilePath, getMaddenLeaguesDir } from '../leaguebuddy/paths.js';
import { getSoloModeConfig, isSoloModeEnabled } from '../leaguebuddy/solo_mode.js';
import { getMaddenChannelId, getMaddenSeasonKey } from '../shared/madden_metadata.js';
import { getFullTeamName } from '../shared/madden_team_names.js';
import { getTeamEmojiByName } from '../shared/madden_visuals.js';
import { getMaddenStatValue, normalizeMaddenStatField } from './madden_stat_fields.js';
import { stablePlayerKey } from './player_identity.js';
import { getLatestReliableRegularSeasonWeekIndex } from './top_players.js';

const RULES_PATH = path.resolve(
  process.env.MADDEN_SOLO_RULES_FILE || path.join(process.cwd(), 'config', 'madden_solo_rules.json'),
);
const AWARDS_PATH = getDataFilePath(path.join('madden', 'awards.json'));
const HISTORY_DIR = getDataFilePath(path.join('madden', 'progression_history'));
const THREADS_DIR = getDataFilePath(path.join('madden', 'progression_threads'));

const STAT_BUCKETS = [
  ['passing', 'playerPassingStatInfoList', [
    'passAtt', 'passComp', 'passCompPct', 'passYds', 'passYdsPerAtt',
    'passYdsPerGame', 'passTDs', 'passInts', 'passSacks', 'passerRating', 'passLongest', 'passPts',
  ]],
  ['rushing', 'playerRushingStatInfoList', [
    'rushAtt', 'rushYds', 'rushTDs', 'fumbles', 'rushBrokenTackles',
    'rushYdsAfterContact', 'rush20PlusYds', 'rushLongest', 'rushYdsPerAtt',
    'rushYdsPerGame', 'rushToPct', 'rushPts',
  ]],
  ['receiving', 'playerReceivingStatInfoList', [
    'recCatches', 'recYds', 'recTDs', 'recDrops', 'recLongest',
    'recYdsAfterCatch', 'recYacPerCatch', 'recYdsPerCatch', 'recCatchPct',
    'recYdsPerGame', 'recToPct', 'recPts',
  ]],
  ['defense', 'playerDefensiveStatInfoList', [
    'defTotalTackles', 'defSacks', 'defInts', 'defForcedFumbles',
    'defRecoveredFumbles', 'defPassDeflections', 'defTDs', 'defCatchAllowed',
    'defIntReturnYds', 'defSafeties', 'defPts',
  ]],
  ['kicking', 'playerKickingStatInfoList', [
    'fgMade', 'fgAtt', 'fg50PlusMade', 'fg50PlusAtt', 'fgCompPct',
    'fgLongest', 'xpMade', 'xpAtt', 'xpCompPct', 'kickPts', 'kickoffAtt', 'kickoffTBs',
  ]],
  ['punting', 'playerPuntingStatInfoList', [
    'pntAtt', 'pntYds', 'pntYdsPerAtt', 'pntNetYds', 'pntNetYdsPerAtt',
    'pntInside20', 'pntLongest', 'pntTBs', 'puntsBlocked',
  ]],
];
const OFFENSIVE_LINE_POSITIONS = new Set(['LT', 'LG', 'C', 'RG', 'RT']);
const DEFENSIVE_POSITIONS = new Set([
  'LE', 'RE', 'DT', 'LOLB', 'MLB', 'ROLB', 'CB', 'FS', 'SS',
  'DE', 'EDGE', 'NT', 'DL', 'LB', 'ILB', 'OLB', 'DB', 'S',
  'LEDGE', 'REDGE', 'LEDG', 'REDG', 'LDE', 'RDE', 'SAM', 'MIKE', 'WILL',
]);
const POSITION_ALIASES = new Map([
  ['RB', 'HB'],
  ['TB', 'HB'],
  ['HALFBACK', 'HB'],
  ['RUNNINGBACK', 'HB'],
  ['FULLBACK', 'FB'],
]);

function progressionPositionKey(position, positionRules) {
  const normalized = String(position || '').toUpperCase().replace(/[\s_-]/g, '');
  const canonical = POSITION_ALIASES.get(normalized) || normalized;
  if (OFFENSIVE_LINE_POSITIONS.has(canonical)) return positionRules.OL ? 'OL' : null;
  if (positionRules[canonical]) return canonical;
  if (DEFENSIVE_POSITIONS.has(canonical) && positionRules.DEF) return 'DEF';
  return null;
}

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
    const rawRows = STAT_BUCKETS.flatMap(([bucket, listKey, fields]) =>
      (entry?.[bucket]?.[listKey] || []).map((player) => [player, fields, false]));
    const hasTotals = Array.isArray(entry.playerTotals) && entry.playerTotals.length > 0;
    const rows = rawRows.length
      ? rawRows
      : hasTotals
        ? entry.playerTotals.map((player) => [player, Object.keys(player?.totals || {}), true])
        : [];
    const touched = new Set();
    for (const [row, fields, hasPlayerTotals] of rows) {
      const key = rosterKeyFor(row, aliases);
      if (!key) continue;
      const target = week.get(key) || {
        playerKey: key,
        position: String(row.position || '').toUpperCase(),
        games: 0,
        totals: {},
      };
      if (hasPlayerTotals && row.totals) {
        const fields = new Set(Object.keys(row.totals).map(normalizeMaddenStatField));
        for (const field of fields) {
          const value = numberOrNull(getMaddenStatValue(row.totals, field));
          if (value !== null) {
            target.totals[field] = (target.totals[field] || 0) + value;
          }
        }
      } else {
        for (const field of fields) {
          const value = numberOrNull(getMaddenStatValue(row, field));
          if (value !== null) target.totals[field] = (target.totals[field] || 0) + value;
        }
      }
      week.set(key, target);
      touched.add(key);
    }
    for (const key of touched) {
      week.get(key).games = 1;
    }
    byWeek.set(weekIndex, week);
  }
  for (const week of byWeek.values()) {
    for (const { totals: stats } of week.values()) {
      if (stats.passAtt > 0) {
        if (stats.passCompPct == null && stats.passComp != null) stats.passCompPct = 100 * stats.passComp / stats.passAtt;
        if (stats.passYdsPerAtt == null && stats.passYds != null) stats.passYdsPerAtt = stats.passYds / stats.passAtt;
      }
      if (stats.recCatches > 0 && stats.recYdsPerCatch == null && stats.recYds != null) {
        stats.recYdsPerCatch = stats.recYds / stats.recCatches;
      }
      if (stats.fgAtt > 0 && stats.fgMade != null && stats.fgCompPct == null) {
        stats.fgCompPct = 100 * stats.fgMade / stats.fgAtt;
      }
      if (stats.pntAtt > 0) {
        if (stats.pntYds != null && stats.pntYdsPerAtt == null) stats.pntYdsPerAtt = stats.pntYds / stats.pntAtt;
        if (stats.pntNetYds != null && stats.pntNetYdsPerAtt == null) stats.pntNetYdsPerAtt = stats.pntNetYds / stats.pntAtt;
      }
    }
  }
  return byWeek;
}

function addOffensiveLineProxies(snapshot, players, aliases, byWeek, weekIndex) {
  const entries = (snapshot?.weeklyStats || []).filter((entry) =>
    Number(entry?.stage ?? entry?.stageIndex ?? 0) === 1 && Number(entry?.weekIndex) === weekIndex);
  const teamStats = new Map();
  const playersByKey = new Map(players.map((player) => [player.key, player]));
  for (const entry of entries) {
    for (const [bucket, list, fields] of [
      ['passing', 'playerPassingStatInfoList', ['passAtt', 'passSacks']],
      ['rushing', 'playerRushingStatInfoList', ['rushAtt', 'rushYds']],
    ]) {
      for (const row of entry?.[bucket]?.[list] || []) {
        const rosterPlayer = playersByKey.get(rosterKeyFor(row, aliases));
        const teamId = String(row.teamId ?? rosterPlayer?.teamId ?? '');
        if (!teamId) continue;
        const totals = teamStats.get(teamId) || { incomplete: new Set() };
        for (const field of fields) {
          const value = numberOrNull(getMaddenStatValue(row, field));
          if (value !== null) totals[field] = (totals[field] || 0) + value;
          else totals.incomplete.add(field);
        }
        teamStats.set(teamId, totals);
      }
    }
  }
  const starters = new Map();
  for (const player of players) {
    if (!OFFENSIVE_LINE_POSITIONS.has(player.position) || player.ovr === null || Number(player.injuryLength || 0) > 0) continue;
    const slot = `${player.teamId}|${player.position}`;
    const previous = starters.get(slot);
    if (!previous || player.ovr > previous.ovr || (player.ovr === previous.ovr && player.key < previous.key)) starters.set(slot, player);
  }
  const week = byWeek.get(weekIndex) || new Map();
  for (const player of starters.values()) {
    const team = teamStats.get(player.teamId);
    if (!team) continue;
    const totals = {};
    if (team.rushAtt >= 10 && team.rushYds != null && !team.incomplete.has('rushAtt') && !team.incomplete.has('rushYds')) {
      totals.teamRushAtt = team.rushAtt;
      totals.teamRushYds = team.rushYds;
      totals.teamRushYpc = team.rushYds / team.rushAtt;
      totals.teamRunScore = clamp(totals.teamRushYpc / 5 * 100, 0, 100);
    }
    if (team.passAtt >= 10 && team.passSacks != null && !team.incomplete.has('passAtt') && !team.incomplete.has('passSacks')) {
      totals.teamPassAtt = team.passAtt;
      totals.teamSacks = team.passSacks;
      totals.teamSackRate = team.passSacks / (team.passAtt + team.passSacks) * 100;
      totals.teamPassScore = clamp(100 - totals.teamSackRate * 5, 0, 100);
    }
    const scores = [totals.teamRunScore, totals.teamPassScore].filter((score) => score != null);
    if (!scores.length) continue;
    totals.teamLineScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    week.set(player.key, { playerKey: player.key, position: player.position, games: 1, totals });
  }
  if (week.size) byWeek.set(weekIndex, week);
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

function getEvidenceAttributes(stats, player, rules, positionRule, maxAttributes = 3) {
  const seenFields = new Set();
  const seenEvidence = new Set();
  const attrs = (positionRule?.attributes || [])
    .filter((rule) => !rule.positions || rule.positions.includes(player.position))
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
    .filter((rule) => {
      const field = rules.attributeFields?.[rule.attribute];
      if (!field || seenFields.has(field) || (!positionRule.allowRepeatedEvidence && seenEvidence.has(rule.evidence))) return false;
      seenFields.add(field);
      seenEvidence.add(rule.evidence);
      return true;
    })
    .slice(0, maxAttributes);
  return attrs.map((rule) => ({
    attribute: rule.attribute,
    field: rules.attributeFields[rule.attribute],
    evidence: rule.evidence,
    evidenceRatio: rule.evidenceValue / Number(rule.minimum),
    currentValue: rule.currentValue,
  }));
}

function getNegativeEvidence(stats, rules, position, games = 1) {
  const checks = rules.negativeEvidence?.[position] || [];
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

export function readWeeklyAwardResults(leagueId, weekNumber, seasonKey) {
  try {
    const store = JSON.parse(readFileSync(AWARDS_PATH, 'utf8'));
    const league = store?.[String(leagueId)];
    if (!seasonKey || league?.__seasonByWeek?.[String(weekNumber)] !== seasonKey) return {};
    return league?.[String(weekNumber)] || {};
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

function selectWithSoftBalance(candidates, rules, maximum, { balanceDirections = false } = {}) {
  const remaining = [...candidates];
  const selected = [];
  const teamCount = new Map();
  const positionCount = new Map();
  const groupCount = new Map();
  const directionCount = { upgrade: 0, downgrade: 0 };
  while (selected.length < maximum && remaining.length) {
    remaining.sort((a, b) => {
      const aPriority = a.selectionScore
        - Number(teamCount.get(a.teamId) || 0) * Number(rules.teamBalancePenalty)
        - Number(positionCount.get(a.position) || 0) * Number(rules.positionBalancePenalty);
      const bPriority = b.selectionScore
        - Number(teamCount.get(b.teamId) || 0) * Number(rules.teamBalancePenalty)
        - Number(positionCount.get(b.position) || 0) * Number(rules.positionBalancePenalty);
      const groupDifference = balanceDirections
        ? (groupCount.get(positionGroup(a.position)) || 0) - (groupCount.get(positionGroup(b.position)) || 0)
        : 0;
      return groupDifference || bPriority - aPriority || a.player.localeCompare(b.player);
    });
    const preferred = directionCount.upgrade <= directionCount.downgrade ? 'upgrade' : 'downgrade';
    const eligibleIndex = balanceDirections ? remaining.findIndex((candidate) =>
      candidate.direction === preferred && candidate.selectionScore >= Number(candidate.minimumSelectionScore)) : -1;
    const next = remaining.splice(eligibleIndex < 0 ? 0 : eligibleIndex, 1)[0];
    const selectionScore = next.selectionScore
      - Number(teamCount.get(next.teamId) || 0) * Number(rules.teamBalancePenalty)
      - Number(positionCount.get(next.position) || 0) * Number(rules.positionBalancePenalty);
    if ((balanceDirections ? next.selectionScore : selectionScore) < Number(next.minimumSelectionScore)) continue;
    selected.push({
      ...next,
      selectionScore: Math.round(selectionScore * 10) / 10,
      selectionAdjustments: {
        ...next.selectionAdjustments,
        teamAndPositionBalance: Math.round((selectionScore - next.selectionScore) * 10) / 10,
      },
    });
    directionCount[next.direction] += 1;
    teamCount.set(next.teamId, (teamCount.get(next.teamId) || 0) + 1);
    positionCount.set(next.position, (positionCount.get(next.position) || 0) + 1);
    const group = positionGroup(next.position);
    const groupWeight = group === 'K' || group === 'P' ? 3 : 1;
    groupCount.set(group, (groupCount.get(group) || 0) + groupWeight);
  }
  return selected;
}

function positionGroup(position) {
  const pos = String(position || '').toUpperCase();
  if (OFFENSIVE_LINE_POSITIONS.has(pos)) return 'OL';
  if (['HB', 'RB', 'TB', 'FB'].includes(pos)) return 'RB';
  if (['LE', 'RE', 'DT', 'DE', 'EDGE', 'NT', 'DL', 'LEDGE', 'REDGE', 'LEDG', 'REDG', 'LDE', 'RDE'].includes(pos)) return 'DL';
  if (['LOLB', 'MLB', 'ROLB', 'LB', 'ILB', 'OLB', 'SAM', 'MIKE', 'WILL'].includes(pos)) return 'LB';
  if (['CB', 'FS', 'SS', 'DB', 'S'].includes(pos)) return 'DB';
  return pos;
}

function getPlayerWindowScores(playerKey, player, byWeek, endWeek, positionKey, weeklyRules) {
  const gameRows = [...byWeek.entries()]
    .filter(([weekIndex]) => weekIndex <= endWeek)
    .sort(([a], [b]) => a - b)
    .map(([weekIndex, players]) => ({ weekIndex, row: players.get(playerKey) }))
    .filter(({ row }) => row?.games);
  const positionRule = weeklyRules.positions[positionKey];
  const metrics = gameRows.map(({ weekIndex, row }) => ({
    weekIndex,
    row,
    score: performanceMetrics(row.totals, player.ovr, positionRule, weeklyRules)?.score ?? 0,
  }));
  const recent = metrics.slice(-Number(weeklyRules.rollingGames));
  const seasonScores = metrics.map((item) => item.score);
  const recentScores = recent.map((item) => item.score);
  const consecutive = (predicate) => {
    let count = 0;
    for (let index = metrics.length - 1; index >= 0; index -= 1) {
      if (!opportunityConfirmed(metrics[index].row.totals, positionKey, weeklyRules)
        || !predicate(metrics[index].score)) break;
      count += 1;
    }
    return count;
  };
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
    consistency: {
      ...getStrongPoorCounts(recentScores, weeklyRules),
      strongStreak: consecutive((score) => score >= Number(weeklyRules.strongGameScore)),
      poorStreak: consecutive((score) => score <= Number(weeklyRules.poorGameScore)),
    },
    seasonConsistency: getStrongPoorCounts(seasonScores, weeklyRules),
  };
}

function selectNegativeAttributes(stats, player, position, rules, games = 1, maxAttributes = 3) {
  const checks = rules.negativeEvidence?.[position] || [];
  const selected = [];
  const usedFields = new Set();
  for (const check of checks) {
    const requiredFields = [check.field, check.opportunityField];
    if (check.minimumMisses !== undefined) requiredFields.push(check.attemptsField);
    if (check.maximumRate !== undefined) requiredFields.push(check.rateField);
    if (requiredFields.some((field) => !field || stats?.[field] == null)) continue;
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
    if (field && !usedFields.has(field) && currentValue !== null && currentValue > 0 && currentValue <= 99) {
      let evidenceRatio = 1;
      if (Number(check.minimum) > 0) evidenceRatio = Number(stats[check.field]) / (Number(check.minimum) * Math.max(1, games));
      else if (Number(check.minimumMisses) > 0) evidenceRatio = (Number(stats[check.attemptsField]) - Number(stats[check.field])) / Number(check.minimumMisses);
      else if (Number(check.maximumRate) > 0) {
        const rate = Number(stats[check.field]) / Number(stats[check.rateField]);
        evidenceRatio = rate > 0 ? Number(check.maximumRate) / rate : Number.MAX_SAFE_INTEGER;
      }
      selected.push({ attribute: check.attribute, field, evidence: check.field, evidenceRatio, currentValue });
      usedFields.add(field);
      if (selected.length >= maxAttributes) break;
    }
  }
  return selected;
}

export function performanceAdjustedRatings(snapshot, rules = readRules().progression) {
  const info = snapshot?.info?.careerHubInfo?.seasonInfo || {};
  const type = Number(info.seasonWeekType ?? 1);
  if (type === 0) return new Map();
  const currentWeek = Number(snapshot?.currentWeek);
  if (type === 1 && (!Number.isInteger(currentWeek) || currentWeek < 2)) return new Map();
  const cap = type === 1 ? Math.min(17, currentWeek - 2) : 17;
  const endWeek = getLatestReliableRegularSeasonWeekIndex(snapshot, cap);
  if (endWeek === null || endWeek < 0) return new Map();
  const { players, aliases } = getRosterPlayers(snapshot);
  const byWeek = buildWeeklyPlayerStats(snapshot, aliases, { requestedWeekIndex: endWeek });
  addOffensiveLineProxies(snapshot, players, aliases, byWeek, endWeek);
  const recentAwards = Array.from({ length: Math.min(4, endWeek + 1) }, (_, index) =>
    readWeeklyAwardResults(snapshot.leagueId, endWeek + 1 - index, getMaddenSeasonKey(snapshot)));
  const ratings = new Map();
  for (const player of players) {
    if (player.ovr === null) continue;
    const positionKey = progressionPositionKey(player.position, rules.weekly.positions);
    if (!positionKey) continue;
    const windows = getPlayerWindowScores(player.key, player, byWeek, endWeek, positionKey, rules.weekly);
    if (!windows.latest || !opportunityConfirmed(windows.latest.row.totals, positionKey, rules.weekly)) continue;
    const positionRule = rules.weekly.positions[positionKey];
    const positive = getEvidenceAttributes(windows.latest.row.totals, player, rules.weekly, positionRule, 1).length > 0;
    const negative = selectNegativeAttributes(windows.latest.row.totals, player, positionKey, rules.weekly, 1, 1).length > 0;
    const score = windows.currentScore * 0.65 + windows.recentScore * 0.35;
    let change = Math.round(clamp((score - 55) / 12, -3, 3));
    if (change > 0 && !positive) change = 0;
    if (change < 0 && !negative) change = 0;
    if (change > 0) {
      if (windows.consistency.strongStreak >= 3) change += 1;
      if (numberOrNull(player.yearsPro) !== null && Number(player.yearsPro) <= 2 && score >= 70) change += 1;
      const awardWeeks = recentAwards.filter((winners) => getWeeklyAwardPoints(winners, player, players, aliases, rules.weekly) > 0).length;
      if (awardWeeks >= 2 && score >= 70) change += 1;
    } else if (change < 0 && windows.consistency.poorStreak >= 3) change -= 1;
    change = clamp(change, -5, 5);
    const adjusted = clamp(player.ovr + change, 0, 99);
    ratings.set(player.key, { adjusted, change: adjusted - player.ovr, score: Math.round(score * 10) / 10, lastWeek: windows.latest.weekIndex + 1 });
  }
  return ratings;
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
  addOffensiveLineProxies(snapshot, players, aliases, byWeek, Number(weekIndex));
  const weekPlayers = byWeek.get(Number(weekIndex)) || new Map();
  const recentAwardWinners = Array.from({ length: Math.min(4, Number(weekIndex) + 1) }, (_, index) =>
    index === 0 && Object.keys(awardWinners).length
      ? awardWinners
      : readWeeklyAwardResults(snapshot.leagueId, weekNumber - index, seasonKey));
  const population = populationSnapshot(players, rules);
  const candidates = [];
  for (const player of players) {
    if (player.ovr === null) continue;
    const positionRules = weeklyRules.positions;
    const positionKey = progressionPositionKey(player.position, positionRules);
    const positionRule = positionKey ? positionRules[positionKey] : null;
    if (!positionRule) continue;
    const current = weekPlayers.get(player.key);
    if (!current || !opportunityConfirmed(current.totals, positionKey, weeklyRules)) continue;
    const windows = getPlayerWindowScores(player.key, player, byWeek, Number(weekIndex), positionKey, weeklyRules);
    const currentMetrics = performanceMetrics(current.totals, player.ovr, positionRule, weeklyRules);
    const rotatedAttributes = positionRule.attributes.length
      ? (() => {
        const offset = (parseInt(stableHash(player.key).slice(0, 8), 16) + Number(weekIndex)) % positionRule.attributes.length;
        return [...positionRule.attributes.slice(offset), ...positionRule.attributes.slice(0, offset)];
      })()
      : positionRule.attributes;
    const currentAttributeEvidence = getEvidenceAttributes(
      current.totals,
      player,
      weeklyRules,
      { ...positionRule, attributes: rotatedAttributes },
      Number(weeklyRules.attributesPerRecommendation || 3),
    );
    const awareness = numberOrNull(player[weeklyRules.attributeFields?.Awareness]);
    const awarenessInterval = Number(weeklyRules.awarenessUpgradeEveryWeeks ?? 3);
    if (awareness !== null && awareness >= 0 && awareness < 99
      && currentMetrics.score >= Number(weeklyRules.awarenessMinimumGameScore ?? weeklyRules.strongGameScore)
      && Number.isInteger(awarenessInterval) && awarenessInterval > 0
      && (parseInt(stableHash(player.key).slice(0, 8), 16) + Number(weekIndex)) % awarenessInterval === 0) {
      currentAttributeEvidence.splice(Math.max(0, Number(weeklyRules.attributesPerRecommendation || 3) - 1));
      currentAttributeEvidence.push({
        attribute: 'Awareness', field: weeklyRules.attributeFields.Awareness,
        evidence: 'currentGameScore', evidenceRatio: 1, currentValue: awareness,
      });
    }
    const seasonKeyOvr = numberOrNull(startingOveralls[player.key]) ?? player.ovr;
    const positivePointsUsed = sumAttributePoints(history, seasonKey, player.key, 'positive');
    const negativePointsUsed = sumAttributePoints(history, seasonKey, player.key, 'negative');
    const soft = positiveSeasonPenalty(positivePointsUsed, seasonKeyOvr, rules.offseason);
    const populationAdjustment = getPopulationSoftPenalty(player, population, rules);
    const weeklyAwards = getWeeklyAwardPoints(awardWinners, player, players, aliases, weeklyRules);
    const awardWeeks = recentAwardWinners.filter((winners) =>
      getWeeklyAwardPoints(winners, player, players, aliases, weeklyRules) > 0).length;
    const breakout = weeklyAwards > 0
      && player.ovr <= Number(weeklyRules.breakoutMaximumOvr ?? 70)
      && currentMetrics.score >= Number(weeklyRules.breakoutMinimumGameScore ?? 85);
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
    let evidence = [];
    let priorityBase = 0;
    if ((windows.performanceScore >= Number(weeklyRules.minimumUpgradePerformanceScore) || breakout)
      && currentAttributeEvidence.length) {
      const tier = getTier(breakout ? Math.max(windows.performanceScore, currentMetrics.score) : windows.performanceScore, weeklyRules.positiveChangeTiers, 'minimumScore');
      if (tier) {
        direction = 'upgrade';
        points = Number(tier.attributePoints);
        evidence = currentAttributeEvidence;
        priorityBase = (breakout ? Math.max(windows.performanceScore, currentMetrics.score) : windows.performanceScore) + consistencyBonus + improvingTrendBonus
            + exceptionalConsistencyBonus + weeklyAwards
          - soft.penalty - populationAdjustment;
      }
    } else if (windows.performanceScore <= Number(weeklyRules.maximumDowngradePerformanceScore)) {
      const negative = selectNegativeAttributes(
        current.totals,
        player,
        positionKey,
        weeklyRules,
        1,
        Number(weeklyRules.attributesPerRecommendation || 3),
      );
      const tier = getNegativeTier(windows.performanceScore, weeklyRules.negativeChangeTiers);
      if (negative.length && tier) {
        direction = 'downgrade';
        points = Number(tier.attributePoints);
        evidence = negative;
        priorityBase = 100 - windows.performanceScore + poorConsistencyBonus + decliningTrendBonus;
      }
    }
    if (!direction || !evidence.length || !points) continue;
    selectionAdjustments.consistency = direction === 'downgrade'
      ? poorConsistencyBonus + decliningTrendBonus
      : consistencyBonus + improvingTrendBonus + exceptionalConsistencyBonus;
    const streak = direction === 'upgrade' ? windows.consistency.strongStreak : windows.consistency.poorStreak;
    const maxPoints = Number(weeklyRules.maximumWeeklyAttributePoints ?? 5);
    const streakThreshold = Number(weeklyRules.streakGamesForExtraPoint ?? 3);
    const streakBonus = Math.max(0, streak - streakThreshold + 1);
    const youngMomentum = direction === 'upgrade'
      && numberOrNull(player.yearsPro) !== null
      && Number(player.yearsPro) <= Number(weeklyRules.youngMomentumMaxYearsPro ?? 2)
      && currentMetrics.score >= Number(weeklyRules.momentumMinimumGameScore ?? 85)
      && streak >= Number(weeklyRules.momentumMinimumStrongStreak ?? 2);
    const awardMomentum = direction === 'upgrade'
      && awardWeeks >= Number(weeklyRules.momentumAwardWeeks ?? 2)
      && currentMetrics.score >= Number(weeklyRules.momentumMinimumGameScore ?? 85);
    const allocation = evidence.flatMap((attribute, index) => {
      const ratio = attribute.evidenceRatio ?? 1;
      let magnitude = 1;
      if (breakout && direction === 'upgrade') {
        magnitude = Number(weeklyRules.breakoutBasePoints ?? 3)
          + (ratio >= Number(weeklyRules.strongEvidenceRatio ?? 1.5) ? 1 : 0)
          + (currentMetrics.score >= Number(weeklyRules.breakoutEliteGameScore ?? 95) && ratio >= 2 ? 1 : 0);
      } else if (direction === 'upgrade'
        && currentMetrics.score >= Number(weeklyRules.outstandingGameScore ?? 90)
        && ratio >= Number(weeklyRules.strongEvidenceRatio ?? 1.5)) {
        magnitude += 1;
      } else if (direction === 'downgrade'
        && currentMetrics.score <= Number(weeklyRules.severeGameScore ?? 15)
        && ratio >= Number(weeklyRules.severeEvidenceRatio ?? 2)) {
        magnitude += 1;
      }
      if (index === 0 || ratio >= Number(weeklyRules.streakEvidenceRatio ?? 1.3)) magnitude += streakBonus;
      if (index === 0 && !breakout) magnitude += Number(youngMomentum) + Number(awardMomentum);
      magnitude = Math.min(maxPoints, magnitude);
      return attributeAllocation(attribute, direction === 'upgrade' ? magnitude : -magnitude);
    });
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
      stats: allocation.some((item) => item.evidence === 'currentGameScore')
        ? { ...current.totals, currentGameScore: currentMetrics.score }
        : current.totals,
      attributes: allocation,
      currentWeekScore: windows.currentScore,
      recentFourGameScore: windows.recentScore,
      seasonToDateScore: windows.seasonScore,
      explanation: `${breakout ? `Breakout: ${player.ovr} OVR, weekly award, game score ${currentMetrics.score.toFixed(1)}. ` : ''}${streak >= streakThreshold ? `${streak}-game ${direction === 'upgrade' ? 'strong' : 'poor'} streak increased supported changes. ` : ''}${direction === 'upgrade' ? 'Positive' : 'Negative'} evidence: ${allocation.map((item) => `${item.attribute} (${item.evidence})`).join(', ')}. Stronger evidence and game performance can change individual amounts.`,
    });
    selected.changeContext = { breakout, streakBonus, youngMomentum, awardMomentum, teamLineProxy: positionKey === 'OL' };
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
    { balanceDirections: true },
  );
  const record = makeRecord({
    snapshot,
    type: 'weekly',
    weekIndex: Number(weekIndex),
    recommendations: selected,
    population,
    rules,
  });
  record.selectionDiagnostics = {
    eligibleCandidates: candidates.filter((candidate) =>
      candidate.selectionScore >= candidate.minimumSelectionScore).length,
    preferredMinimum: Number(weeklyRules.preferredRecommendationRange?.[0] || 0),
  };
  return record;
}

function makeOffseasonAttributes(player, stats, rules, positionKey, direction, tier, seasonGames) {
  const positionRule = rules.weekly.positions[positionKey];
  if (!positionRule) return [];
  if (direction === 'upgrade') {
    const positives = getEvidenceAttributes(
      stats,
      player,
      rules.weekly,
      positionRule,
      Number(rules.offseason.attributesPerRecommendation ?? rules.weekly.attributesPerRecommendation ?? 3),
    );
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
  const negatives = selectNegativeAttributes(
    stats,
    player,
    positionKey,
    rules.weekly,
    seasonGames,
    Number(rules.offseason.attributesPerRecommendation ?? rules.weekly.attributesPerRecommendation ?? 3),
  );
  return negatives.flatMap((evidence) => attributeAllocation(evidence, Number(tier.primaryPoints)));
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
    const positionKey = progressionPositionKey(player.position, positionRules);
    const positionRule = positionKey ? positionRules[positionKey] : null;
    if (!positionRule) continue;
    const windows = getPlayerWindowScores(player.key, player, byWeek, maxWeek, positionKey, rules.weekly);
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
    const attributes = makeOffseasonAttributes(player, totalStats, rules, positionKey, direction, tier, games);
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
        : `Full-season performance score ${seasonScore.toFixed(1)} with verified attribute-specific evidence for ${attributes.map((item) => item.attribute).join(', ')}.`,
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

const STAT_LABELS = {
  currentGameScore: 'Game performance score',
  teamRushAtt: 'Team carries', teamRushYds: 'Team rushing yards', teamRushYpc: 'Team yards per carry',
  teamPassAtt: 'Team pass attempts', teamSacks: 'Team sacks allowed', teamSackRate: 'Team sack rate',
  teamRunScore: 'Team run-blocking proxy', teamPassScore: 'Team pass-protection proxy', teamLineScore: 'Team line proxy score',
  passAtt: 'Pass attempts', passComp: 'Completions', passCompPct: 'Completion rate',
  passYds: 'Passing yards', passYdsPerAtt: 'Yards per pass', passTDs: 'Passing touchdowns',
  passInts: 'Interceptions thrown', passSacks: 'Sacks taken', passLongest: 'Longest pass',
  rushAtt: 'Carries', rushYds: 'Rushing yards', rushTDs: 'Rushing touchdowns',
  fumbles: 'Fumbles', rushBrokenTackles: 'Broken tackles', rushYdsAfterContact: 'Yards after contact',
  rush20PlusYds: 'Runs of 20+ yards', rushLongest: 'Longest run',
  recCatches: 'Receptions', recYds: 'Receiving yards', recTDs: 'Receiving touchdowns',
  recDrops: 'Drops', recLongest: 'Longest reception', recYdsPerCatch: 'Yards per catch',
  recCatchPct: 'Catch rate', recYdsAfterCatch: 'Yards after catch',
  defTotalTackles: 'Tackles', defSacks: 'Sacks', defInts: 'Interceptions',
  defForcedFumbles: 'Forced fumbles', defRecoveredFumbles: 'Fumble recoveries',
  defPassDeflections: 'Pass deflections', defTDs: 'Defensive touchdowns',
  defSafeties: 'Safeties', defCatchAllowed: 'Catches allowed',
  fgMade: 'Field goals made', fgAtt: 'Field goal attempts', fgCompPct: 'Field goal rate',
  fgLongest: 'Longest field goal', fg50PlusMade: 'Field goals from 50+ yards',
  xpMade: 'Extra points made', xpAtt: 'Extra point attempts',
  pntAtt: 'Punts', pntYds: 'Punting yards', pntYdsPerAtt: 'Yards per punt',
  pntNetYdsPerAtt: 'Net yards per punt', pntInside20: 'Punts inside the 20',
  passYdsPerGame: 'Passing yards per game', passerRating: 'Passer rating', passPts: 'Passing points',
  rushYdsPerAtt: 'Yards per carry', rushYdsPerGame: 'Rushing yards per game',
  rushToPct: 'Rushing turnover rate', rushPts: 'Rushing points',
  recYacPerCatch: 'Yards after catch per reception', recYdsPerGame: 'Receiving yards per game',
  recToPct: 'Receiving turnover rate', recPts: 'Receiving points',
  defIntReturnYds: 'Interception return yards', defPts: 'Defensive points',
  fg50PlusAtt: 'Field goal attempts from 50+ yards', xpCompPct: 'Extra point rate',
  kickPts: 'Kicking points', kickoffAtt: 'Kickoffs', kickoffTBs: 'Kickoff touchbacks',
  pntNetYds: 'Net punting yards', pntLongest: 'Longest punt', pntTBs: 'Punt touchbacks',
  puntsBlocked: 'Punts blocked',
};

function statLabel(field) {
  if (STAT_LABELS[field]) return STAT_LABELS[field];
  return String(field || '').replace(/^(pass|rush|rec|def|fg|xp|pnt)/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (letter) => letter.toUpperCase());
}

function recommendationEvidence(item) {
  const fields = [...new Set([
    ...item.attributes.map((attribute) => attribute.evidence),
    ...['passYds', 'passAtt', 'passComp', 'passTDs', 'passInts', 'rushYds', 'recYds', 'defTotalTackles'],
    ...Object.keys(item.stats || {}),
  ])];
  return fields
    .filter((key) => key && item.stats?.[key] != null && Number.isFinite(Number(item.stats[key])))
    .slice(0, 10)
    .map((key) => `${statLabel(key)}: ${Math.round(Number(item.stats[key]) * 10) / 10}${/(Pct|SackRate)$/.test(key) ? '%' : ''}`)
    .join(' · ') || 'No statistics available';
}

function recommendationWhy(record, item) {
  const labels = [...new Set((item.attributes || []).map((attribute) => statLabel(attribute.evidence)).filter(Boolean))];
  const evidence = labels.length ? labels.join(', ').toLowerCase() : 'the available game statistics';
  const reasons = [`${item.direction === 'upgrade' ? 'Strong' : 'Poor'} performance in ${evidence}.`];
  if (item.changeContext?.teamLineProxy) {
    const sources = [item.stats?.teamRunScore != null ? 'rushing' : null, item.stats?.teamPassScore != null ? 'pass protection' : null].filter(Boolean).join(' and ');
    reasons[0] = `Team ${sources} performance is a proxy, not individual blocking stats. Starter estimated from the highest-rated player at this position who is not listed as injured.`;
  }
  if (record.type === 'weekly' && item.awardPoints > 0) reasons.push('Won a weekly award.');
  if (item.attributes.some((attribute) => attribute.attribute === 'Awareness' && attribute.evidence === 'currentGameScore')) {
    reasons.push('Awareness is estimated from game performance, not measured directly.');
  }
  if (item.changeContext?.breakout) {
    reasons.push('Exceptional play for a lower-rated player earned a larger boost.');
  }
  if (item.changeContext?.youngMomentum) reasons.push('Sustained strong play accelerated this young player’s development.');
  if (item.changeContext?.awardMomentum) reasons.push('Multiple recent weekly awards increased the strongest change.');
  const streak = item.direction === 'upgrade' ? item.consistency?.strongStreak : item.consistency?.poorStreak;
  if (item.changeContext?.streakBonus > 0) reasons.push(`${streak} consecutive ${item.direction === 'upgrade' ? 'strong' : 'poor'} games increased some changes.`);
  return reasons.join(' ');
}

function recommendationBreakdown(item) {
  const score = (value) => value == null || !Number.isFinite(Number(value)) ? 'N/A' : `${Math.round(Number(value) * 10) / 10}/100`;
  const streak = item.direction === 'upgrade' ? item.consistency?.strongStreak : item.consistency?.poorStreak;
  return `This game: ${score(item.windows?.currentGame)} · Recent: ${score(item.windows?.recentFourGames)} · Season: ${score(item.windows?.seasonToDate)}\n${item.direction === 'upgrade' ? 'Strong' : 'Poor'} streak: ${streak ?? 'N/A'} played games`;
}

function recordEmbed(record, item) {
  const upgrade = item.direction === 'upgrade';
  const emoji = getTeamEmojiByName(item.team);
  const attributeLines = item.attributes.map((attribute) =>
    `**${attribute.attribute}** ${attribute.currentValue} → ${attribute.targetValue} (${attribute.points > 0 ? '+' : ''}${attribute.points})`).join('\n');
  const statistics = recommendationEvidence(item);
  const status = record.statusById?.[item.recommendationId]?.status || 'pending';
  const embed = new EmbedBuilder()
    .setTitle(`${upgrade ? '📈 Upgrade' : '📉 Downgrade'} · ${item.player}`)
    .setDescription(`${emoji ? `${emoji} ` : ''}**${item.team}** · ${item.position} · ${item.currentOvr} OVR\n\n${attributeLines}`)
    .addFields(
      { name: 'Why', value: recommendationWhy(record, item).slice(0, 1024), inline: false },
      { name: 'Recent performance', value: statistics.slice(0, 1024), inline: false },
      { name: 'Score breakdown', value: recommendationBreakdown(item).slice(0, 1024), inline: false },
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
  const embed = new EmbedBuilder()
    .setTitle(`${upgrade ? '🟢 Upgrade' : '🟠 Downgrade'} · ${item.player}`)
    .setDescription(`${emoji ? `${emoji} ` : ''}**${item.team}** · ${item.position} · ${item.currentOvr} OVR\n\n${attributes}`)
    .addFields(
      { name: 'Why', value: recommendationWhy(record, item).slice(0, 400), inline: false },
      { name: 'Stats', value: recommendationEvidence(item).slice(0, 300), inline: false },
      { name: 'Score breakdown', value: recommendationBreakdown(item).slice(0, 250), inline: false },
    )
    .setColor(upgrade ? 0x2ecc71 : 0xe67e22)
    .setFooter({ text: `${seasonLabel(record.seasonKey)} · ${record.weekNumber ? `Week ${record.weekNumber}` : 'Offseason'} · Apply changes in Madden` })
    .setTimestamp(new Date(record.generatedAt));
  if (typeof item.playerImage === 'string' && /^https?:\/\//i.test(item.playerImage)) {
    embed.setThumbnail(item.playerImage);
  }
  return embed;
}

function controlsForRecommendations(record, teamId, page, entries) {
  return [];
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

export function isOffseason(snapshot) {
  const info = snapshot?.info?.careerHubInfo?.seasonInfo || {};
  const rawWeekType = info.seasonWeekType ?? info.seasonWeekTypeId ?? snapshot?.stage;
  const weekType = rawWeekType == null ? null : Number(rawWeekType);
  if ([0, 1, 2].includes(weekType)) return false;
  return weekType === 3
    || weekType === 8
    || Number(info.offSeasonStage || 0) > 0
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

async function seasonComparisonBaseline(leagueId, seasonKey) {
  const file = path.join(getMaddenLeaguesDir(), 'history', safeId(leagueId, 'Madden league ID'), 'index.json');
  const index = await loadJsonFile(file, { records: [] });
  if (!Array.isArray(index.records)) throw new Error(`Invalid sync history index for league ${leagueId}.`);
  const directory = path.dirname(file);
  for (const entry of [...index.records].sort((a, b) => String(a.syncedAt || '').localeCompare(String(b.syncedAt || '')))) {
    if (!entry.syncId) throw new Error(`Sync history for league ${leagueId} contains a record without a sync ID.`);
    const archived = await loadJsonFile(path.join(directory, `${safeId(entry.syncId, 'sync ID')}.json`), null);
    if (!archived) throw new Error(`A sync history snapshot is missing for league ${leagueId}.`);
    if (getMaddenSeasonKey(archived) !== seasonKey) continue;
    const info = archived?.info?.careerHubInfo?.seasonInfo || {};
    const rawType = info.seasonWeekType ?? info.seasonWeekTypeId ?? archived.stage;
    if (rawType == null || ![0, 1].includes(Number(rawType))) continue;
    const week = numberOrNull(archived.currentWeek ?? info.seasonWeek);
    const partial = Number(rawType) === 1 && (week === null || week > 1 || week < 1);
    const label = Number(rawType) === 0 ? 'Preseason' : week && week >= 1 ? `Week ${week}` : 'Regular season, week unknown';
    return { snapshot: archived, label, partial };
  }
  return null;
}

export function buildSeasonOverallChanges(snapshot, baseline) {
  const original = new Map((baseline ? getRosterPlayers(baseline).players : [])
    .filter((player) => player.ovr !== null && player.ovr >= 0 && player.ovr <= 99 && !player.key.startsWith('fallback:'))
    .map((player) => [player.key, player.ovr]));
  const byTeam = new Map();
  for (const player of getRosterPlayers(snapshot).players) {
    const start = original.get(player.key);
    if (player.ovr === null || player.ovr < 0 || player.ovr > 99 || start === undefined) continue;
    const change = player.ovr - start;
    if (!change) continue;
    const group = byTeam.get(player.teamId) || { upgrades: [], downgrades: [] };
    group[change > 0 ? 'upgrades' : 'downgrades'].push({
      key: player.key, name: player.name, position: player.position,
      start, end: player.ovr, change,
    });
    byTeam.set(player.teamId, group);
  }
  for (const group of byTeam.values()) {
    group.upgrades.sort((a, b) => b.change - a.change || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
    group.downgrades.sort((a, b) => a.change - b.change || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
    group.upgrades = group.upgrades.slice(0, 10);
    group.downgrades = group.downgrades.slice(0, 10);
  }
  return byTeam;
}

function seasonOverallChangesEmbed(record, teamName, baseline, changes) {
  const format = (players) => players.length
    ? players.map((player, index) => `**${index + 1}.** ${player.name.slice(0, 50)} · ${player.position.slice(0, 10)} · ${player.start} → ${player.end} (${player.change > 0 ? '+' : ''}${player.change})`).join('\n')
    : 'No qualifying changes.';
  const emoji = getTeamEmojiByName(teamName);
  const description = baseline
    ? `Comparing actual Madden OVR from **${baseline.label}** to the latest offseason sync.${baseline.partial ? '\n**Partial-season comparison:** no preseason or Week 1 snapshot is available.' : ''}\nPlayers are listed on their current team; players without a matching baseline rating are excluded.`
    : 'No preseason or regular-season snapshot is available for this season. Sync during the season to establish a comparison baseline.';
  return new EmbedBuilder()
    .setTitle('📊 Season OVR Changes')
    .setDescription(`${emoji ? `${emoji} ` : ''}**${teamName} · ${seasonLabel(record.seasonKey)}**\n\n${description}`)
    .addFields(
      { name: '📈 Top 10 Upgrades', value: format(changes?.upgrades || []) },
      { name: '📉 Top 10 Downgrades', value: format(changes?.downgrades || []) },
    )
    .setColor(0x5865f2)
    .setFooter({ text: 'Actual Madden OVR · Updates on offseason syncs' });
}

async function publishSeasonOverallChanges(client, guildId, snapshot, record, history, registry) {
  const baseline = await seasonComparisonBaseline(record.leagueId, record.seasonKey);
  const changes = buildSeasonOverallChanges(snapshot, baseline?.snapshot);
  record.seasonChangeMessages ||= {};
  const messages = record.seasonChangeMessages[guildId] ||= {};
  for (const team of snapshot?.teams?.leagueTeamInfoList || []) {
    const teamId = String(team.teamId);
    const registered = registry.teams[teamId];
    if (!registered?.threadId) throw new Error(`No progression thread is registered for team ${teamId}.`);
    const thread = await client.channels.fetch(registered.threadId);
    if (!thread?.isThread()) throw new Error(`Registered progression thread ${registered.threadId} is unavailable.`);
    if (thread.archived) await thread.setArchived(false, 'Season overall changes');
    const payload = {
      embeds: [seasonOverallChangesEmbed(record, registered.teamName, baseline, changes.get(teamId))],
      allowedMentions: { parse: [] },
    };
    const previous = messages[teamId];
    let message = null;
    if (previous?.threadId === thread.id && previous.messageId) {
      message = await thread.messages.fetch(previous.messageId).catch((error) => {
        if (error?.code === 10008) return null;
        throw error;
      });
    }
    if (message) await message.edit(payload);
    else message = await thread.send(payload);
    messages[teamId] = { threadId: thread.id, messageId: message.id };
    await saveHistory(record.leagueId, history);
  }
  return { teamCount: (snapshot?.teams?.leagueTeamInfoList || []).length, baseline: baseline?.label || null, partial: Boolean(baseline?.partial) };
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
      awardWinners: awardWinners || readWeeklyAwardResults(leagueId, Number(weekIndex) + 1, seasonKey),
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
  const seasonChanges = type === 'offseason'
    ? await publishSeasonOverallChanges(client, guildId, snapshot, record, history, await loadJsonFile(threadsFile(guildId), null))
    : null;
  return {
    ...output,
    ...(seasonChanges ? { seasonChanges } : {}),
    published: record.recommendations.length > 0,
    ...(record.recommendations.length ? {} : { reason: 'No players met the configured evidence threshold.' }),
    periodKey: record.periodKey,
    type: record.type,
    ...(record.selectionDiagnostics ? { selectionDiagnostics: record.selectionDiagnostics } : {}),
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

export function buildProgressionCardEmbed(record, item) {
  return progressionCardEmbed(record, item);
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
