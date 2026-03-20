import fs from 'fs';
import { loadLeagueSnapshot, resolveLeagueIdWithConfig } from '../madden/madden_data.js';
import { getGuildChannelMap } from './madden_guild_config.js';
import { getMaddenDataFilePath } from '../leaguebuddy/paths.js';

const CHANNEL_MAP_FILE = getMaddenDataFilePath('madden_channel_ids.json');

function safeReadJSON(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function getMaddenSeasonInfo(snapshot = null) {
  return snapshot?.info?.careerHubInfo?.seasonInfo || {};
}

export function getMaddenSeasonKey(snapshot = null) {
  const seasonInfo = getMaddenSeasonInfo(snapshot);
  const year = Number(seasonInfo.calendarYear || snapshot?.info?.calendarYear || snapshot?.calendarYear || new Date().getFullYear());
  return `year_${year}`;
}

export function getMaddenWeekNumber(snapshot = null) {
  const seasonInfo = getMaddenSeasonInfo(snapshot);
  const weekNumber = Number(snapshot?.currentWeek ?? seasonInfo.displayWeek ?? seasonInfo.seasonWeek ?? 0);
  return weekNumber > 0 ? weekNumber : null;
}

export function getMaddenWeekIndex(snapshot = null) {
  const weekNumber = getMaddenWeekNumber(snapshot);
  return weekNumber ? weekNumber - 1 : null;
}

export function getMaddenWeekKey(snapshot = null) {
  const seasonInfo = getMaddenSeasonInfo(snapshot);
  const weekNumber = getMaddenWeekNumber(snapshot);
  if (weekNumber) return `week_${weekNumber}`;
  return `phase_${String(seasonInfo.phase || seasonInfo.seasonWeekType || 'offseason')}`;
}

export function getMaddenSnapshotContext(guildId, { leagueId = null, snapshot = null } = {}) {
  const resolvedLeagueId = leagueId || resolveLeagueIdWithConfig(guildId, 'shared:madden_metadata.getMaddenSnapshotContext');
  if (!resolvedLeagueId) return null;
  let resolvedSnapshot = snapshot;
  if (!resolvedSnapshot) {
    try {
      resolvedSnapshot = loadLeagueSnapshot(resolvedLeagueId);
    } catch {
      return null;
    }
  }
  const seasonInfo = getMaddenSeasonInfo(resolvedSnapshot);
  return {
    guildId: guildId ? String(guildId) : null,
    leagueId: String(resolvedLeagueId),
    snapshot: resolvedSnapshot,
    seasonInfo,
    seasonKey: getMaddenSeasonKey(resolvedSnapshot),
    weekNumber: getMaddenWeekNumber(resolvedSnapshot),
    weekIndex: getMaddenWeekIndex(resolvedSnapshot),
    weekKey: getMaddenWeekKey(resolvedSnapshot),
  };
}

export function loadMaddenChannelMap(guildId = null) {
  const overlay = guildId ? getGuildChannelMap(guildId) : null;
  if (overlay) return overlay;
  return safeReadJSON(CHANNEL_MAP_FILE, {});
}

export function getMaddenChannelId(channelName, guildId = null) {
  const channelMap = loadMaddenChannelMap(guildId);
  return channelMap?.[channelName] || null;
}
