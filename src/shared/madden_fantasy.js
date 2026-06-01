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
  return { guilds: {} };
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
  const isMock = String(seasonKey || '').endsWith(':mock');
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
        teamsPerConference: 5,
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
    teamsPerConference: 5,
    byesPerConference: 1,
    ...(league.settings.playoffs || {}),
  };
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
    store.guilds[guildId].leagues[seasonKey].isMock = String(seasonKey || '').endsWith(':mock');
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
  league.isMock = String(seasonKey || '').endsWith(':mock');
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
      board.push({
        assetId,
        rosterId: player.rosterId,
        type: 'player',
        name: fullName(player),
        position,
        teamId: Number(player.teamId),
        teamName: player.teamName || context.teamNameById?.[player.teamId] || String(player.teamId),
        points,
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
    board.push({
      assetId,
      type: 'dst',
      name: `${stats.teamName} DST`,
      position: 'DST',
      teamId,
      teamName: stats.teamName,
      points,
      overall: 0,
      statLine: `${safeNumber(stats.labels?.defSacks)} sacks, ${safeNumber(stats.labels?.defINT)} INT`,
    });
  }
  return board
    .sort((a, b) => b.points - a.points || b.overall - a.overall || a.name.localeCompare(b.name))
    .map((entry, index) => ({ ...entry, rank: index + 1, points: Number(entry.points.toFixed(1)) }));
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

export function startFantasyDraft(league, options = {}) {
  if (options.soloMockUserId) {
    ensureCpuManagers(league, options.cpuTeams || SOLO_MOCK_CPU_COUNT);
  }
  const desiredTeams = safeNumber(league.settings?.leagueSize, FANTASY_TEAM_COUNT);
  const order = options.soloMockUserId
    ? [options.soloMockUserId, ...Object.keys(league.managers || {}).filter((id) => isCpuUserId(id)).slice(0, options.cpuTeams || SOLO_MOCK_CPU_COUNT)]
    : Object.keys(league.managers || {}).filter((id) => !isCpuUserId(id)).slice(0, desiredTeams);
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
  return `${emoji ? `${emoji} ` : ''}${asset.position} **${asset.name}** (${asset.teamName}) - ${asset.points} pts - ${asset.statLine}`;
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

function actionId(mode, action, value = null) {
  const prefix = normalizeFantasyMode(mode) === 'mock' ? `mock_${action}` : action;
  return value === null ? `madden_fantasy|${prefix}` : `madden_fantasy|${prefix}|${value}`;
}

function baseButtons(active = 'hub', page = 0, mode = 'live') {
  const isMock = normalizeFantasyMode(mode) === 'mock';
  const secondRowComponents = [
    new ButtonBuilder().setCustomId(actionId(mode, 'start')).setLabel(isMock ? 'Start Mock' : 'Start Draft').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(actionId(mode, 'draft')).setLabel('Draft Room').setStyle(active === 'draft' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(actionId(mode, 'trade')).setLabel('Trade Center').setStyle(active === 'trade' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    isMock
      ? new ButtonBuilder().setCustomId(actionId(mode, 'reset')).setLabel('Reset Mock').setStyle(ButtonStyle.Secondary)
      : new ButtonBuilder().setCustomId(actionId('mock', 'hub')).setLabel('Mock Draft').setStyle(ButtonStyle.Secondary),
  ];
  if (isMock) {
    secondRowComponents.push(
      new ButtonBuilder().setCustomId(actionId('live', 'hub')).setLabel('Live League').setStyle(ButtonStyle.Secondary),
    );
  }
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(actionId(mode, 'hub')).setLabel(isMock ? 'Mock Hub' : 'Hub').setStyle(active === 'hub' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(actionId(mode, 'join')).setLabel('Join').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(actionId(mode, 'board', page)).setLabel('Draft Board').setStyle(active === 'board' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(actionId(mode, 'team')).setLabel('My Team').setStyle(active === 'team' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(actionId(mode, 'standings')).setLabel('Standings').setStyle(active === 'standings' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(...secondRowComponents),
  ];
}

export function buildFantasyHubPayload(league, snapshot, userId, { mode = 'live' } = {}) {
  const isMock = normalizeFantasyMode(mode) === 'mock';
  const managerCount = Object.values(league.managers || {}).filter((manager) => isMock || !manager.isCpu).length;
  const leagueSize = safeNumber(league.settings?.leagueSize, FANTASY_TEAM_COUNT);
  const playoffs = league.settings?.playoffs || {};
  const onClock = currentFantasyDrafter(league);
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
      { name: 'Lineup', value: 'QB, RB, RB, WR, WR, TE, FLEX, DST, K, 5 BN', inline: false },
      { name: 'Playoffs', value: `${safeNumber(playoffs.teams, 6)} teams • ${safeNumber(playoffs.conferences, 2)} conferences • 1-seed in each conference gets a bye`, inline: false },
      { name: 'Board Leaders', value: preview.slice(0, 1024), inline: false },
    )
    .setFooter({ text: isMock ? 'Mock mode is safe to reset before launch.' : 'Scoring uses common half-PPR fantasy rules from current Madden season totals.' });
  return { embeds: [embed], components: baseButtons('hub', 0, mode) };
}

export function buildFantasyBoardPayload(league, snapshot, userId, page = 0, { mode = 'live' } = {}) {
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

  const rows = baseButtons('board', safePage, mode);
  const prevDisabled = safePage <= 0;
  const nextDisabled = safePage >= maxPage;
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(prevDisabled ? actionId(mode, 'board_prev_disabled', safePage) : actionId(mode, 'board', safePage - 1))
      .setLabel('Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(prevDisabled),
    new ButtonBuilder()
      .setCustomId(nextDisabled ? actionId(mode, 'board_next_disabled', safePage) : actionId(mode, 'board', safePage + 1))
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(nextDisabled),
  ));
  if (league.draft?.status === 'live' && onClock === userId && slice.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(actionId(mode, 'pick', safePage))
        .setPlaceholder('Make your pick')
        .addOptions(slice.slice(0, SELECT_PAGE_SIZE).map((asset) => (
          new StringSelectMenuOptionBuilder()
            .setLabel(`${asset.position} ${asset.name}`.slice(0, 100))
            .setDescription(`${asset.teamName} • ${asset.points} pts • ${asset.statLine}`.slice(0, 100))
            .setValue(asset.assetId)
        ))),
    ));
  }
  return { embeds: [embed], components: rows.slice(0, 5) };
}

export function buildFantasyTeamPayload(league, snapshot, userId) {
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
  return { embeds: [embed], components: baseButtons('team', 0, league.isMock ? 'mock' : 'live') };
}

export function buildFantasyStandingsPayload(league, snapshot) {
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
  return { embeds: [embed], components: baseButtons('standings', 0, league.isMock ? 'mock' : 'live') };
}

export function buildFantasyDraftPayload(league, snapshot, userId, { mode = 'live' } = {}) {
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
  const payload = buildFantasyBoardPayload(league, snapshot, userId, 0, { mode });
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
