import fs from 'fs';
import path from 'path';
import { EmbedBuilder } from 'discord.js';
import { resolveLeagueIdWithConfig, loadLeagueSnapshot } from '../madden/madden_data.js';
import { getPinId, setPinId } from '../madden/pins_store.js';
import { upsertGuildPin } from './madden_guild_config.js';
import { getMaddenDataFilePath } from '../leaguebuddy/paths.js';

const ACTIVE_TRADES_FILE = getMaddenDataFilePath('active_trades.json');
const TRADE_COUNTS_FILE = getMaddenDataFilePath('trade_counts.json');
const ROLE_MAP_FILE = getMaddenDataFilePath('madden_role_ids.json');
const TRADE_COUNT_MESSAGE_ID = '1460405214032035891';
const GLOBAL_SCOPE_KEY = '__legacy_global__';

function readScopedStore(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && typeof raw === 'object' && raw.byGuild && typeof raw.byGuild === 'object') {
      return raw;
    }
    return { byGuild: { [GLOBAL_SCOPE_KEY]: raw && typeof raw === 'object' ? raw : {} } };
  } catch {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const empty = { byGuild: {} };
    fs.writeFileSync(file, JSON.stringify(empty, null, 2));
    return empty;
  }
}

function writeScopedStore(file, scoped) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(scoped ?? { byGuild: {} }, null, 2));
}

function resolveScopeKey(guildId = null) {
  return guildId ? String(guildId) : GLOBAL_SCOPE_KEY;
}

export function canTrade(leagueId) {
  try {
    const snapshot = loadLeagueSnapshot(leagueId);
    const wk = snapshot?.currentWeek ?? snapshot?.info?.careerHubInfo?.seasonInfo?.seasonWeek ?? 1;
    return Number(wk) < 13; // lock starting Week 13 (deadline end of Week 12)
  } catch {
    return true;
  }
}

export function loadActiveTrades(guildId = null) {
  const scoped = readScopedStore(ACTIVE_TRADES_FILE);
  return scoped.byGuild?.[resolveScopeKey(guildId)] || {};
}

export function findActiveTradeById(tradeId, guildId = null) {
  const scoped = readScopedStore(ACTIVE_TRADES_FILE);
  const preferredScope = guildId ? resolveScopeKey(guildId) : null;
  if (preferredScope && scoped.byGuild?.[preferredScope]?.[tradeId]) {
    return {
      guildId: preferredScope,
      trades: scoped.byGuild[preferredScope],
      trade: scoped.byGuild[preferredScope][tradeId],
    };
  }
  for (const [scopeKey, trades] of Object.entries(scoped.byGuild || {})) {
    if (trades?.[tradeId]) {
      return {
        guildId: scopeKey === GLOBAL_SCOPE_KEY ? null : scopeKey,
        trades,
        trade: trades[tradeId],
      };
    }
  }
  return { guildId: preferredScope || null, trades: preferredScope ? (scoped.byGuild?.[preferredScope] || {}) : {}, trade: null };
}

export function saveActiveTrades(guildIdOrData, maybeData = undefined) {
  const guildId = maybeData === undefined ? null : guildIdOrData;
  const data = maybeData === undefined ? guildIdOrData : maybeData;
  const scoped = readScopedStore(ACTIVE_TRADES_FILE);
  scoped.byGuild[resolveScopeKey(guildId)] = data ?? {};
  writeScopedStore(ACTIVE_TRADES_FILE, scoped);
}

export function loadTradeCounts(guildId = null) {
  const scoped = readScopedStore(TRADE_COUNTS_FILE);
  return scoped.byGuild?.[resolveScopeKey(guildId)] || {};
}

export function saveTradeCounts(guildIdOrData, maybeData = undefined) {
  const guildId = maybeData === undefined ? null : guildIdOrData;
  const data = maybeData === undefined ? guildIdOrData : maybeData;
  const scoped = readScopedStore(TRADE_COUNTS_FILE);
  scoped.byGuild[resolveScopeKey(guildId)] = data ?? {};
  writeScopedStore(TRADE_COUNTS_FILE, scoped);
}

export function computeApprovedTradeCounts(trades) {
  const counts = {};
  Object.values(trades || {}).forEach(tr => {
    if (tr?.status !== 'approved') return;
    [tr.yourTeam, tr.otherTeam].forEach(t => {
      if (!t) return;
      counts[t] = (counts[t] || 0) + 1;
    });
  });
  return counts;
}

export function incrementTradeCounts(counts, teams) {
  teams.forEach(t => {
    counts[t] = (counts[t] || 0) + 1;
  });
  return counts;
}

export async function updateTradeCountsEmbed(client, channelMap, counts, { guildId = null } = {}) {
  const channelId = channelMap['Trade Counts'];
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const roleMap = (() => {
    try { return JSON.parse(fs.readFileSync(ROLE_MAP_FILE, 'utf8')); } catch { return {}; }
  })();
  // Build full list with zeros for all teams we know
  const keys = Object.keys(counts || {});
  const allTeams = Array.from(new Set(keys));
  allTeams.sort((a, b) => (a || '').localeCompare(b || ''));

  const lines = allTeams.map(team => {
    const cnt = counts[team] || 0;
    return `${team}: ${cnt}`;
  });

  const embed = new EmbedBuilder()
    .setTitle('Trade Counts')
    .setDescription(lines.length ? lines.join('\n') : 'No trades yet.')
    .setColor(0x00b0f4)
    .setTimestamp(new Date());

  const fixedMsg = await channel.messages.fetch(TRADE_COUNT_MESSAGE_ID).catch(() => null);
  if (fixedMsg) {
    await fixedMsg.edit({ embeds: [embed], content: null }).catch(() => null);
    return;
  }

  try {
    const pins = await channel.messages.fetchPinned().catch(() => null);
    const botPin = pins ? pins.find(m => m.author.id === client.user.id) : null;
    if (botPin) {
      await botPin.edit({ embeds: [embed], content: null }).catch(() => null);
      return;
    }
  } catch { }

  try {
    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    const botMsg = recent ? recent.find(m => m.author.id === client.user.id) : null;
    if (botMsg) {
      await botMsg.edit({ embeds: [embed], content: null }).catch(() => null);
      return;
    }
  } catch { }

  const pinId = getPinId('trade_counts', guildId);
  if (pinId) {
    const msg = await channel.messages.fetch(pinId).catch(() => null);
    if (msg) {
      await msg.edit({ embeds: [embed], content: null }).catch(() => null);
      return;
    }
  }
  const msg = await channel.send({ embeds: [embed] });
  try { await msg.pin(); } catch { }
  if (guildId) upsertGuildPin(guildId, 'trade_counts', msg.id);
  setPinId('trade_counts', msg.id, guildId);
}
