import fs from 'fs';
import { getExplicitLeagueForGuild, getLeagueForGuild } from './madden_config.js';
import { getMaddenLeagueSnapshotPath, getMaddenLeaguesDir } from '../leaguebuddy/paths.js';

const LEAGUE_DIR = getMaddenLeaguesDir();
const warnedFallbackSurfaces = new Set();

export function loadLeagueSnapshot(leagueId) {
  if (!leagueId) throw new Error('Missing league_id');
  const file = getMaddenLeagueSnapshotPath(leagueId);
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

function listLeagueFiles() {
  try {
    return fs.readdirSync(LEAGUE_DIR).filter(f => f.endsWith('.json'));
  } catch {
    return [];
  }
}

export function getDefaultLeagueId() {
  const files = listLeagueFiles();
  if (!files.length) return null;
  const withMtime = files.map(f => {
    const full = getMaddenLeagueSnapshotPath(f.replace('.json', ''));
    let mtime = 0;
    try { mtime = fs.statSync(full).mtimeMs; } catch {}
    return { name: f.replace('.json', ''), mtime };
  });
  withMtime.sort((a, b) => b.mtime - a.mtime);
  return withMtime[0]?.name || null;
}

export function resolveLeagueIdWithConfig(guildId, surface = 'unknown') {
  const mapped = getLeagueForGuild(guildId);
  if (mapped) return mapped;

  const fallback = getDefaultLeagueId();
  if (fallback) {
    const key = `${String(guildId || 'no-guild')}::${surface}`;
    if (!warnedFallbackSurfaces.has(key)) {
      warnedFallbackSurfaces.add(key);
      console.warn('[madden] legacy league fallback used', {
        guildId: guildId ? String(guildId) : null,
        surface,
        fallbackLeagueId: fallback,
      });
    }
  }
  return fallback;
}

export function resolveLeagueIdStrict(guildId) {
  return getExplicitLeagueForGuild(guildId) || null;
}

export function requireLeagueIdForGuild(guildId) {
  const leagueId = resolveLeagueIdStrict(guildId);
  if (!leagueId) throw new Error('No league is mapped to this server yet. Run `/setup` and press Open Setup Dashboard.');
  return leagueId;
}

export function findScheduleForWeek(snapshot, weekIndex) {
  const schedules = snapshot?.schedule?.schedules || [];
  return schedules.filter(s => s.weekIndex === weekIndex);
}

export function currentWeek(snapshot) {
  return snapshot?.currentWeek ?? snapshot?.info?.careerHubInfo?.seasonInfo?.seasonWeek ?? 1;
}
