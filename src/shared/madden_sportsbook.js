import fs from 'fs';
import path from 'path';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { brandTitle } from './madden_branding.js';
import { awardRecognitionPoints, consumeRecognitionPerk, getRecognitionGameOfWeek, getRecognitionPerkState, hasRecognitionPerk } from './league_recognition.js';
import { getCoachAssignmentMap } from './madden_coach_assignments.js';
import { loadLeagueSnapshot, requireLeagueIdForGuild } from '../../madden/madden_data.js';
import { getMaddenSnapshotContext } from './madden_metadata.js';
import { loadMaddenChannelMap } from './madden_metadata.js';
import { getGuildRoleMap } from './madden_guild_config.js';
import { getMaddenDataFilePath } from '../leaguebuddy/paths.js';
import { getMessageForWeek } from '../madden/madden_utils.js';

const STORE_PATH = getMaddenDataFilePath('sportsbook.json');
const ROLE_MAP_FILE = getMaddenDataFilePath('madden_role_ids.json');
const WEEKLY_GAME_LOG_FILE = getMaddenDataFilePath('weekly_game_log.json');

const STARTING_BANKROLL = 40;
const MAX_GAME_MARKETS = 2;
const SPREAD_PRICE = -110;
const TOTAL_PRICE = -110;
const IMPACT_EMOJI = 'impact';
const GAME_OF_WEEK_BET_BONUS = 2;
const FIRST_BET_BOOST_MULTIPLIER = 2;
const FIRST_BET_BOOST_MAX_EXTRA = 10;
const SUPERBOWL_FUTURE_MARKET = 'superbowl';
const SUPERBOWL_FUTURE_PREFIX = 'future:superbowl:';
const FUTURES_PAGE_SIZE = 5;
const PARLAY_MARKET = 'parlay';
const PARLAY_GAME_PREFIX = 'parlay:';
const PARLAY_MIN_LEGS = 2;
const PARLAY_MAX_LEGS = 5;
const PROP_MARKET = 'prop';
const PROP_GAME_PREFIX = 'prop:';
const PROP_PRICE = -115;
const MAX_PROPS_PER_GAME = 4;
const STAGE_REGULAR = 1;
const STAGE_POSTSEASON = 2;
const STAGE_OFFSEASON = 3;
const STAGE_OFFSEASON_ALT = 8;

// Founder/test protection: prevent role-removal testing from wiping founder sportsbook state.
const PROTECTED_SPORTSBOOK_USER_IDS = new Set([
  '1076243288056664234',
]);

function safeEmbedText(value = '', max = 4096) {
  const text = String(value || '').trim();
  if (!text) return '—';
  const limit = Math.max(128, Math.min(4096, Number(max) || 4096));
  if (text.length <= limit) return text;
  let cut = text.lastIndexOf('\n', limit - 12);
  if (cut < Math.floor(limit * 0.5)) cut = text.lastIndexOf(' ', limit - 12);
  if (cut <= 0) cut = limit - 12;
  return `${text.slice(0, cut).trim()}...`;
}

function safeReadJSON(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function loadStore() {
  return safeReadJSON(STORE_PATH, {});
}

function saveStore(store) {
  saveJSON(STORE_PATH, store);
}

function loadRoleMap(guildId = null) {
  const overlay = getGuildRoleMap(guildId);
  if (overlay && Object.keys(overlay).length) return overlay;
  return safeReadJSON(ROLE_MAP_FILE, {});
}

function loadChannelMap(guildId = null) {
  return loadMaddenChannelMap(guildId);
}

function loadWeeklyGameLog() {
  return safeReadJSON(WEEKLY_GAME_LOG_FILE, {});
}

function normalizeName(name = '') {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function roundToHalf(value) {
  return Math.round(Number(value || 0) * 2) / 2;
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function formatSigned(value) {
  const number = Number(value || 0);
  return `${number > 0 ? '+' : ''}${number}`;
}

function formatImpactValue(value) {
  const amount = Number(value || 0);
  const rounded = Number.isInteger(amount) ? String(amount) : amount.toFixed(1);
  return `${rounded}x ${IMPACT_EMOJI}`;
}

function formatImpactDelta(value) {
  const amount = Number(value || 0);
  const prefix = amount > 0 ? '+' : '';
  const rounded = Number.isInteger(amount) ? String(amount) : amount.toFixed(1);
  return `${prefix}${rounded}x ${IMPACT_EMOJI}`;
}

function recordWins(record = '') {
  const [wins] = String(record).split('-').map((value) => Number(value || 0));
  return Number.isFinite(wins) ? wins : 0;
}

function favoriteLabel(line) {
  return line.favorite === 'home' ? line.homeSpreadDisplay : line.awaySpreadDisplay;
}

function buildSportsbookIntel(lines = [], gotw = null) {
  if (!lines.length) {
    return {
      bestSide: 'Best side: board still loading.',
      totalToWatch: 'Total to watch: board still loading.',
      trapLine: 'Trap line: board still loading.',
      stayAway: 'Stay away: board still loading.',
      featured: gotw ? `Featured game: ${gotw.label} • winning bets add +${GAME_OF_WEEK_BET_BONUS} ${IMPACT_EMOJI}` : 'Featured game: not set yet.',
    };
  }

  const gotwGameId = gotw?.awayTeam && gotw?.homeTeam
    ? (lines.find((line) =>
      normalizeName(line.awayTeam) === normalizeName(gotw.awayTeam)
      && normalizeName(line.homeTeam) === normalizeName(gotw.homeTeam)
    )?.gameId || null)
    : null;

  const strongestSide = [...lines].sort((a, b) => Number(b.spread || 0) - Number(a.spread || 0))[0];
  const highestTotal = [...lines].sort((a, b) => Number(b.total || 0) - Number(a.total || 0))[0];
  const trapCandidate = [...lines]
    .filter((line) => Math.abs(Number(line.spread || 0)) <= 3.5)
    .filter((line) => !gotwGameId || String(line.gameId) !== String(gotwGameId))
    .sort((a, b) => {
      const aGap = Math.abs(recordWins(a.homeRecord) - recordWins(a.awayRecord));
      const bGap = Math.abs(recordWins(b.homeRecord) - recordWins(b.awayRecord));
      return bGap - aGap;
    })[0];
  const stayAwayLine = [...lines]
    .filter((line) => String(line?.gameId || '') !== String(trapCandidate?.gameId || ''))
    .filter((line) => String(line?.gameId || '') !== String(strongestSide?.gameId || ''))
    .filter((line) => !gotwGameId || String(line.gameId) !== String(gotwGameId))
    .sort((a, b) => {
      const aSpread = Math.abs(Number(a.spread || 0) - 1.5);
      const bSpread = Math.abs(Number(b.spread || 0) - 1.5);
      return aSpread - bSpread;
    })[0];

  return {
    bestSide: strongestSide
      ? `Best side: ${favoriteLabel(strongestSide)} • biggest edge on the board`
      : 'Best side: board still loading.',
    totalToWatch: highestTotal
      ? `Total to watch: ${highestTotal.awayTeam} at ${highestTotal.homeTeam} • O/U ${highestTotal.total}`
      : 'Total to watch: board still loading.',
    trapLine: trapCandidate
      ? `Trap line: ${trapCandidate.awayTeam} at ${trapCandidate.homeTeam} • ${favoriteLabel(trapCandidate)}`
      : 'Trap line: none yet.',
    stayAway: stayAwayLine
      ? `Stay away: ${stayAwayLine.awayTeam} at ${stayAwayLine.homeTeam} • close number at ${favoriteLabel(stayAwayLine)}`
      : 'Stay away: none yet.',
    featured: gotw
      ? `Featured game: ${gotw.label} • winning bets add +${GAME_OF_WEEK_BET_BONUS} ${IMPACT_EMOJI}`
      : 'Featured game: not set yet.',
  };
}

function resolveRecognitionSeasonKeyForGuild(guildId, fallbackSeasonKey) {
  if (!guildId) return fallbackSeasonKey;
  try {
    const leagueId = requireLeagueIdForGuild(guildId);
    const snapshot = loadLeagueSnapshot(leagueId);
    const year = snapshot?.info?.careerHubInfo?.seasonInfo?.calendarYear
      || snapshot?.info?.calendarYear
      || new Date().getFullYear();
    return `year_${year}`;
  } catch {
    return fallbackSeasonKey;
  }
}

function gotwLabelFromRecognition(gotw = null) {
  if (!gotw) return null;
  if (gotw.label) return String(gotw.label);
  const away = gotw.awayTeam ? String(gotw.awayTeam) : '';
  const home = gotw.homeTeam ? String(gotw.homeTeam) : '';
  if (away && home) return `${away} at ${home}`;
  return null;
}

function featuredGameLabelFromSnapshot(snapshot = null, weekNumber) {
  const featured = snapshot?.info?.careerHubInfo?.featuredGame || snapshot?.info?.featuredGame || null;
  if (!featured) return null;
  const week = Number(featured?.week ?? featured?.weekNumber ?? featured?.weekIndex != null ? Number(featured.weekIndex) + 1 : NaN);
  if (Number.isFinite(week) && weekNumber && Number(weekNumber) !== Number(week)) return null;
  const away = featured?.awayTeam || featured?.awayTeamName || featured?.visitorTeam || featured?.awayDisplayName || '';
  const home = featured?.homeTeam || featured?.homeTeamName || featured?.homeDisplayName || '';
  if (away && home) return `${away} at ${home}`;
  const label = featured?.label || featured?.gameLabel || '';
  return label ? String(label) : null;
}

function mostPopularLineFromBoard(lines = []) {
  if (!Array.isArray(lines) || !lines.length) return null;
  // If we haven't collected any bet meta yet, just surface "best line" as the default popular lean.
  const strongestSide = [...lines].sort((a, b) => Number(b.spread || 0) - Number(a.spread || 0))[0];
  if (!strongestSide) return null;
  return {
    matchupLabel: `${strongestSide.awayTeam} at ${strongestSide.homeTeam}`,
    label: `Spread ${favoriteLabel(strongestSide)}`,
    count: 0,
  };
}

function mostPopularBetForWeek(weekStore = {}) {
  const bets = (weekStore?.bets || []).filter((bet) => {
    const status = String(bet?.status || '');
    return status && status !== 'void';
  });
  if (!bets.length) return null;
  const counts = new Map();
  for (const bet of bets) {
    const key = [bet.gameId, bet.market, bet.selection].map((v) => String(v ?? '')).join('|');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [topKey, count] = sorted[0] || [];
  if (!topKey || !count) return null;
  const [gameId, market, selection] = String(topKey).split('|');
  const sample = bets.find((bet) => String(bet.gameId) === String(gameId) && String(bet.market) === String(market) && String(bet.selection) === String(selection));
  if (!sample) return null;
  return {
    label: sample.betLabel || `${market} ${selection}`,
    matchupLabel: sample.matchupLabel || 'Game',
    count,
  };
}

function getSportsbookLimits(balance = STARTING_BANKROLL) {
  const current = Math.max(0, Number(balance || 0));
  return {
    maxWager: Math.min(current, clamp(Math.floor(current * 0.25), 1, 20)),
    maxWeeklyExposure: Math.min(current, clamp(Math.floor(current * 0.65), 1, 60)),
  };
}

function americanProfit(stake, americanOdds) {
  const wager = Number(stake || 0);
  const odds = Number(americanOdds || 0);
  if (!wager || !odds) return 0;
  if (odds > 0) return Math.round((wager * (odds / 100)) * 10) / 10;
  return Math.round((wager * (100 / Math.abs(odds))) * 10) / 10;
}

function payoutBreakdown(stake, americanOdds) {
  const wager = Number(stake || 0);
  const profit = americanProfit(wager, americanOdds);
  return {
    stake: wager,
    profit,
    totalReturn: wager + profit,
  };
}

function americanToDecimal(odds) {
  const price = Number(odds || 0);
  if (!Number.isFinite(price) || price === 0) return 1;
  return price > 0 ? 1 + (price / 100) : 1 + (100 / Math.abs(price));
}

function decimalToAmerican(decimalOdds) {
  const decimal = Math.max(1.01, Number(decimalOdds || 1));
  const american = decimal >= 2
    ? (decimal - 1) * 100
    : -100 / (decimal - 1);
  return Math.round(american);
}

function parlayPrice(legs = []) {
  const decimal = (legs || []).reduce((product, leg) => product * americanToDecimal(leg?.price || 0), 1);
  return decimalToAmerican(decimal);
}

function impliedMoneylineFromSpread(spread) {
  const abs = Math.abs(Number(spread || 0));
  if (abs <= 1.5) return { favorite: -120, underdog: 100 };
  if (abs <= 3.5) return { favorite: -145, underdog: 125 };
  if (abs <= 6.5) return { favorite: -190, underdog: 160 };
  return { favorite: -260, underdog: 210 };
}

function ensureSeason(store, seasonKey) {
  store[seasonKey] = store[seasonKey] || { bankrolls: {}, weeks: {} };
  store[seasonKey].bankrolls = store[seasonKey].bankrolls || {};
  store[seasonKey].weeks = store[seasonKey].weeks || {};
  return store[seasonKey];
}

function ensureFuturesBook(seasonStore) {
  seasonStore.futures = seasonStore.futures || {
    market: SUPERBOWL_FUTURE_MARKET,
    lines: [],
    bets: [],
    updatedAt: null,
  };
  seasonStore.futures.lines = Array.isArray(seasonStore.futures.lines) ? seasonStore.futures.lines : [];
  seasonStore.futures.bets = Array.isArray(seasonStore.futures.bets) ? seasonStore.futures.bets : [];
  return seasonStore.futures;
}

function ensureWeek(seasonStore, weekKey) {
  seasonStore.weeks[weekKey] = seasonStore.weeks[weekKey] || {
    lines: [],
    bets: [],
    posts: null,
    settled: false,
    settledAt: null,
  };
  return seasonStore.weeks[weekKey];
}

function initialSportsbookImpact({ guildId, seasonKey, userId }) {
  if (!guildId || !seasonKey || !userId) return STARTING_BANKROLL;
  const perkState = getRecognitionPerkState({
    guildId,
    league: 'madden',
    seasonKey,
    userId: String(userId),
  });
  const impact = Number(perkState?.balances?.impact || 0);
  return impact > 0 ? impact : STARTING_BANKROLL;
}

function ensureBankroll(seasonStore, userId, startingBalance = STARTING_BANKROLL) {
  seasonStore.bankrolls[userId] = seasonStore.bankrolls[userId] || {
    balance: Number(startingBalance || STARTING_BANKROLL),
    totalWagered: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    profit: 0,
    firstBetBoostUsed: false,
    firstBetBoostBetPlacedAt: null,
    firstBetBoostBonus: 0,
  };
  return seasonStore.bankrolls[userId];
}

function firstBetBoostState(card = {}) {
  const bankroll = card?.bankroll || {};
  const liveBoostBet = (card?.bets || []).find((bet) => bet?.status === 'open' && bet?.firstBetBoost);
  if (liveBoostBet) {
    return `Live now on your first bet: ${liveBoostBet.betLabel || 'open slip'} • win gets ${FIRST_BET_BOOST_MULTIPLIER}x profit`;
  }
  if (bankroll.firstBetBoostUsed) {
    return bankroll.firstBetBoostBonus > 0
      ? `Used • cashed an extra ${formatImpactValue(bankroll.firstBetBoostBonus)}`
      : 'Used • your boosted first bet did not cash';
  }
  return `Available • your first bet of the season pays ${FIRST_BET_BOOST_MULTIPLIER}x profit if it wins`;
}

function isCoachOrLeaguebuddy(member, roleMap) {
  return member.roles.cache.some((role) => {
    if (role.id === (roleMap['LEAGUEbuddy Coaches'] || roleMap['LB Coaches'] || roleMap['Ghost Legacy'])) return true;
    return Object.entries(roleMap).some(([name, id]) => /coach$/i.test(name) && id === role.id);
  });
}

async function canUserBetSportsbook({ guild = null, guildId = null, userId = null }) {
  if (!guild || !userId) return false;
  const roleMap = loadRoleMap(guildId);
  const member = guild.members?.cache?.get?.(String(userId))
    || await guild.members?.fetch?.(String(userId)).catch(() => null);
  if (!member) return false;
  return isCoachOrLeaguebuddy(member, roleMap);
}

function coachTeamsFromMember(member, roleMap) {
  const teams = [];
  for (const role of member?.roles?.cache?.values?.() || []) {
    for (const [name, id] of Object.entries(roleMap || {})) {
      if (id !== role.id) continue;
      if (!/coach$/i.test(name)) continue;
      teams.push(name.replace(/coach$/i, '').trim());
    }
  }
  return [...new Set(teams)];
}

function pointsFromSchedule(snapshot, currentWeekLimit) {
  const out = {};
  const games = (snapshot?.schedule?.schedules || []).filter((game) => {
    const stage = Number(game.stageIndex ?? game.stage ?? 1);
    if (stage !== 1) return false;
    if (currentWeekLimit != null && Number.isInteger(game.weekIndex)) return game.weekIndex < currentWeekLimit;
    return true;
  });
  for (const game of games) {
    const away = game.awayTeamId;
    const home = game.homeTeamId;
    const awayScore = Number(game.awayScore ?? 0);
    const homeScore = Number(game.homeScore ?? 0);
    out[away] = out[away] || { for: 0, against: 0, games: 0 };
    out[home] = out[home] || { for: 0, against: 0, games: 0 };
    out[away].for += awayScore;
    out[away].against += homeScore;
    out[away].games += 1;
    out[home].for += homeScore;
    out[home].against += awayScore;
    out[home].games += 1;
  }
  return out;
}

function pickField(obj, keys) {
  for (const key of keys) {
    if (obj?.[key] !== undefined && obj?.[key] !== null) return Number(obj[key]);
  }
  return null;
}

function normalizeStandingsPoints(rawValue, games) {
  const raw = Number(rawValue);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const played = Math.max(1, Number(games || 1));
  // Many exports already store ptsFor / ptsAgainst as per-game values.
  // Only divide when the number looks like a season total.
  if (raw >= played * 10) return raw / played;
  return raw;
}

function buildTeamStrengthMap(snapshot) {
  const standings = snapshot?.standings?.teamStandingInfoList || [];
  const currentWeek = snapshot?.currentWeek ?? snapshot?.info?.careerHubInfo?.seasonInfo?.seasonWeek ?? null;
  const schedulePts = pointsFromSchedule(snapshot, currentWeek ? currentWeek : null);
  const map = {};
  for (const team of standings) {
    const teamId = Number(team.teamId);
    const wins = Number(team.totalWins || 0);
    const losses = Number(team.totalLosses || 0);
    const ties = Number(team.totalTies || 0);
    const games = Math.max(1, wins + losses + ties);
    const winPct = wins / games;
    const scheduleHasScoring = Number(schedulePts[teamId]?.for || 0) > 0 || Number(schedulePts[teamId]?.against || 0) > 0;
    const standingsPtsFor = normalizeStandingsPoints(pickField(team, ['pointsFor', 'totalPointsFor', 'offPts', 'ptsFor']), games);
    const standingsPtsAgainst = normalizeStandingsPoints(pickField(team, ['pointsAgainst', 'ptsAllowed', 'defPtsAllowed', 'ptsAgainst']), games);
    const ptsFor = (schedulePts[teamId]?.games && scheduleHasScoring)
      ? (schedulePts[teamId].for / schedulePts[teamId].games)
      : standingsPtsFor;
    const ptsAgainst = (schedulePts[teamId]?.games && scheduleHasScoring)
      ? (schedulePts[teamId].against / schedulePts[teamId].games)
      : standingsPtsAgainst;
    const diff = (Number.isFinite(ptsFor) ? ptsFor : 0) - (Number.isFinite(ptsAgainst) ? ptsAgainst : 0);
    map[teamId] = {
      wins,
      losses,
      winPct,
      ptsFor: Number.isFinite(ptsFor) ? ptsFor : 21,
      ptsAgainst: Number.isFinite(ptsAgainst) ? ptsAgainst : 21,
      diff,
      teamOvr: Number(team.teamOvr || team.ovrRating || 80),
      netPts: Number(team.netPts || 0),
      ptsForRank: Number(team.ptsForRank || 16),
      ptsAgainstRank: Number(team.ptsAgainstRank || 16),
      offPassYdsRank: Number(team.offPassYdsRank || 16),
      offRushYdsRank: Number(team.offRushYdsRank || 16),
      defPassYdsRank: Number(team.defPassYdsRank || 16),
      defRushYdsRank: Number(team.defRushYdsRank || 16),
      score: (winPct * 18) + (diff * 0.9) + ((Number.isFinite(ptsFor) ? ptsFor : 21) * 0.15),
    };
  }
  return map;
}

function recentGameMap(snapshot, currentWeekLimit) {
  const out = {};
  const games = (snapshot?.schedule?.schedules || [])
    .filter((game) => Number(game.stageIndex ?? game.stage ?? 1) === 1)
    .filter((game) => currentWeekLimit == null || Number(game.weekIndex ?? -1) < Number(currentWeekLimit))
    .filter((game) => Number(game.awayScore ?? 0) > 0 || Number(game.homeScore ?? 0) > 0)
    .sort((a, b) => Number(a.weekIndex ?? 0) - Number(b.weekIndex ?? 0));
  for (const game of games) {
    const awayTeamId = Number(game.awayTeamId);
    const homeTeamId = Number(game.homeTeamId);
    out[awayTeamId] = out[awayTeamId] || [];
    out[homeTeamId] = out[homeTeamId] || [];
    out[awayTeamId].push({
      weekIndex: Number(game.weekIndex ?? -1),
      pointsFor: Number(game.awayScore || 0),
      pointsAgainst: Number(game.homeScore || 0),
      margin: Number(game.awayScore || 0) - Number(game.homeScore || 0),
      won: Number(game.awayScore || 0) > Number(game.homeScore || 0),
    });
    out[homeTeamId].push({
      weekIndex: Number(game.weekIndex ?? -1),
      pointsFor: Number(game.homeScore || 0),
      pointsAgainst: Number(game.awayScore || 0),
      margin: Number(game.homeScore || 0) - Number(game.awayScore || 0),
      won: Number(game.homeScore || 0) > Number(game.awayScore || 0),
    });
  }
  return out;
}

function averageOf(values = []) {
  const nums = values.map((value) => Number(value || 0)).filter((value) => Number.isFinite(value));
  if (!nums.length) return 0;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function buildRecentFormMap(snapshot) {
  const currentWeek = snapshot?.currentWeek ?? snapshot?.info?.careerHubInfo?.seasonInfo?.seasonWeek ?? null;
  const gamesByTeam = recentGameMap(snapshot, currentWeek ? currentWeek : null);
  const out = {};
  for (const [teamId, games] of Object.entries(gamesByTeam)) {
    const recent = [...games].slice(-3);
    out[Number(teamId)] = {
      recentWins: recent.filter((game) => game.won).length,
      recentAvgMargin: averageOf(recent.map((game) => game.margin)),
      recentAvgPtsFor: averageOf(recent.map((game) => game.pointsFor)),
      recentAvgPtsAgainst: averageOf(recent.map((game) => game.pointsAgainst)),
      blowoutWins: recent.filter((game) => game.margin >= 14).length,
      blowoutLosses: recent.filter((game) => game.margin <= -14).length,
      games: recent.length,
    };
  }
  return out;
}

function buildTeamWeeklyProfiles(snapshot) {
  const out = {};
  for (const week of snapshot?.weeklyStats || []) {
    if (Number(week?.stage ?? week?.stageIndex ?? 1) !== 1) continue;
    for (const player of week?.passing?.playerPassingStatInfoList || []) {
      const teamId = Number(player.teamId);
      out[teamId] = out[teamId] || { passAtt: 0, rushAtt: 0, sacks: 0, games: new Set() };
      out[teamId].passAtt += Number(player.passAtt || 0);
      out[teamId].games.add(`${week.weekIndex}:${player.scheduleId || ''}`);
    }
    for (const player of week?.rushing?.playerRushingStatInfoList || []) {
      const teamId = Number(player.teamId);
      out[teamId] = out[teamId] || { passAtt: 0, rushAtt: 0, sacks: 0, games: new Set() };
      out[teamId].rushAtt += Number(player.rushAtt || 0);
      out[teamId].games.add(`${week.weekIndex}:${player.scheduleId || ''}`);
    }
    for (const player of week?.defense?.playerDefensiveStatInfoList || []) {
      const teamId = Number(player.teamId);
      out[teamId] = out[teamId] || { passAtt: 0, rushAtt: 0, sacks: 0, games: new Set() };
      out[teamId].sacks += Number(player.defSacks || player.sacks || 0);
      out[teamId].games.add(`${week.weekIndex}:${player.scheduleId || ''}`);
    }
  }
  for (const value of Object.values(out)) {
    value.gameCount = Math.max(1, value.games.size);
    delete value.games;
  }
  return out;
}

function rosterForTeam(snapshot, teamId) {
  return snapshot?.rosters?.teams?.[String(teamId)]?.rosterInfoList || [];
}

function formatPlayerName(player = {}) {
  return player?.name || `${player?.firstName || ''} ${player?.lastName || ''}`.trim() || 'Unknown';
}

function playerPosition(player = {}) {
  return String(player?.position || player?.pos || '').toUpperCase();
}

function playerKey(player = {}) {
  const id = player?.playerId ?? player?.rosterId ?? player?.maddenId ?? null;
  if (id != null && String(id).trim()) return `id:${id}`;
  return `name:${normalizeName(formatPlayerName(player))}:${Number(player?.teamId || 0)}`;
}

function roundPropLine(value, type) {
  const number = Number(value || 0);
  if (type === 'rec') return Math.max(1.5, Math.round(number * 2) / 2);
  if (type === 'sacks') return Math.max(0.5, Math.round(number * 2) / 2);
  return Math.max(9.5, Math.round(number / 5) * 5 - 0.5);
}

function propLabel(type) {
  if (type === 'pass_yds') return 'pass yards';
  if (type === 'rush_yds') return 'rush yards';
  if (type === 'rec_yds') return 'rec yards';
  if (type === 'rec') return 'receptions';
  if (type === 'sacks') return 'sacks';
  return 'stat';
}

function propStatFromRow(row = {}, type) {
  if (type === 'pass_yds') return Number(row.passYds || 0);
  if (type === 'rush_yds') return Number(row.rushYds || 0);
  if (type === 'rec_yds') return Number(row.recYds || 0);
  if (type === 'rec') return Number(row.recCatches || row.receptions || 0);
  if (type === 'sacks') return Number(row.defSacks || row.sacks || 0);
  return 0;
}

function addPropStat(map, row, type, weekIndex, rosterByKey = new Map()) {
  const teamId = Number(row?.teamId);
  if (!Number.isFinite(teamId)) return;
  const key = playerKey(row);
  const roster = rosterByKey.get(key) || {};
  const name = formatPlayerName({ ...roster, ...row });
  if (!name || name === 'Unknown') return;
  const stat = propStatFromRow(row, type);
  const entryKey = `${key}:${type}`;
  const current = map.get(entryKey) || {
    playerKey: key,
    playerId: row?.playerId ?? row?.rosterId ?? roster?.playerId ?? null,
    playerName: name,
    position: playerPosition(row) || playerPosition(roster),
    teamId,
    type,
    games: [],
  };
  current.games.push({ weekIndex: Number(weekIndex ?? -1), value: stat });
  map.set(entryKey, current);
}

function buildPlayerPropProfiles(snapshot, weekNumber = 1) {
  const targetWeekIndex = Math.max(0, Number(weekNumber || 1) - 1);
  const rosterByKey = new Map();
  for (const team of snapshot?.teams?.leagueTeamInfoList || []) {
    for (const player of rosterForTeam(snapshot, Number(team.teamId))) {
      rosterByKey.set(playerKey({ ...player, teamId: Number(team.teamId) }), { ...player, teamId: Number(team.teamId) });
    }
  }
  const map = new Map();
  for (const week of snapshot?.weeklyStats || []) {
    const stage = Number(week?.stage ?? week?.stageIndex ?? STAGE_REGULAR);
    const weekIndex = Number(week?.weekIndex ?? -1);
    if (stage !== STAGE_REGULAR || weekIndex < 0 || weekIndex >= targetWeekIndex) continue;
    for (const row of week?.passing?.playerPassingStatInfoList || []) addPropStat(map, row, 'pass_yds', weekIndex, rosterByKey);
    for (const row of week?.rushing?.playerRushingStatInfoList || []) addPropStat(map, row, 'rush_yds', weekIndex, rosterByKey);
    for (const row of week?.receiving?.playerReceivingStatInfoList || []) {
      addPropStat(map, row, 'rec_yds', weekIndex, rosterByKey);
      addPropStat(map, row, 'rec', weekIndex, rosterByKey);
    }
    for (const row of week?.defense?.playerDefensiveStatInfoList || []) addPropStat(map, row, 'sacks', weekIndex, rosterByKey);
  }
  return [...map.values()].map((profile) => {
    const ordered = profile.games.slice().sort((a, b) => Number(a.weekIndex) - Number(b.weekIndex));
    const values = ordered.map((game) => Number(game.value || 0));
    const recent = values.slice(-3);
    const avg = averageOf(values);
    const recentAvg = averageOf(recent);
    const hitRate = values.length ? values.filter((value) => value >= avg).length / values.length : 0;
    return {
      ...profile,
      gamesPlayed: values.length,
      avg,
      recentAvg,
      trend: recentAvg - avg,
      high: values.length ? Math.max(...values) : 0,
      hitRate,
    };
  });
}

function propOpponentAdjustment(type, opponentStrength = {}) {
  if (type === 'pass_yds' || type === 'rec_yds' || type === 'rec') {
    return ((Number(opponentStrength.defPassYdsRank || 16) - 16) * 0.35) + ((Number(opponentStrength.ptsAgainst || 21) - 21) * 0.15);
  }
  if (type === 'rush_yds') {
    return ((Number(opponentStrength.defRushYdsRank || 16) - 16) * 0.4) + ((Number(opponentStrength.ptsAgainst || 21) - 21) * 0.12);
  }
  if (type === 'sacks') {
    return ((Number(opponentStrength.offPassYdsRank || 16) - 16) * 0.03);
  }
  return 0;
}

function buildPlayerPropsForGame(snapshot, line, { seasonKey = null, weekNumber = 1 } = {}) {
  const profiles = buildPlayerPropProfiles(snapshot, weekNumber);
  const strength = buildTeamStrengthMap(snapshot);
  const teams = [Number(line.awayTeamId), Number(line.homeTeamId)];
  const candidates = [];
  for (const profile of profiles) {
    if (!teams.includes(Number(profile.teamId))) continue;
    if (Number(profile.gamesPlayed || 0) < 2) continue;
    const opponentId = Number(profile.teamId) === Number(line.awayTeamId) ? Number(line.homeTeamId) : Number(line.awayTeamId);
    const opponent = strength[opponentId] || {};
    const baseline = (Number(profile.avg || 0) * 0.65) + (Number(profile.recentAvg || 0) * 0.35) + propOpponentAdjustment(profile.type, opponent);
    const lineValue = roundPropLine(baseline, profile.type);
    const confidence =
      (Number(profile.gamesPlayed || 0) * 0.8) +
      Math.min(8, Number(profile.avg || 0) / (profile.type === 'sacks' ? 0.18 : profile.type === 'rec' ? 0.45 : 12)) +
      Math.min(5, Math.abs(Number(profile.trend || 0)) / (profile.type === 'sacks' ? 0.2 : profile.type === 'rec' ? 0.5 : 12)) +
      (Number(profile.hitRate || 0) * 2);
    const minimum =
      profile.type === 'pass_yds' ? 120 :
        profile.type === 'rush_yds' ? 30 :
          profile.type === 'rec_yds' ? 28 :
            profile.type === 'rec' ? 2 :
              0.25;
    if (Number(profile.avg || 0) < minimum && Number(profile.recentAvg || 0) < minimum) continue;
    candidates.push({
      gameId: `${PROP_GAME_PREFIX}${line.gameId}:${profile.playerKey.replace(/[^a-zA-Z0-9:_-]/g, '')}:${profile.type}`,
      underlyingGameId: line.gameId,
      weekNumber: Number(weekNumber),
      market: PROP_MARKET,
      propType: profile.type,
      playerKey: profile.playerKey,
      playerId: profile.playerId,
      playerName: profile.playerName,
      position: profile.position,
      teamId: Number(profile.teamId),
      teamName: Number(profile.teamId) === Number(line.awayTeamId) ? line.awayTeam : line.homeTeam,
      opponentTeamId: opponentId,
      awayTeamId: line.awayTeamId,
      homeTeamId: line.homeTeamId,
      awayTeam: line.awayTeam,
      homeTeam: line.homeTeam,
      stage: line.stage,
      scheduleWeekIndex: line.scheduleWeekIndex,
      line: lineValue,
      price: PROP_PRICE,
      avg: Number(profile.avg.toFixed(1)),
      recentAvg: Number(profile.recentAvg.toFixed(1)),
      gamesPlayed: profile.gamesPlayed,
      trend: Number(profile.trend.toFixed(1)),
      confidence,
      betLabel: `${profile.playerName} ${lineValue} ${propLabel(profile.type)} ${formatSigned(PROP_PRICE)}`,
    });
  }
  const byTypePriority = { pass_yds: 5, rush_yds: 4, rec_yds: 4, rec: 2, sacks: 3 };
  return candidates
    .sort((a, b) => (b.confidence + (byTypePriority[b.propType] || 0)) - (a.confidence + (byTypePriority[a.propType] || 0)))
    .filter((candidate, idx, arr) => arr.findIndex((entry) => entry.playerKey === candidate.playerKey) === idx)
    .slice(0, MAX_PROPS_PER_GAME);
}

function tendencyLabelFromProfile(profile = {}) {
  const passAtt = Number(profile.passAtt || 0);
  const rushAtt = Number(profile.rushAtt || 0);
  const total = Math.max(1, passAtt + rushAtt);
  const passRate = passAtt / total;
  if (passRate >= 0.63) return 'pass-heavy';
  if (passRate <= 0.44) return 'run-heavy';
  return 'balanced';
}

function buildStandingsByTeam(snapshot) {
  const map = {};
  for (const team of snapshot?.standings?.teamStandingInfoList || []) {
    map[Number(team.teamId)] = team;
  }
  return map;
}

function buildHeadToHeadContext(snapshot, awayTeamId, homeTeamId, targetWeekNumber = 1) {
  const targetWeekIndex = Math.max(0, Number(targetWeekNumber || 1) - 1);
  const allGames = (snapshot?.schedule?.schedules || []).filter((game) => {
    const gameAway = Number(game.awayTeamId);
    const gameHome = Number(game.homeTeamId);
    const sameMatchup = (gameAway === Number(awayTeamId) && gameHome === Number(homeTeamId)) ||
      (gameAway === Number(homeTeamId) && gameHome === Number(awayTeamId));
    if (!sameMatchup) return false;
    const weekIndex = Number(game.weekIndex ?? -1);
    const stage = Number(game.stageIndex ?? game.stage ?? 1);
    if (stage === 1) return weekIndex >= 0 && weekIndex < targetWeekIndex && hasRealPlayedSignal(game);
    if (stage === 2) return hasRealPlayedSignal(game);
    return false;
  });
  const ordered = allGames
    .slice()
    .sort((a, b) =>
      Number(a.stageIndex ?? a.stage ?? 1) - Number(b.stageIndex ?? b.stage ?? 1) ||
      Number(a.weekIndex ?? -1) - Number(b.weekIndex ?? -1));
  const lastMeeting = ordered.length ? ordered[ordered.length - 1] : null;
  return {
    games: ordered,
    count: ordered.length,
    lastMeeting,
    regularSeasonMeetings: ordered.filter((game) => Number(game.stageIndex ?? game.stage ?? 1) === 1).length,
    postseasonMeetings: ordered.filter((game) => Number(game.stageIndex ?? game.stage ?? 1) === 2).length,
    isRematch: ordered.length > 0,
  };
}

function buildHistoricalSportsbookProfiles({ seasonKey = null, weekNumber = null } = {}) {
  const store = loadStore();
  const teamGames = new Map();
  const h2h = new Map();
  const currentYear = Number(String(seasonKey || '').replace(/^year_/, '')) || 0;
  const pushTeamGame = (teamId, game) => {
    const key = Number(teamId);
    if (!Number.isFinite(key)) return;
    const list = teamGames.get(key) || [];
    list.push(game);
    teamGames.set(key, list);
  };
  const h2hKey = (a, b) => [Number(a), Number(b)].sort((left, right) => left - right).join(':');

  for (const [storeSeasonKey, seasonStore] of Object.entries(store || {})) {
    if (!seasonStore?.weeks) continue;
    const storeYear = Number(String(storeSeasonKey || '').replace(/^year_/, '')) || 0;
    const yearDistance = currentYear && storeYear ? Math.max(0, currentYear - storeYear) : 0;
    if (yearDistance > 3) continue;
    for (const [weekKey, weekStore] of Object.entries(seasonStore.weeks || {})) {
      const storedWeek = Number(String(weekKey || '').replace(/^week_/, '')) || 0;
      if (storeSeasonKey === seasonKey && weekNumber && storedWeek >= Number(weekNumber)) continue;
      for (const line of weekStore?.lines || []) {
        const result = line?.result;
        if (!result?.played) continue;
        const awayTeamId = Number(line.awayTeamId);
        const homeTeamId = Number(line.homeTeamId);
        const awayScore = Number(result.awayScore);
        const homeScore = Number(result.homeScore);
        if (!Number.isFinite(awayTeamId) || !Number.isFinite(homeTeamId) || !Number.isFinite(awayScore) || !Number.isFinite(homeScore)) continue;
        const recencyWeight = storeSeasonKey === seasonKey
          ? 1
          : Math.max(0.35, 0.75 - (yearDistance * 0.15));
        const playedAt = `${storeSeasonKey}:${weekKey}`;
        pushTeamGame(awayTeamId, {
          seasonKey: storeSeasonKey,
          week: storedWeek,
          playedAt,
          pointsFor: awayScore,
          pointsAgainst: homeScore,
          margin: awayScore - homeScore,
          won: awayScore > homeScore,
          weight: recencyWeight,
        });
        pushTeamGame(homeTeamId, {
          seasonKey: storeSeasonKey,
          week: storedWeek,
          playedAt,
          pointsFor: homeScore,
          pointsAgainst: awayScore,
          margin: homeScore - awayScore,
          won: homeScore > awayScore,
          weight: recencyWeight,
        });
        const key = h2hKey(awayTeamId, homeTeamId);
        const meetings = h2h.get(key) || [];
        meetings.push({
          seasonKey: storeSeasonKey,
          week: storedWeek,
          awayTeamId,
          homeTeamId,
          awayScore,
          homeScore,
          homeMargin: homeScore - awayScore,
          total: awayScore + homeScore,
          weight: recencyWeight,
        });
        h2h.set(key, meetings);
      }
    }
  }

  const summarize = (games = [], limit = 10) => {
    const recent = games.slice(-limit);
    const weightTotal = recent.reduce((sum, game) => sum + Number(game.weight || 1), 0);
    if (!recent.length || !weightTotal) return null;
    const weighted = (field) => recent.reduce((sum, game) => sum + (Number(game[field] || 0) * Number(game.weight || 1)), 0) / weightTotal;
    return {
      games: recent.length,
      avgMargin: weighted('margin'),
      avgPtsFor: weighted('pointsFor'),
      avgPtsAgainst: weighted('pointsAgainst'),
      winPct: recent.reduce((sum, game) => sum + (game.won ? Number(game.weight || 1) : 0), 0) / weightTotal,
    };
  };

  return {
    team: new Map([...teamGames.entries()].map(([teamId, games]) => [teamId, summarize(games)])),
    h2h,
  };
}

function teamDisplayName(team = {}, fallback = '') {
  return String(team.displayName || team.nickName || team.longName || fallback || `Team ${team.teamId}`).trim();
}

function teamShortName(team = {}, label = '') {
  return String(team.abbrName || team.teamAbbr || team.abbreviation || team.nickName || label || `T${team.teamId}`).trim();
}

function conferenceLabelFromStanding(standing = {}) {
  const value = standing?.conferenceName || standing?.confName || standing?.conferenceId;
  if (value == null || value === '') return 'CONF';
  if (String(value).toUpperCase().includes('AFC')) return 'AFC';
  if (String(value).toUpperCase().includes('NFC')) return 'NFC';
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric === 0 ? 'AFC' : numeric === 1 ? 'NFC' : `CONF ${numeric}`;
  return String(value).toUpperCase();
}

function playoffSeedFromStanding(standing = {}) {
  return pickField(standing, ['playoffSeed', 'seed', 'confSeed', 'conferenceSeed', 'rank']) || null;
}

function roundFutureOdds(odds) {
  const value = Math.max(250, Number(odds || 0));
  if (value < 1000) return Math.round(value / 25) * 25;
  if (value < 5000) return Math.round(value / 100) * 100;
  return Math.round(value / 500) * 500;
}

function impliedProbabilityToAmericanOdds(probability) {
  const p = clamp(Number(probability || 0), 0.003, 0.25);
  return roundFutureOdds(((1 / p) - 1) * 100);
}

function buildSuperBowlFutures(snapshot, { seasonKey = null, weekNumber = null } = {}) {
  const teams = snapshot?.teams?.leagueTeamInfoList || [];
  const standings = buildStandingsByTeam(snapshot);
  const strength = buildTeamStrengthMap(snapshot);
  const recentForm = buildRecentFormMap(snapshot);
  const historical = buildHistoricalSportsbookProfiles({ seasonKey, weekNumber });
  const currentWeek = Number(weekNumber || snapshot?.currentWeek || snapshot?.info?.careerHubInfo?.seasonInfo?.seasonWeek || 1);
  const rows = teams
    .map((team) => {
      const teamId = Number(team?.teamId);
      if (!Number.isFinite(teamId)) return null;
      const standing = standings[teamId] || {};
      const current = strength[teamId] || {
        wins: Number(standing.totalWins || 0),
        losses: Number(standing.totalLosses || 0),
        winPct: 0,
        diff: 0,
        ptsFor: 21,
        ptsAgainst: 21,
        teamOvr: Number(standing.teamOvr || team.teamOvr || 80),
        score: 0,
      };
      const recent = recentForm[teamId] || { recentWins: 0, recentAvgMargin: 0, games: 0 };
      const history = historical.team.get(teamId) || null;
      const seed = playoffSeedFromStanding(standing);
      const games = Math.max(1, Number(current.wins || 0) + Number(current.losses || 0));
      const recordScore = (Number(current.winPct || 0) - 0.5) * 18;
      const differentialScore = clamp(Number(current.diff || 0), -24, 24) * 0.95;
      const rosterScore = (Number(current.teamOvr || 80) - 80) * 0.65;
      const recentScore = Number(recent.games || 0)
        ? (Number(recent.recentWins || 0) * 2.4) + (clamp(Number(recent.recentAvgMargin || 0), -21, 21) * 0.45)
        : 0;
      const historyScore = history
        ? ((Number(history.winPct || 0) - 0.5) * 9) + (clamp(Number(history.avgMargin || 0), -21, 21) * 0.35) + Math.min(3, Number(history.games || 0) * 0.3)
        : 0;
      const seedScore = seed ? Math.max(0, 8 - Number(seed)) * 0.8 : 0;
      const earlySeasonBlend = currentWeek <= 4 ? 0.8 : 1;
      const powerScore = (
        12 +
        (recordScore * earlySeasonBlend) +
        differentialScore +
        rosterScore +
        recentScore +
        historyScore +
        seedScore +
        (games >= 4 ? 1.5 : 0)
      );
      const label = teamDisplayName(team, standing.teamName);
      return {
        gameId: `${SUPERBOWL_FUTURE_PREFIX}${teamId}`,
        market: SUPERBOWL_FUTURE_MARKET,
        selection: String(teamId),
        teamId,
        teamName: label,
        shortName: teamShortName(team, label),
        conference: conferenceLabelFromStanding(standing),
        seed,
        record: `${Number(current.wins || 0)}-${Number(current.losses || 0)}`,
        winPct: Number(current.winPct || 0),
        pointDiff: Number(current.diff || 0),
        teamOvr: Number(current.teamOvr || team.teamOvr || 80),
        recentWins: Number(recent.recentWins || 0),
        recentGames: Number(recent.games || 0),
        historyGames: Number(history?.games || 0),
        historyWinPct: Number(history?.winPct || 0),
        powerScore,
      };
    })
    .filter(Boolean)
    .slice(0, 32);

  const weights = rows.map((row) => Math.exp(clamp(row.powerScore, -10, 45) / 8));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
  return rows
    .map((row, idx) => {
      const trueProbability = weights[idx] / totalWeight;
      const bookProbability = clamp(trueProbability * 0.78, 0.003, 0.25);
      const odds = impliedProbabilityToAmericanOdds(bookProbability);
      return {
        ...row,
        odds,
        impliedProbability: Number((10000 / (odds + 100)).toFixed(4)),
      };
    })
    .sort((a, b) => (a.odds - b.odds) || (b.powerScore - a.powerScore) || a.teamName.localeCompare(b.teamName))
    .map((row, idx) => ({ ...row, rank: idx + 1 }));
}

function refreshSuperBowlFutures(seasonStore, snapshot, { seasonKey = null, weekNumber = null } = {}) {
  const futures = ensureFuturesBook(seasonStore);
  futures.lines = buildSuperBowlFutures(snapshot, { seasonKey, weekNumber });
  futures.updatedAt = Date.now();
  return futures;
}

function divisionGameFlag(snapshot, awayTeamId, homeTeamId) {
  const standings = buildStandingsByTeam(snapshot);
  const awayDivision = String(standings?.[Number(awayTeamId)]?.divisionId || '');
  const homeDivision = String(standings?.[Number(homeTeamId)]?.divisionId || '');
  return awayDivision && homeDivision && awayDivision === homeDivision;
}

function spreadToMoneyline(spread) {
  const abs = Math.abs(Number(spread || 0));
  if (abs <= 1.5) return { favorite: -120, underdog: 100 };
  if (abs <= 3.5) return { favorite: -155, underdog: 135 };
  if (abs <= 5.5) return { favorite: -185, underdog: 155 };
  if (abs <= 7.5) return { favorite: -240, underdog: 195 };
  if (abs <= 10.5) return { favorite: -320, underdog: 250 };
  return { favorite: -425, underdog: 325 };
}

function buildLinesForGames(snapshot, games = [], teamsById = {}, weekNumber = 1, options = {}) {
  const strength = buildTeamStrengthMap(snapshot);
  const recentForm = buildRecentFormMap(snapshot);
  const weeklyProfiles = buildTeamWeeklyProfiles(snapshot);
  const historical = buildHistoricalSportsbookProfiles({
    seasonKey: options?.seasonKey || null,
    weekNumber,
  });
  return games.map((game) => {
    const modeledWeekNumber = Math.max(
      1,
      Number.isFinite(resolveGameWeekIndex(game)) && resolveGameWeekIndex(game) >= 0
        ? resolveGameWeekIndex(game) + 1
        : Number(weekNumber || 1),
    );
    const awayTeamId = Number(game.awayTeamId);
    const homeTeamId = Number(game.homeTeamId);
    const away = strength[awayTeamId] || { score: 0, ptsFor: 21, ptsAgainst: 21, wins: 0, losses: 0, diff: 0 };
    const home = strength[homeTeamId] || { score: 0, ptsFor: 21, ptsAgainst: 21, wins: 0, losses: 0, diff: 0 };
    const awayRecent = recentForm[awayTeamId] || { recentWins: 0, recentAvgMargin: 0, recentAvgPtsFor: away.ptsFor, recentAvgPtsAgainst: away.ptsAgainst, blowoutWins: 0, blowoutLosses: 0, games: 0 };
    const homeRecent = recentForm[homeTeamId] || { recentWins: 0, recentAvgMargin: 0, recentAvgPtsFor: home.ptsFor, recentAvgPtsAgainst: home.ptsAgainst, blowoutWins: 0, blowoutLosses: 0, games: 0 };
    const awayProfile = weeklyProfiles[awayTeamId] || {};
    const homeProfile = weeklyProfiles[homeTeamId] || {};
    const awayHistory = historical.team.get(awayTeamId) || null;
    const homeHistory = historical.team.get(homeTeamId) || null;
    const currentGames = Math.min(
      Number(away.wins || 0) + Number(away.losses || 0),
      Number(home.wins || 0) + Number(home.losses || 0),
    );
    const historyWeight = currentGames <= 1 ? 0.42 : currentGames <= 3 ? 0.30 : currentGames <= 6 ? 0.18 : 0.08;
    const awayTendency = tendencyLabelFromProfile(awayProfile);
    const homeTendency = tendencyLabelFromProfile(homeProfile);
    const h2h = buildHeadToHeadContext(snapshot, awayTeamId, homeTeamId, modeledWeekNumber);
    const divisionGame = divisionGameFlag(snapshot, awayTeamId, homeTeamId);
    const lastMeeting = h2h.lastMeeting;
    const lastAwayScore = Number(lastMeeting?.awayScore || 0);
    const lastHomeScore = Number(lastMeeting?.homeScore || 0);
    const lastWinner = lastMeeting
      ? (lastAwayScore > lastHomeScore ? 'away' : 'home')
      : null;
    const lastMarginForHome = lastMeeting
      ? ((Number(lastMeeting.homeTeamId) === homeTeamId ? lastHomeScore - lastAwayScore : lastAwayScore - lastHomeScore))
      : 0;

    const homeEdge = 1.5;
    const recentMarginEdge = (homeRecent.recentAvgMargin - awayRecent.recentAvgMargin) * 0.22;
    const blowoutEdge = ((homeRecent.blowoutWins - homeRecent.blowoutLosses) - (awayRecent.blowoutWins - awayRecent.blowoutLosses)) * 0.9;
    const rankEdge =
      ((away.ptsAgainstRank - home.ptsAgainstRank) * 0.08) +
      ((away.ptsForRank - home.ptsForRank) * 0.08) +
      ((away.defPassYdsRank - home.defPassYdsRank) * 0.03) +
      ((away.defRushYdsRank - home.defRushYdsRank) * 0.03);
    const ovrEdge = (home.teamOvr - away.teamOvr) * 0.12;
    const rematchSpreadLean = lastMeeting
      ? clamp(lastMarginForHome * 0.1, -2.5, 2.5)
      : 0;
    const h2hMeetings = historical.h2h.get([awayTeamId, homeTeamId].sort((a, b) => a - b).join(':')) || [];
    const historicalH2h = h2hMeetings.length ? h2hMeetings[h2hMeetings.length - 1] : null;
    const historicalH2hLean = historicalH2h
      ? clamp(
        (Number(historicalH2h.homeTeamId) === homeTeamId
          ? Number(historicalH2h.homeMargin || 0)
          : -Number(historicalH2h.homeMargin || 0)) * 0.06,
        -1.5,
        1.5,
      )
      : 0;
    const historicalEdge = (awayHistory && homeHistory)
      ? (((homeHistory.avgMargin - awayHistory.avgMargin) * 0.55) + ((homeHistory.winPct - awayHistory.winPct) * 3.5)) * historyWeight
      : 0;
    const divisionCompression = divisionGame ? -0.6 : 0;
    const repeatFamiliarityCompression = h2h.count >= 1 ? -0.4 : 0;
    const rawSpread = clamp(
      roundToHalf(((home.score + homeEdge) - away.score) + recentMarginEdge + blowoutEdge + rankEdge + ovrEdge + rematchSpreadLean + historicalH2hLean + historicalEdge + divisionCompression + repeatFamiliarityCompression),
      -16.5,
      16.5,
    );

    const explosiveOffenseBoost =
      ((away.ptsFor > 31 ? 1 : 0) + (home.ptsFor > 31 ? 1 : 0)) +
      ((awayRecent.recentAvgPtsFor > 31 ? 1 : 0) + (homeRecent.recentAvgPtsFor > 31 ? 1 : 0));
    const leakyDefenseBoost =
      ((away.ptsAgainst > 29 ? 1 : 0) + (home.ptsAgainst > 29 ? 1 : 0)) +
      ((awayRecent.recentAvgPtsAgainst > 29 ? 1 : 0) + (homeRecent.recentAvgPtsAgainst > 29 ? 1 : 0));
    const tendencyTotalBoost =
      (awayTendency === 'pass-heavy' ? 1.2 : awayTendency === 'run-heavy' ? -0.8 : 0) +
      (homeTendency === 'pass-heavy' ? 1.2 : homeTendency === 'run-heavy' ? -0.8 : 0);
    const rematchTotalLean = lastMeeting ? clamp(((lastAwayScore + lastHomeScore) - 42) * 0.08, -3, 3) : 0;
    const trenchSuppression =
      ((awayProfile.sacks || 0) / Math.max(1, awayProfile.gameCount || 1) > 3 ? -0.7 : 0) +
      ((homeProfile.sacks || 0) / Math.max(1, homeProfile.gameCount || 1) > 3 ? -0.7 : 0);
    const awayExpected = ((away.ptsFor * 0.6) + (home.ptsAgainst * 0.4) + (awayRecent.recentAvgPtsFor * 0.35) + (homeRecent.recentAvgPtsAgainst * 0.25)) / 1.6;
    const homeExpected = ((home.ptsFor * 0.6) + (away.ptsAgainst * 0.4) + (homeRecent.recentAvgPtsFor * 0.35) + (awayRecent.recentAvgPtsAgainst * 0.25)) / 1.6;
    const currentTotalBase = awayExpected + homeExpected;
    const historicalTotalBase = (awayHistory && homeHistory)
      ? ((awayHistory.avgPtsFor * 0.55) + (homeHistory.avgPtsAgainst * 0.45)) +
        ((homeHistory.avgPtsFor * 0.55) + (awayHistory.avgPtsAgainst * 0.45))
      : currentTotalBase;
    const totalBase = (currentTotalBase * (1 - (historyWeight * 0.45))) + (historicalTotalBase * (historyWeight * 0.45));
    const recentTotalLean = (((awayRecent.recentAvgPtsFor + awayRecent.recentAvgPtsAgainst) + (homeRecent.recentAvgPtsFor + homeRecent.recentAvgPtsAgainst)) / 2) - totalBase;
    const rankTotalBoost =
      ((33 - away.ptsForRank) * 0.18) +
      ((33 - home.ptsForRank) * 0.18) +
      ((33 - away.ptsAgainstRank) * 0.08) +
      ((33 - home.ptsAgainstRank) * 0.08) +
      ((33 - away.offPassYdsRank) * 0.04) +
      ((33 - home.offPassYdsRank) * 0.04);
    const matchupTotalBoost =
      ((home.ptsAgainst - 21) * 0.18) +
      ((away.ptsAgainst - 21) * 0.18) +
      ((away.ptsFor - 21) * 0.22) +
      ((home.ptsFor - 21) * 0.22);
    const lateSeasonBump = modeledWeekNumber >= 10 ? 1 : 0;
    const total = clamp(
      roundToHalf(totalBase + (recentTotalLean * 0.2) + rankTotalBoost + matchupTotalBoost + (explosiveOffenseBoost * 1.4) + (leakyDefenseBoost * 1.1) + tendencyTotalBoost + rematchTotalLean + trenchSuppression + lateSeasonBump),
      34.5,
      78.5,
    );
    const favorite = rawSpread >= 0 ? 'home' : 'away';
    const spread = Math.abs(rawSpread);
    const money = spreadToMoneyline(spread);
    return {
      gameId: `${weekNumber}:${awayTeamId}:${homeTeamId}`,
      weekNumber,
      awayTeamId,
      homeTeamId,
      awayTeam: teamsById[awayTeamId] || 'Away',
      homeTeam: teamsById[homeTeamId] || 'Home',
      awayRecord: `${away.wins}-${away.losses}`,
      homeRecord: `${home.wins}-${home.losses}`,
      favorite,
      spread,
      awayTendency,
      homeTendency,
      awaySpreadDisplay: favorite === 'away' ? `${teamsById[awayTeamId] || 'Away'} -${spread}` : `${teamsById[awayTeamId] || 'Away'} +${spread}`,
      homeSpreadDisplay: favorite === 'home' ? `${teamsById[homeTeamId] || 'Home'} -${spread}` : `${teamsById[homeTeamId] || 'Home'} +${spread}`,
      total,
      awayMoneyline: favorite === 'away' ? money.favorite : money.underdog,
      homeMoneyline: favorite === 'home' ? money.favorite : money.underdog,
      divisionGame,
      stage: resolveGameStage(game),
      scheduleWeekIndex: resolveGameWeekIndex(game),
      rematchCount: h2h.count,
      isRematch: h2h.isRematch,
      regularSeasonMeetings: h2h.regularSeasonMeetings,
      postseasonMeetings: h2h.postseasonMeetings,
      historyModel: {
        currentGames,
        historyWeight: Number(historyWeight.toFixed(2)),
        awayGames: awayHistory?.games || 0,
        homeGames: homeHistory?.games || 0,
        historicalH2hCount: h2hMeetings.length,
      },
      lastMeeting: lastMeeting ? {
        weekIndex: Number(lastMeeting.weekIndex ?? -1),
        stage: Number(lastMeeting.stageIndex ?? lastMeeting.stage ?? 1),
        awayTeamId: Number(lastMeeting.awayTeamId),
        homeTeamId: Number(lastMeeting.homeTeamId),
        awayScore: lastAwayScore,
        homeScore: lastHomeScore,
        winner: lastWinner,
      } : null,
    };
  });
}

function buildTeamsById(snapshot) {
  const out = {};
  for (const team of snapshot?.teams?.leagueTeamInfoList || []) {
    out[Number(team.teamId)] = String(team.displayName || team.nickName || team.longName || `Team ${team.teamId}`).trim();
  }
  return out;
}

function resolveGameStage(game = {}) {
  return Number(game.stageIndex ?? game.stage ?? STAGE_REGULAR);
}

function resolveGameWeekIndex(game = {}) {
  const weekIndex = Number(game.weekIndex ?? game.seasonWeekIndex ?? -1);
  if (Number.isFinite(weekIndex) && weekIndex >= 0) return weekIndex;
  const seasonWeek = Number(game.seasonWeek ?? 0);
  return seasonWeek > 0 ? seasonWeek - 1 : -1;
}

function resolveGameWeekCandidates(game = {}) {
  const candidates = new Set();
  const weekIndex = resolveGameWeekIndex(game);
  if (weekIndex >= 0) candidates.add(weekIndex + 1);
  const seasonWeek = Number(game.seasonWeek ?? 0);
  if (seasonWeek > 0) candidates.add(seasonWeek);
  if (resolveGameStage(game) === STAGE_POSTSEASON && weekIndex >= 18) {
    candidates.add(Math.max(1, weekIndex - 18));
  }
  return [...candidates];
}

function sportsbookWeekLabel({ stage = STAGE_REGULAR, weekNumber = null, offSeasonStage = 0, games = [] } = {}) {
  const stageValue = Number(stage ?? STAGE_REGULAR);
  const resolvedWeekIndex = (games || []).reduce((best, game) => {
    const idx = resolveGameWeekIndex(game);
    return idx > best ? idx : best;
  }, -1);
  if (stageValue === STAGE_POSTSEASON && resolvedWeekIndex >= 18) {
    return getMessageForWeek(resolvedWeekIndex + 1, STAGE_POSTSEASON, 0);
  }
  if (Number(offSeasonStage || 0) > 0 || stageValue === STAGE_OFFSEASON || stageValue === STAGE_OFFSEASON_ALT) {
    return `Offseason Stage ${Number(offSeasonStage || 1)}`;
  }
  if (!weekNumber) return stageValue === STAGE_POSTSEASON ? 'Postseason' : 'Current Week';
  return getMessageForWeek(Number(weekNumber), stageValue, Number(offSeasonStage || 0));
}

function chooseActiveSportsbookGames(allGames = [], { stage = STAGE_REGULAR, weekNumber = null } = {}) {
  const stageGames = (allGames || []).filter((game) => resolveGameStage(game) === Number(stage ?? STAGE_REGULAR));
  if (!stageGames.length) return [];

  const targetWeek = Number(weekNumber || 0);
  if (targetWeek > 0) {
    const exactMatches = stageGames.filter((game) => resolveGameWeekCandidates(game).includes(targetWeek));
    if (exactMatches.length) return exactMatches;
  }

  const unplayedGames = stageGames.filter((game) => !hasRealPlayedSignal(game));
  if (unplayedGames.length) {
    const weekIndexes = [...new Set(unplayedGames.map((game) => resolveGameWeekIndex(game)).filter((value) => value >= 0))];
    if (weekIndexes.length) {
      const chosenWeekIndex = Number(stage) === STAGE_POSTSEASON
        ? Math.max(...weekIndexes)
        : Math.min(...weekIndexes);
      return unplayedGames.filter((game) => resolveGameWeekIndex(game) === chosenWeekIndex);
    }
    return unplayedGames;
  }

  const availableWeekIndexes = [...new Set(stageGames.map((game) => resolveGameWeekIndex(game)).filter((value) => value >= 0))];
  if (availableWeekIndexes.length) {
    const chosenWeekIndex = Math.max(...availableWeekIndexes);
    return stageGames.filter((game) => resolveGameWeekIndex(game) === chosenWeekIndex);
  }
  return stageGames;
}

function getSportsbookContextForGuild(guildId) {
  let leagueId = null;
  try {
    leagueId = requireLeagueIdForGuild(guildId);
  } catch {
    return null;
  }
  let snapshot = null;
  try {
    snapshot = loadLeagueSnapshot(leagueId);
  } catch {
    return null;
  }
  const context = getMaddenSnapshotContext(guildId, { leagueId, snapshot });
  if (!context) return null;
  const stage = Number(context.seasonInfo?.seasonWeekType ?? STAGE_REGULAR);
  const weekNumber = Number(context.weekNumber || 0) || null;
  const offSeasonStage = Number(context.seasonInfo?.offSeasonStage ?? 0) || 0;
  const teamsById = buildTeamsById(snapshot);
  if (![STAGE_REGULAR, STAGE_POSTSEASON].includes(stage) || !weekNumber) {
    return {
      leagueId: context.leagueId,
      snapshot,
      seasonKey: context.seasonKey,
      weekNumber: null,
      stage,
      displayLabel: sportsbookWeekLabel({ stage, weekNumber, offSeasonStage }),
      games: [],
      teamsById,
    };
  }
  const games = chooseActiveSportsbookGames(snapshot?.schedule?.schedules || [], { stage, weekNumber });
  return {
    leagueId: context.leagueId,
    snapshot,
    seasonKey: context.seasonKey,
    weekNumber,
    stage,
    displayLabel: sportsbookWeekLabel({ stage, weekNumber, offSeasonStage, games }),
    games,
    teamsById,
  };
}

export function getSportsbookLineForMatchup({ guildId, awayTeamId, homeTeamId, seasonKey = null, weekNumber = null, snapshot = null }) {
  const context = snapshot
    ? {
      snapshot,
      seasonKey,
      weekNumber,
      teamsById: buildTeamsById(snapshot),
      games: chooseActiveSportsbookGames(snapshot?.schedule?.schedules || [], {
        stage: Number(snapshot?.info?.careerHubInfo?.seasonInfo?.seasonWeekType ?? STAGE_REGULAR),
        weekNumber,
      }),
    }
    : getSportsbookContextForGuild(guildId);
  if (!context?.snapshot || !context?.teamsById) return null;
  const targetAway = Number(awayTeamId);
  const targetHome = Number(homeTeamId);
  const week = Number(weekNumber || context.weekNumber || 0);
  if (!week) return null;
  const games = (context.games || []).filter((game) =>
    Number(game.awayTeamId) === targetAway &&
    Number(game.homeTeamId) === targetHome,
  );
  if (!games.length) return null;
  return buildLinesForGames(context.snapshot, games, context.teamsById, week, { seasonKey: context.seasonKey })[0] || null;
}

function marketCountForGame(weekStore, userId, gameId, existingMarket = null) {
  const markets = new Set();
  for (const bet of weekStore?.bets || []) {
    if (String(bet.userId) !== String(userId)) continue;
    if (bet.gameId !== gameId) continue;
    if (bet.status !== 'open') continue;
    if (existingMarket && bet.market === existingMarket) continue;
    markets.add(bet.market);
  }
  return markets.size;
}

function openExposureForWeek(weekStore, userId, existingBet = null) {
  return (weekStore?.bets || []).reduce((sum, bet) => {
    if (String(bet.userId) !== String(userId)) return sum;
    if (bet.status !== 'open') return sum;
    if (existingBet && bet === existingBet) return sum;
    return sum + Number(bet.wager || 0);
  }, 0);
}

function hasRealPlayedSignal(game = {}) {
  const awayScore = Number(game.awayScore ?? 0);
  const homeScore = Number(game.homeScore ?? 0);
  const explicitPlayed = game.isPlayed === true || game.played === true;
  const completedStatus = [2, 3, 4].includes(Number(game.status ?? game.gameStatus ?? -1));
  return completedStatus || (explicitPlayed && (awayScore > 0 || homeScore > 0));
}

function gameAlreadyPlayed(leagueId, weekNumber, line, liveGames = []) {
  const liveGame = (liveGames || []).find((game) =>
    Number(game.awayTeamId) === Number(line.awayTeamId) &&
    Number(game.homeTeamId) === Number(line.homeTeamId) &&
    resolveGameStage(game) === Number(line.stage ?? STAGE_REGULAR) &&
    (
      (Number(line.scheduleWeekIndex ?? -1) >= 0 && resolveGameWeekIndex(game) === Number(line.scheduleWeekIndex))
      || resolveGameWeekCandidates(game).includes(Number(weekNumber))
    ),
  );
  if (liveGame && !hasRealPlayedSignal(liveGame)) return false;
  if (liveGame && hasRealPlayedSignal(liveGame)) return true;

  const log = loadWeeklyGameLog();
  const leagueLog = log?.[String(leagueId)];
  if (!leagueLog?.games?.length) return false;
  return leagueLog.games.some((game) =>
    resolveGameStage(game) === Number(line.stage ?? STAGE_REGULAR) &&
    (
      (Number(line.scheduleWeekIndex ?? -1) >= 0 && resolveGameWeekIndex(game) === Number(line.scheduleWeekIndex))
      || resolveGameWeekCandidates(game).includes(Number(weekNumber))
    ) &&
    Number(game.awayTeamId) === Number(line.awayTeamId) &&
    Number(game.homeTeamId) === Number(line.homeTeamId) &&
    hasRealPlayedSignal(game),
  );
}

function sportsbookHeaderEmbed(weekNumber, seasonKey, intel = null, guildId = null) {
  const roleMap = loadRoleMap(guildId);
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(brandTitle(`LB Sportsbook • Week ${weekNumber}`))
    .setDescription([
      `Open the private board below to view this week's lines, check your card, and place bets.`,
      `Eligible: coaches and <@&${roleMap?.['LEAGUEbuddy Coaches'] || roleMap?.['LB Coaches'] || roleMap?.['Ghost Legacy'] || 'LEAGUEbuddy Coaches'}>`,
      ``,
      `Markets: spread, moneyline, over/under`,
      `Rules: current week only • max ${MAX_GAME_MARKETS} markets per game`,
      `Season offer: First Bet Boost • your first bet pays ${FIRST_BET_BOOST_MULTIPLIER}x profit if it wins`,
      `Your Impact available to bet, limits, and payouts are shown inside the private board.`,
      `Winning bets return your Impact and add bonus Impact.`,
    ].join('\n'))
    .setFooter({ text: `${seasonKey.replace('_', ' ')} • private board opens only for you` })
    .setTimestamp();
  if (intel) {
    embed.addFields(
      { name: 'Board Intel', value: [intel.bestSide, intel.totalToWatch, intel.trapLine, intel.stayAway].join('\n') },
      { name: 'Featured Bonus', value: intel.featured },
    );
  }
  return embed;
}

function headerRows(weekNumber) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`madden_sportsbook_open|${weekNumber}|board|0`)
        .setLabel('Open Private Lines, Card & Bets')
        .setStyle(ButtonStyle.Success),
    ),
  ];
}

export async function postSportsbookWeek({ client, guild, seasonKey, weekNumber, snapshot, games = [], teamsById = {} }) {
  // Sportsbook channel is deprecated. The board is accessed privately via Franchise Hub.
  // We still persist weekly lines here so the private view has something to render.
  const store = loadStore();
  const seasonStore = ensureSeason(store, seasonKey);
  const weekKey = `week_${weekNumber}`;
  const weekStore = ensureWeek(seasonStore, weekKey);
  const lines = buildLinesForGames(snapshot, games, teamsById, weekNumber, { seasonKey });
  const gotw = getRecognitionGameOfWeek({
    guildId: guild?.id,
    league: 'madden',
    seasonKey,
    weekKey,
  });
  weekStore.lines = lines;
  weekStore.props = lines.flatMap((line) => buildPlayerPropsForGame(snapshot, line, { seasonKey, weekNumber }));
  refreshSuperBowlFutures(seasonStore, snapshot, { seasonKey, weekNumber });
  // Clear any legacy channel post pointers so they don't get refreshed/recreated.
  weekStore.posts = null;
  saveStore(store);
  return weekStore;
}

export async function ensureSportsbookWeekPosted({ client, guild, mode = 'all' } = {}) {
  if (!client || !guild) return null;
  const context = getSportsbookContextForGuild(guild.id);
  if (!context?.seasonKey || !context?.weekNumber || !context?.games?.length) return null;

  // Startup safety: only ensure the *current* board exists. This prevents old weeks
  // (like a settled Week 6) from being recreated if their stored message IDs went stale.
  if (mode === 'currentOnly') {
    const store = loadStore();
    const seasonStore = store?.[context.seasonKey];
    const currentWeekKey = `week_${context.weekNumber}`;
    const weekStore = seasonStore?.weeks?.[currentWeekKey];
    if (weekStore?.settled) return null;
  }
  return postSportsbookWeek({
    client,
    guild,
    seasonKey: context.seasonKey,
    weekNumber: context.weekNumber,
    snapshot: context.snapshot,
    games: context.games,
    teamsById: context.teamsById,
  });
}

export async function refreshSportsbookHeaders({ client, guild, mode = 'all' } = {}) {
  // No-op: sportsbook channel headers are deprecated.
  return { updated: 0 };
}

export function sportsbookModal(customId, line) {
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle(line?.futureLabel || (line?.teamName ? `${line.teamName} futures` : `${line.awayTeam} at ${line.homeTeam}`));
  const wagerInput = new TextInputBuilder()
    .setCustomId('wager')
    .setLabel('Type a whole number only (example: 5)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(3)
    .setPlaceholder('5 = bet 5 Impact');
  modal.addComponents(new ActionRowBuilder().addComponents(wagerInput));
  return modal;
}

export function getLineForBet(seasonKey, weekNumber, gameId) {
  const store = loadStore();
  const seasonStore = store?.[seasonKey];
  const weekStore = seasonStore?.weeks?.[`week_${weekNumber}`];
  return weekStore?.lines?.find((entry) => entry.gameId === gameId)
    || weekStore?.props?.find((entry) => entry.gameId === gameId)
    || seasonStore?.futures?.lines?.find((entry) => entry.gameId === gameId)
    || null;
}

function linePrice(line, market, selection) {
  if (market === PROP_MARKET || String(line?.gameId || '').startsWith(PROP_GAME_PREFIX)) return Number(line?.price || PROP_PRICE);
  if (market === SUPERBOWL_FUTURE_MARKET || String(line?.gameId || '').startsWith(SUPERBOWL_FUTURE_PREFIX)) {
    return Number(line?.odds || 0);
  }
  if (market === 'moneyline') {
    return selection === 'away' ? line.awayMoneyline : line.homeMoneyline;
  }
  if (market === 'total') return TOTAL_PRICE;
  return SPREAD_PRICE;
}

function betLabelForLine(line, market, selection, price = null) {
  const odds = price == null ? linePrice(line, market, selection) : Number(price || 0);
  if (market === SUPERBOWL_FUTURE_MARKET) return futureBetLabel(line, odds);
  if (market === PROP_MARKET) return `${line.playerName} ${selection === 'under' ? 'Under' : 'Over'} ${line.line} ${propLabel(line.propType)} ${formatSigned(odds)}`;
  if (market === 'moneyline') return `${selection === 'away' ? line.awayTeam : line.homeTeam} moneyline ${formatSigned(odds)}`;
  if (market === 'total') return `${selection === 'over' ? 'Over' : 'Under'} ${line.total} ${formatSigned(odds)}`;
  return `${selection === 'away' ? line.awaySpreadDisplay : line.homeSpreadDisplay} ${formatSigned(odds)}`;
}

function isSuperBowlFutureBet(market, gameId) {
  return market === SUPERBOWL_FUTURE_MARKET || String(gameId || '').startsWith(SUPERBOWL_FUTURE_PREFIX);
}

function futureBetLabel(line, price = null) {
  const odds = price == null ? Number(line?.odds || 0) : Number(price || 0);
  return `${line?.teamName || 'Team'} Super Bowl winner ${formatSigned(odds)}`;
}

function parlayBuilderFor(seasonStore, userId) {
  seasonStore.parlayBuilders = seasonStore.parlayBuilders || {};
  const key = String(userId);
  seasonStore.parlayBuilders[key] = seasonStore.parlayBuilders[key] || { legs: [], updatedAt: Date.now() };
  seasonStore.parlayBuilders[key].legs = Array.isArray(seasonStore.parlayBuilders[key].legs)
    ? seasonStore.parlayBuilders[key].legs
    : [];
  return seasonStore.parlayBuilders[key];
}

function validateParlayLeg({ guildId, member, liveContext, line, market, selection }) {
  if (!line) return { ok: false, message: 'This betting line is no longer available.' };
  if (isSuperBowlFutureBet(market, line.gameId)) {
    return { ok: false, message: 'Super Bowl futures cannot be added to parlays.' };
  }
  if (gameAlreadyPlayed(liveContext.leagueId, liveContext.weekNumber, line, liveContext.games || [])) {
    return { ok: false, message: 'This game has already been logged as played. Betting is closed.' };
  }
  const roleMap = loadRoleMap(guildId);
  const coachTeams = coachTeamsFromMember(member, roleMap).map(normalizeName);
  const bettingOwnGame = coachTeams.some((team) =>
    team === normalizeName(line.awayTeam) || team === normalizeName(line.homeTeam),
  );
  if (bettingOwnGame) return { ok: false, message: 'Coaches cannot add their own games to a parlay.' };
  const allowed = ['spread', 'total', 'moneyline', PROP_MARKET].includes(String(market || ''));
  if (!allowed) return { ok: false, message: 'That market cannot be added to a parlay.' };
  if (market === PROP_MARKET && !['over', 'under'].includes(String(selection || ''))) return { ok: false, message: 'Invalid prop selection.' };
  if (market === 'total' && !['over', 'under'].includes(String(selection || ''))) return { ok: false, message: 'Invalid parlay selection.' };
  if (['spread', 'moneyline'].includes(String(market || '')) && !['away', 'home'].includes(String(selection || ''))) return { ok: false, message: 'Invalid parlay selection.' };
  return { ok: true };
}

export function addSportsbookParlayLeg({ guildId, member, userId, seasonKey, weekNumber, gameId, market, selection }) {
  const roleMap = loadRoleMap(guildId);
  if (!isCoachOrLeaguebuddy(member, roleMap)) {
    return { ok: false, message: 'Only coaches and LEAGUEbuddy Coaches can use parlays.' };
  }
  const liveContext = getSportsbookContextForGuild(guildId);
  if (!liveContext?.seasonKey || !liveContext?.weekNumber) return { ok: false, message: 'The sportsbook is not open right now.' };
  if (String(seasonKey) !== String(liveContext.seasonKey) || Number(weekNumber) !== Number(liveContext.weekNumber)) {
    return { ok: false, message: 'Only the current week board is open for parlay building.' };
  }
  const line = getLineForBet(seasonKey, weekNumber, gameId);
  const valid = validateParlayLeg({ guildId, member, liveContext, line, market, selection });
  if (!valid.ok) return valid;
  const store = loadStore();
  const seasonStore = ensureSeason(store, seasonKey);
  const weekStore = ensureWeek(seasonStore, `week_${weekNumber}`);
  if (weekStore.settled) return { ok: false, message: 'This week is already settled.' };
  const builder = parlayBuilderFor(seasonStore, userId);
  if (builder.weekNumber && Number(builder.weekNumber) !== Number(weekNumber)) {
    builder.legs = [];
  }
  const legGameKey = line.underlyingGameId || line.gameId;
  const duplicateGame = builder.legs.find((leg) => String(leg.underlyingGameId || leg.gameId) === String(legGameKey));
  if (duplicateGame) return { ok: false, message: 'Parlays can only use one leg from each game.' };
  if (builder.legs.length >= PARLAY_MAX_LEGS) return { ok: false, message: `Parlays are limited to ${PARLAY_MAX_LEGS} legs.` };
  const price = linePrice(line, market, selection);
  const leg = {
    gameId,
    underlyingGameId: line.underlyingGameId || line.gameId,
    market,
    selection,
    matchupLabel: `${line.awayTeam} at ${line.homeTeam}`,
    betLabel: betLabelForLine(line, market, selection, price),
    price,
    addedAt: Date.now(),
  };
  builder.legs.push(leg);
  builder.weekNumber = Number(weekNumber);
  builder.updatedAt = Date.now();
  saveStore(store);
  return {
    ok: true,
    leg,
    legs: builder.legs,
    price: parlayPrice(builder.legs),
  };
}

export function clearSportsbookParlay({ seasonKey, userId }) {
  const store = loadStore();
  const seasonStore = ensureSeason(store, seasonKey);
  seasonStore.parlayBuilders = seasonStore.parlayBuilders || {};
  seasonStore.parlayBuilders[String(userId)] = { legs: [], updatedAt: Date.now() };
  saveStore(store);
  return { ok: true };
}

export function getSportsbookParlaySlip({ seasonKey, userId }) {
  const store = loadStore();
  const seasonStore = store?.[seasonKey];
  const builder = seasonStore?.parlayBuilders?.[String(userId)] || { legs: [] };
  const legs = Array.isArray(builder.legs) ? builder.legs : [];
  return {
    legs,
    price: legs.length >= PARLAY_MIN_LEGS ? parlayPrice(legs) : null,
    updatedAt: builder.updatedAt || null,
  };
}

export function placeSportsbookParlay({ guildId, member, userId, seasonKey, weekNumber, wager }) {
  const roleMap = loadRoleMap(guildId);
  if (!isCoachOrLeaguebuddy(member, roleMap)) {
    return { ok: false, message: 'Only coaches and LEAGUEbuddy Coaches can use parlays.' };
  }
  const liveContext = getSportsbookContextForGuild(guildId);
  if (!liveContext?.seasonKey || !liveContext?.weekNumber) return { ok: false, message: 'The sportsbook is not open right now.' };
  if (String(seasonKey) !== String(liveContext.seasonKey) || Number(weekNumber) !== Number(liveContext.weekNumber)) {
    return { ok: false, message: 'Only the current week board is open for parlay betting.' };
  }
  const store = loadStore();
  const seasonStore = ensureSeason(store, seasonKey);
  const weekStore = ensureWeek(seasonStore, `week_${weekNumber}`);
  if (weekStore.settled) return { ok: false, message: 'This week is already settled.' };
  const builder = parlayBuilderFor(seasonStore, userId);
  const legs = Array.isArray(builder.legs) ? builder.legs : [];
  if (builder.weekNumber && Number(builder.weekNumber) !== Number(weekNumber)) {
    builder.legs = [];
    builder.updatedAt = Date.now();
    saveStore(store);
    return { ok: false, message: 'That parlay slip was from a different week, so it was cleared. Add fresh legs from this week.' };
  }
  if (legs.length < PARLAY_MIN_LEGS) return { ok: false, message: `Add at least ${PARLAY_MIN_LEGS} legs before placing a parlay.` };
  if (legs.length > PARLAY_MAX_LEGS) return { ok: false, message: `Parlays are limited to ${PARLAY_MAX_LEGS} legs.` };
  for (const leg of legs) {
    const line = getLineForBet(seasonKey, weekNumber, leg.gameId);
    const valid = validateParlayLeg({ guildId, member, liveContext, line, market: leg.market, selection: leg.selection });
    if (!valid.ok) return valid;
  }
  const bankroll = ensureBankroll(seasonStore, String(userId), initialSportsbookImpact({ guildId, seasonKey, userId }));
  const limits = getSportsbookLimits(bankroll.balance);
  const amount = Number(wager || 0);
  if (!Number.isFinite(amount) || amount < 1 || amount > limits.maxWager) {
    return { ok: false, message: `Bet amount must be between 1 and ${limits.maxWager} based on your Impact available to bet.` };
  }
  const weeklyExposure = openExposureForWeek(weekStore, userId);
  if ((weeklyExposure + amount) > limits.maxWeeklyExposure) {
    return { ok: false, message: `You can only keep ${formatImpactValue(limits.maxWeeklyExposure)} in open bets this week.` };
  }
  if (bankroll.balance < amount) return { ok: false, message: `You only have ${formatImpactValue(bankroll.balance)} Impact available to bet.` };
  const placedAt = Date.now();
  const price = parlayPrice(legs);
  const record = {
    userId: String(userId),
    gameId: `${PARLAY_GAME_PREFIX}${placedAt}`,
    market: PARLAY_MARKET,
    selection: 'all',
    matchupLabel: `${legs.length}-Leg Parlay`,
    betLabel: legs.map((leg) => leg.betLabel).join(' + '),
    legs: legs.map((leg) => ({ ...leg })),
    wager: amount,
    price,
    status: 'open',
    placedAt,
    firstBetBoost: false,
  };
  bankroll.balance -= amount;
  bankroll.totalWagered += amount;
  weekStore.bets.push(record);
  builder.legs = [];
  builder.updatedAt = Date.now();
  saveStore(store);
  return {
    ok: true,
    bet: record,
    balance: bankroll.balance,
    price,
    payout: payoutBreakdown(amount, price),
    limits,
  };
}

export function placeSportsbookBet({ guildId, member, userId, seasonKey, weekNumber, gameId, market, selection, wager }) {
  const roleMap = loadRoleMap(guildId);
  if (!isCoachOrLeaguebuddy(member, roleMap)) {
    return { ok: false, message: 'Only coaches and LEAGUEbuddy Coaches can use the sportsbook.' };
  }
  const liveContext = getSportsbookContextForGuild(guildId);
  if (!liveContext?.seasonKey || !liveContext?.weekNumber) {
    return { ok: false, message: 'The sportsbook is not open right now.' };
  }
  if (String(seasonKey) !== String(liveContext.seasonKey) || Number(weekNumber) !== Number(liveContext.weekNumber)) {
    return { ok: false, message: 'Only the current week board is open for betting.' };
  }
  const line = getLineForBet(seasonKey, weekNumber, gameId);
  if (!line) return { ok: false, message: 'This betting line is no longer available.' };
  const futureBet = isSuperBowlFutureBet(market, gameId);
  if (gameAlreadyPlayed(liveContext.leagueId, weekNumber, line, liveContext.games || [])) {
    return { ok: false, message: 'This game has already been logged as played. Betting is closed.' };
  }
  const coachTeams = coachTeamsFromMember(member, roleMap).map(normalizeName);
  const bettingOwnGame = coachTeams.some((team) =>
    team === normalizeName(line.awayTeam) || team === normalizeName(line.homeTeam),
  );
  if (!futureBet && bettingOwnGame) {
    return { ok: false, message: 'Coaches cannot bet on their own games.' };
  }
  const store = loadStore();
  const seasonStore = ensureSeason(store, seasonKey);
  const weekStore = ensureWeek(seasonStore, `week_${weekNumber}`);
  const futuresBook = ensureFuturesBook(seasonStore);
  if (!futureBet && weekStore.settled) return { ok: false, message: 'This week is already settled.' };
  const bankroll = ensureBankroll(
    seasonStore,
    String(userId),
    initialSportsbookImpact({ guildId, seasonKey, userId }),
  );
  const limits = getSportsbookLimits(bankroll.balance);
  const amount = Number(wager || 0);
  if (!Number.isFinite(amount) || amount < 1 || amount > limits.maxWager) {
    return { ok: false, message: `Bet amount must be between 1 and ${limits.maxWager} based on your Impact available to bet.` };
  }
  const existing = weekStore.bets.find((bet) =>
    String(bet.userId) === String(userId) &&
    bet.gameId === gameId &&
    bet.market === market,
  );
  if (existing && existing.status === 'open') {
    return { ok: false, message: 'You already have a bet in this market for this game. Open bets cannot be edited.' };
  }
  if (marketCountForGame(weekStore, userId, gameId, existing?.market) >= MAX_GAME_MARKETS) {
    return { ok: false, message: `You can only hold ${MAX_GAME_MARKETS} open markets on one game.` };
  }
  const weeklyExposure = openExposureForWeek(weekStore, userId, existing);
  if ((weeklyExposure + amount) > limits.maxWeeklyExposure) {
    return { ok: false, message: `You can only keep ${formatImpactValue(limits.maxWeeklyExposure)} in open bets this week.` };
  }
  if (bankroll.balance < amount) {
    return { ok: false, message: `You only have ${formatImpactValue(bankroll.balance)} Impact available to bet.` };
  }
  if (futureBet) {
    const existingFuture = futuresBook.bets.find((bet) =>
      String(bet.userId) === String(userId) &&
      String(bet.gameId) === String(gameId) &&
      String(bet.status || '') === 'open',
    );
    if (existingFuture) {
      return { ok: false, message: 'You already have an open Super Bowl ticket on this team.' };
    }
    bankroll.balance -= amount;
    bankroll.totalWagered += amount;
    const price = linePrice(line, market, selection);
    const placedAt = Date.now();
    const firstBetBoost = false;
    const record = {
      userId: String(userId),
      gameId,
      market: SUPERBOWL_FUTURE_MARKET,
      selection: String(line.teamId || selection || ''),
      matchupLabel: 'Super Bowl Winner',
      betLabel: futureBetLabel(line, price),
      wager: amount,
      price,
      status: 'open',
      placedAt,
      weekPlaced: Number(weekNumber || liveContext.weekNumber || 0),
      teamId: Number(line.teamId || selection || 0),
      teamName: line.teamName || null,
      firstBetBoost,
    };
    futuresBook.bets.push(record);
    saveStore(store);
    const payout = payoutBreakdown(amount, price);
    return {
      ok: true,
      line,
      balance: bankroll.balance,
      price,
      payout,
      limits,
    };
  }
  bankroll.balance -= amount;
  bankroll.totalWagered += amount;
  const price = linePrice(line, market, selection);
  const placedAt = Date.now();
  const firstBetBoost = !bankroll.firstBetBoostUsed && !bankroll.firstBetBoostBetPlacedAt;
  const betLabel = betLabelForLine(line, market, selection, price);
  const record = {
    userId: String(userId),
    gameId,
    market,
    selection,
    matchupLabel: `${line.awayTeam} at ${line.homeTeam}`,
    betLabel,
    wager: amount,
    price,
    status: 'open',
    placedAt,
    firstBetBoost,
  };
  if (firstBetBoost) {
    bankroll.firstBetBoostUsed = true;
    bankroll.firstBetBoostBetPlacedAt = placedAt;
  }
  weekStore.bets.push(record);
  saveStore(store);
  const payout = payoutBreakdown(amount, price);
  return {
    ok: true,
    line,
    balance: bankroll.balance,
    price,
    payout,
    limits,
  };
}

export function getSportsbookUserCard({ seasonKey, weekNumber, userId, guildId = null }) {
  const store = loadStore();
  const seasonStore = store?.[seasonKey];
  const bankroll = seasonStore?.bankrolls?.[String(userId)] || {
    balance: initialSportsbookImpact({ guildId, seasonKey, userId }),
    profit: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
  };
  const weekStore = seasonStore?.weeks?.[`week_${weekNumber}`] || { bets: [] };
  const bets = (weekStore.bets || []).filter((bet) => String(bet.userId) === String(userId));
  const futures = seasonStore?.futures || { lines: [], bets: [] };
  const futureBets = (futures.bets || []).filter((bet) => String(bet.userId) === String(userId));
  const parlaySlip = seasonStore?.parlayBuilders?.[String(userId)] || { legs: [] };
  return { bankroll, bets, futureBets, lines: weekStore.lines || [], futures: futures.lines || [], parlaySlip };
}

function parseMatchupFromGameId(gameId = '') {
  const parts = String(gameId || '').split(':');
  if (parts.length !== 3) return null;
  const awayTeamId = Number(parts[1]);
  const homeTeamId = Number(parts[2]);
  if (!Number.isFinite(awayTeamId) || !Number.isFinite(homeTeamId)) return null;
  return { awayTeamId, homeTeamId };
}

function buildTeamsByIdFromStoreOrSnapshot(lines = [], guildId = null) {
  const map = new Map();
  for (const line of lines || []) {
    if (line?.awayTeamId != null && line?.awayTeam) map.set(Number(line.awayTeamId), String(line.awayTeam));
    if (line?.homeTeamId != null && line?.homeTeam) map.set(Number(line.homeTeamId), String(line.homeTeam));
  }
  if (guildId == null) return map;
  try {
    const leagueId = requireLeagueIdForGuild(guildId);
    const snapshot = loadLeagueSnapshot(leagueId);
    for (const team of snapshot?.teams?.leagueTeamInfoList || []) {
      const teamId = Number(team?.teamId);
      const label = String(team?.displayName || team?.nickName || team?.longName || '').trim();
      if (Number.isFinite(teamId) && label) map.set(teamId, label);
    }
  } catch { }
  return map;
}

function resolveBetMatchupLabel(bet = {}, lines = [], guildId = null) {
  if (bet?.matchupLabel) return String(bet.matchupLabel);
  const line = (lines || []).find((entry) => String(entry?.gameId || '') === String(bet?.gameId || ''));
  if (line?.awayTeam && line?.homeTeam) return `${line.awayTeam} at ${line.homeTeam}`;
  const parsed = parseMatchupFromGameId(bet?.gameId || '');
  if (!parsed) return 'Unknown game';
  const teamsById = buildTeamsByIdFromStoreOrSnapshot(lines, guildId);
  const away = teamsById.get(parsed.awayTeamId);
  const home = teamsById.get(parsed.homeTeamId);
  return away && home ? `${away} at ${home}` : 'Unknown game';
}

export function getSportsbookOpenBetOpportunity({ seasonKey, userId, weekNumber = null, guildId = null }) {
  const store = loadStore();
  const seasonStore = store?.[seasonKey];
  const bankroll = seasonStore?.bankrolls?.[String(userId)] || {
    balance: initialSportsbookImpact({ guildId, seasonKey, userId }),
    profit: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
  };
  const weekKeys = weekNumber != null
    ? [`week_${weekNumber}`]
    : Object.keys(seasonStore?.weeks || {});
  let total = 0;
  let count = 0;
  for (const key of weekKeys) {
    const weekStore = seasonStore?.weeks?.[key];
    for (const bet of weekStore?.bets || []) {
      if (String(bet?.userId) !== String(userId)) continue;
      if (String(bet?.status || '') !== 'open') continue;
      count += 1;
      total += Number(payoutBreakdown(bet?.wager || 0, bet?.price || 0)?.profit || 0);
    }
  }
  return {
    bankroll,
    total: Math.round(total * 10) / 10,
    count,
  };
}

export function sportsbookLeaderboard(seasonKey, limit = 10) {
  const store = loadStore();
  const seasonStore = store?.[seasonKey];
  const rows = Object.entries(seasonStore?.bankrolls || {}).map(([userId, value]) => ({
    userId,
    balance: Number(value.balance || 0),
    profit: Number(value.profit || 0),
    wins: Number(value.wins || 0),
    losses: Number(value.losses || 0),
    pushes: Number(value.pushes || 0),
  }));
  rows.sort((a, b) => (b.balance - a.balance) || (b.profit - a.profit));
  return rows.slice(0, limit);
}

function openBetsForGame(bets = [], gameId) {
  return bets.filter((bet) => bet.gameId === gameId && bet.status === 'open');
}

function cardLinesForUser(bets = [], lines = [], guildId = null) {
  return bets.length
    ? bets
      .slice()
      .sort((a, b) => Number(b.placedAt || 0) - Number(a.placedAt || 0))
      .slice(0, 8)
      .map((bet) => {
        const matchupLabel = resolveBetMatchupLabel(bet, lines, guildId);
        const baseLabel = bet.betLabel || `${bet.market} ${bet.selection}`;
        if (bet.market === PARLAY_MARKET) {
          const legCount = Array.isArray(bet.legs) ? bet.legs.length : 0;
          const legLabel = legCount ? `${legCount}-leg parlay` : 'Parlay';
          return `${legLabel} • ${formatSigned(bet.price || 0)} • ${formatImpactValue(bet.wager)} • ${bet.status}`;
        }
        const oddsLabel = Number.isFinite(Number(bet?.price || 0)) && Number(bet?.price || 0) !== 0 && !String(baseLabel).includes(formatSigned(Number(bet.price || 0)))
          ? ` @ ${formatSigned(Number(bet.price || 0))}`
          : '';
        if (bet.status === 'buyout') {
          return `${matchupLabel} • ${baseLabel}${oddsLabel} • ${formatImpactValue(bet.wager)} • buyout for ${formatImpactValue(bet.refund || 0)}`;
        }
        return `${matchupLabel} • ${baseLabel}${oddsLabel} • ${formatImpactValue(bet.wager)} • ${bet.status}`;
      })
    : ['No bets placed for this week or Super Bowl futures board.'];
}

function openBuyoutBetsForUser(bets = []) {
  return bets
    .filter((bet) => String(bet?.status || '') === 'open' && ![PARLAY_MARKET, PROP_MARKET].includes(String(bet?.market || '')))
    .slice()
    .sort((a, b) => Number(b?.placedAt || 0) - Number(a?.placedAt || 0));
}

function normalizeTeamKey(name = '') {
  return normalizeName(name);
}

function userOwnsSportsbookGame({ guildId, userId, line }) {
  if (!guildId || !userId || !line) return false;
  const assignments = getCoachAssignmentMap({ guildId });
  const teams = assignments?.userToTeams?.get(String(userId)) || [];
  const owned = new Set(teams.map((team) => normalizeTeamKey(team)));
  return owned.has(normalizeTeamKey(line.awayTeam)) || owned.has(normalizeTeamKey(line.homeTeam));
}

function viewNavRow(weekNumber, mode, index, hasBoard = true) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`madden_sportsbook_view|${weekNumber}|tab_breakdown|0`).setLabel('Week Breakdown').setStyle(mode === 'breakdown' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`madden_sportsbook_view|${weekNumber}|tab_board|${index}`).setLabel('Board').setStyle(mode === 'board' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(!hasBoard),
    new ButtonBuilder().setCustomId(`madden_sportsbook_view|${weekNumber}|tab_futures|0`).setLabel('Super Bowl Futures').setStyle(mode === 'futures' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`madden_sportsbook_view|${weekNumber}|tab_card|0`).setLabel('My Card').setStyle(mode === 'card' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`madden_sportsbook_view|${weekNumber}|tab_leaderboard|0`).setLabel('Leaderboard').setStyle(mode === 'leaderboard' ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );
}

function breakdownPagerRow(weekNumber, index, total) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`madden_sportsbook_view|${weekNumber}|breakdown_prev|${Math.max(0, index - 1)}`).setLabel('Prev Game').setStyle(ButtonStyle.Secondary).setDisabled(index <= 0),
    new ButtonBuilder().setCustomId(`madden_sportsbook_view|${weekNumber}|breakdown_next|${Math.min(total - 1, index + 1)}`).setLabel('Next Game').setStyle(ButtonStyle.Secondary).setDisabled(index >= total - 1),
  );
}

function pageRow(weekNumber, index, total) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`madden_sportsbook_view|${weekNumber}|page_prev|${Math.max(0, index - 1)}`).setLabel('Prev').setStyle(ButtonStyle.Secondary).setDisabled(index <= 0),
    new ButtonBuilder().setCustomId(`madden_sportsbook_view|${weekNumber}|page_next|${Math.min(total - 1, index + 1)}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(index >= total - 1),
  );
}

function betRows(line) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`madden_sportsbook_bet|${line.weekNumber}|${line.gameId}|spread|away`).setLabel(line.awaySpreadDisplay).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`madden_sportsbook_bet|${line.weekNumber}|${line.gameId}|spread|home`).setLabel(line.homeSpreadDisplay).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`madden_sportsbook_bet|${line.weekNumber}|${line.gameId}|total|over`).setLabel(`Over ${line.total}`).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`madden_sportsbook_bet|${line.weekNumber}|${line.gameId}|total|under`).setLabel(`Under ${line.total}`).setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`madden_sportsbook_bet|${line.weekNumber}|${line.gameId}|moneyline|away`).setLabel(`${line.awayTeam} ML ${formatSigned(line.awayMoneyline)}`).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`madden_sportsbook_bet|${line.weekNumber}|${line.gameId}|moneyline|home`).setLabel(`${line.homeTeam} ML ${formatSigned(line.homeMoneyline)}`).setStyle(ButtonStyle.Success),
    ),
  ];
}

function futuresPagerRow(weekNumber, index, total) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`madden_sportsbook_view|${weekNumber}|futures_prev|${Math.max(0, index - FUTURES_PAGE_SIZE)}`).setLabel('Prev Teams').setStyle(ButtonStyle.Secondary).setDisabled(index <= 0),
    new ButtonBuilder().setCustomId(`madden_sportsbook_view|${weekNumber}|futures_next|${Math.min(Math.max(0, total - FUTURES_PAGE_SIZE), index + FUTURES_PAGE_SIZE)}`).setLabel('Next Teams').setStyle(ButtonStyle.Secondary).setDisabled(index + FUTURES_PAGE_SIZE >= total),
  );
}

function futuresBetRow(weekNumber, lines = []) {
  const row = new ActionRowBuilder();
  for (const line of lines.slice(0, FUTURES_PAGE_SIZE)) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`madden_sportsbook_bet|${weekNumber}|${line.gameId}|${SUPERBOWL_FUTURE_MARKET}|${line.teamId}`)
        .setLabel(`${line.shortName || line.teamName} ${formatSigned(line.odds)}`.slice(0, 80))
        .setStyle(ButtonStyle.Success),
    );
  }
  return row.components.length ? row : null;
}

function propRows(weekNumber, props = []) {
  const shown = props.slice(0, MAX_PROPS_PER_GAME);
  if (!shown.length) return [];
  const overRow = new ActionRowBuilder();
  const underRow = new ActionRowBuilder();
  for (const prop of shown) {
    const labelBase = `${prop.playerName.split(' ').slice(-1)[0]} ${prop.line} ${propLabel(prop.propType)}`.slice(0, 60);
    overRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`madden_sportsbook_bet|${weekNumber}|${prop.gameId}|${PROP_MARKET}|over`)
        .setLabel(`O ${labelBase}`)
        .setStyle(ButtonStyle.Primary),
    );
    underRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`madden_sportsbook_bet|${weekNumber}|${prop.gameId}|${PROP_MARKET}|under`)
        .setLabel(`U ${labelBase}`)
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return [overRow, underRow].filter((row) => row.components.length);
}

function parlaySlipRows(weekNumber, slip = {}, canBet = false) {
  const legs = slip?.legs || [];
  if (!canBet || !legs.length) return [];
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`madden_sportsbook_parlay_clear|${weekNumber}`)
        .setLabel('Clear Parlay')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
  if (legs.length >= PARLAY_MIN_LEGS) {
    rows[0].addComponents(
      new ButtonBuilder()
        .setCustomId(`madden_sportsbook_parlay_place|${weekNumber}`)
        .setLabel(`Place ${legs.length}-Leg Parlay`)
        .setStyle(ButtonStyle.Success),
    );
  }
  return rows;
}

function buyoutRows(openBets = [], weekNumber = 0) {
  const rows = [];
  const bets = openBets.slice(0, 5);
  for (let i = 0; i < bets.length; i += 2) {
    const row = new ActionRowBuilder();
    for (const bet of bets.slice(i, i + 2)) {
      const shortLabel = `${bet.matchupLabel || 'Bet'} • ${formatImpactValue(Math.round((Number(bet.wager || 0) * 0.5) * 10) / 10)}`;
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`madden_sportsbook_buyout|${weekNumber}|${encodeURIComponent(String(bet.gameId))}|${bet.placedAt}`)
          .setLabel(shortLabel.slice(0, 80))
          .setStyle(ButtonStyle.Danger),
      );
    }
    rows.push(row);
  }
  return rows;
}

async function resolveSportsbookUserLabel(guild, userId) {
  const compact = String(userId || '').trim();
  if (!compact) return 'Unknown Coach';
  const member = guild?.members?.cache?.get?.(compact)
    || await guild?.members?.fetch?.(compact).catch(() => null);
  const user = member?.user || await guild?.client?.users?.fetch?.(compact).catch(() => null);
  return member?.displayName
    || user?.globalName
    || user?.username
    || `Coach ${compact.slice(-4)}`;
}

export async function buildSportsbookPrivateView({ seasonKey, weekNumber, userId, guildId = null, guild = null, mode = 'board', index = 0 }) {
  let card = getSportsbookUserCard({ seasonKey, weekNumber, userId, guildId });
  let lines = card.lines || [];
  const liveContext = guildId ? getSportsbookContextForGuild(guildId) : null;
  if (
    !lines.length &&
    liveContext?.seasonKey === seasonKey &&
    Number(liveContext?.weekNumber || 0) === Number(weekNumber || 0) &&
    liveContext.games?.length
  ) {
    await postSportsbookWeek({
      guild,
      seasonKey,
      weekNumber,
      snapshot: liveContext.snapshot,
      games: liveContext.games,
      teamsById: liveContext.teamsById,
    });
    card = getSportsbookUserCard({ seasonKey, weekNumber, userId, guildId });
    lines = card.lines || [];
  }
  if (
    liveContext?.seasonKey === seasonKey &&
    Number(liveContext?.weekNumber || 0) === Number(weekNumber || 0) &&
    liveContext?.snapshot
  ) {
    const store = loadStore();
    const seasonStore = ensureSeason(store, seasonKey);
    const weekStore = ensureWeek(seasonStore, `week_${weekNumber}`);
    if (!Array.isArray(weekStore.props) || !weekStore.props.length) {
      const activeLines = weekStore.lines?.length ? weekStore.lines : lines;
      weekStore.props = (activeLines || []).flatMap((line) => buildPlayerPropsForGame(liveContext.snapshot, line, { seasonKey, weekNumber }));
    }
    const futures = refreshSuperBowlFutures(seasonStore, liveContext.snapshot, { seasonKey, weekNumber });
    saveStore(store);
    card = { ...card, futures: futures.lines || [], futureBets: (futures.bets || []).filter((bet) => String(bet.userId) === String(userId)) };
  }
  const boardLabel = liveContext?.displayLabel || sportsbookWeekLabel({
    weekNumber,
    stage: Number(lines[0]?.stage ?? STAGE_REGULAR),
    games: lines,
  });
  const safeIndex = lines.length ? Math.max(0, Math.min(lines.length - 1, Number(index || 0))) : 0;
  const components = [viewNavRow(weekNumber, mode, safeIndex, lines.length > 0)];
  const canBet = await canUserBetSportsbook({ guild, guildId, userId });
  const parlaySlip = getSportsbookParlaySlip({ seasonKey, userId });

  if (mode === 'breakdown') {
    const store = loadStore();
    const weekStore = store?.[seasonKey]?.weeks?.[`week_${weekNumber}`] || {};
    const gotwSeasonKey = resolveRecognitionSeasonKeyForGuild(guildId, seasonKey);
    const gotw = getRecognitionGameOfWeek({
      guildId,
      league: 'madden',
      seasonKey: gotwSeasonKey,
      weekKey: `week_${weekNumber}`,
    });
    const intel = buildSportsbookIntel(weekStore?.lines || [], gotw);
    const popular = mostPopularBetForWeek(weekStore) || mostPopularLineFromBoard(weekStore?.lines || lines);
    const openOpp = getSportsbookOpenBetOpportunity({ seasonKey, userId, weekNumber, guildId });

    const featuredFallbackLabel = featuredGameLabelFromSnapshot(openOpp?.snapshot, weekNumber);
    const featuredLabel = gotwLabelFromRecognition(gotw) || featuredFallbackLabel;

    if (lines.length) {
      components.push(breakdownPagerRow(weekNumber, safeIndex, lines.length));
    }

    const focusLine = lines[safeIndex] || null;
    const focusLabel = focusLine
      ? `${focusLine.awayTeam} at ${focusLine.homeTeam} • line: ${favoriteLabel(focusLine)} • O/U ${focusLine.total}`
      : null;

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`LB Sportsbook • Week Breakdown • ${boardLabel}`)
      .setDescription([
        `Impact available to bet: **${formatImpactValue(openOpp?.bankroll?.balance || 0)}**`,
        openOpp?.count ? `Open bets: **${openOpp.count}** • live max profit: **${formatImpactValue(openOpp.total || 0)}**` : 'Open bets: **0**',
        focusLabel ? `\n**Current matchup:** ${focusLabel}` : null,
        '',
        `**Best Line:** ${intel?.bestSide || 'Not available yet.'}`,
        `**Most Popular Bet:** ${popular ? `**${popular.matchupLabel}** • ${popular.label}${popular.count ? ` (${popular.count})` : ''}` : 'No bets placed yet.'}`,
        `**Trap Line:** ${intel?.trapLine || 'Not available yet.'}`,
        `**Stay Away:** ${intel?.stayAway || 'Not available yet.'}`,
        '',
        '**Game of the Week Bonus**',
        featuredLabel
          ? `${featuredLabel}${gotwLabelFromRecognition(gotw) ? '' : ' *(featured game)*'}\nWinning bets on this matchup add **+${GAME_OF_WEEK_BET_BONUS} ${IMPACT_EMOJI}** profit.`
          : 'Not set yet.',
        '',
        'Next: open **Board** for the live lines, then **My Card** to track your bets.',
      ].filter(Boolean).join('\n'))
      .setFooter({ text: 'Private view • start here each week, then browse the book' })
      .setTimestamp();

    return { embeds: [embed], components };
  }

  if (mode === 'futures') {
    const futures = (card.futures || []).slice().sort((a, b) => (Number(a.rank || 999) - Number(b.rank || 999)) || (Number(a.odds || 0) - Number(b.odds || 0)));
    const safeFutureIndex = futures.length ? Math.max(0, Math.min(futures.length - 1, Number(index || 0))) : 0;
    const pageStart = Math.floor(safeFutureIndex / FUTURES_PAGE_SIZE) * FUTURES_PAGE_SIZE;
    const pageLines = futures.slice(pageStart, pageStart + FUTURES_PAGE_SIZE);
    const boardLines = futures.map((line) => {
      const history = Number(line.historyGames || 0) > 0
        ? `hist ${Math.round(Number(line.historyWinPct || 0) * 100)}%`
        : 'hist new';
      const diff = Number(line.pointDiff || 0);
      const diffLabel = `${diff >= 0 ? '+' : ''}${diff.toFixed(1)} MOV`;
      return `**${line.rank}. ${line.teamName} ${formatSigned(line.odds)}** — ${line.record}, ${diffLabel}, ${history}`;
    });
    const openFutureBets = (card.futureBets || []).filter((bet) => String(bet?.status || '') === 'open');
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`LB Sportsbook • Super Bowl Winner Futures • ${boardLabel}`)
      .setDescription([
        `All 32 teams are priced like a futures board, sorted favorite to longshot with current record, scoring margin, roster strength, recent form, and year-to-year sportsbook history baked in.`,
        `Impact available to bet: **${formatImpactValue(card.bankroll.balance || 0)}**`,
        openFutureBets.length ? `Open futures: **${openFutureBets.length}**` : 'Open futures: **0**',
        '',
        safeEmbedText(boardLines.join('\n'), 3400),
        '',
        pageLines.length
          ? `Bet buttons shown: **${pageStart + 1}-${pageStart + pageLines.length}**`
          : 'Futures board is not ready yet.',
      ].filter(Boolean).join('\n'))
      .setFooter({ text: 'Super Bowl futures stay open across advances until they are settled manually at season end' })
      .setTimestamp();
    if (futures.length) {
      components.push(futuresPagerRow(weekNumber, pageStart, futures.length));
      const row = futuresBetRow(weekNumber, pageLines);
      if (canBet && row) components.push(row);
    }
    return { embeds: [embed], components };
  }

  if (mode === 'card') {
    const buyoutActive = Boolean(hasRecognitionPerk({
      guildId,
      league: 'madden',
      seasonKey,
      weekKey: `week_${weekNumber}`,
      userId: String(userId),
      perkKey: 'betBuyout',
    }));
    const buyoutBets = buyoutActive ? openBuyoutBetsForUser(card.bets) : [];
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`LB Sportsbook • My Card • ${boardLabel}`)
      .setDescription(safeEmbedText(cardLinesForUser([...(card.bets || []), ...(card.futureBets || [])], [...(card.lines || []), ...(card.futures || [])], guildId).join('\n')))
      .addFields(
        { name: 'Impact To Bet', value: formatImpactValue(card.bankroll.balance || 0), inline: true },
        { name: 'Impact Won', value: formatImpactValue(card.bankroll.profit || 0), inline: true },
        { name: 'Record', value: `${card.bankroll.wins || 0}-${card.bankroll.losses || 0}-${card.bankroll.pushes || 0}`, inline: true },
        { name: 'First Bet Boost', value: firstBetBoostState(card), inline: false },
        {
          name: 'Parlay Builder',
          value: (parlaySlip.legs || []).length
            ? `${parlaySlip.legs.length} leg(s) queued • ${parlaySlip.price ? formatSigned(parlaySlip.price) : `needs ${PARLAY_MIN_LEGS} legs`}\n${(parlaySlip.legs || []).map((leg) => `• ${leg.betLabel}`).join('\n')}`
            : 'No parlay legs queued. Open a line and choose Add to Parlay.',
          inline: false,
        },
      )
      .setFooter({ text: 'Private view • open bets and settled results' })
      .setTimestamp();
    if (buyoutActive) {
      embed.addFields({
        name: 'Bet Buyout',
        value: buyoutBets.length
          ? 'Your buyout is live. Cash out one nervous open bet for 50% of the stake before kickoff and protect the rest of your Impact bankroll.'
          : 'Your buyout is live, but there is no eligible open bet right now. Place or keep an open bet before kickoff to use it.',
        inline: false,
      });
    }
    components.push(...parlaySlipRows(weekNumber, parlaySlip, canBet));
    if (buyoutBets.length) components.push(...buyoutRows(buyoutBets, weekNumber));
    return { embeds: [embed], components };
  }

  if (mode === 'leaderboard') {
    const board = sportsbookLeaderboard(seasonKey, 10);
    const lines = await Promise.all(
      board.map(async (row, idx) => `${idx + 1}. ${await resolveSportsbookUserLabel(guild, row.userId)} — ${formatImpactValue(row.balance)} bankroll (${row.wins}-${row.losses}-${row.pushes})`)
    );
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`LB Sportsbook • Leaderboard • ${boardLabel}`)
      .setDescription(
        board.length
          ? lines.join('\n')
          : 'No sportsbook action yet.',
      )
      .setFooter({ text: 'Private view • sportsbook standings' })
      .setTimestamp();
    return { embeds: [embed], components };
  }

  if (!lines.length) {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`LB Sportsbook • ${boardLabel}`)
      .setDescription('This week does not have an active board yet. Check back after the current slate is posted or rerun the hub once the week is live.')
      .setTimestamp();
    return { embeds: [embed], components };
  }

  const line = lines[safeIndex];
  const store = loadStore();
  const gameProps = (store?.[seasonKey]?.weeks?.[`week_${weekNumber}`]?.props || [])
    .filter((prop) => String(prop?.underlyingGameId || '') === String(line.gameId))
    .slice(0, MAX_PROPS_PER_GAME);
  const gameBets = openBetsForGame(card.bets, line.gameId);
  const limits = getSportsbookLimits(card.bankroll.balance || STARTING_BANKROLL);
  const priceGuide = payoutBreakdown(5, SPREAD_PRICE);
  const ownGameBlocked = userOwnsSportsbookGame({ guildId, userId, line });
  const gotwSeasonKey = resolveRecognitionSeasonKeyForGuild(guildId, seasonKey);
  const gotw = guildId ? getRecognitionGameOfWeek({ guildId, league: 'madden', seasonKey: gotwSeasonKey, weekKey: `week_${weekNumber}` }) : null;
  const gotwMatch = gotw && normalizeName(gotw.awayTeam) === normalizeName(line.awayTeam) && normalizeName(gotw.homeTeam) === normalizeName(line.homeTeam);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`LB Sportsbook • ${boardLabel}`)
    .setDescription([
      `**${line.awayTeam} at ${line.homeTeam}**`,
      `${line.awayTeam} (${line.awayRecord}) vs ${line.homeTeam} (${line.homeRecord})`,
      '',
      `Spread: ${line.favorite === 'home' ? line.homeSpreadDisplay : line.awaySpreadDisplay}`,
      `Moneyline: ${line.awayTeam} ${formatSigned(line.awayMoneyline)} • ${line.homeTeam} ${formatSigned(line.homeMoneyline)}`,
      `Over/Under: ${line.total}`,
      '',
      `Impact available to bet: ${formatImpactValue(card.bankroll.balance || 0)}`,
      `Max on one bet: ${formatImpactValue(limits.maxWager)}`,
      `Max open this week: ${formatImpactValue(limits.maxWeeklyExposure)}`,
      `Example: bet ${formatImpactValue(priceGuide.stake)} at -110 • win ${formatImpactValue(priceGuide.profit)} • return ${formatImpactValue(priceGuide.totalReturn)}`,
      gotwMatch ? `Featured bonus: this is Game of the Week • winning bets add +${GAME_OF_WEEK_BET_BONUS} ${IMPACT_EMOJI}` : null,
      (parlaySlip.legs || []).length
        ? `Parlay builder: ${parlaySlip.legs.length} leg(s) queued${parlaySlip.price ? ` • ${formatSigned(parlaySlip.price)}` : ''}`
        : 'Parlay builder: open any weekly pick and choose Add to Parlay.',
      gameBets.length
        ? `Your bets on this game: ${gameBets.map((bet) => `${bet.betLabel || `${bet.market} ${bet.selection}`} ${formatImpactValue(bet.wager)}`).join(' • ')}`
        : 'Your bets on this game: none yet.',
      gameProps.length
        ? `\n**Player Props**\n${gameProps.map((prop) => `• ${prop.playerName} ${prop.line} ${propLabel(prop.propType)} (${prop.avg} avg, ${prop.recentAvg} last 3)`).join('\n')}`
        : null,
      '',
      !canBet
        ? 'You can browse the sportsbook board here. Betting unlocks once you have a coach role or LEAGUEbuddy Coaches access in this server.'
        : ownGameBlocked
        ? 'You cannot bet this game because it is your matchup.'
        : 'Pick a button below to bet spread, moneyline, or total.',
    ].filter(Boolean).join('\n'))
    .setFooter({ text: `Game ${safeIndex + 1} of ${lines.length} • private betting board` })
    .setTimestamp();

  components.push(pageRow(weekNumber, safeIndex, lines.length));
  components.push(...parlaySlipRows(weekNumber, parlaySlip, canBet));
  if (canBet && !ownGameBlocked) components.push(...betRows(line));
  if (canBet && !ownGameBlocked && gameProps.length) components.push(...propRows(weekNumber, gameProps));
  return { embeds: [embed], components };
}

export { IMPACT_EMOJI, formatImpactValue, formatImpactDelta, getSportsbookLimits, payoutBreakdown, linePrice, parlayPrice };

export function buyoutSportsbookBet({ guildId, seasonKey, weekNumber, userId, gameId, placedAt }) {
  if (!guildId || !seasonKey || !weekNumber || !userId || !gameId || !placedAt) {
    return { ok: false, message: 'Missing buyout context.' };
  }
  const weekKey = `week_${weekNumber}`;
  if (!hasRecognitionPerk({ guildId, league: 'madden', seasonKey, weekKey, userId: String(userId), perkKey: 'betBuyout' })) {
    return { ok: false, message: 'Bet Buyout is not active for this week.' };
  }
  const liveContext = getSportsbookContextForGuild(guildId);
  if (!liveContext?.seasonKey || !liveContext?.weekNumber) {
    return { ok: false, message: 'The sportsbook is not open right now.' };
  }
  if (String(seasonKey) !== String(liveContext.seasonKey) || Number(weekNumber) !== Number(liveContext.weekNumber)) {
    return { ok: false, message: 'Bet Buyout only works on the current week board.' };
  }
  const store = loadStore();
  const seasonStore = ensureSeason(store, seasonKey);
  const weekStore = ensureWeek(seasonStore, weekKey);
  const bet = (weekStore.bets || []).find((entry) =>
    String(entry?.userId) === String(userId) &&
    String(entry?.gameId) === String(gameId) &&
    Number(entry?.placedAt || 0) === Number(placedAt) &&
    String(entry?.status || '') === 'open');
  if (!bet) {
    return { ok: false, message: 'That open bet is no longer available for buyout.' };
  }
  const line = weekStore.lines.find((entry) => String(entry?.gameId) === String(gameId));
  if (!line) {
    return { ok: false, message: 'This betting line is no longer available.' };
  }
  if (gameAlreadyPlayed(liveContext.leagueId, weekNumber, line, liveContext.games || [])) {
    return { ok: false, message: 'That game has already been logged as played, so the bet cannot be bought out.' };
  }
  const bankroll = ensureBankroll(seasonStore, String(userId), initialSportsbookImpact({ guildId, seasonKey, userId }));
  const refund = Math.round((Number(bet.wager || 0) * 0.5) * 10) / 10;
  const realizedLoss = Math.max(0, Number(bet.wager || 0) - refund);
  bankroll.balance += refund;
  bankroll.profit -= realizedLoss;
  bet.status = 'buyout';
  bet.refund = refund;
  bet.buyoutAt = Date.now();
  bet.profit = -realizedLoss;
  saveStore(store);
  consumeRecognitionPerk({
    guildId,
    league: 'madden',
    seasonKey,
    weekKey,
    userId: String(userId),
    perkKey: 'betBuyout',
    reason: 'Consumed Bet Buyout',
  });
  return {
    ok: true,
    bet,
    line,
    refund,
    realizedLoss,
    balance: bankroll.balance,
  };
}

export function resetSportsbookUserSeason({ seasonKey, userId, reason = 'Coach role removed' }) {
  if (!seasonKey || !userId) return { ok: false, message: 'Missing sportsbook reset context.' };
  if (PROTECTED_SPORTSBOOK_USER_IDS.has(String(userId))) {
    return { ok: false, protected: true, message: 'Sportsbook reset skipped for protected user.' };
  }
  const store = loadStore();
  const seasonStore = ensureSeason(store, seasonKey);
  const userKey = String(userId);
  const bankroll = seasonStore?.bankrolls?.[userKey] || null;
  const userBets = [];
  for (const [weekKey, weekStore] of Object.entries(seasonStore?.weeks || {})) {
    const remaining = [];
    for (const bet of weekStore?.bets || []) {
      if (String(bet.userId) === userKey) {
        userBets.push({ weekKey, ...bet });
      } else {
        remaining.push(bet);
      }
    }
    weekStore.bets = remaining;
  }
  if (seasonStore?.futures?.bets?.length) {
    const remainingFutures = [];
    for (const bet of seasonStore.futures.bets || []) {
      if (String(bet.userId) === userKey) {
        userBets.push({ weekKey: 'futures', ...bet });
      } else {
        remainingFutures.push(bet);
      }
    }
    seasonStore.futures.bets = remainingFutures;
  }
  if (!bankroll && !userBets.length) {
    return { ok: false, message: 'No sportsbook state found for this user in the current season.' };
  }
  seasonStore.archivedUsers = seasonStore.archivedUsers || {};
  seasonStore.archivedUsers[userKey] = seasonStore.archivedUsers[userKey] || [];
  seasonStore.archivedUsers[userKey].push({
    ts: Date.now(),
    reason,
    bankroll,
    bets: userBets,
  });
  seasonStore.archivedUsers[userKey] = seasonStore.archivedUsers[userKey].slice(-5);
  if (seasonStore.bankrolls?.[userKey]) delete seasonStore.bankrolls[userKey];
  saveStore(store);
  return { ok: true, archived: true, betCount: userBets.length };
}

function settleBet(line, bet, game) {
  const awayScore = Number(game.awayScore || 0);
  const homeScore = Number(game.homeScore || 0);
  if (bet.market === 'spread') {
    const favoriteScore = line.favorite === 'away' ? awayScore : homeScore;
    const underdogScore = line.favorite === 'away' ? homeScore : awayScore;
    const margin = favoriteScore - underdogScore;
    const favoriteCovered = margin > line.spread;
    const push = margin === line.spread;
    if (push) return { result: 'push', profit: 0 };
    const selectionWins =
      (bet.selection === line.favorite && favoriteCovered) ||
      (bet.selection !== line.favorite && !favoriteCovered);
    return { result: selectionWins ? 'win' : 'loss', profit: selectionWins ? americanProfit(bet.wager, bet.price) : -bet.wager };
  }
  if (bet.market === 'total') {
    const totalScore = awayScore + homeScore;
    if (totalScore === line.total) return { result: 'push', profit: 0 };
    const over = totalScore > line.total;
    const selectionWins = (bet.selection === 'over' && over) || (bet.selection === 'under' && !over);
    return { result: selectionWins ? 'win' : 'loss', profit: selectionWins ? americanProfit(bet.wager, bet.price) : -bet.wager };
  }
  const awayWon = awayScore > homeScore;
  const selectionWins = (bet.selection === 'away' && awayWon) || (bet.selection === 'home' && !awayWon);
  return { result: selectionWins ? 'win' : 'loss', profit: selectionWins ? americanProfit(bet.wager, bet.price) : -bet.wager };
}

function settleParlayBet(weekStore, bet, gameMap, snapshot = null) {
  const legs = Array.isArray(bet?.legs) ? bet.legs : [];
  if (!legs.length) return null;
  const settledLegs = [];
  for (const leg of legs) {
    const propLine = weekStore.props?.find((entry) => String(entry.gameId) === String(leg.gameId));
    if (propLine) {
      if (!snapshot) return null;
      const propOutcome = settlePropBet(propLine, leg, snapshot);
      if (!propOutcome) return null;
      settledLegs.push({ ...leg, result: propOutcome.result, profit: propOutcome.profit, actual: propOutcome.actual });
      continue;
    }
    const line = weekStore.lines.find((entry) => String(entry.gameId) === String(leg.gameId));
    const game = gameMap.get(leg.gameId);
    if (!line || !game || !hasRealPlayedSignal(game)) return null;
    const outcome = settleBet(line, leg, game);
    settledLegs.push({ ...leg, result: outcome.result, profit: outcome.profit });
  }
  if (settledLegs.some((leg) => leg.result === 'loss')) {
    return { result: 'loss', profit: -Number(bet.wager || 0), settledLegs };
  }
  const liveLegs = settledLegs.filter((leg) => leg.result === 'win');
  if (!liveLegs.length) return { result: 'push', profit: 0, settledLegs };
  const price = parlayPrice(liveLegs);
  return {
    result: 'win',
    profit: americanProfit(bet.wager, price),
    settledLegs,
    settledPrice: price,
  };
}

function findPropActual(snapshot, prop = {}) {
  const targetWeekIndex = Number(prop.scheduleWeekIndex ?? -1);
  const weeks = (snapshot?.weeklyStats || []).filter((week) =>
    Number(week?.stage ?? week?.stageIndex ?? STAGE_REGULAR) === Number(prop.stage ?? STAGE_REGULAR) &&
    Number(week?.weekIndex ?? -1) === targetWeekIndex,
  );
  const listsByType = {
    pass_yds: (week) => week?.passing?.playerPassingStatInfoList || [],
    rush_yds: (week) => week?.rushing?.playerRushingStatInfoList || [],
    rec_yds: (week) => week?.receiving?.playerReceivingStatInfoList || [],
    rec: (week) => week?.receiving?.playerReceivingStatInfoList || [],
    sacks: (week) => week?.defense?.playerDefensiveStatInfoList || [],
  };
  for (const week of weeks) {
    for (const row of listsByType[prop.propType]?.(week) || []) {
      if (Number(row?.teamId) !== Number(prop.teamId)) continue;
      const sameId = prop.playerId != null && (String(row?.playerId ?? row?.rosterId ?? '') === String(prop.playerId));
      const sameName = normalizeName(formatPlayerName(row)) === normalizeName(prop.playerName);
      if (!sameId && !sameName) continue;
      return propStatFromRow(row, prop.propType);
    }
  }
  return null;
}

function settlePropBet(prop, bet, snapshot) {
  const actual = findPropActual(snapshot, prop);
  if (actual == null) return null;
  const lineValue = Number(prop.line || 0);
  if (Number(actual) === lineValue) return { result: 'push', profit: 0, actual };
  const over = Number(actual) > lineValue;
  const selectionWins = (bet.selection === 'over' && over) || (bet.selection === 'under' && !over);
  return {
    result: selectionWins ? 'win' : 'loss',
    profit: selectionWins ? americanProfit(bet.wager, bet.price) : -bet.wager,
    actual,
  };
}

export async function settleSportsbookWeek({ client, guildId, seasonKey, weekNumber, games = [] }) {
  const store = loadStore();
  const seasonStore = ensureSeason(store, seasonKey);
  const weekStore = ensureWeek(seasonStore, `week_${weekNumber}`);
  if (weekStore.settled) return null;
  let settleSnapshot = null;
  if (guildId) {
    try {
      settleSnapshot = loadLeagueSnapshot(requireLeagueIdForGuild(guildId));
    } catch { }
  }
  const gameMap = new Map((games || []).map((game) => [`${weekNumber}:${Number(game.awayTeamId)}:${Number(game.homeTeamId)}`, game]));
  let lineResultsUpdated = 0;
  for (const line of weekStore.lines || []) {
    const game = gameMap.get(line.gameId);
    if (!game || !hasRealPlayedSignal(game)) continue;
    const awayScore = Number(game.awayScore || 0);
    const homeScore = Number(game.homeScore || 0);
    const favoriteScore = line.favorite === 'away' ? awayScore : homeScore;
    const underdogScore = line.favorite === 'away' ? homeScore : awayScore;
    const favoriteMargin = favoriteScore - underdogScore;
    line.result = {
      played: true,
      awayScore,
      homeScore,
      totalScore: awayScore + homeScore,
      winner: awayScore > homeScore ? 'away' : 'home',
      favoriteMargin,
      favoriteCovered: favoriteMargin > Number(line.spread || 0),
      spreadError: Number((favoriteMargin - Number(line.spread || 0)).toFixed(1)),
      totalError: Number(((awayScore + homeScore) - Number(line.total || 0)).toFixed(1)),
      settledAt: Date.now(),
    };
    lineResultsUpdated += 1;
  }
  let settled = 0;
  let futuresSettled = 0;
  const summary = [];
  for (const bet of weekStore.bets || []) {
    if (bet.status !== 'open') continue;
    const parlayBet = String(bet.market || '') === PARLAY_MARKET;
    const propBet = String(bet.market || '') === PROP_MARKET;
    const line = parlayBet || propBet ? null : weekStore.lines.find((entry) => entry.gameId === bet.gameId);
    const prop = propBet ? weekStore.props?.find((entry) => String(entry.gameId) === String(bet.gameId)) : null;
    const game = parlayBet ? null : gameMap.get(bet.gameId);
    if (!parlayBet && !propBet && (!line || !game || !hasRealPlayedSignal(game))) continue;
    if (propBet && (!prop || !settleSnapshot)) continue;
    const bankroll = ensureBankroll(seasonStore, String(bet.userId));
    const outcome = parlayBet
      ? settleParlayBet(weekStore, bet, gameMap, settleSnapshot)
      : propBet
        ? settlePropBet(prop, bet, settleSnapshot)
        : settleBet(line, bet, game);
    if (!outcome) continue;
    let firstBetBoostBonus = 0;
    if (outcome.result === 'win' && bet.firstBetBoost) {
      firstBetBoostBonus = Math.min(
        Number(outcome.profit || 0) * (FIRST_BET_BOOST_MULTIPLIER - 1),
        FIRST_BET_BOOST_MAX_EXTRA,
      );
      outcome.profit = Math.round((Number(outcome.profit || 0) + firstBetBoostBonus) * 10) / 10;
    }
    bet.status = outcome.result;
    bet.profit = outcome.profit;
    if (outcome.actual != null) bet.actual = outcome.actual;
    if (outcome.settledLegs) bet.settledLegs = outcome.settledLegs;
    if (outcome.settledPrice) bet.settledPrice = outcome.settledPrice;
    bet.settledAt = Date.now();
    bet.impactAward = 0;
    bet.firstBetBoostBonus = firstBetBoostBonus;
    if (firstBetBoostBonus > 0) bankroll.firstBetBoostBonus = Number(firstBetBoostBonus || 0);
    settled += 1;
    if (outcome.result === 'push') {
      bankroll.pushes += 1;
      bankroll.balance += Number(bet.wager || 0);
    } else if (outcome.result === 'win') {
      bankroll.wins += 1;
      bankroll.profit += Number(outcome.profit || 0);
      bankroll.balance += Number(bet.wager || 0) + Number(outcome.profit || 0);
      let impactAward = Math.max(1, Math.round(Number(outcome.profit || 0)));
      const gotwSeasonKey = resolveRecognitionSeasonKeyForGuild(guildId, seasonKey);
      const gotw = getRecognitionGameOfWeek({
        guildId,
        league: 'madden',
        seasonKey: gotwSeasonKey,
        weekKey: `week_${weekNumber}`,
      });
      if (
        gotw &&
        line &&
        normalizeName(gotw.awayTeam) === normalizeName(line.awayTeam) &&
        normalizeName(gotw.homeTeam) === normalizeName(line.homeTeam)
      ) {
        impactAward += GAME_OF_WEEK_BET_BONUS;
      }
      bet.impactAward = impactAward;
      awardRecognitionPoints({
        guildId,
        league: 'madden',
        seasonKey,
        userId: String(bet.userId),
        tier: 'impact',
        amount: impactAward,
        reason: `Sportsbook win • Week ${weekNumber}`,
        weekKey: `week_${weekNumber}`,
      });
    } else {
      bankroll.losses += 1;
      bankroll.profit -= Number(bet.wager || 0);
    }
    summary.push({ userId: String(bet.userId), wager: Number(bet.wager || 0), ...outcome });
  }
  const titleGame = (games || []).filter((game) => resolveGameStage(game) === STAGE_POSTSEASON && hasRealPlayedSignal(game)).slice(-1)[0] || null;
  if (titleGame && (games || []).filter((game) => resolveGameStage(game) === STAGE_POSTSEASON).length === 1) {
    const winnerTeamId = Number(titleGame.awayScore || 0) > Number(titleGame.homeScore || 0)
      ? Number(titleGame.awayTeamId)
      : Number(titleGame.homeTeamId);
    const futuresBook = ensureFuturesBook(seasonStore);
    for (const bet of futuresBook.bets || []) {
      if (String(bet?.status || '') !== 'open') continue;
      const bankroll = ensureBankroll(seasonStore, String(bet.userId));
      const won = Number(bet.teamId || bet.selection || 0) === winnerTeamId;
      const profit = won ? Number(payoutBreakdown(bet.wager || 0, bet.price || 0)?.profit || 0) : -Number(bet.wager || 0);
      bet.status = won ? 'win' : 'loss';
      bet.profit = profit;
      bet.settledAt = Date.now();
      bet.impactAward = 0;
      if (won) {
        bankroll.wins += 1;
        bankroll.profit += profit;
        bankroll.balance += Number(bet.wager || 0) + profit;
        const impactAward = Math.max(2, Math.round(profit));
        bet.impactAward = impactAward;
        awardRecognitionPoints({
          guildId,
          league: 'madden',
          seasonKey,
          userId: String(bet.userId),
          tier: 'impact',
          amount: impactAward,
          reason: 'Sportsbook future win • Super Bowl',
          weekKey: `week_${weekNumber}`,
        });
      } else {
        bankroll.losses += 1;
        bankroll.profit -= Number(bet.wager || 0);
      }
      futuresSettled += 1;
      summary.push({ userId: String(bet.userId), wager: Number(bet.wager || 0), result: bet.status, profit });
    }
  }
  if (!settled && !lineResultsUpdated && !futuresSettled) return null;
  weekStore.settled = true;
  weekStore.settledAt = Date.now();
  saveStore(store);

  // With the sportsbook channel being optional, always DM coaches their personal results.
  if (client) {
    const settledByUser = new Map();
    for (const bet of weekStore.bets || []) {
      if (!bet?.userId) continue;
      if (!['win', 'loss', 'push', 'buyout'].includes(String(bet.status || ''))) continue;
      const list = settledByUser.get(String(bet.userId)) || [];
      list.push(bet);
      settledByUser.set(String(bet.userId), list);
    }
    if (futuresSettled) {
      for (const bet of seasonStore?.futures?.bets || []) {
        if (!bet?.userId) continue;
        if (!['win', 'loss'].includes(String(bet.status || ''))) continue;
        if (Number(bet.settledAt || 0) < Number(weekStore.settledAt || 0) - 5000) continue;
        const list = settledByUser.get(String(bet.userId)) || [];
        list.push(bet);
        settledByUser.set(String(bet.userId), list);
      }
    }

    await Promise.all(
      [...settledByUser.entries()].map(async ([userId, bets]) => {
        const user = await client.users.fetch(String(userId)).catch(() => null);
        if (!user) return;
        const wins = (bets || []).filter((bet) => bet.status === 'win');
        const totalProfit = Math.round((bets || []).reduce((sum, bet) => sum + Number(bet?.profit || 0), 0) * 10) / 10;

        const embed = new EmbedBuilder()
          .setColor(wins.length ? 0x2ecc71 : 0xe67e22)
          .setTitle(brandTitle(`Sportsbook Slip Results • Week ${weekNumber}`))
          .setDescription(
            [
              wins.length
                ? `You had **${wins.length}** winning bet(s). Your bankroll + Impact earnings are updated in Franchise Hub.`
                : `Your bets are settled. Your bankroll is updated in Franchise Hub.`,
              `Net profit: ${formatImpactValue(totalProfit)}`,
              '',
              (bets || [])
                .slice(0, 10)
                .map((bet) => {
                  const resultLabel = String(bet.status || '').toUpperCase();
                  const profit = Number(bet.profit || 0);
                  const award = Number(bet.impactAward || 0);
                  const awardText = award > 0 ? ` • ${formatImpactDelta(award)}` : '';
                  const buyoutText = bet.status === 'buyout' ? ` • buyout refund ${formatImpactValue(bet.refund || 0)}` : '';
                  return `• **${resultLabel}** — ${bet.matchupLabel || 'Game'}\n  ${bet.betLabel || `${bet.market} ${bet.selection}`} • stake ${formatImpactValue(bet.wager || 0)} • profit ${formatImpactValue(profit)}${awardText}${buyoutText}`;
                })
                .join('\n'),
              (bets || []).length > 10 ? `\n…and ${bets.length - 10} more slip(s).` : null,
              `\nOpen **/franchisehub** → **Open Sportsbook** to review the board + your card anytime.`,
            ].filter(Boolean).join('\n'),
          )
          .setFooter({ text: 'Private DM • results are reflected in Franchise Hub' })
          .setTimestamp();

        await user.send({ embeds: [embed] }).catch(() => null);
      }),
    );
  }

  return summary;
}
