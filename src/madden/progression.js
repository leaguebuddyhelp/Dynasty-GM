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
import { seasonProductionReward, buildTeamFormContexts } from './weekly_progression_context.js';
import { normalizePlayoffProgressionSnapshot, hasPlayoffPlayerData } from './playoff_stats.js';
import { loadFullSeasonRun, matchesFullSeason } from './full_season_store.js';
import { buildTeamReportIndex } from './report_navigation.js';
import { getFranchisePhase } from './franchise_phase.js';
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
  if (!Number.isFinite(Number(offseason.minimumUpgradePerformanceScore))
    || offseason.minimumUpgradePerformanceScore == null) {
    throw new Error(`Missing offseason minimum upgrade performance score in ${RULES_PATH}.`);
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
        observedTeamIds: new Set(),
        observedPositions: new Set(),
        missingTeamId: false,
      };
      if (row.teamId == null || String(row.teamId).trim() === '') target.missingTeamId = true;
      else target.observedTeamIds.add(String(row.teamId));
      if (row.position) target.observedPositions.add(String(row.position).toUpperCase());
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

function projectedOffensiveLineStarters(players) {
  const starters = new Map();
  for (const player of players) {
    if (!OFFENSIVE_LINE_POSITIONS.has(player.position) || player.ovr === null || Number(player.injuryLength || 0) > 0) continue;
    const slot = `${player.teamId}|${player.position}`;
    const previous = starters.get(slot);
    if (!previous || player.ovr > previous.ovr || (player.ovr === previous.ovr && player.key < previous.key)) starters.set(slot, player);
  }
  return starters;
}

function clearOffensiveLineStats(byWeek, players) {
  const lineKeys = players.filter((player) => OFFENSIVE_LINE_POSITIONS.has(player.position)).map((player) => player.key);
  for (const week of byWeek.values()) {
    for (const key of lineKeys) week.delete(key);
  }
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
  const starters = projectedOffensiveLineStarters(players);
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

function inactivityObservations(snapshot, players, byWeek, weekIndex) {
  const week = (snapshot?.weeklyStats || []).find((entry) =>
    Number(entry?.stage ?? entry?.stageIndex ?? 0) === 1 && Number(entry?.weekIndex) === weekIndex);
  const games = (snapshot?.schedule?.schedules || []).filter((game) =>
    Number(game.stageIndex ?? game.stage ?? -1) === 1
    && Number(game.weekIndex) === weekIndex && Number(game.status) >= 2);
  const playedTeams = new Set(games.flatMap((game) => [String(game.homeTeamId ?? ''), String(game.awayTeamId ?? '')]));
  const positions = {
    QB: ['passing', 'playerPassingStatInfoList'], HB: ['rushing', 'playerRushingStatInfoList'],
    FB: ['rushing', 'playerRushingStatInfoList'], WR: ['receiving', 'playerReceivingStatInfoList'],
    TE: ['receiving', 'playerReceivingStatInfoList'], DEF: ['defense', 'playerDefensiveStatInfoList'],
    K: ['kicking', 'playerKickingStatInfoList'], P: ['punting', 'playerPuntingStatInfoList'],
  };
  const observations = {};
  for (const player of players) {
    const positionKey = progressionPositionKey(player.position, positions);
    const bucket = positions[positionKey];
    if (!bucket || !playedTeams.has(player.teamId) || !player.key || player.key.startsWith('fallback:')
      || Number(player.injuryLength || 0) > 0) continue;
    const rows = week?.[bucket[0]]?.[bucket[1]];
    if (!Array.isArray(rows) || !rows.some((row) => String(row.teamId ?? '') === player.teamId)) continue;
    const current = byWeek.get(weekIndex)?.get(player.key);
    const hasStats = current && Object.values(current.totals).some((value) => Number.isFinite(value) && value !== 0);
    observations[player.key] = { teamId: player.teamId, position: player.position, missing: !hasStats };
  }
  return observations;
}

function inactivityStreak(player, observations, history, seasonKey, weekIndex, schedule) {
  if (!observations[player.key]?.missing) return 0;
  const games = (schedule || []).filter((game) =>
    Number(game.stageIndex ?? game.stage ?? -1) === 1 && Number(game.status) >= 2
    && Number.isInteger(Number(game.weekIndex)) && Number(game.weekIndex) <= weekIndex
    && [String(game.homeTeamId ?? ''), String(game.awayTeamId ?? '')].includes(player.teamId))
    .sort((a, b) => Number(b.weekIndex) - Number(a.weekIndex));
  let count = 0;
  const seen = new Set();
  for (const game of games) {
    const index = Number(game.weekIndex);
    if (seen.has(index)) return 0;
    seen.add(index);
    const observation = index === weekIndex ? observations[player.key]
      : history.periods?.[`${seasonKey}_week_${index + 1}`]?.inactivityObservations?.[player.key];
    if (!observation || observation.teamId !== player.teamId || observation.position !== player.position || !observation.missing) break;
    count++;
  }
  return count;
}

function observedPoorStreak(player, positionKey, positionRule, observations, history, seasonKey, weekIndex, schedule, byWeek, rules) {
  const games = (schedule || []).filter((game) =>
    Number(game.stageIndex ?? game.stage ?? -1) === 1 && Number(game.status) >= 2
    && Number.isInteger(Number(game.weekIndex)) && Number(game.weekIndex) <= weekIndex
    && [String(game.homeTeamId ?? ''), String(game.awayTeamId ?? '')].includes(player.teamId))
    .sort((a, b) => Number(b.weekIndex) - Number(a.weekIndex));
  if (!games.length || Number(games[0].weekIndex) !== weekIndex) return 0;
  const seen = new Set();
  let count = 0;
  for (const game of games) {
    const index = Number(game.weekIndex);
    if (seen.has(index)) return 0;
    seen.add(index);
    const observed = index === weekIndex ? observations[player.key]
      : history.periods?.[`${seasonKey}_week_${index + 1}`]?.inactivityObservations?.[player.key];
    const stats = byWeek.get(index)?.get(player.key)?.totals;
    if (!observed || observed.missing || observed.teamId !== player.teamId || observed.position !== player.position
      || !stats || !opportunityConfirmed(stats, positionKey, rules)
      || !Object.keys(positionRule.weights).some((field) => numberOrNull(stats[field]) !== null)
      || performanceMetrics(stats, player.ovr, positionRule, rules).score > Number(rules.poorGameScore)) break;
    count++;
  }
  return count;
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
      && rule.currentValue < 99)
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

const WEEKLY_AWARD_CATEGORIES = ['afc_offense', 'nfc_offense', 'afc_defense', 'nfc_defense', 'rookie_offense', 'rookie_defense'];

function getWeeklyAwardPoints(winners, player, players, aliases, rules) {
  const awardIds = new Set();
  for (const category of WEEKLY_AWARD_CATEGORIES) {
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
      if (!history.projected && period.statusById?.[recommendation.recommendationId]?.status !== 'applied') continue;
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

function earnedGrowthPenalty(soft, qualifies, rules) {
  const limit = numberOrNull(rules.sustainedGrowth?.maximumSeasonGuidelinePenalty);
  const penalty = qualifies && limit !== null && limit >= 0 ? Math.min(soft.penalty, limit) : soft.penalty;
  return { ...soft, penalty, earnedRelief: soft.penalty - penalty };
}

function sustainedWeeklyGrowth(windows, positionKey, rules) {
  const growth = rules.sustainedGrowth;
  if (!growth) return false;
  const games = Number(growth.minimumWeeklyGames);
  const minimum = Number(growth.minimumPerformanceScore);
  if (!Number.isInteger(games) || games < 1 || !Number.isFinite(minimum)) return false;
  const recent = windows.metrics.slice(-games);
  return recent.length === games && windows.recentScore >= minimum
    && recent.every(({ row, score }) => score >= minimum && opportunityConfirmed(row.totals, positionKey, rules.weekly));
}

function experienceYears(player) {
  if (typeof player.yearsPro === 'boolean') return null;
  const years = numberOrNull(player.yearsPro);
  return years !== null && Number.isInteger(years) && years >= 0 ? years : null;
}

function pipelineMomentum(player, windows, positionKey, rules) {
  const policy = rules.developmentPipeline;
  const none = { rookie: false, young: false, elite: false, selectionBonus: 0 };
  if (!policy || positionKey === 'OL') return none;
  const count = Number(policy.minimumQualifyingGames);
  if (!Number.isInteger(count) || count < 2) return none;
  const recent = windows.metrics.slice(-count);
  if (recent.length !== count || !recent.every(({ row }) => opportunityConfirmed(row.totals, positionKey, rules.weekly))) return none;
  const years = experienceYears(player);
  const young = years !== null && years <= Number(policy.maximumYoungYearsPro)
    && recent.every(({ score }) => score >= Number(policy.minimumYoungGameScore));
  const rookie = young && years === 0;
  const elite = recent.every(({ score }) => score >= Number(policy.minimumEliteGameScore));
  return { rookie, young, elite, selectionBonus:
    (rookie ? Number(policy.rookieSelectionBonus) : young ? Number(policy.youngSelectionBonus) : 0)
    + (elite ? Number(policy.eliteSelectionBonus) : 0) };
}

function rookiePerformanceOutcome(player, windows, positionKey, rules, verifiedPoorStreak = 0) {
  const policy = rules.developmentPipeline?.rookieOutcomes;
  if (!policy || experienceYears(player) !== 0) return null;
  const integer = (value) => {
    const number = typeof value === 'boolean' ? null : numberOrNull(value);
    return Number.isInteger(number) && number > 0 ? number : null;
  };
  const round = integer(player.draftRound ?? player.draftYearRound ?? player.collegeDraftRound);
  const overall = integer(player.overallPick ?? player.draftOverallPick);
  // Conflicting or undrafted metadata cannot create premium-pick expectations.
  const highPick = (round !== null || overall !== null)
    && (round === null || round <= Number(policy.maximumHighPickRound))
    && (overall === null || overall <= Number(policy.maximumHighOverallPick));
  const qualified = windows?.metrics.filter(({ row }) => opportunityConfirmed(row.totals, positionKey, rules.weekly)) || [];
  let trajectory = 'monitoring';
  const healthy = Number(player.injuryLength || 0) <= 0;
  const individual = positionKey && positionKey !== 'OL';
  if (healthy && individual && windows && pipelineMomentum(player, windows, positionKey, rules).rookie) trajectory = 'boom';
  else if (healthy && individual && verifiedPoorStreak >= Math.max(3, Number(policy.minimumBustGames))) trajectory = 'bust';
  else if (healthy && individual && qualified.length >= Number(policy.minimumEvaluationGames)) trajectory = 'average';
  return { trajectory, highPick, qualifyingGames: qualified.length, verifiedPoorStreak };
}

function addRookieMonitoring(record, players, byWeek, endWeek, candidates, startingOveralls, rules, outcomes = new Map()) {
  const selected = new Map(record.recommendations.map((item) => [item.playerKey, item.direction]));
  const eligible = new Set(candidates.filter((item) => item.selectionScore >= item.minimumSelectionScore).map((item) => item.playerKey));
  record.rookieMonitoring = players.filter((player) => experienceYears(player) === 0).map((player) => {
    const positionKey = progressionPositionKey(player.position, rules.weekly.positions);
    const windows = positionKey && player.ovr !== null
      ? getPlayerWindowScores(player.key, player, byWeek, endWeek, positionKey, rules.weekly) : null;
    const currentRow = record.type !== 'weekly' ? windows?.latest?.row : byWeek.get(endWeek)?.get(player.key);
    const hasCurrentStats = Boolean(currentRow);
    const currentUsage = hasCurrentStats && opportunityConfirmed(currentRow.totals, positionKey, rules.weekly);
    const starting = numberOrNull(startingOveralls[player.key]);
    return {
      playerKey: player.key, player: player.name, teamId: player.teamId, team: player.team,
      position: player.position, currentOvr: player.ovr,
      seasonOvrChange: starting === null || player.ovr === null ? null : player.ovr - starting,
      qualifyingGames: windows?.metrics.filter(({ row }) => opportunityConfirmed(row.totals, positionKey, rules.weekly)).length || 0,
      currentGameScore: hasCurrentStats ? windows?.currentScore ?? null : null,
      recentScore: windows?.recentScore ?? null,
      status: selected.get(player.key) || (eligible.has(player.key) ? 'eligible_not_selected'
        : player.ovr === null ? 'missing_rating' : !positionKey ? 'unsupported_position'
          : Number(player.injuryLength || 0) > 0 && !hasCurrentStats ? 'injured'
          : !hasCurrentStats ? 'no_current_stats' : !currentUsage ? 'limited_usage' : 'monitoring'),
      performanceOutcome: outcomes.get(player.key) || rookiePerformanceOutcome(player, windows, positionKey, rules),
      teamLineProxy: positionKey === 'OL',
    };
  }).sort((a, b) => a.team.localeCompare(b.team) || a.player.localeCompare(b.player));
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
    yearsPro: experienceYears(player),
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
  clearOffensiveLineStats(byWeek, players);
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
      if (experienceYears(player) !== null && experienceYears(player) <= 2 && score >= 70) change += 1;
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

function seasonStatSummaries(rows) {
  const totals = allTotals(rows);
  const averages = {};
  const counts = {};
  for (const { totals: stats } of rows) {
    for (const [field, value] of Object.entries(stats)) {
      if (!Number.isFinite(Number(value))) continue;
      counts[field] = (counts[field] || 0) + 1;
    }
  }
  for (const [field, value] of Object.entries(totals)) averages[field] = value / counts[field];
  for (const [field, numerator, denominator, scale] of [
    ['passCompPct', 'passComp', 'passAtt', 100],
    ['passYdsPerAtt', 'passYds', 'passAtt', 1],
    ['recYdsPerCatch', 'recYds', 'recCatches', 1],
    ['fgCompPct', 'fgMade', 'fgAtt', 100],
    ['pntYdsPerAtt', 'pntYds', 'pntAtt', 1],
    ['pntNetYdsPerAtt', 'pntNetYds', 'pntAtt', 1],
  ]) {
    if (counts[numerator] === counts[denominator] && counts[denominator] === rows.length && totals[denominator] > 0) {
      averages[field] = totals[numerator] / totals[denominator] * scale;
    } else {
      delete averages[field];
    }
  }
  for (const field of ['passLongest', 'rushLongest', 'recLongest', 'fgLongest', 'pntLongest']) {
    const values = rows.map((row) => numberOrNull(row.totals[field])).filter((value) => value !== null);
    if (values.length) averages[field] = Math.max(...values);
  }
  return { totals, averages };
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

function playedTeamIds(snapshot, weekIndex) {
  const games = (snapshot.schedule?.schedules || []).filter((game) =>
    Number(game.weekIndex) === Number(weekIndex) && [1, 2].includes(Number(game.stageIndex ?? game.stage)) && Number(game.status) >= 2);
  if (games.length) return new Set(games.flatMap((game) => [game.homeTeamId, game.awayTeamId]).filter((id) => id != null).map(String));
  const entries = (snapshot.weeklyStats || []).filter((entry) => Number(entry.weekIndex) === Number(weekIndex) && [1, 2].includes(Number(entry.stage ?? entry.stageIndex)));
  return new Set(entries.flatMap((entry) => [...STAT_BUCKETS.flatMap(([bucket, list]) => entry[bucket]?.[list] || []), ...(entry.playerTotals || [])])
    .map((row) => row.teamId).filter((id) => id != null).map(String));
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
  clearOffensiveLineStats(byWeek, players);
  addOffensiveLineProxies(snapshot, players, aliases, byWeek, Number(weekIndex));
  const weekPlayers = byWeek.get(Number(weekIndex)) || new Map();
  const observations = inactivityObservations(snapshot, players, byWeek, Number(weekIndex));
  const recentAwardWinners = Array.from({ length: Math.min(4, Number(weekIndex) + 1) }, (_, index) =>
    index === 0 && Object.keys(awardWinners).length
      ? awardWinners
      : history.weeklyAwardWinners?.[weekNumber - index] || history.periods?.[`${seasonKey}_week_${weekNumber - index}`]?.awardWinners || readWeeklyAwardResults(snapshot.leagueId, weekNumber - index, seasonKey));
  const population = populationSnapshot(players, rules);
  const participants = Number(weekIndex) >= 18 ? playedTeamIds(snapshot, weekIndex) : null;
  const teamForms = buildTeamFormContexts(snapshot, Number(weekIndex), weeklyRules.teamForm);
  const candidates = [];
  const rookieOutcomes = new Map();
  const awardReasons = new Map();
  for (const player of players) {
    if (participants && !participants.has(player.teamId)) continue;
    const weeklyAwards = getWeeklyAwardPoints(awardWinners, player, players, aliases, weeklyRules);
    if (player.ovr === null) {
      if (weeklyAwards) awardReasons.set(player.key, 'Missing overall rating.');
      continue;
    }
    const positionRules = weeklyRules.positions;
    const positionKey = progressionPositionKey(player.position, positionRules);
    const positionRule = positionKey ? positionRules[positionKey] : null;
    if (!positionRule) {
      if (weeklyAwards) awardReasons.set(player.key, 'No progression rules for this position.');
      continue;
    }
    const current = weekPlayers.get(player.key);
    if (participants && current && (current.missingTeamId || !current.observedTeamIds?.has(player.teamId))) continue;
    if (!current || (!weeklyAwards && !opportunityConfirmed(current.totals, positionKey, weeklyRules))) {
      if (weeklyAwards) {
        awardReasons.set(player.key, 'No matching weekly statistics.');
        continue;
      }
      if (weeklyRules.gameplayMovement?.requirePlayedGame) continue;
      const streak = inactivityStreak(player, observations, history, seasonKey, Number(weekIndex), snapshot?.schedule?.schedules);
      const awareness = numberOrNull(player[weeklyRules.attributeFields?.Awareness]);
      const inactivityMinimum = experienceYears(player) === 0 && rules.developmentPipeline
        ? Math.max(Number(weeklyRules.inactivityMinimumGames ?? 4), Number(rules.developmentPipeline.rookieInactivityMinimumGames))
        : Number(weeklyRules.inactivityMinimumGames ?? 4);
      if (streak >= inactivityMinimum && awareness !== null && awareness > 0 && awareness <= 99) {
        const allocation = attributeAllocation({
          attribute: 'Awareness', field: weeklyRules.attributeFields.Awareness,
          evidence: 'missingStatGames', currentValue: awareness,
        }, -1);
        const selected = recommendation({
          player, seasonKey, direction: 'downgrade', performanceScore: 0,
          selectionScore: Number(weeklyRules.minimumDowngradeSelectionPriority)
            + Math.min(streak - inactivityMinimum, 5),
          selectionAdjustments: { consistency: 0, awardPoints: 0, teamAndPositionBalance: 0, seasonalGuidelineSoftPenalty: 0, ratingPopulationSoftPenalty: 0 },
          consistency: { poorStreak: 0 }, stats: { missingStatGames: streak }, attributes: allocation,
          explanation: `${streak} consecutive observed team games without a tracked stat line; this is possible inactivity, not confirmed DNP.`,
        });
        selected.changeContext = { possibleInactivity: true, inactivityGames: streak };
        selected.minimumSelectionScore = Number(weeklyRules.minimumDowngradeSelectionPriority);
        candidates.push(selected);
      }
      continue;
    }
    const windows = getPlayerWindowScores(player.key, player, byWeek, Number(weekIndex), positionKey, weeklyRules);
    const currentMetrics = performanceMetrics(current.totals, player.ovr, positionRule, weeklyRules);
    const pipeline = pipelineMomentum(player, windows, positionKey, rules);
    const qualified = windows.metrics.filter(({ row }) => opportunityConfirmed(row.totals, positionKey, weeklyRules));
    const seasonStats = seasonStatSummaries(qualified.map(({ row }) => row));
    const productionAverages = { ...seasonStats.averages };
    for (const field of ['passYds', 'passTDs', 'recYds', 'recTDs', 'rushYds', 'rushTDs', 'defSacks', 'defInts', 'defTotalTackles', 'defPassDeflections']) {
      if (seasonStats.totals[field] != null) productionAverages[field] = seasonStats.totals[field] / Math.max(1, qualified.length);
    }
    productionAverages.scrimmageYds = (productionAverages.rushYds || 0) + (productionAverages.recYds || 0);
    productionAverages.scrimmageTDs = (productionAverages.rushTDs || 0) + (productionAverages.recTDs || 0);
    const productionTotals = { ...seasonStats.totals, scrimmageYds: (seasonStats.totals.rushYds || 0) + (seasonStats.totals.recYds || 0),
      scrimmageTDs: (seasonStats.totals.rushTDs || 0) + (seasonStats.totals.recTDs || 0) };
    const production = positionKey === 'OL' ? null : seasonProductionReward({ position: positionKey, games: qualified.length,
      averages: productionAverages, totals: productionTotals,
      seasonScore: performanceMetrics(productionAverages, player.ovr, positionRule, weeklyRules).score, policy: weeklyRules.statProduction });
    const verifiedPoorStreak = observedPoorStreak(
      player, positionKey, positionRule, observations, history, seasonKey, Number(weekIndex),
      snapshot?.schedule?.schedules, byWeek, weeklyRules,
    );
    const rookieOutcome = rookiePerformanceOutcome(player, windows, positionKey, rules, verifiedPoorStreak);
    if (rookieOutcome) rookieOutcomes.set(player.key, rookieOutcome);
    const rookieBust = rookieOutcome?.trajectory === 'bust';
    const outcomePolicy = rules.developmentPipeline?.rookieOutcomes;
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
    if (!production && awareness !== null && awareness >= 0 && awareness < 99
      && currentMetrics.score >= Number(weeklyRules.awarenessMinimumGameScore ?? weeklyRules.strongGameScore)
      && Number.isInteger(awarenessInterval) && awarenessInterval > 0
      && (parseInt(stableHash(player.key).slice(0, 8), 16) + Number(weekIndex)) % awarenessInterval === 0) {
      currentAttributeEvidence.splice(Math.max(0, Number(weeklyRules.attributesPerRecommendation || 3) - 1));
      currentAttributeEvidence.push({
        attribute: 'Awareness', field: weeklyRules.attributeFields.Awareness,
        evidence: 'currentGameScore', evidenceRatio: 1, currentValue: awareness,
      });
    }
    if (production) {
      const priorities = weeklyRules.statProduction.priorityAttributes?.[positionKey] || [];
      const rank = (attribute) => { const index = priorities.indexOf(attribute.attribute); return index < 0 ? 100 : index; };
      currentAttributeEvidence.sort((left, right) => rank(left) - rank(right));
    }
    const seasonKeyOvr = numberOrNull(startingOveralls[player.key]) ?? player.ovr;
    const positivePointsUsed = sumAttributePoints(history, seasonKey, player.key, 'positive');
    const negativePointsUsed = sumAttributePoints(history, seasonKey, player.key, 'negative');
    const soft = earnedGrowthPenalty(
      positiveSeasonPenalty(positivePointsUsed, seasonKeyOvr, rules.offseason),
      Boolean(production) || sustainedWeeklyGrowth(windows, positionKey, rules), rules,
    );
    const populationAdjustment = getPopulationSoftPenalty(player, population, rules);
    const awardEvidence = currentAttributeEvidence.some((item) => item.evidence !== 'currentGameScore');
    if (weeklyAwards && !awardEvidence) {
      awardReasons.set(player.key, 'No supported stat and available attribute rating for an upgrade.');
      continue;
    }
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
    const movement = weeklyRules.gameplayMovement;
    const volume = movement?.minimumVolume;
    const reserveUpgrade = volume && currentMetrics.score >= Number(volume.minimumUpgradeScore)
      && windows.performanceScore >= Number(volume.minimumUpgradeScore);
    const reserveDowngrade = volume && currentMetrics.score <= Number(volume.maximumDowngradeScore)
      && windows.performanceScore <= Number(volume.maximumDowngradeScore) && Number(player.injuryLength || 0) <= 0;
    let reserve = false;
    const currentUpgradeEligible = !movement || currentMetrics.score >= Number(movement.minimumCurrentUpgradeScore) || weeklyAwards > 0;
    const currentDowngradeEligible = !movement || (currentMetrics.score <= Number(movement.maximumCurrentDowngradeScore) && Number(player.injuryLength || 0) <= 0);
    const productionUpgrade = production && currentMetrics.score >= Number(movement?.minimumVolume?.minimumUpgradeScore ?? weeklyRules.minimumUpgradePerformanceScore);
    if ((currentUpgradeEligible || reserveUpgrade || productionUpgrade) && !rookieBust && (productionUpgrade || reserveUpgrade || windows.performanceScore >= Number(weeklyRules.minimumUpgradePerformanceScore) || breakout || weeklyAwards > 0)
      && currentAttributeEvidence.length) {
      const tier = getTier(breakout ? Math.max(windows.performanceScore, currentMetrics.score) : windows.performanceScore, weeklyRules.positiveChangeTiers, 'minimumScore')
        || (weeklyAwards || reserveUpgrade || productionUpgrade ? { attributePoints: 1 } : null);
      if (tier) {
        direction = 'upgrade';
        reserve = !productionUpgrade && (!currentUpgradeEligible || (windows.performanceScore < Number(weeklyRules.minimumUpgradePerformanceScore) && !breakout && !weeklyAwards));
        points = Number(tier.attributePoints);
        evidence = currentAttributeEvidence;
        priorityBase = (breakout ? Math.max(windows.performanceScore, currentMetrics.score) : windows.performanceScore) + consistencyBonus + improvingTrendBonus
            + exceptionalConsistencyBonus + weeklyAwards
          - soft.penalty - populationAdjustment;
      }
    } else if ((currentDowngradeEligible || reserveDowngrade) && (!rookieOutcome || positionKey === 'OL' || rookieBust) && (reserveDowngrade || windows.performanceScore <= Number(weeklyRules.maximumDowngradePerformanceScore)
      || verifiedPoorStreak >= Number(weeklyRules.poorPerformanceMinimumGames ?? 3))) {
      const negative = selectNegativeAttributes(
        current.totals,
        player,
        positionKey,
        weeklyRules,
        1,
        Number(weeklyRules.attributesPerRecommendation || 3),
      );
      const sustainedPoor = verifiedPoorStreak >= Number(weeklyRules.poorPerformanceMinimumGames ?? 3);
      const awarenessValue = numberOrNull(player[weeklyRules.attributeFields?.Awareness]);
      // Repeated poor decisions affect awareness as well as the evidenced skill.
      // Keeping this alongside skill losses lets struggling highly rated players
      // decline instead of repeatedly reducing only one attribute.
      if (sustainedPoor && !negative.some((attribute) => attribute.attribute === 'Awareness')
        && awarenessValue !== null && awarenessValue > 0 && awarenessValue <= 99) {
        negative.splice(Math.max(0, Number(weeklyRules.attributesPerRecommendation || 3) - 1));
        negative.push({ attribute: 'Awareness', field: weeklyRules.attributeFields.Awareness, evidence: 'currentGameScore', currentValue: awarenessValue, evidenceRatio: 1 });
      }
      const tier = getNegativeTier(windows.performanceScore, weeklyRules.negativeChangeTiers)
        || (sustainedPoor || reserveDowngrade ? { attributePoints: -1 } : null);
      if (negative.length && tier) {
        direction = 'downgrade';
        reserve = !currentDowngradeEligible || (windows.performanceScore > Number(weeklyRules.maximumDowngradePerformanceScore) && !sustainedPoor);
        points = Number(tier.attributePoints);
        evidence = negative;
        priorityBase = 100 - windows.performanceScore + poorConsistencyBonus + decliningTrendBonus;
      }
    }
    if (reserve) evidence = evidence.filter((item) => item.evidence !== 'currentGameScore').slice(0, Number(volume.maximumAttributes));
    if (!direction || !evidence.length || !points) continue;
    if (direction === 'upgrade') {
      priorityBase += pipeline.selectionBonus;
      selectionAdjustments.developmentPipeline = pipeline.selectionBonus;
    }
    const rookieOutcomeBonus = (direction === 'upgrade' && rookieOutcome?.trajectory === 'boom') || (direction === 'downgrade' && rookieBust)
      ? (rookieOutcome.highPick ? Number(outcomePolicy.highPickSelectionBonus) : 0)
        + (direction === 'downgrade' ? Number(outcomePolicy.bustSelectionBonus) : 0) : 0;
    const productionBonus = direction === 'upgrade' && productionUpgrade ? production.selectionBonus : 0;
    const form = teamForms.get(player.teamId);
    const teamMultiplier = reserve ? 1 : (direction === 'upgrade' ? form?.upgradeMultiplier : form?.downgradeMultiplier) || 1;
    const teamBonus = weeklyRules.teamForm ? (teamMultiplier - 1) / Math.max(0.01, Number(weeklyRules.teamForm.streakMultiplier) - 1) * Number(weeklyRules.teamForm.maximumSelectionBonus) : 0;
    priorityBase += productionBonus + teamBonus;
    selectionAdjustments.seasonProduction = productionBonus;
    selectionAdjustments.teamForm = teamBonus;
    priorityBase += rookieOutcomeBonus;
    selectionAdjustments.rookieOutcome = rookieOutcomeBonus;
    const recentSelections = movement ? Object.values(history.periods || {}).filter((period) =>
      period.type === 'weekly' && period.seasonKey === seasonKey && period.weekIndex < Number(weekIndex)
      && period.weekIndex >= Number(weekIndex) - Number(movement.recentSelectionWindow)
      && period.recommendations?.some((item) => item.playerKey === player.key)).length : 0;
    const repeatSelectionPenalty = movement ? Math.min(Number(movement.maximumRepeatSelectionPenalty), recentSelections * Number(movement.repeatSelectionPenalty)) : 0;
    priorityBase -= repeatSelectionPenalty;
    selectionAdjustments.recentSelectionPenalty = repeatSelectionPenalty;
    selectionAdjustments.consistency = direction === 'downgrade'
      ? poorConsistencyBonus + decliningTrendBonus
      : consistencyBonus + improvingTrendBonus + exceptionalConsistencyBonus;
    const awarenessPoorFallback = direction === 'downgrade' && evidence.some((item) => item.evidence === 'currentGameScore');
    const streak = direction === 'upgrade' ? windows.consistency.strongStreak
      : awarenessPoorFallback ? verifiedPoorStreak : windows.consistency.poorStreak;
    const maxPoints = Number(weeklyRules.maximumWeeklyAttributePoints ?? 5);
    const streakThreshold = Number(weeklyRules.streakGamesForExtraPoint ?? 3);
    const streakBonus = Math.max(0, streak - streakThreshold + 1);
    const youngMomentum = direction === 'upgrade'
      && experienceYears(player) !== null
      && experienceYears(player) <= Number(weeklyRules.youngMomentumMaxYearsPro ?? 2)
      && currentMetrics.score >= Number(weeklyRules.momentumMinimumGameScore ?? 85)
      && streak >= Number(weeklyRules.momentumMinimumStrongStreak ?? 2);
    const awardMomentum = direction === 'upgrade'
      && awardWeeks >= Number(weeklyRules.momentumAwardWeeks ?? 2)
      && currentMetrics.score >= Number(weeklyRules.momentumMinimumGameScore ?? 85);
    const recentStrong = movement ? windows.metrics.slice(-Number(movement.minimumStrongGames)) : [];
    const gameplayMomentum = Boolean(movement && positionKey !== 'OL' && (direction === 'upgrade'
      ? recentStrong.length >= Number(movement.minimumStrongGames) && recentStrong.every(({ row, score }) =>
        score >= Number(movement.minimumStrongScore) && opportunityConfirmed(row.totals, positionKey, weeklyRules))
      : verifiedPoorStreak >= Number(movement.minimumPoorGames) && currentMetrics.score <= Number(movement.maximumPoorScore)));
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
      if (direction === 'upgrade' && attribute.evidence !== 'currentGameScore') {
        if (pipeline.rookie && index < Number(rules.developmentPipeline.rookieAcceleratedAttributes)
          && (index === 0 || ratio >= Number(weeklyRules.streakEvidenceRatio ?? 1.3))) {
          magnitude += Number(rules.developmentPipeline.rookieExtraAttributePoints);
        }
        if (pipeline.elite && index === 0) magnitude += Number(rules.developmentPipeline.eliteExtraPrimaryPoints);
      }
      if (gameplayMomentum && index < Number(movement.acceleratedAttributes) && attribute.evidence !== 'currentGameScore'
        && (index === 0 || ratio >= Number(weeklyRules.streakEvidenceRatio ?? 1.3))) magnitude += Number(movement.extraAttributePoints);
      if (index === 0 && rookieOutcome?.highPick && rookieOutcomeBonus > 0) {
        magnitude += Number(outcomePolicy.highPickExtraPrimaryPoints);
      }
      if (direction === 'upgrade' && productionUpgrade && index < production.attributes && attribute.evidence !== 'currentGameScore') magnitude += production.extraPoints;
      magnitude = reserve ? 1 : Math.min(maxPoints, Math.ceil(magnitude * teamMultiplier));
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
      consistency: awarenessPoorFallback ? { ...windows.consistency, poorStreak: verifiedPoorStreak } : windows.consistency,
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
    selected.eligibilityTier = reserve ? 'reserve' : 'primary';
    selected.changeContext = { seasonProduction: productionBonus ? production : null,
      teamForm: teamMultiplier > 1 ? { ...form, multiplier: teamMultiplier } : null, reserveSelection: reserve, gameplayMomentum: !reserve && gameplayMomentum, rookieOutcome, breakout, streakBonus, youngMomentum, awardMomentum,
      rookieMomentum: direction === 'upgrade' && pipeline.rookie,
      eliteMomentum: direction === 'upgrade' && pipeline.elite,
      sustainedGrowth: direction === 'upgrade' && soft.earnedRelief > 0, teamLineProxy: positionKey === 'OL' };
    selected.minimumSelectionScore = direction === 'upgrade'
      ? Number(reserve ? volume.minimumUpgradePriority : weeklyRules.minimumUpgradeSelectionScore)
      : Number(reserve ? volume.minimumDowngradePriority : weeklyRules.minimumDowngradeSelectionPriority);
    selected.pointTracking = {
      positivePreviouslyConfirmed: positivePointsUsed,
      negativePreviouslyConfirmed: negativePointsUsed,
      softGuideline: soft.guideline,
      seasonalGuidelineRelief: direction === 'upgrade' ? soft.earnedRelief : 0,
    };
    candidates.push(selected);
  }
  const awardCandidates = candidates.filter((candidate) => candidate.direction === 'upgrade' && candidate.awardPoints > 0);
  const otherCandidates = candidates.filter((candidate) => !awardCandidates.includes(candidate) && candidate.eligibilityTier !== 'reserve');
  const selected = [...awardCandidates, ...selectWithSoftBalance(
    otherCandidates,
    weeklyRules,
    Math.max(0, Number(weeklyRules.maximumRecommendations) - awardCandidates.length),
    { balanceDirections: true },
  )];
  const minimum = Math.min(Number(weeklyRules.maximumRecommendations), Number(weeklyRules.preferredRecommendationRange?.[0] || 0));
  if (selected.length < minimum) selected.push(...selectWithSoftBalance(
    candidates.filter((candidate) => candidate.eligibilityTier === 'reserve'), weeklyRules, minimum - selected.length, { balanceDirections: true },
  ));
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
    primaryEligible: candidates.filter((candidate) => candidate.eligibilityTier !== 'reserve' && candidate.selectionScore >= candidate.minimumSelectionScore).length,
    reserveSelected: selected.filter((candidate) => candidate.eligibilityTier === 'reserve').length,
    participatingTeamCount: participants?.size ?? null,
    targetShortfall: Math.max(0, minimum - selected.length),
    preferredMinimum: minimum,
  };
  addRookieMonitoring(record, players, byWeek, Number(weekIndex), candidates, startingOveralls, rules, rookieOutcomes);
  const missingAwards = new Map();
  for (const category of WEEKLY_AWARD_CATEGORIES) {
    const winner = awardWinners?.[category];
    if (!winner) continue;
    const key = awardIdentity(winner, players, aliases);
    if (key && selected.some((item) => item.playerKey === key && item.direction === 'upgrade')) continue;
    const label = key || `${winner.rosterId ?? ''}|${winner.fullName || winner.name || winner.playerName || category}`;
    if (!missingAwards.has(label)) {
      const player = players.find((entry) => entry.key === key);
      missingAwards.set(label, {
        playerKey: key,
        player: player?.name || winner.fullName || winner.name || winner.playerName || `Award winner (${category.replaceAll('_', ' ')})`,
        reason: key ? awardReasons.get(key) || 'No supported attribute upgrade was available.' : 'Could not uniquely match winner to the current roster.',
      });
    }
  }
  record.unupgradedAwardWinners = [...missingAwards.values()];
  record.inactivityObservations = observations;
  return record;
}

function makeOffseasonAttributes(player, stats, averages, rules, positionKey, direction, tier, seasonGames, sustainedPoor) {
  const positionRule = rules.weekly.positions[positionKey];
  if (!positionRule) return [];
  if (direction === 'upgrade') {
    const positives = getEvidenceAttributes(
      averages,
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
  const awarenessField = rules.weekly.attributeFields?.Awareness;
  const awareness = numberOrNull(player[awarenessField]);
  if (!negatives.length && sustainedPoor && awareness !== null && awareness > 0 && awareness <= 99) {
    return attributeAllocation({
      attribute: 'Awareness', field: awarenessField, evidence: 'seasonPoorGames',
      currentValue: awareness, evidenceRatio: 1,
    }, -1);
  }
  return negatives.flatMap((evidence) => attributeAllocation(evidence, Number(tier.primaryPoints)));
}

export function buildOffseasonProgressionRecommendations(snapshot, {
  history = { periods: {}, seasonAwards: {} },
  startingOveralls = {},
  lineObservations = [],
  regularSeasonOnly = false,
  rules = readRules().progression,
} = {}) {
  const seasonKey = getMaddenSeasonKey(snapshot);
  const { players, aliases } = getRosterPlayers(snapshot);
  const byWeek = buildWeeklyPlayerStats(snapshot, aliases, { includePostseason: !regularSeasonOnly, requestedWeekIndex: regularSeasonOnly ? 17 : null });
  clearOffensiveLineStats(byWeek, players);
  const currentPlayers = new Map(players.map((player) => [player.key, player]));
  const projectedLineKeys = new Set([...projectedOffensiveLineStarters(players).values()].map((player) => player.key));
  for (const observation of lineObservations) {
    if (regularSeasonOnly && observation.weekIndex >= 18) continue;
    const player = currentPlayers.get(observation.playerKey);
    if (!player || player.teamId !== observation.teamId || player.position !== observation.position) continue;
    const week = byWeek.get(observation.weekIndex) || new Map();
    week.set(player.key, { playerKey: player.key, position: player.position, games: 1, totals: observation.totals });
    byWeek.set(observation.weekIndex, week);
  }
  const population = populationSnapshot(players, rules);
  const maxWeek = Math.max(-1, ...byWeek.keys());
  const candidates = [];
  for (const player of players) {
    if (player.ovr === null) continue;
    const positionRules = rules.weekly.positions;
    const positionKey = progressionPositionKey(player.position, positionRules);
    const positionRule = positionKey ? positionRules[positionKey] : null;
    if (!positionRule) continue;
    if (positionKey === 'OL' && !projectedLineKeys.has(player.key)) continue;
    const windows = getPlayerWindowScores(player.key, player, byWeek, maxWeek, positionKey, rules.weekly);
    const observedMetrics = windows.metrics.filter((entry) =>
      opportunityConfirmed(entry.row.totals, positionKey, rules.weekly));
    const rows = observedMetrics.map((entry) => entry.row);
    if (!rows.length) continue;
    const { totals: totalStats, averages: avgStats } = seasonStatSummaries(rows);
    const games = rows.length;
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
    const growth = rules.sustainedGrowth;
    const sustainedGrowth = growth && games >= Number(growth.minimumOffseasonGames)
      && seasonScore >= Number(growth.minimumPerformanceScore)
      && observedMetrics.filter(({ score }) => score >= Number(growth.minimumPerformanceScore)).length / games
        >= Number(growth.minimumExcellentSeasonShare);
    const soft = earnedGrowthPenalty(
      positiveSeasonPenalty(positiveUsed, startingOvr, rules.offseason), sustainedGrowth, rules,
    );
    const populationAdjustment = getPopulationSoftPenalty(player, population, rules);
    const consistency = getStrongPoorCounts(observedMetrics.map((entry) => entry.score), rules.weekly);
    const identityVerified = observedMetrics.every(({ row }) =>
      !row.missingTeamId && row.observedTeamIds?.size === 1 && row.observedTeamIds.has(player.teamId)
      && [...(row.observedPositions || [])].every((position) => position === player.position));
    const sustainedPoor = positionKey !== 'OL' && identityVerified
      && consistency.poor >= Number(rules.weekly.poorPerformanceMinimumGames ?? 3)
      && consistency.poor * 2 >= consistency.observedGames;
    const recentScores = observedMetrics.slice(-Number(rules.weekly.rollingGames)).map((entry) => entry.score);
    const recentScore = recentScores.reduce((sum, score) => sum + score, 0) / recentScores.length;
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
    const attributes = makeOffseasonAttributes(player, totalStats, avgStats, rules, positionKey, direction, tier, games, sustainedPoor);
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
      stats: {
        ...Object.fromEntries(Object.entries(totalStats).filter(([field]) => !/Pct$|PerAtt$|PerCatch$|Longest$/.test(field))),
        ...Object.fromEntries(Object.entries(avgStats).filter(([field]) => /Pct$|PerAtt$|PerCatch$|Longest$/.test(field))),
        ...(attributes.some((attribute) => attribute.evidence === 'seasonPoorGames') ? { seasonPoorGames: consistency.poor } : {}),
      },
      attributes,
      currentGameScore: null,
      recentFourGameScore: recentScore,
      seasonToDateScore: seasonScore,
      explanation: direction === 'upgrade'
        ? `Full-season performance score ${seasonScore.toFixed(1)}, including OVR-adjusted expectations and ${games} played games.`
        : `Full-season performance score ${seasonScore.toFixed(1)} with verified attribute-specific evidence for ${attributes.map((item) => item.attribute).join(', ')}.`,
    }));
    candidates.at(-1).minimumSelectionScore = minimumSelectionScore;
    candidates.at(-1).changeContext = { teamLineProxy: positionKey === 'OL', sustainedGrowth: direction === 'upgrade' && soft.earnedRelief > 0 };
    candidates.at(-1).pointTracking = {
      positivePreviouslyConfirmed: positiveUsed,
      negativePreviouslyConfirmed: negativeUsed,
      softGuideline: soft.guideline,
      seasonalGuidelineRelief: direction === 'upgrade' ? soft.earnedRelief : 0,
    };
  }
  const ranked = candidates.sort((a, b) => b.selectionScore - a.selectionScore
    || a.player.localeCompare(b.player) || a.playerKey.localeCompare(b.playerKey));
  let upgradeCount = 0;
  const selected = regularSeasonOnly ? ranked.filter((item) => item.direction !== 'upgrade'
    || ++upgradeCount <= Number(rules.offseason.maximumSeasonEndUpgrades ?? 50)) : ranked;
  const record = makeRecord({
    snapshot,
    type: regularSeasonOnly ? 'season_end' : 'offseason',
    weekIndex: null,
    recommendations: selected,
    population,
    rules,
  });
  record.regularSeasonOnly = regularSeasonOnly;
  if (regularSeasonOnly) record.selectionDiagnostics = {
    eligibleCandidates: candidates.length,
    eligibleUpgrades: candidates.filter((item) => item.direction === 'upgrade').length,
    preferredMinimum: Number(rules.offseason.preferredSeasonEndUpgradeRange?.[0] ?? 40),
  };
  addRookieMonitoring(record, players, byWeek, maxWeek, candidates, startingOveralls, rules);
  return record;
}

const STAT_LABELS = {
  currentGameScore: 'Game performance score',
  seasonPoorGames: 'Games with low tracked production',
  missingStatGames: 'Consecutive team games without recorded stats',
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
  if (item.changeContext?.possibleInactivity) {
    return `No tracked stat line in ${item.changeContext.inactivityGames} consecutive observed team games. This may indicate inactivity, but it does not confirm a DNP; limited usage can look the same.`;
  }
  const labels = [...new Set((item.attributes || []).map((attribute) => statLabel(attribute.evidence)).filter(Boolean))];
  const evidence = labels.length ? labels.join(', ').toLowerCase() : 'the available game statistics';
  const reasons = [`${item.direction === 'upgrade' ? 'Strong' : 'Poor'} performance in ${evidence}.`];
  const production = item.changeContext?.seasonProduction;
  if (production) {
    const totals = Object.entries(production.evidence).filter(([, value]) => Number.isFinite(value))
      .map(([field, value]) => `${Math.round(value)} ${statLabel(field).toLowerCase()}`).join(', ');
    reasons.push(`${production.label}: ${totals} in ${production.games} games earned faster attribute growth.`);
  }
  const team = item.changeContext?.teamForm;
  if (team) reasons.push(`Team form ${team.wins}-${team.losses} over ${team.games} games: ${team.multiplier}× earned ${item.direction === 'upgrade' ? 'upgrade' : 'downgrade'} points, within the weekly cap.`);
  if (item.changeContext?.teamLineProxy) {
    const sources = [item.stats?.teamRunScore != null ? 'rushing' : null, item.stats?.teamPassScore != null ? 'pass protection' : null].filter(Boolean).join(' and ');
    reasons[0] = `Team ${sources} performance is a proxy, not individual blocking stats. Projected starter is the highest-OVR healthy player at this position${record.type !== 'weekly' ? '; season evidence comes only from weeks when this player was also the projected starter' : ''}.`;
  }
  if (record.type === 'weekly' && item.awardPoints > 0) reasons.push('Won a weekly award.');
  if (item.attributes.some((attribute) => attribute.attribute === 'Awareness' && attribute.evidence === 'currentGameScore')) {
    reasons.push('Awareness is estimated from game performance, not measured directly.');
  }
  if (item.attributes.some((attribute) => attribute.evidence === 'seasonPoorGames')) {
    reasons[0] = `${item.consistency.poor} of ${item.consistency.observedGames} observed games had low tracked production. This is an estimate, not a direct measurement of Awareness or individual performance.`;
  }
  if (item.changeContext?.breakout) {
    reasons.push('Exceptional play for a lower-rated player earned a larger boost.');
  }
  if (item.changeContext?.reserveSelection) reasons.push('A smaller supported change based on current and recent gameplay.');
  if (item.changeContext?.gameplayMomentum) reasons.push('Repeated gameplay performance increased supported attribute changes.');
  if (item.changeContext?.youngMomentum) reasons.push('Sustained strong play accelerated this young player’s development.');
  const rookieOutcome = item.changeContext?.rookieOutcome;
  if (rookieOutcome?.trajectory === 'boom') reasons.push(`Rookie boom trajectory${rookieOutcome.highPick ? ': early-round expectations met with stronger growth' : ''}.`);
  if (rookieOutcome?.trajectory === 'bust') reasons.push(`Rookie bust trajectory: ${rookieOutcome.verifiedPoorStreak} verified poor games${rookieOutcome.highPick ? '; early-round expectations increased this penalty' : ''}.`);
  if (item.changeContext?.rookieMomentum) reasons.push('Two qualifying excellent games earned this rookie faster growth on supported attributes.');
  if (item.changeContext?.eliteMomentum) reasons.push('Repeated elite performance accelerated the strongest supported attribute change.');
  if (item.changeContext?.awardMomentum) reasons.push('Multiple recent weekly awards increased the strongest change.');
  if (item.changeContext?.sustainedGrowth) reasons.push('Sustained excellent play kept the season point guideline soft so earned growth can continue across OVR tiers.');
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
    .setFooter({ text: `${seasonLabel(record.seasonKey)} · ${record.weekNumber ? `Week ${record.weekNumber}` : record.type === 'season_end' ? 'Regular-season finale' : 'Offseason'} · Changes are manual in Madden` })
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
  const embed = new EmbedBuilder()
    .setTitle('🏈 Franchise Progression')
    .setDescription(`**${seasonLabel(record.seasonKey)} · ${record.weekNumber ? `Week ${record.weekNumber}` : record.type === 'season_end' ? 'Regular-season finale' : 'Offseason'}**\n\n📈 **${upgrades}** upgrade${upgrades === 1 ? '' : 's'}　 ·　 📉 **${downgrades}** downgrade${downgrades === 1 ? '' : 's'}\n\nReview team threads below. Apply every change manually in Madden.`)
    .addFields(
      { name: 'Players rated 80+', value: String(population.overall80Plus ?? 0), inline: true },
      { name: 'Players rated 90+', value: String(population.overall90Plus ?? 0), inline: true },
    )
    .setColor(0x5865f2)
    .setFooter({ text: 'Dynasty GM · Updated after each sync' })
    .setTimestamp(new Date(record.generatedAt));
  if (record.unupgradedAwardWinners?.length) {
    embed.addFields({
      name: 'Award winners needing review',
      value: record.unupgradedAwardWinners.map((winner) => `${winner.player}: ${winner.reason}`).join('\n').slice(0, 1024),
      inline: false,
    });
  }
  return embed;
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
    .setFooter({ text: `${seasonLabel(record.seasonKey)} · ${record.weekNumber ? `Week ${record.weekNumber}` : record.type === 'season_end' ? 'Regular-season finale' : 'Offseason'} · Apply changes in Madden` })
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

// Remove only recorded legacy recap messages belonging to this bot. Failed
// deletions retain their IDs so the next startup can retry safely.
export async function removeRookieRecapMessages(client, guildId) {
  const registry = await loadJsonFile(threadsFile(guildId), null);
  if (!registry) return;
  const files = await fs.readdir(HISTORY_DIR).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  let removed = 0;
  for (const file of files.filter((name) => name.endsWith('.json'))) {
    const history = await loadJsonFile(path.join(HISTORY_DIR, file), null);
    let changed = false;
    for (const record of Object.values(history?.periods || {})) {
      for (const [teamId, ids] of Object.entries(record.rookieMessages || {})) {
        if (!ids.length) continue;
        const threadId = registry.teams?.[teamId]?.threadId;
        if (!threadId) continue;
        const thread = await client.channels.fetch(threadId).catch(() => null);
        if (!thread?.isThread() || thread.guildId !== guildId) continue;
        const remaining = [];
        for (const id of ids) {
          try {
            const message = await thread.messages.fetch(id);
            const recap = message.embeds.some((embed) => embed.title === '🌱 Rookie Pipeline')
              || message.content === 'This rookie watch page has been superseded.';
            if (message.author?.id !== client.user.id || !recap) {
              remaining.push(id);
              continue;
            }
            if (thread.archived) await thread.setArchived(false, 'Removing retired rookie recaps');
            await message.delete();
            removed++;
          } catch (error) {
            if (error.code !== 10008) {
              remaining.push(id);
              console.warn('[progression] Rookie recap removal failed', id, error.message);
            }
          }
        }
        if (remaining.length !== ids.length) {
          record.rookieMessages[teamId] = remaining;
          changed = true;
        }
      }
    }
    if (changed) await atomicJsonWrite(path.join(HISTORY_DIR, file), history);
  }
  if (registry.summaryMessageId) {
    const channel = await client.channels.fetch(registry.channelId);
    if (channel?.guildId === guildId && channel.isTextBased()) {
      const message = await channel.messages.fetch(registry.summaryMessageId).catch((error) => {
        if (error.code === 10008) return null;
        throw error;
      });
      if (message?.author?.id === client.user.id) {
        const embeds = message.embeds.map((embed) => embed.toJSON());
        const summary = embeds.find((embed) => embed.title === '🏈 Franchise Progression');
        if (summary?.fields?.some((field) => field.name === 'Rookie pipeline')) {
          summary.fields = summary.fields.filter((field) => field.name !== 'Rookie pipeline');
          await message.edit({ embeds, allowedMentions: { parse: [] } });
        }
      }
    }
  }
  console.log(`[progression] Removed ${removed} legacy rookie recap messages`);
}

async function publishReportIndex(client, guildId, registry, record, history, embed, files = null) {
  const channel = await client.channels.fetch(registry.channelId);
  if (!channel?.isTextBased()) throw new Error('Player Upgrades channel is unavailable for report navigation.');
  record.reportIndexMessages ||= {};
  const previous = record.reportIndexMessages[guildId];
  const existing = previous ? await channel.messages.fetch(previous).catch((error) => {
    if (error.code === 10008) return null;
    throw error;
  }) : null;
  const payload = { embeds: [embed], allowedMentions: { parse: [] }, ...(files ? { files, attachments: [] } : {}) };
  const message = existing ? await existing.edit(payload) : await channel.send(payload);
  record.reportIndexMessages[guildId] = message.id;
  await saveHistory(record.leagueId, history);
  return `https://discord.com/channels/${guildId}/${registry.channelId}/${message.id}`;
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
        ? `<@&${managerRoleId}> New progression recommendations for ${record.seasonKey}${record.weekNumber ? `, week ${record.weekNumber}` : record.type === 'season_end' ? ', regular-season finale' : ', offseason'}.`
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
  const upgrades = record.recommendations.filter((item) => item.direction === 'upgrade').length;
  const reportUrl = record.recommendations.length ? await publishReportIndex(client, guildId, registry, record, history, buildTeamReportIndex({
    title: `📈 Weekly Player Changes · Week ${record.weekNumber}`,
    description: `**${seasonLabel(record.seasonKey)} · ${record.recommendations.length} player changes**\n${upgrades} upgrades · ${record.recommendations.length - upgrades} downgrades\n\nOpen your team below. Apply each change manually in Madden.`,
    reports: [...byTeam.keys()].map((teamId) => ({ teamName: registry.teams[teamId].teamName,
      url: `https://discord.com/channels/${guildId}/${registry.teams[teamId].threadId}/${record.teamMessages[teamId][0]}` })),
  })) : null;
  return {
    published: true,
    reportUrl,
    teamCount: byTeam.size,
    recommendationCount: record.recommendations.length,
    threadCount: Object.keys(registry.teams).length,
  };
}

export function readProgressionRules() { return structuredClone(readRules().progression); }

export async function hasIssuedSeasonWeeklyChanges(snapshot) {
  const history = await loadHistory(snapshot.leagueId);
  const info = snapshot.info?.careerHubInfo?.seasonInfo || {};
  const index = info.seasonIndex ?? snapshot.season ?? info.seasonYear;
  return Object.values(history.periods).some((period) => period.type === 'weekly' && !period.issuedAsAggregate
    && period.seasonKey === getMaddenSeasonKey(snapshot) && (index == null || period.season == null || Number(period.season) === Number(index))
    && period.recommendations?.length > 0);
}

export function isOffseason(snapshot) {
  return getFranchisePhase(snapshot) === 'offseason';
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
    if (!entry.syncId) continue;
    const archived = await loadJsonFile(path.join(directory, `${safeId(entry.syncId, 'sync ID')}.json`), null);
    if (!archived) { console.warn('[progression] Skipping missing baseline archive', entry.syncId); continue; }
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
    ? `Comparing actual Madden OVR from **${baseline.label}** to the latest sync.${baseline.partial ? '\n**Partial-season comparison:** no preseason or Week 1 snapshot is available.' : ''}\nPlayers are listed on their current team; players without a matching baseline rating are excluded.`
    : 'No preseason or regular-season snapshot is available for this season. Sync during the season to establish a comparison baseline.';
  return new EmbedBuilder()
    .setTitle('📊 Season OVR Changes')
    .setDescription(`${emoji ? `${emoji} ` : ''}**${teamName} · ${seasonLabel(record.seasonKey)}**\n\n${description}`)
    .addFields(
      { name: '📈 Top 10 Growers', value: format(changes?.upgrades || []) },
      { name: '📉 Top 10 Fallers', value: format(changes?.downgrades || []) },
    )
    .setColor(0x5865f2)
    .setFooter({ text: 'Actual Madden OVR · Updates from playoff Week 2 onward' });
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
  const indexUrl = await publishReportIndex(client, guildId, registry, record, history, buildTeamReportIndex({
    title: `📊 ${seasonLabel(record.seasonKey)} · Top 10 Growers / Fallers`,
    description: 'Actual Madden OVR movement since the season baseline. Open your team’s list below.',
    reports: (snapshot.teams?.leagueTeamInfoList || []).map((team) => {
      const teamId = String(team.teamId);
      return { teamName: registry.teams[teamId].teamName,
        url: `https://discord.com/channels/${guildId}/${messages[teamId].threadId}/${messages[teamId].messageId}` };
    }),
  }));
  return { teamCount: (snapshot?.teams?.leagueTeamInfoList || []).length, baseline: baseline?.label || null, partial: Boolean(baseline?.partial), indexUrl };
}

async function publishProgression({ client, guildId, snapshot, type, weekIndex = null, awardWinners = null }) {
  if (getFranchisePhase(snapshot) === 'offseason') return { published: false, recommendationCount: 0, reason: 'No rating changes during offseason.' };
  const leagueId = safeId(snapshot?.leagueId, 'Madden league ID');
  const history = await loadHistory(leagueId);
  const rules = readRules().progression;
  const seasonKey = getMaddenSeasonKey(snapshot);
  const starting = await startingOveralls(leagueId, snapshot, seasonKey);
  if (type !== 'weekly') throw new Error('Only gameplay-based weekly rating changes are supported.');
  const current = buildWeeklyProgressionRecommendations(snapshot, {
    weekIndex,
    awardWinners: awardWinners || readWeeklyAwardResults(leagueId, Number(weekIndex) + 1, seasonKey),
    history,
    startingOveralls: starting,
    rules,
  });
  const old = history.periods[current.periodKey];
  let record;
  if (old && ((old.gameplayPolicyVersion >= 1 && old.recommendations?.length > 0) || Object.values(old.statusById || {}).some((status) => status.status === 'applied'))) {
    record = {
      ...old,
      ...(type === 'weekly' ? { inactivityObservations: current.inactivityObservations } : {}),
      latestSyncId: current.syncId,
      syncIds: [...new Set([...(old.syncIds || [old.syncId]), current.syncId].filter(Boolean))],
      updatedAt: new Date().toISOString(),
    };
    const starterKeys = new Set([...projectedOffensiveLineStarters(getRosterPlayers(snapshot).players).values()].map((player) => player.key));
    record.recommendations = old.recommendations.filter((item) =>
      !item.changeContext?.teamLineProxy || starterKeys.has(item.playerKey)
      || old.statusById?.[item.recommendationId]?.status === 'applied');
    for (const item of current.recommendations.filter((entry) => entry.changeContext?.teamLineProxy)) {
      if (record.recommendations.length < Number(rules.weekly.maximumRecommendations) && !record.recommendations.some((existing) => existing.playerKey === item.playerKey)) record.recommendations.push(item);
    }
    if (type === 'weekly') {
      record.unupgradedAwardWinners = current.unupgradedAwardWinners.filter((winner) =>
        !winner.playerKey || !record.recommendations.some((item) => item.playerKey === winner.playerKey && item.direction === 'upgrade'));
      for (const winner of current.recommendations.filter((item) => item.awardPoints > 0 && item.direction === 'upgrade')) {
        const index = record.recommendations.findIndex((item) => item.playerKey === winner.playerKey);
        if (index < 0) {
          if (record.recommendations.length < Number(rules.weekly.maximumRecommendations)) record.recommendations.push(winner);
          else record.unupgradedAwardWinners.push({ player: winner.player, reason: 'The weekly limit has already been issued; review this late award separately.' });
        } else if (record.recommendations[index].direction !== 'upgrade') {
          const existing = record.recommendations[index];
          if (old.statusById?.[existing.recommendationId]?.status === 'applied') {
            record.unupgradedAwardWinners.push({ player: winner.player, reason: 'A prior downgrade was marked applied; review before changing it.' });
          } else record.recommendations[index] = winner;
        }
      }
    }
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
  if (Number(weekIndex) >= 18) {
    const participants = playedTeamIds(snapshot, weekIndex);
    record.recommendations = record.recommendations.filter((item) => participants.has(String(item.teamId)));
  }
  if (record.recommendations.length < Number(rules.weekly.preferredRecommendationRange?.[0] || 0)) {
    for (const item of current.recommendations) {
      if (record.recommendations.length >= Number(rules.weekly.maximumRecommendations)) break;
      if (!record.recommendations.some((existing) => existing.playerKey === item.playerKey)) record.recommendations.push(item);
    }
  }
  record.selectionDiagnostics = { ...current.selectionDiagnostics, targetShortfall: Math.max(0,
    Number(rules.weekly.preferredRecommendationRange?.[0] || 0) - record.recommendations.length) };
  const recommendedRookies = new Map(record.recommendations.map((item) => [item.playerKey, item.direction]));
  record.rookieMonitoring = (current.rookieMonitoring || []).map((player) => ({
    ...player,
    status: recommendedRookies.get(player.playerKey) || (['upgrade', 'downgrade'].includes(player.status) ? 'eligible_not_selected' : player.status),
  }));
  record.gameplayPolicyVersion = 2;
  if (Number(weekIndex) >= 18) record.playoffStatsVersion = 1;
  history.periods[record.periodKey] = record;
  await saveHistory(leagueId, history);
  const output = await publishTeamThreadReports(client, guildId, snapshot, record, history, rules);
  return {
    ...output,
    published: record.recommendations.length > 0,
    ...(record.recommendations.length ? {} : { reason: 'No players met the configured evidence threshold.' }),
    periodKey: record.periodKey,
    type: record.type,
    upgradeCount: record.recommendations.filter((item) => item.direction === 'upgrade').length,
    downgradeCount: record.recommendations.filter((item) => item.direction === 'downgrade').length,
    ...(record.selectionDiagnostics ? { selectionDiagnostics: record.selectionDiagnostics } : {}),
    ...(record.unupgradedAwardWinners?.length ? { unupgradedAwardWinners: record.unupgradedAwardWinners } : {}),
  };
}

export function buildFullSeasonCardEmbeds(row, seasonKey, teamName = row.team) {
  const signed = (number) => `${number >= 0 ? '+' : ''}${number}`;
  const emoji = getTeamEmojiByName(teamName);
  return ['upgrade', 'downgrade', 'review'].flatMap((direction) => {
    const attributes = row.attributes.filter((attribute) => direction === 'review'
      ? !attribute.net && attribute.needsReview
      : direction === 'upgrade' ? attribute.net > 0 : attribute.net < 0);
    if (!attributes.length) return [];
    const lines = attributes.map((attribute) => attribute.needsReview
      ? `**${attribute.attribute}** · earned ${signed(attribute.net)} · imported rating missing; review in Madden`
      : `**${attribute.attribute}** ${attribute.currentValue} → ${attribute.targetValue} (${signed(attribute.pointsToApply)})`);
    const positive = attributes.reduce((sum, attribute) => sum + attribute.positive, 0);
    const negative = attributes.reduce((sum, attribute) => sum + attribute.negative, 0);
    const label = direction === 'upgrade' ? '📈 Upgrade' : direction === 'downgrade' ? '📉 Downgrade' : '📋 Review';
    return [new EmbedBuilder().setTitle(`${label} · ${row.player}`.slice(0, 256))
      .setDescription(`${emoji ? `${emoji} ` : ''}**${teamName}** · ${row.position}\n\n${lines.join('\n')}`.slice(0, 3900))
      .addFields(
        { name: 'Why', value: 'Weeks 1–18 evaluated individually; each attribute shows the sum of its earned upgrades minus downgrades. Net changes are added to the latest Madden ratings.', inline: false },
        { name: 'Season attribute totals', value: `+${positive} / −${negative} · Net ${signed(positive - negative)}`, inline: false },
        { name: 'Status', value: '🕒 Waiting for your Madden update · Apply these final targets once', inline: false })
      .setColor(direction === 'upgrade' ? 0x2ecc71 : direction === 'downgrade' ? 0xe74c3c : 0x5865f2)
      .setFooter({ text: `${seasonLabel(seasonKey)} · Season totals, Weeks 1–18 · Changes are manual in Madden` })];
  });
}
function encodeSeasonCsv(rows) {
  const cell = (value) => {
    let text = String(value ?? '');
    if (typeof value === 'string' && /^[=+@\-\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return Buffer.from(rows.map((row) => row.map(cell).join(',')).join('\r\n'));
}
function seasonCsv(run) {
  const rows = [['Player', 'Team ID', 'Position', 'Attribute', 'Baseline', 'Gross upgrades', 'Gross downgrades', 'Net earned', 'Current Madden', 'Final target', 'Change to apply', 'Weeks', 'Review required']];
  for (const player of run.application) for (const attribute of player.attributes) rows.push([
    player.player, player.teamId, player.position, attribute.attribute, attribute.baselineValue, attribute.positive, attribute.negative,
    attribute.net, attribute.currentValue, attribute.targetValue, attribute.pointsToApply, attribute.weeks.join(' '), attribute.needsReview || player.teamId == null ? 'Yes' : 'No',
  ]);
  return encodeSeasonCsv(rows);
}
function seasonWeeklyCsv(run) {
  const rows = [['Week', 'Player', 'Team ID', 'Position', 'Direction', 'Attribute', 'Virtual rating before', 'Virtual rating after', 'Points', 'Evidence']];
  for (const week of Object.values(run.weeks)) for (const player of week.recommendations) for (const attribute of player.attributes) rows.push([
    week.weekNumber, player.player, player.teamId, player.position, player.direction,
    attribute.attribute, attribute.currentValue, attribute.targetValue, attribute.points, attribute.evidence,
  ]);
  return encodeSeasonCsv(rows);
}
export async function publishFullSeasonTotals({ client, guildId, snapshot, run }) {
  const rules = readRules().progression;
  const history = await loadHistory(snapshot.leagueId);
  const seasonKey = getMaddenSeasonKey(snapshot);
  const registry = await ensureTeamThreads({ client, guildId, snapshot, rules });
  const periodKey = `${seasonKey}_full_season`;
  const record = history.periods[periodKey] ||= {
    version: 1, leagueId: String(snapshot.leagueId), periodKey, seasonKey, season: snapshot.season,
    type: 'full_season', recommendations: [], application: run.application, teamMessages: {}, statusById: {},
  };
  for (const week of Object.values(run.weeks)) {
    const key = `${seasonKey}_week_${week.weekNumber}`;
    const prior = history.periods[key];
    if (prior && prior.season != null && snapshot.season != null && Number(prior.season) !== Number(snapshot.season)) history.periods[`${key}_season_${prior.season}`] = prior;
    history.periods[key] = { ...week, periodKey: key, seasonKey, season: snapshot.season, issuedAsAggregate: true };
  }
  await saveHistory(snapshot.leagueId, history);
  const grouped = new Map();
  for (const player of record.application) {
    if (!player.attributes.some((attribute) => attribute.net || attribute.needsReview) || !registry.teams[player.teamId]) continue;
    const list = grouped.get(player.teamId) || [];
    list.push(player);
    grouped.set(player.teamId, list);
  }
  const reports = [];
  for (const [teamId, players] of grouped) {
    const thread = await client.channels.fetch(registry.teams[teamId].threadId);
    if (!thread?.isThread()) throw new Error('Full-season progression thread is unavailable.');
    if (thread.archived) await thread.setArchived(false, 'Full-season attribute totals');
    const pages = players.flatMap((player) => buildFullSeasonCardEmbeds(player, run.seasonKey, registry.teams[teamId].teamName))
      .map((embed) => [embed]);
    const previous = record.teamMessages[teamId] || [];
    const ids = [];
    for (const [index, embeds] of pages.entries()) {
      const message = previous[index] ? await thread.messages.fetch(previous[index]).catch((error) => {
        if (error.code === 10008) return null;
        throw error;
      }) : null;
      const payload = { embeds, components: [], allowedMentions: { parse: [] } };
      const posted = message ? await message.edit(payload) : await thread.send(payload);
      ids.push(posted?.id || message?.id);
      record.teamMessages[teamId] = [...ids, ...previous.slice(ids.length)];
      await saveHistory(snapshot.leagueId, history);
    }
    record.teamMessages[teamId] = ids;
    reports.push({ teamName: registry.teams[teamId].teamName, url: `https://discord.com/channels/${guildId}/${thread.id}/${ids[0]}` });
  }
  const totals = run.totals;
  const embed = buildTeamReportIndex({ title: `📋 ${seasonLabel(run.seasonKey)} · Season Upgrades & Downgrades`,
    description: `**All 18 weeks evaluated separately**\n${totals.upgradeEvents} weekly upgrade events · ${totals.downgradeEvents} downgrade events\n**Attribute points earned: +${totals.positivePoints} / −${totals.negativePoints} · Net ${totals.netPoints >= 0 ? '+' : ''}${totals.netPoints}**\n\nOpen your existing team thread below for the season's upgrade and downgrade cards. Each attribute adds up all 18 weeks; apply its final target **once**. The attached CSVs are backup totals and the weekly audit.`, reports });
  if (run.unmatchedPlayers?.length) embed.addFields({ name: 'Players needing review', value: `${run.unmatchedPlayers.length} players had no starting baseline and were excluded from rating calculations.` });
  const tally = Object.values(run.weeks).map((week) => `Week ${week.weekNumber}: ${week.recommendations.filter((item) => item.direction === 'upgrade').length} upgrades / ${week.recommendations.filter((item) => item.direction === 'downgrade').length} downgrades`);
  embed.addFields({ name: 'Weeks 1–9', value: tally.slice(0, 9).join('\n') }, { name: 'Weeks 10–18', value: tally.slice(9).join('\n') });
  const reportUrl = await publishReportIndex(client, guildId, registry, record, history, embed,
    [{ attachment: seasonCsv(run), name: `${run.seasonKey}-combined-attribute-changes.csv` },
      { attachment: seasonWeeklyCsv(run), name: `${run.seasonKey}-weekly-attribute-audit.csv` }]);
  let movement = {};
  try { movement = await publishSeasonMovementSummary({ client, guildId, snapshot }); }
  catch (error) { console.error('[full-season] OVR list publication failed', error); movement.seasonChangesError = error.message; }
  return { published: true, recommendationCount: [...grouped.values()].reduce((sum, players) => sum + players.length, 0),
    type: 'full_season', periodKey, reportUrl, ...(movement.seasonChanges ? { seasonChanges: movement.seasonChanges } : {}),
    ...(movement.seasonChangesError ? { seasonChangesError: movement.seasonChangesError } : {}) };
}

export function isSeasonMovementDue(snapshot) {
  const phase = getFranchisePhase(snapshot);
  if (phase === 'offseason') return true;
  if (phase !== 'playoffs') return false;
  const info = snapshot.info?.careerHubInfo?.seasonInfo || {};
  const week = Number(snapshot.currentWeek) > 0 ? Number(snapshot.currentWeek)
    : Number(info.displayWeek) > 0 ? Number(info.displayWeek) : Number(info.seasonWeek) + 1;
  return Number.isFinite(week) && week >= 20;
}
async function deferPublishedSeasonMovement(client, guildId, snapshot, history) {
  const record = history.periods[`${getMaddenSeasonKey(snapshot)}_ovr_summary`];
  if (!record || record.deferredUntilPlayoffWeek === 2) return;
  const waiting = new EmbedBuilder().setTitle('📊 Top 10 Risers / Fallers · Playoff Week 2')
    .setDescription('Apply the first playoff week’s attribute changes in Madden, then sync in the second playoff week. The top 10 lists will use those updated ratings.')
    .setColor(0x5865f2);
  const refs = Object.values(record.seasonChangeMessages?.[guildId] || {}).map((row) => ({ channelId: row.threadId, messageId: row.messageId }));
  const registry = await loadJsonFile(threadsFile(guildId), null);
  if (record.reportIndexMessages?.[guildId] && registry?.channelId) refs.push({ channelId: registry.channelId, messageId: record.reportIndexMessages[guildId] });
  for (const ref of refs) {
    const channel = await client.channels.fetch(ref.channelId);
    const message = await channel.messages.fetch(ref.messageId).catch((error) => { if (error.code === 10008) return null; throw error; });
    if (!message) continue;
    if (message.author?.id && message.author.id !== client.user?.id) throw new Error('Recorded OVR report belongs to a different author.');
    await message.edit({ embeds: [waiting], allowedMentions: { parse: [] } });
  }
  record.deferredUntilPlayoffWeek = 2;
  await saveHistory(snapshot.leagueId, history);
}
async function publishSeasonMovementSummary({ client, guildId, snapshot }) {
  const history = await loadHistory(snapshot.leagueId);
  if (!isSeasonMovementDue(snapshot)) {
    await deferPublishedSeasonMovement(client, guildId, snapshot, history);
    return { published: false, recommendationCount: 0, type: 'season_summary', reason: 'Top 10 risers/fallers publish in playoff Week 2, after the first-week rating changes are applied in Madden.' };
  }
  const rules = readRules().progression;
  const registry = await ensureTeamThreads({ client, guildId, snapshot, rules });
  const seasonKey = getMaddenSeasonKey(snapshot);
  const periodKey = `${seasonKey}_ovr_summary`;
  const record = history.periods[periodKey] || {
    ...makeRecord({ snapshot, type: 'season_summary', weekIndex: null, recommendations: [], population: populationSnapshot(getRosterPlayers(snapshot).players, rules), rules }),
    periodKey,
    seasonChangeMessages: history.periods[`${seasonKey}_offseason`]?.seasonChangeMessages || {},
  };
  history.periods[periodKey] = record;
  record.deferredUntilPlayoffWeek = null;
  const seasonChanges = await publishSeasonOverallChanges(client, guildId, snapshot, record, history, registry);
  return { published: false, recommendationCount: 0, type: 'season_summary', periodKey, seasonChanges,
    reason: 'Season OVR risers/fallers updated. Ratings change only through weekly gameplay recommendations.' };
}

function playoffProgressionSnapshot(snapshot) {
  return normalizePlayoffProgressionSnapshot(snapshot);
}

export function resolveProgressionWeek(snapshot) {
  const phase = getFranchisePhase(snapshot);
  if (['offseason', 'preseason'].includes(phase)) return null;
  const info = snapshot?.info?.careerHubInfo?.seasonInfo || {};
  const current = Number(snapshot.currentWeek ?? info.displayWeek ?? (Number.isInteger(info.seasonWeek) ? info.seasonWeek + 1 : 0));
  if (phase === 'playoffs') {
    const normalized = playoffProgressionSnapshot(snapshot);
    const completed = (normalized.weeklyStats || []).filter(hasPlayoffPlayerData).filter((entry) => [1, 2].includes(Number(entry.stage ?? entry.stageIndex))
      && Number(entry.weekIndex) >= 18 && Number(entry.weekIndex) <= 22)
      .map((entry) => Number(entry.weekIndex)).filter((index) => {
        const games = (normalized.schedule?.schedules || []).filter((game) => [1, 2].includes(Number(game.stageIndex ?? game.stage)) && Number(game.weekIndex) === index);
        return index < current - 1 || (games.length > 0 && games.every((game) => Number(game.status) >= 2));
      });
    if (completed.length) return Math.max(...completed);
    // The first playoff sync evaluates Week 18, never the upcoming wild-card
    // placeholder or a stale earlier regular-season week.
    return getLatestReliableRegularSeasonWeekIndex(snapshot, 17) === 17 ? 17 : null;
  }
  return getLatestReliableRegularSeasonWeekIndex(snapshot, current > 0 ? Math.min(17, current - 2) : 17);
}

export async function publishProgressionReports({ client, guildId, snapshot }) {
  if (!isSoloModeEnabled()) return { published: false, reason: 'Solo mode is disabled.' };
  if (!snapshot?.leagueId || !snapshot?.syncId) throw new Error('Progression requires a synced franchise snapshot.');
  const phase = getFranchisePhase(snapshot);
  const seasonRun = await loadFullSeasonRun(guildId, snapshot.leagueId);
  const fullSeason = matchesFullSeason(seasonRun, snapshot) ? seasonRun : null;
  if (fullSeason && fullSeason.status !== 'complete') return { published: false, recommendationCount: 0, reason: 'Full-season mode is active. Use /sync mode:full-season for season totals in your team threads.' };
  if (phase === 'preseason') return { published: false, reason: 'Progression starts after regular-season games.' };
  let summary = {};
  if (['playoffs', 'offseason'].includes(phase)) {
    try { summary = await publishSeasonMovementSummary({ client, guildId, snapshot }); }
    catch (error) {
      console.error('[progression] OVR summary failed', error);
      summary = { published: false, recommendationCount: 0, seasonChangesError: error.message };
    }
    if (phase === 'offseason') return summary;
  }
  const weekIndex = resolveProgressionWeek(snapshot);
  if (fullSeason?.status === 'complete' && weekIndex !== null && weekIndex < 18) return {
    ...summary, published: false, recommendationCount: 0, reason: 'Regular-season changes are already included in the combined season list. Playoff games use weekly progression.',
  };
  console.log('[progression] evaluation', { phase, currentWeek: snapshot.currentWeek, targetWeek: weekIndex === null ? null : weekIndex + 1 });
  if (phase === 'playoffs' && weekIndex >= 18) console.log('[progression] playoff source buckets',
    (snapshot.weeklyStats || []).filter((entry) => Number(entry.weekIndex) === weekIndex).map((entry) => ({
      stage: entry.stage ?? entry.stageIndex, rows: STAT_BUCKETS.reduce((count, [bucket, list]) => count + (entry[bucket]?.[list]?.length || 0), 0),
    })));
  if (weekIndex === null) {
    const registry = await ensureTeamThreads({ client, guildId, snapshot, rules: readRules().progression });
    return { ...summary, published: false, recommendationCount: 0, reason: 'Waiting for reliable completed-week statistics.', threadCount: Object.keys(registry.teams).length };
  }
  const weekly = await publishProgression({ client, guildId, snapshot: phase === 'playoffs' ? playoffProgressionSnapshot(snapshot) : snapshot, type: 'weekly', weekIndex });
  return { ...weekly, ...(summary.seasonChanges ? { seasonChanges: summary.seasonChanges } : {}),
    ...(summary.seasonChangesError ? { seasonChangesError: summary.seasonChangesError } : {}) };
}

// Backfill navigation and retry empty playoff reports from older stage handling.
// This reads the saved snapshot and never contacts EA or advances the league.
export async function repairProgressionReportNavigation(client, guildId) {
  const { resolveLeagueIdWithConfig, loadLeagueSnapshot } = await import('./madden_data.js');
  const leagueId = resolveLeagueIdWithConfig(guildId, 'progression:navigation');
  if (!leagueId) return;
  const snapshot = loadLeagueSnapshot(leagueId);
  if (!snapshot?.syncId) return;
  const history = await loadHistory(leagueId);
  const seasonKey = getMaddenSeasonKey(snapshot);
  const weekIndex = resolveProgressionWeek(snapshot);
  const weekly = weekIndex === null ? null : history.periods[`${seasonKey}_week_${weekIndex + 1}`];
  const seasonal = history.periods[`${seasonKey}_ovr_summary`];
  if (getFranchisePhase(snapshot) === 'playoffs' && !isSeasonMovementDue(snapshot) && seasonal) {
    await deferPublishedSeasonMovement(client, guildId, snapshot, history);
  }
  const needsWeekly = !weekly?.issuedAsAggregate && weekly?.recommendations?.length && !weekly.reportIndexMessages?.[guildId];
  const needsSeasonal = seasonal?.seasonChangeMessages?.[guildId] && !seasonal.reportIndexMessages?.[guildId];
  const needsPlayoffRepair = getFranchisePhase(snapshot) === 'playoffs' && weekIndex >= 18
    && weekly && !weekly.recommendations?.length && weekly.playoffStatsVersion !== 1;
  if (!needsWeekly && !needsSeasonal && !needsPlayoffRepair) return;
  const result = await publishProgressionReports({ client, guildId, snapshot });
  console.log('[progression] Saved reports repaired', { playoffStatsRepaired: Boolean(needsPlayoffRepair), week: weekIndex === null ? null : weekIndex + 1,
    changes: result.recommendationCount, teams: result.seasonChanges?.teamCount });
  return result;
}

export async function refreshProgressionForAwardChange({ client, guildId, leagueId, snapshot, weekNumber, winners }) {
  const weekIndex = Number(weekNumber) - 1;
  if (!Number.isInteger(weekIndex) || weekIndex < 0) return { published: false, reason: 'Invalid award week.' };
  if (isOffseason(snapshot)) return { published: false, reason: 'No rating recommendations are issued during offseason.' };
  const seasonRun = await loadFullSeasonRun(guildId, snapshot.leagueId);
  if (matchesFullSeason(seasonRun, snapshot) && (seasonRun.status !== 'complete' || weekIndex < 18)) return { published: false, recommendationCount: 0, reason: 'Regular-season changes belong to the combined full-season list.' };
  const progressionSnapshot = weekIndex >= 18 ? playoffProgressionSnapshot(snapshot) : snapshot;
  return publishProgression({
    client,
    guildId,
    snapshot: progressionSnapshot,
    type: 'weekly',
    weekIndex,
    awardWinners: winners,
  });
}

export async function refreshProgressionForSeasonAwardChange({ client, guildId, snapshot }) {
  return { published: false, reason: 'Season awards saved for history; ratings change only through weekly gameplay.' };
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
