import { stablePlayerKey } from './player_identity.js';

const BUCKETS = [
  ['passing', 'playerPassingStatInfoList'], ['rushing', 'playerRushingStatInfoList'],
  ['receiving', 'playerReceivingStatInfoList'], ['defense', 'playerDefensiveStatInfoList'],
  ['kicking', 'playerKickingStatInfoList'], ['punting', 'playerPuntingStatInfoList'],
];
const playerKey = (row) => row.rosterId != null ? `roster:${row.rosterId}` : stablePlayerKey(row);
const quality = (row) => Object.entries(row.totals || row).filter(([field, value]) =>
  /^(pass|rush|rec|def|fg|fG|xp|xP|pnt)/.test(field) && value != null && Number.isFinite(Number(value)) && Number(value) !== 0).length;

function mergeRows(entries, rowsFor) {
  const players = new Map();
  // Prefer real numeric evidence, then the explicit postseason stage. Never
  // sum duplicate exports of the same player's same game.
  for (const entry of [...entries].sort((a, b) => Number(a.stage ?? a.stageIndex) - Number(b.stage ?? b.stageIndex))) {
    for (const row of rowsFor(entry) || []) {
      const key = playerKey(row);
      if (!key) continue;
      const old = players.get(key);
      if (!old || quality(row) >= quality(old)) players.set(key, row);
    }
  }
  return [...players.values()];
}

export function hasPlayoffPlayerData(entry) {
  return BUCKETS.some(([bucket, list]) => entry[bucket]?.[list]?.length > 0) || entry.playerTotals?.length > 0;
}

export function normalizePlayoffProgressionSnapshot(snapshot) {
  const weeks = new Map();
  const weeklyStats = (snapshot.weeklyStats || []).filter((entry) => Number(entry.weekIndex) < 18);
  for (const entry of snapshot.weeklyStats || []) {
    const index = Number(entry.weekIndex);
    if (!Number.isInteger(index) || index < 18 || index > 22 || ![0, 1, 2].includes(Number(entry.stage ?? entry.stageIndex))) continue;
    const entries = weeks.get(index) || [];
    entries.push(entry);
    weeks.set(index, entries);
  }
  for (const [weekIndex, entries] of weeks) {
    const merged = { weekIndex, stage: 1, stageIndex: 1 };
    for (const [bucket, list] of BUCKETS) {
      const rows = mergeRows(entries, (entry) => entry[bucket]?.[list]);
      if (rows.length) merged[bucket] = { [list]: rows };
    }
    merged.playerTotals = mergeRows(entries, (entry) => entry.playerTotals);
    const teamEntry = [...entries].sort((a, b) => Object.values(b.teamstats || {}).reduce((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0)
      - Object.values(a.teamstats || {}).reduce((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0))[0];
    if (teamEntry?.teamstats) merged.teamstats = teamEntry.teamstats;
    weeklyStats.push(merged);
  }
  const games = new Map();
  const schedules = (snapshot.schedule?.schedules || []).filter((game) => Number(game.weekIndex) < 18);
  for (const game of snapshot.schedule?.schedules || []) {
    const index = Number(game.weekIndex);
    if (index < 18 || index > 22 || ![0, 1, 2].includes(Number(game.stageIndex ?? game.stage))
      || game.homeTeamId == null || game.awayTeamId == null || String(game.homeTeamId) === '0' || String(game.awayTeamId) === '0') continue;
    const key = `${index}:${game.homeTeamId}:${game.awayTeamId}`;
    const rank = (row) => (Number(row.status) >= 2 ? 10 : 0) + (row.homeScore != null && row.awayScore != null ? 2 : 0);
    const previous = games.get(key);
    if (!previous || rank(game) >= rank(previous)) games.set(key, { ...game, stage: 1, stageIndex: 1 });
  }
  schedules.push(...games.values());
  return { ...snapshot, weeklyStats, schedule: { ...snapshot.schedule, schedules } };
}
