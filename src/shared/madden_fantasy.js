import fs from 'fs';
import path from 'path';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { getMaddenDataFilePath } from '../leaguebuddy/paths.js';
import { buildLiveDraftContext } from '../madden/coach/draft_live_data.js';
import { coachTeamsForMember } from './madden_mock_draft_live.js';
import { getTeamEmojiByName } from './madden_visuals.js';

const STORE_FILE = getMaddenDataFilePath('fantasy_leagues.json');
const BOARD_PAGE_SIZE = 20;
const SELECT_PAGE_SIZE = 25;
export const FANTASY_CHAT_CHANNEL_ID = '1510874753014169661';
export const FANTASY_ACCESS_ROLE_ID = '1510874958409109574';
const FANTASY_TEAM_COUNT = 10;
const DEFAULT_ROSTER_SLOTS = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  FLEX: 1,
  DST: 1,
  K: 1,
  BN: 5,
};
const SKILL_POSITIONS = new Set(['QB', 'HB', 'RB', 'WR', 'TE', 'K']);
const POSITION_LABELS = { HB: 'RB' };
const FANTASY_MODES = new Set(['live', 'mock']);
const SOLO_MOCK_CPU_COUNT = FANTASY_TEAM_COUNT - 1;

function nowIso() {
  return new Date().toISOString();
}

function ensureStoreDir() {
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
}

function baseStore() {
  return { guilds: {}, mockTokens: {} };
}

export function loadFantasyStore() {
  ensureStoreDir();
  if (!fs.existsSync(STORE_FILE)) return baseStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? { ...baseStore(), ...parsed } : baseStore();
  } catch {
    return baseStore();
  }
}

export function saveFantasyStore(store) {
  ensureStoreDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

function hashText(value = '') {
  let hash = 2166136261;
  for (let i = 0; i < String(value).length; i += 1) {
    hash ^= String(value).charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function fantasyMockToken(guildId, seasonKey) {
  const token = `m${hashText(`${guildId}::${seasonKey}`)}`;
  const store = loadFantasyStore();
  store.mockTokens = store.mockTokens || {};
  store.mockTokens[token] = {
    guildId: String(guildId || ''),
    seasonKey: String(seasonKey || ''),
    updatedAt: Date.now(),
  };
  saveFantasyStore(store);
  return token;
}

export function resolveFantasyMockToken(token) {
  const entry = loadFantasyStore().mockTokens?.[String(token || '')];
  if (!entry?.guildId || !entry?.seasonKey) return null;
  return entry;
}

function normalizeKey(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function isCpuUserId(userId = '') {
  return String(userId || '').startsWith('cpu_');
}

function managerLabel(league, userId) {
  if (!userId) return 'N/A';
  if (isCpuUserId(userId)) return league?.managers?.[userId]?.displayName || 'CPU';
  return `<@${userId}>`;
}

function fullName(player = {}) {
  return player.name || player.displayName || `${player.firstName || ''} ${player.lastName || ''}`.trim() || 'Unknown';
}

function fantasyPosition(position = '') {
  const upper = String(position || '').toUpperCase();
  return POSITION_LABELS[upper] || upper;
}

function teamEmoji(teamName = '') {
  return getTeamEmojiByName(teamName) || '';
}

function rosterSize(settings = {}) {
  return Object.values(settings.rosterSlots || DEFAULT_ROSTER_SLOTS)
    .reduce((sum, value) => sum + safeNumber(value), 0);
}

export function getFantasySeasonKey(league = {}) {
  const info = league?.info?.careerHubInfo?.seasonInfo || {};
  const year = info.calendarYear || league?.info?.calendarYear || league?.calendarYear || new Date().getFullYear();
  return `madden:${year}`;
}

export function getFantasyLeagueKey(league = {}, mode = 'live') {
  const baseKey = getFantasySeasonKey(league);
  return mode === 'mock' ? `${baseKey}:mock` : baseKey;
}

export function normalizeFantasyMode(mode = 'live') {
  const normalized = String(mode || 'live').toLowerCase();
  return FANTASY_MODES.has(normalized) ? normalized : 'live';
}

function createLeague({ guildId, seasonKey }) {
  const rounds = rosterSize({ rosterSlots: DEFAULT_ROSTER_SLOTS });
  const isMock = String(seasonKey || '').includes(':mock');
  return {
    guildId,
    seasonKey,
    isMock,
    status: 'setup',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    settings: {
      rosterSlots: DEFAULT_ROSTER_SLOTS,
      leagueSize: FANTASY_TEAM_COUNT,
      playoffs: {
        teams: 6,
        conferences: 2,
        conferenceSize: 5,
        playoffTeamsPerConference: 3,
        byesPerConference: 1,
      },
      scoring: {
        passYds: 0.04,
        passTD: 4,
        passINT: -2,
        rushYds: 0.1,
        rushTD: 6,
        rec: 0.5,
        recYds: 0.1,
        recTD: 6,
        sack: 1,
        defINT: 2,
        ff: 2,
        fr: 2,
      },
      draft: { type: 'snake', rounds },
    },
    managers: {},
    draft: {
      status: 'not_started',
      order: [],
      round: 1,
      pickIndex: 0,
      picks: [],
    },
    trades: [],
    scores: {},
  };
}

function normalizeFantasySettings(league) {
  league.settings = league.settings || {};
  league.settings.rosterSlots = league.settings.rosterSlots || DEFAULT_ROSTER_SLOTS;
  league.settings.leagueSize = safeNumber(league.settings.leagueSize, FANTASY_TEAM_COUNT);
  league.settings.playoffs = {
    teams: 6,
    conferences: 2,
    conferenceSize: 5,
    playoffTeamsPerConference: 3,
    byesPerConference: 1,
    ...(league.settings.playoffs || {}),
  };
  league.settings.playoffs.conferenceSize = Math.floor(safeNumber(league.settings.leagueSize, FANTASY_TEAM_COUNT) / safeNumber(league.settings.playoffs.conferences, 2));
  league.settings.playoffs.playoffTeamsPerConference = Math.floor(safeNumber(league.settings.playoffs.teams, 6) / safeNumber(league.settings.playoffs.conferences, 2));
  league.settings.draft = {
    type: 'snake',
    rounds: rosterSize(league.settings),
    ...(league.settings.draft || {}),
  };
  return league;
}

export function ensureFantasyLeague({ guildId, seasonKey }) {
  const store = loadFantasyStore();
  if (!store.guilds[guildId]) store.guilds[guildId] = { leagues: {} };
  if (!store.guilds[guildId].leagues[seasonKey]) {
    store.guilds[guildId].leagues[seasonKey] = createLeague({ guildId, seasonKey });
    saveFantasyStore(store);
  } else {
    store.guilds[guildId].leagues[seasonKey].isMock = String(seasonKey || '').includes(':mock');
  }
  normalizeFantasySettings(store.guilds[guildId].leagues[seasonKey]);
  return store.guilds[guildId].leagues[seasonKey];
}

export function mutateFantasyLeague({ guildId, seasonKey }, mutator) {
  const store = loadFantasyStore();
  if (!store.guilds[guildId]) store.guilds[guildId] = { leagues: {} };
  if (!store.guilds[guildId].leagues[seasonKey]) {
    store.guilds[guildId].leagues[seasonKey] = createLeague({ guildId, seasonKey });
  }
  const league = store.guilds[guildId].leagues[seasonKey];
  league.isMock = String(seasonKey || '').includes(':mock');
  normalizeFantasySettings(league);
  const result = mutator(league) || league;
  result.updatedAt = nowIso();
  store.guilds[guildId].leagues[seasonKey] = result;
  saveFantasyStore(store);
  return result;
}

function teamLookup(league = {}) {
  const byId = new Map();
  const byKey = new Map();
  for (const team of league?.teams?.leagueTeamInfoList || []) {
    const teamId = Number(team.teamId);
    const full = [team.cityName, team.nickName].filter(Boolean).join(' ').trim()
      || team.displayName
      || team.nickName
      || String(teamId);
    const variants = [
      full,
      team.displayName,
      team.nickName,
      team.cityName,
      team.abbrName,
    ].filter(Boolean);
    byId.set(teamId, full);
    for (const variant of variants) byKey.set(normalizeKey(variant), teamId);
  }
  return { byId, byKey };
}

export function resolveCoachTeamIds(member, league = {}) {
  const names = coachTeamsForMember(member) || [];
  const lookup = teamLookup(league);
  const ids = new Set();
  for (const name of names) {
    const key = normalizeKey(name);
    if (lookup.byKey.has(key)) ids.add(lookup.byKey.get(key));
    for (const [variant, teamId] of lookup.byKey.entries()) {
      if (variant === key || variant.includes(key) || key.includes(variant)) ids.add(teamId);
    }
  }
  return [...ids].filter((id) => Number.isFinite(id));
}

export function upsertFantasyManager(league, member, maddenTeamIds = []) {
  const userId = member?.user?.id || member?.id;
  if (!userId) return league;
  const displayName = member?.displayName || member?.user?.username || `Coach ${userId}`;
  const existing = league.managers[userId] || {};
  league.managers[userId] = {
    userId,
    displayName,
    teamName: existing.teamName || `${displayName}'s Team`,
    maddenTeamIds: [...new Set([...(existing.maddenTeamIds || []), ...maddenTeamIds])],
    roster: existing.roster || [],
    lineup: existing.lineup || {},
    picks: existing.picks || [],
    autoPick: Boolean(existing.autoPick),
    joinedAt: existing.joinedAt || nowIso(),
  };
  return league;
}

function ensureCpuManagers(league, count = SOLO_MOCK_CPU_COUNT) {
  for (let idx = 1; idx <= count; idx += 1) {
    const userId = `cpu_${idx}`;
    const existing = league.managers[userId] || {};
    league.managers[userId] = {
      userId,
      displayName: existing.displayName || `CPU Team ${idx}`,
      teamName: existing.teamName || `CPU Team ${idx}`,
      maddenTeamIds: [],
      roster: existing.roster || [],
      lineup: existing.lineup || {},
      picks: existing.picks || [],
      autoPick: Boolean(existing.autoPick),
      joinedAt: existing.joinedAt || nowIso(),
      isCpu: true,
    };
  }
}

function playerFantasyPoints(player, scoring) {
  const pass = safeNumber(player.passYds) * scoring.passYds
    + safeNumber(player.passTDs) * scoring.passTD
    + safeNumber(player.passInts) * scoring.passINT;
  const rush = safeNumber(player.rushYds) * scoring.rushYds
    + safeNumber(player.rushTDs) * scoring.rushTD;
  const rec = safeNumber(player.recCatches) * scoring.rec
    + safeNumber(player.recYds) * scoring.recYds
    + safeNumber(player.recTDs) * scoring.recTD;
  const def = safeNumber(player.sacks) * scoring.sack
    + safeNumber(player.interceptions) * scoring.defINT
    + safeNumber(player.def?.ff) * scoring.ff
    + safeNumber(player.def?.fr) * scoring.fr;
  return pass + rush + rec + def;
}

function playerStatLine(player, position) {
  if (position === 'QB') {
    return `${safeNumber(player.passYds)} pass yds, ${safeNumber(player.passTDs)} TD, ${safeNumber(player.passInts)} INT`;
  }
  if (position === 'RB') {
    return `${safeNumber(player.rushYds)} rush yds, ${safeNumber(player.rushTDs)} rush TD, ${safeNumber(player.recYds)} rec yds`;
  }
  if (position === 'WR' || position === 'TE') {
    return `${safeNumber(player.recCatches)} rec, ${safeNumber(player.recYds)} yds, ${safeNumber(player.recTDs)} TD`;
  }
  if (position === 'K') return `${safeNumber(player.overall)} OVR`;
  return `${safeNumber(player.sacks)} sacks, ${safeNumber(player.interceptions)} INT`;
}

function defenseFantasyPoints(stats, scoring) {
  const labels = stats?.labels || stats || {};
  return safeNumber(labels.defSacks) * scoring.sack
    + safeNumber(labels.defINT) * scoring.defINT;
}

function remainingRegularSeasonGames(context) {
  const completed = safeNumber(context?.seasonContext?.completedRegularWeeks, 0);
  return Math.max(1, 17 - completed);
}

function positionDemandIndex(position) {
  const demand = {
    QB: FANTASY_TEAM_COUNT,
    RB: FANTASY_TEAM_COUNT * 3,
    WR: FANTASY_TEAM_COUNT * 3,
    TE: FANTASY_TEAM_COUNT,
    DST: FANTASY_TEAM_COUNT,
    K: FANTASY_TEAM_COUNT,
  };
  return demand[position] || FANTASY_TEAM_COUNT * 2;
}

function positionPremium(position) {
  const premiums = {
    RB: 6,
    WR: 6,
    TE: 5,
    QB: 4,
    DST: -6,
    K: -14,
  };
  return premiums[position] ?? 0;
}

function playerRoleScore(player, position) {
  if (position === 'QB') {
    return Math.min(18, safeNumber(player.passAtt) * 0.04 + safeNumber(player.rushAtt) * 0.12);
  }
  if (position === 'RB') {
    return Math.min(18, safeNumber(player.rushAtt) * 0.18 + safeNumber(player.recCatches) * 0.45);
  }
  if (position === 'WR' || position === 'TE') {
    return Math.min(18, safeNumber(player.recCatches) * 0.55 + safeNumber(player.recYds) * 0.01);
  }
  return 0;
}

function playerProjection(player, position, points, games, context) {
  const played = Math.max(1, safeNumber(games, 1));
  const ppg = points / played;
  const remaining = remainingRegularSeasonGames(context);
  const ovr = safeNumber(player.overall);
  const talentBoost = Math.max(-4, Math.min(10, (ovr - 78) * 0.45));
  const roleScore = playerRoleScore(player, position);
  const future = ppg * remaining;
  return points * 0.55 + future * 0.45 + talentBoost + roleScore;
}

function defenseProjection(stats, points, context) {
  const games = Math.max(1, safeNumber(stats?.labels?.games || stats?.games, 1));
  const ppg = points / games;
  const remaining = remainingRegularSeasonGames(context);
  const labels = stats?.labels || {};
  const pressure = safeNumber(labels.defSacks) * 0.7 + safeNumber(labels.defINT) * 1.2;
  return points * 0.5 + (ppg * remaining) * 0.35 + pressure;
}

function applyFantasyDraftValues(board) {
  const byPosition = new Map();
  for (const asset of board) {
    if (!byPosition.has(asset.position)) byPosition.set(asset.position, []);
    byPosition.get(asset.position).push(asset);
  }
  const baselines = {};
  for (const [position, assets] of byPosition.entries()) {
    const sorted = [...assets].sort((a, b) => b.projected - a.projected);
    const index = Math.min(sorted.length - 1, Math.max(0, positionDemandIndex(position) - 1));
    baselines[position] = safeNumber(sorted[index]?.projected, 0);
  }
  for (const asset of board) {
    const replacementGap = asset.projected - safeNumber(baselines[asset.position], 0);
    const ovr = safeNumber(asset.overall);
    const ovrBoost = asset.position === 'K' || asset.position === 'DST'
      ? 0
      : Math.max(-4, Math.min(14, (ovr - 76) * 0.5));
    const starBoost = asset.position === 'K' || asset.position === 'DST'
      ? 0
      : Math.max(0, ovr - 88) * 1.15;
    const value = replacementGap * 0.4
      + safeNumber(asset.projected) * 0.35
      + safeNumber(asset.points) * 0.25
      + positionPremium(asset.position)
      + ovrBoost
      + starBoost;
    asset.draftValue = Number(value.toFixed(1));
  }
  return board;
}

function shuffled(values = []) {
  const list = [...values];
  for (let idx = list.length - 1; idx > 0; idx -= 1) {
    const swapIdx = Math.floor(Math.random() * (idx + 1));
    [list[idx], list[swapIdx]] = [list[swapIdx], list[idx]];
  }
  return list;
}

function draftedAssetIds(league) {
  return new Set((league?.draft?.picks || []).map((pick) => pick.assetId));
}

export function buildFantasyBoard(league, snapshot, { userId = null, includeOwnTeam = false, includeDrafted = false } = {}) {
  const context = buildLiveDraftContext(snapshot);
  const scoring = league.settings?.scoring || createLeague({ guildId: 'x', seasonKey: 'x' }).settings.scoring;
  const taken = draftedAssetIds(league);
  const manager = userId ? league.managers?.[userId] : null;
  const blockedTeamIds = new Set(manager?.maddenTeamIds || []);
  const board = [];
  for (const players of Object.values(context.currentPlayersByTeamId || {})) {
    for (const player of players || []) {
      const position = fantasyPosition(player.position);
      if (!SKILL_POSITIONS.has(String(player.position || '').toUpperCase()) && !['QB', 'RB', 'WR', 'TE', 'K'].includes(position)) continue;
      const assetId = `player:${player.rosterId}`;
      if (!includeDrafted && taken.has(assetId)) continue;
      if (!includeOwnTeam && blockedTeamIds.has(Number(player.teamId))) continue;
      const points = playerFantasyPoints(player, scoring);
      if (points <= 0 && !['K'].includes(position)) continue;
      const teamGames = context.teamStatsByTeamId?.[Number(player.teamId)]?.labels?.games || context.teamStatsByTeamId?.[Number(player.teamId)]?.games || 1;
      const projected = playerProjection(player, position, points, teamGames, context);
      board.push({
        assetId,
        rosterId: player.rosterId,
        type: 'player',
        name: fullName(player),
        position,
        teamId: Number(player.teamId),
        teamName: player.teamName || context.teamNameById?.[player.teamId] || String(player.teamId),
        points,
        projected,
        overall: safeNumber(player.overall),
        statLine: playerStatLine(player, position),
      });
    }
  }
  for (const stats of Object.values(context.teamStatsByTeamId || {})) {
    const teamId = Number(stats.teamId);
    const assetId = `dst:${teamId}`;
    if (!includeDrafted && taken.has(assetId)) continue;
    if (!includeOwnTeam && blockedTeamIds.has(teamId)) continue;
    const points = defenseFantasyPoints(stats, scoring);
    const projected = defenseProjection(stats, points, context);
    board.push({
      assetId,
      type: 'dst',
      name: `${stats.teamName} DST`,
      position: 'DST',
      teamId,
      teamName: stats.teamName,
      points,
      projected,
      overall: 0,
      statLine: `${safeNumber(stats.labels?.defSacks)} sacks, ${safeNumber(stats.labels?.defINT)} INT`,
    });
  }
  return applyFantasyDraftValues(board)
    .sort((a, b) => b.draftValue - a.draftValue || b.projected - a.projected || b.points - a.points || b.overall - a.overall || a.name.localeCompare(b.name))
    .map((entry, index) => ({
      ...entry,
      rank: index + 1,
      points: Number(entry.points.toFixed(1)),
      projected: Number(entry.projected.toFixed(1)),
    }));
}

export function findFantasyAsset(league, snapshot, assetId, userId) {
  return buildFantasyBoard(league, snapshot, { userId, includeOwnTeam: true, includeDrafted: true }).find((entry) => entry.assetId === assetId) || null;
}

function nextDrafterId(draft) {
  const order = draft?.order || [];
  if (!order.length) return null;
  const round = safeNumber(draft.round, 1);
  const index = safeNumber(draft.pickIndex, 0);
  const snakeIndex = round % 2 === 1 ? index : order.length - 1 - index;
  return order[snakeIndex] || null;
}

export function currentFantasyDrafter(league) {
  return nextDrafterId(league?.draft || {});
}

function shouldAutoPickManager(league, userId) {
  const manager = league?.managers?.[userId];
  return isCpuUserId(userId) || Boolean(manager?.autoPick);
}

export function startFantasyDraft(league, options = {}) {
  if (options.soloMockUserId) {
    ensureCpuManagers(league, options.cpuTeams || SOLO_MOCK_CPU_COUNT);
  }
  const desiredTeams = safeNumber(league.settings?.leagueSize, FANTASY_TEAM_COUNT);
  const humanManagers = Object.keys(league.managers || {}).filter((id) => !isCpuUserId(id));
  const orderedHumans = options.soloMockUserId
    ? [
      options.soloMockUserId,
      ...humanManagers.filter((id) => id !== options.soloMockUserId),
    ]
    : humanManagers;
  const pool = options.soloMockUserId
    ? [
      ...orderedHumans,
      ...Object.keys(league.managers || {}).filter((id) => isCpuUserId(id)).slice(0, Math.max(0, desiredTeams - orderedHumans.length)),
    ].slice(0, desiredTeams)
    : orderedHumans.slice(0, desiredTeams);
  const order = shuffled(pool).slice(0, desiredTeams);
  if (options.soloMockUserId && order.length < desiredTeams) return { ok: false, reason: `Need ${desiredTeams} fantasy teams before the mock starts.` };
  if (!options.soloMockUserId && order.length < desiredTeams) return { ok: false, reason: `Need ${desiredTeams} joined coaches before the fantasy draft starts.` };
  league.status = 'draft';
  league.draft.status = 'live';
  league.draft.order = order;
  league.draft.round = 1;
  league.draft.pickIndex = 0;
  league.draft.picks = [];
  league.settings.draft.rounds = rosterSize(league.settings);
  return { ok: true };
}

export function autoSimFantasyUntilUser(league, snapshot, userId, limit = 100) {
  let count = 0;
  while (league.draft?.status === 'live' && currentFantasyDrafter(league) !== userId && count < limit) {
    const cpuId = currentFantasyDrafter(league);
    if (!isCpuUserId(cpuId)) break;
    const board = buildFantasyBoard(league, snapshot, { userId: cpuId, includeOwnTeam: true });
    const asset = board[0];
    if (!asset) break;
    const result = makeFantasyPick(league, asset, cpuId);
    if (!result?.ok) break;
    count += 1;
  }
  return count;
}

export function autoSimFantasyUntilManualPick(league, snapshot, limit = 100) {
  let count = 0;
  while (league.draft?.status === 'live' && count < limit) {
    const onClock = currentFantasyDrafter(league);
    if (!onClock || !shouldAutoPickManager(league, onClock)) break;
    const board = buildFantasyBoard(league, snapshot, { userId: onClock, includeOwnTeam: isCpuUserId(onClock) });
    const asset = board[0];
    if (!asset) break;
    const result = makeFantasyPick(league, asset, onClock);
    if (!result?.ok) break;
    count += 1;
  }
  return count;
}

export function toggleFantasyAutoPick(league, userId) {
  const manager = league?.managers?.[userId];
  if (!manager) return { ok: false, reason: 'Join the fantasy league first.' };
  manager.autoPick = !manager.autoPick;
  return { ok: true, enabled: manager.autoPick };
}

export function resetFantasyDraft(league) {
  league.status = 'setup';
  league.draft = {
    status: 'not_started',
    order: [],
    round: 1,
    pickIndex: 0,
    picks: [],
  };
  for (const manager of Object.values(league.managers || {})) {
    manager.roster = [];
    manager.lineup = {};
    manager.picks = [];
  }
  return { ok: true };
}

export function makeFantasyPick(league, asset, userId) {
  if (league.draft?.status !== 'live') return { ok: false, reason: 'The fantasy draft is not live yet.' };
  const onClock = currentFantasyDrafter(league);
  if (onClock !== userId) return { ok: false, reason: `It is <@${onClock}>'s pick.` };
  if ((league.draft.picks || []).some((pick) => pick.assetId === asset.assetId)) {
    return { ok: false, reason: 'That player is already drafted.' };
  }
  const manager = league.managers[userId];
  if ((manager?.maddenTeamIds || []).includes(Number(asset.teamId))) {
    return { ok: false, reason: 'You cannot draft a player or defense from your own Madden team.' };
  }
  const pickNo = league.draft.picks.length + 1;
  const pick = {
    pickNo,
    round: league.draft.round,
    slot: league.draft.pickIndex + 1,
    userId,
    assetId: asset.assetId,
    name: asset.name,
    position: asset.position,
    teamId: asset.teamId,
    teamName: asset.teamName,
    points: asset.points,
    statLine: asset.statLine,
    madeAt: nowIso(),
  };
  league.draft.picks.push(pick);
  manager.roster = manager.roster || [];
  manager.roster.push(asset.assetId);

  league.draft.pickIndex += 1;
  if (league.draft.pickIndex >= league.draft.order.length) {
    league.draft.pickIndex = 0;
    league.draft.round += 1;
  }
  if (league.draft.round > safeNumber(league.settings?.draft?.rounds, rosterSize(league.settings))) {
    league.draft.status = 'complete';
    league.status = 'active';
  }
  return { ok: true, pick };
}

function formatAssetLine(asset) {
  const emoji = teamEmoji(asset.teamName);
  const valueLabel = asset.draftValue != null ? `${asset.draftValue} value` : `${asset.points} pts`;
  return `${emoji ? `${emoji} ` : ''}${asset.position} **${asset.name}** (${asset.teamName}) - ${valueLabel} - ${asset.points} pts - ${asset.statLine}`;
}

function formatPlayoffSystem(settings = {}) {
  const leagueSize = safeNumber(settings.leagueSize, FANTASY_TEAM_COUNT);
  const playoffs = settings.playoffs || {};
  const conferences = safeNumber(playoffs.conferences, 2);
  const conferenceSize = safeNumber(playoffs.conferenceSize, Math.floor(leagueSize / conferences));
  const playoffTeamsPerConference = safeNumber(playoffs.playoffTeamsPerConference, 3);
  const totalPlayoffTeams = conferences * playoffTeamsPerConference;
  return `${leagueSize} teams max • ${conferences} conferences of ${conferenceSize} • top ${playoffTeamsPerConference} per conference make it (${totalPlayoffTeams} total) • #1 gets a bye, #2 vs #3, winners play for the conference title`;
}

function managerRosterAssets(league, snapshot, userId) {
  const picked = new Map((league.draft?.picks || []).map((pick) => [pick.assetId, pick]));
  return (league.managers?.[userId]?.roster || [])
    .map((assetId) => {
      const liveAsset = findFantasyAsset(league, snapshot, assetId, userId);
      const pick = picked.get(assetId);
      return liveAsset ? { ...liveAsset, draftedBy: pick?.userId, pickNo: pick?.pickNo } : pick;
    })
    .filter(Boolean);
}

function gradeFromRank(rank, total) {
  if (rank <= 1) return 'A';
  if (rank <= Math.ceil(total * 0.25)) return 'A-';
  if (rank <= Math.ceil(total * 0.45)) return 'B+';
  if (rank <= Math.ceil(total * 0.65)) return 'B';
  if (rank <= Math.ceil(total * 0.85)) return 'C+';
  return 'C';
}

function projectedWinsForRank(rank, total) {
  if (total <= 1) return 8;
  const pct = 1 - ((rank - 1) / Math.max(1, total - 1));
  return Math.max(4, Math.min(12, Math.round(5 + pct * 7)));
}

function formatRecapPlayer(asset) {
  return `${asset.position} ${asset.name} (${asset.teamName}) - ${asset.points} pts, ${asset.statLine}`;
}

export function buildFantasyDraftRecaps(league, snapshot) {
  const managers = Object.values(league.managers || {}).filter((manager) => !manager.isCpu);
  const scored = managers.map((manager) => {
    const assets = managerRosterAssets(league, snapshot, manager.userId);
    const totalValue = assets.reduce((sum, asset) => sum + safeNumber(asset.draftValue), 0);
    const totalProjected = assets.reduce((sum, asset) => sum + safeNumber(asset.projected), 0);
    return { manager, assets, totalValue, totalProjected };
  }).sort((a, b) => b.totalValue - a.totalValue || b.totalProjected - a.totalProjected);

  return scored.map((entry, index) => {
    const rank = index + 1;
    const grade = gradeFromRank(rank, scored.length);
    const projectedWins = projectedWinsForRank(rank, scored.length);
    const top = entry.assets.slice()
      .sort((a, b) => safeNumber(b.draftValue) - safeNumber(a.draftValue))
      .slice(0, 5);
    const positionCounts = entry.assets.reduce((acc, asset) => {
      acc[asset.position] = (acc[asset.position] || 0) + 1;
      return acc;
    }, {});
    const coreNames = top.slice(0, 3).map((asset) => asset.name).join(', ') || 'your top picks';
    const blurb = `${entry.manager.teamName || 'Your fantasy team'} came out with a ${grade}. The build leans on ${coreNames}, with enough weekly ceiling to project around ${projectedWins} wins if the usage holds. The strongest part of the roster is ${top[0]?.position || 'the top end'} value; the swing point is whether the bench turns into usable flex depth once the season settles.`;
    const embed = new EmbedBuilder()
      .setTitle('Fantasy Draft Recap')
      .setColor(0x5865f2)
      .setDescription(blurb)
      .addFields(
        { name: 'Grade', value: grade, inline: true },
        { name: 'Projected Wins', value: String(projectedWins), inline: true },
        { name: 'Draft Rank', value: `${rank}/${scored.length}`, inline: true },
        { name: 'Roster Shape', value: Object.entries(positionCounts).map(([pos, count]) => `${pos}: ${count}`).join(' • ') || 'No picks logged', inline: false },
        { name: 'Best Picks', value: top.length ? top.map(formatRecapPlayer).join('\n').slice(0, 1024) : 'No picks logged.', inline: false },
      )
      .setFooter({ text: 'Projection uses fantasy draft value, current production, position scarcity, and expected rest-of-season role.' });
    return { userId: entry.manager.userId, embed, grade, projectedWins };
  });
}

function actionId(mode, action, value = null, seasonKey = null) {
  if (normalizeFantasyMode(mode) === 'mock' && seasonKey) {
    const base = `madden_fantasy|mockkey_${action}|${seasonKey}`;
    return value === null ? base : `${base}|${value}`;
  }
  const prefix = normalizeFantasyMode(mode) === 'mock' ? `mock_${action}` : action;
  return value === null ? `madden_fantasy|${prefix}` : `madden_fantasy|${prefix}|${value}`;
}

function baseButtons(active = 'hub', page = 0, mode = 'live', seasonKey = null) {
  const isMock = normalizeFantasyMode(mode) === 'mock';
  if (isMock) {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(actionId(mode, 'hub', null, seasonKey)).setLabel('🏠 Mock Hub').setStyle(active === 'hub' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(actionId(mode, 'draft', null, seasonKey)).setLabel('🎯 Draft Room').setStyle(active === 'draft' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(actionId(mode, 'board', page, seasonKey)).setLabel('📋 Board').setStyle(active === 'board' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(actionId(mode, 'team', null, seasonKey)).setLabel('🧢 My Team').setStyle(active === 'team' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(actionId(mode, 'autopick', null, seasonKey)).setLabel('🤖 Auto Pick').setStyle(ButtonStyle.Secondary),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(actionId(mode, 'start', null, seasonKey)).setLabel('⚡ Start Mock').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(actionId(mode, 'invite', null, seasonKey)).setLabel('👥 Invite').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(actionId(mode, 'standings', null, seasonKey)).setLabel('🏆 Standings').setStyle(active === 'standings' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(actionId(mode, 'reset', null, seasonKey)).setLabel('🔄 Reset').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(actionId('live', 'hub')).setLabel('Live League').setStyle(ButtonStyle.Secondary),
      ),
    ];
  }
  const secondRowComponents = [
    new ButtonBuilder().setCustomId(actionId(mode, 'start', null, seasonKey)).setLabel('Start Draft').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(actionId(mode, 'draft', null, seasonKey)).setLabel('Draft Room').setStyle(active === 'draft' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(actionId(mode, 'trade', null, seasonKey)).setLabel('Trade Center').setStyle(active === 'trade' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(actionId(mode, 'invite', null, seasonKey)).setLabel('Invite Coaches').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(actionId('mock', 'hub')).setLabel('Mock Draft').setStyle(ButtonStyle.Secondary),
  ];
  const thirdRowComponents = [
    new ButtonBuilder().setCustomId(actionId(mode, 'autopick', null, seasonKey)).setLabel('Toggle Auto Pick').setStyle(ButtonStyle.Secondary),
  ];
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(actionId(mode, 'hub', null, seasonKey)).setLabel(isMock ? 'Mock Hub' : 'Hub').setStyle(active === 'hub' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(actionId(mode, 'join', null, seasonKey)).setLabel('Join').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(actionId(mode, 'board', page, seasonKey)).setLabel('Draft Board').setStyle(active === 'board' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(actionId(mode, 'team', null, seasonKey)).setLabel('My Team').setStyle(active === 'team' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(actionId(mode, 'standings', null, seasonKey)).setLabel('Standings').setStyle(active === 'standings' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(...secondRowComponents),
    new ActionRowBuilder().addComponents(...thirdRowComponents),
  ];
}

export function buildFantasyHubPayload(league, snapshot, userId, { mode = 'live', seasonKey = null } = {}) {
  const isMock = normalizeFantasyMode(mode) === 'mock';
  const leagueSize = safeNumber(league.settings?.leagueSize, FANTASY_TEAM_COUNT);
  const rawManagerCount = Object.values(league.managers || {}).filter((manager) => isMock || !manager.isCpu).length;
  const managerCount = Math.min(leagueSize, league.draft?.order?.length || rawManagerCount);
  const onClock = currentFantasyDrafter(league);
  const manager = league.managers?.[userId];
  const board = buildFantasyBoard(league, snapshot, { userId });
  const preview = board.slice(0, 5).map((asset, idx) => `${idx + 1}. ${formatAssetLine(asset)}`).join('\n') || 'No eligible players found from the current export.';
  const embed = new EmbedBuilder()
    .setTitle(isMock ? 'Madden Fantasy Mock Draft' : 'Madden Fantasy League')
    .setColor(0x5865f2)
    .setDescription(isMock
      ? `Test the yearly redraft flow here. Mock picks, mock rosters, and mock resets are separate from the real fantasy league. Use <#${FANTASY_CHAT_CHANNEL_ID}> for mock draft chat.`
      : `Draft players from other Madden teams, then their real league production becomes your fantasy score. Own-team players and own-team defenses are blocked. Fantasy chat lives in <#${FANTASY_CHAT_CHANNEL_ID}>.`)
    .addFields(
      { name: 'Status', value: `${league.status} • ${managerCount}/${leagueSize} teams`, inline: true },
      { name: 'Draft', value: league.draft?.status === 'live' ? `Live • on clock: ${managerLabel(league, onClock)}` : league.draft?.status || 'not_started', inline: true },
      { name: 'Auto Pick', value: manager?.autoPick ? 'On' : 'Off', inline: true },
      { name: 'Lineup', value: 'QB, RB, RB, WR, WR, TE, FLEX, DST, K, 5 BN', inline: false },
      { name: 'Playoffs', value: formatPlayoffSystem(league.settings), inline: false },
      { name: 'Board Leaders', value: preview.slice(0, 1024), inline: false },
    )
    .setFooter({ text: isMock ? 'Mock mode is safe to reset before launch.' : 'Scoring uses common half-PPR fantasy rules from current Madden season totals.' });
  return { embeds: [embed], components: baseButtons('hub', 0, mode, seasonKey) };
}

export function buildFantasyBoardPayload(league, snapshot, userId, page = 0, { mode = 'live', seasonKey = null } = {}) {
  const board = buildFantasyBoard(league, snapshot, { userId });
  const maxPage = Math.max(0, Math.ceil(board.length / BOARD_PAGE_SIZE) - 1);
  const safePage = Math.min(Math.max(0, safeNumber(page)), maxPage);
  const slice = board.slice(safePage * BOARD_PAGE_SIZE, safePage * BOARD_PAGE_SIZE + BOARD_PAGE_SIZE);
  const onClock = currentFantasyDrafter(league);
  const embed = new EmbedBuilder()
    .setTitle(normalizeFantasyMode(mode) === 'mock' ? 'Fantasy Mock Draft Board' : 'Fantasy Draft Board')
    .setColor(0x2ecc71)
    .setDescription(
      slice.map((asset) => `#${asset.rank} ${formatAssetLine(asset)}`).join('\n') || 'No eligible board entries on this page.',
    )
    .addFields({ name: 'On Clock', value: onClock ? managerLabel(league, onClock) : 'Draft has not started.', inline: true })
    .setFooter({ text: `Page ${safePage + 1}/${maxPage + 1} • board excludes your own Madden team.` });

  const rows = baseButtons('board', safePage, mode, seasonKey);
  const prevDisabled = safePage <= 0;
  const nextDisabled = safePage >= maxPage;
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(prevDisabled ? actionId(mode, 'board_prev_disabled', safePage, seasonKey) : actionId(mode, 'board', safePage - 1, seasonKey))
      .setLabel('Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(prevDisabled),
    new ButtonBuilder()
      .setCustomId(nextDisabled ? actionId(mode, 'board_next_disabled', safePage, seasonKey) : actionId(mode, 'board', safePage + 1, seasonKey))
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(nextDisabled),
  ));
  if (league.draft?.status === 'live' && onClock === userId && slice.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(actionId(mode, 'pick', safePage, seasonKey))
        .setPlaceholder('Make your pick')
        .addOptions(slice.slice(0, SELECT_PAGE_SIZE).map((asset) => (
          new StringSelectMenuOptionBuilder()
            .setLabel(`${asset.position} ${asset.name}`.slice(0, 100))
            .setDescription(`${asset.teamName} • ${asset.draftValue} value • ${asset.points} pts • ${asset.statLine}`.slice(0, 100))
            .setValue(asset.assetId)
        ))),
    ));
  }
  return { embeds: [embed], components: rows.slice(0, 5) };
}

export function buildFantasyTeamPayload(league, snapshot, userId, { seasonKey = null } = {}) {
  const manager = league.managers?.[userId];
  const assets = managerRosterAssets(league, snapshot, userId);
  const embed = new EmbedBuilder()
    .setTitle('My Fantasy Team')
    .setColor(0xf1c40f)
    .setDescription(manager ? `**${manager.teamName}**` : 'Join the fantasy league first.')
    .addFields(
      { name: 'Roster', value: assets.length ? assets.map(formatAssetLine).join('\n').slice(0, 1024) : 'No drafted players yet.', inline: false },
      { name: 'Madden Team Block', value: (manager?.maddenTeamIds || []).length ? 'Own-team players are hidden from your draft board and blocked at pick time.' : 'No Madden team assignment found yet.', inline: false },
    );
  return { embeds: [embed], components: baseButtons('team', 0, league.isMock ? 'mock' : 'live', seasonKey) };
}

export function buildFantasyStandingsPayload(league, snapshot, { seasonKey = null } = {}) {
  const rows = Object.values(league.managers || {})
    .map((manager) => {
      const assets = managerRosterAssets(league, snapshot, manager.userId);
      const total = assets.reduce((sum, asset) => sum + safeNumber(asset.points), 0);
      return { manager, picks: assets.length, total };
    })
    .sort((a, b) => b.total - a.total);
  const embed = new EmbedBuilder()
    .setTitle('Fantasy Standings')
    .setColor(0x3498db)
    .setDescription(rows.length
      ? rows.map((row, idx) => `${idx + 1}. ${managerLabel(league, row.manager.userId)} - ${row.total.toFixed(1)} draft-board pts • ${row.picks} players`).join('\n')
      : 'No coaches have joined yet.')
    .setFooter({ text: 'Live weekly scoring will use the same half-PPR scoring model.' });
  return { embeds: [embed], components: baseButtons('standings', 0, league.isMock ? 'mock' : 'live', seasonKey) };
}

export function buildFantasyDraftPayload(league, snapshot, userId, { mode = 'live', seasonKey = null } = {}) {
  const onClock = currentFantasyDrafter(league);
  const lastPicks = (league.draft?.picks || []).slice(-6).reverse();
  const embed = new EmbedBuilder()
    .setTitle(normalizeFantasyMode(mode) === 'mock' ? 'Fantasy Mock Draft Room' : 'Fantasy Draft Room')
    .setColor(0xe67e22)
    .setDescription(league.draft?.status === 'live'
      ? `Round ${league.draft.round}, Pick ${league.draft.pickIndex + 1} • On clock: ${managerLabel(league, onClock)}`
      : `Draft status: ${league.draft?.status || 'not_started'}`)
    .addFields(
      { name: 'Order', value: (league.draft?.order || Object.keys(league.managers || {})).map((id, idx) => `${idx + 1}. ${managerLabel(league, id)}`).join('\n') || 'No joined coaches yet.', inline: true },
      { name: 'Recent Picks', value: lastPicks.length ? lastPicks.map((pick) => `${pick.pickNo}. ${pick.position} ${pick.name} - ${managerLabel(league, pick.userId)}`).join('\n') : 'No picks made yet.', inline: true },
    );
  const payload = buildFantasyBoardPayload(league, snapshot, userId, 0, { mode, seasonKey });
  return { embeds: [embed, ...payload.embeds], components: payload.components };
}

export function buildFantasyTradePayload(league, userId) {
  const manager = league.managers?.[userId];
  const embed = new EmbedBuilder()
    .setTitle('Fantasy Trade Center')
    .setColor(0x9b59b6)
    .setDescription('Player and fantasy-pick trades are tracked in the fantasy store. Draft-room trading can be handled by staff now; the next UI pass will add guided offer buttons without adding a new slash command.')
    .addFields(
      { name: 'Tradeable', value: 'Drafted players, bench players, and future fantasy picks.', inline: false },
      { name: 'Rule', value: 'You still cannot receive or roster a player from your own Madden team.', inline: false },
      { name: 'Your Team', value: manager ? manager.teamName : 'Join the league first.', inline: true },
    );
  return { embeds: [embed], components: baseButtons('trade', 0, league.isMock ? 'mock' : 'live') };
}
