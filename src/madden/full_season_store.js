import fs from 'node:fs/promises';
import path from 'node:path';
import { getMaddenDataFilePath } from '../leaguebuddy/paths.js';
import { getMaddenSeasonKey } from '../shared/madden_metadata.js';

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
