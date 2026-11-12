import fs from 'node:fs/promises';
import path from 'node:path';
import { getMaddenDataFilePath, getMaddenLeaguesDir } from '../leaguebuddy/paths.js';
import { getMaddenSeasonKey } from '../shared/madden_metadata.js';
import { getFranchisePhase } from './franchise_phase.js';

function safe(value) {
  const text = String(value || '').trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(text)) throw new Error('Invalid full-season storage ID.');
  return text;
}
function stateFile(guildId, leagueId) {
  return getMaddenDataFilePath(path.join('full_season', safe(guildId), safe(leagueId), 'active.json'));
}
export function fullSeasonIdentity(snapshot) {
  const info = snapshot.info?.careerHubInfo?.seasonInfo || {};
  const raw = info.seasonIndex ?? snapshot.season ?? info.seasonYear;
  return { seasonKey: getMaddenSeasonKey(snapshot), index: raw != null && Number.isInteger(Number(raw)) ? Number(raw) : null };
}
export function matchesFullSeason(run, snapshot) {
  if (!run || String(run.leagueId) !== String(snapshot.leagueId)) return false;
  const identity = fullSeasonIdentity(snapshot);
  return run.identity?.index != null && identity.index != null ? run.identity.index === identity.index : run.seasonKey === identity.seasonKey;
}
export async function loadFullSeasonRun(guildId, leagueId) {
  try { return JSON.parse(await fs.readFile(stateFile(guildId, leagueId), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export function isStartingSeasonSnapshot(snapshot) {
  const phase = getFranchisePhase(snapshot);
  if (phase !== 'preseason' && !(phase === 'regular' && Number(snapshot.currentWeek) === 1)) return false;
  if ((snapshot.teams?.leagueTeamInfoList || []).length !== 32 || Object.keys(snapshot.rosters?.teams || {}).length !== 32) return false;
  if (Object.values(snapshot.rosters.teams).some((roster) => !(roster.rosterInfoList || roster.rosterPlayerInfoList || []).length)) return false;
  if (phase === 'preseason') return true;
  // Week 1 is eligible only before games have been played, not a stale hub label.
  if ((snapshot.schedule?.schedules || []).some((game) => Number(game.stageIndex ?? game.stage) === 1 && Number(game.status) >= 2)) return false;
  return !(snapshot.weeklyStats || []).some((week) => Number(week.stage ?? week.stageIndex) === 1
    && (week.passing?.playerPassingStatInfoList || []).some((player) => Number(player.passAtt) > 0));
}
export async function findArchivedSeasonBaseline(snapshot) {
  const directory = path.join(getMaddenLeaguesDir(), 'history', safe(snapshot.leagueId));
  let index;
  try { index = JSON.parse(await fs.readFile(path.join(directory, 'index.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!Array.isArray(index.records)) throw new Error('Invalid sync history index while recovering the season baseline.');
  let selected = null;
  for (const entry of [...index.records].sort((a, b) => String(b.syncedAt || '').localeCompare(String(a.syncedAt || '')))) {
    if (!entry.syncId || Number(entry.summary?.currentWeek) > 1 && Number(entry.summary?.stage) !== 0) continue;
    let archived;
    try { archived = JSON.parse(await fs.readFile(path.join(directory, `${safe(entry.syncId)}.json`), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!matchesFullSeason({ leagueId: snapshot.leagueId, seasonKey: getMaddenSeasonKey(archived), identity: fullSeasonIdentity(archived) }, snapshot)
      || String(archived.leagueId) !== String(snapshot.leagueId) || !isStartingSeasonSnapshot(archived)) continue;
    // Prefer the final Week 1 roster (after cuts/signings) over preseason.
    if (getFranchisePhase(archived) === 'regular') return archived;
    selected ||= archived;
  }
  return selected;
}
export async function saveFullSeasonRun(run) {
  const file = stateFile(run.guildId, run.leagueId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(run, null, 2), { flag: 'wx' });
    await fs.rename(temporary, file);
  } catch (error) { await fs.rm(temporary, { force: true }); throw error; }
}
export async function archiveFullSeasonRun(run) {
  const directory = path.dirname(stateFile(run.guildId, run.leagueId));
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, `${safe(run.seasonKey)}_${run.identity.index ?? 'unknown'}.json`);
  await fs.writeFile(file, JSON.stringify(run, null, 2));
}
