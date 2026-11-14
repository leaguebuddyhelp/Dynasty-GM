// Offline audit. Always isolate writes and never construct a Discord client.
import fs from 'node:fs/promises';
import path from 'node:path';
import { getMaddenSeasonKey } from '../src/shared/madden_metadata.js';
import { isStartingSeasonSnapshot } from '../src/madden/full_season_store.js';
import { replayFullSeason, regularSeasonWeeks, seasonCoverage } from '../src/madden/full_season_engine.js';
import { updateAwards } from '../src/madden/awards.js';

const [input, output] = process.argv.slice(2);
if (!input || !output || !process.env.LB_DATA_ROOT || path.resolve(process.env.LB_DATA_ROOT).startsWith(path.resolve(input))) {
  throw new Error('Usage: LB_DATA_ROOT=<isolated scratch directory> node scripts/replay_saved_seasons.js <copied madden directory> <output directory>');
}
await fs.mkdir(output, { recursive: true });
const rules = JSON.parse(await fs.readFile('config/madden_solo_rules.json', 'utf8')).progression;
const seasons = new Map();
const group = (key) => { if (!seasons.has(key)) seasons.set(key, { snapshots: [] }); return seasons.get(key); };
async function files(directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(file));
    else if (entry.name.endsWith('.json')) result.push(file);
  }
  return result;
}
for (const file of await files(path.join(input, 'leagues', 'history'))) {
  if (path.basename(file) === 'index.json') continue;
  const snapshot = JSON.parse(await fs.readFile(file, 'utf8'));
  const entry = group(getMaddenSeasonKey(snapshot));
  entry.snapshots.push(snapshot);
  if (isStartingSeasonSnapshot(snapshot)) entry.baseline = snapshot;
}
for (const file of await files(path.join(input, 'full_season'))) {
  const run = JSON.parse(await fs.readFile(file, 'utf8'));
  if (run.baseline) Object.assign(group(run.seasonKey), { baseline: run.baseline, importedWeeks: run.importedWeeks, importedSchedule: run.importedSchedule });
}
const results = [];
for (const [season, entry] of [...seasons].sort(([a], [b]) => a.localeCompare(b))) {
  const snapshots = entry.snapshots.sort((a, b) => String(a.syncedAt).localeCompare(String(b.syncedAt)));
  let snapshot = structuredClone(snapshots.at(-1));
  if (!snapshot || !entry.baseline) { results.push({ season, skipped: 'No verified starting baseline' }); continue; }
  const weeks = {};
  for (const source of snapshots) {
    // Week 1 / preseason exports can contain stale prior-year stat buckets.
    if (Number(source.currentWeek) <= 1) continue;
    for (const [index, week] of Object.entries(regularSeasonWeeks(source))) {
      if (Number(source.info?.careerHubInfo?.seasonInfo?.seasonWeekType) === 1 && Number(index) >= Number(source.currentWeek) - 1) continue;
      if ((week.passing?.playerPassingStatInfoList || []).some((row) => Number(row.passAtt) > 0)) weeks[index] = week;
    }
  }
  Object.assign(weeks, entry.importedWeeks || {});
  snapshot.weeklyStats = Object.values(weeks);
  if (entry.importedSchedule?.length) snapshot.schedule = { schedules: entry.importedSchedule };
  else {
    // Offseason exports can already contain the following season's unplayed
    // schedule. Select the saved schedule with the greatest verified coverage.
    for (const source of snapshots) {
      const candidate = { ...source, weeklyStats: Object.values(weeks) };
      if (seasonCoverage(candidate, weeks).completedWeeks > seasonCoverage(snapshot, weeks).completedWeeks) snapshot = candidate;
    }
  }
  const coverage = seasonCoverage(snapshot, weeks);
  if (!coverage.complete) { results.push({ season, skipped: 'Incomplete saved weeks', coverage }); continue; }
  const awards = new Map();
  const computeAwards = async (view, week) => {
    if (!awards.has(week)) awards.set(week, (await updateAwards(null, snapshot.leagueId, week, { snapshot: view, stage: 1, captureOnly: true, refreshProgression: false })).winners);
    return awards.get(week);
  };
  const oldRules = process.env.MADDEN_REPLAY_COMPARISON_RULES
    ? JSON.parse(await fs.readFile(process.env.MADDEN_REPLAY_COMPARISON_RULES, 'utf8')).progression : structuredClone(rules);
  if (!process.env.MADDEN_REPLAY_COMPARISON_RULES) delete oldRules.weekly.statLeaders;
  const runs = {};
  for (const [label, policy] of [['previous', oldRules], ['updated', rules]]) {
    console.log(`REPLAY ${season} ${label}`);
    const replay = await replayFullSeason({ baseline: entry.baseline, snapshot, weeks, rules: policy, computeAwards });
    const rows = replay.totals.players.map((p) => ({ ...p, net: Object.values(p.attributes).reduce((s, a) => s + a.net, 0) }));
    const positions = {};
    for (const p of rows) {
      const pos = positions[p.position] ||= { growers: 0, fallers: 0, positive: 0, negative: 0, biggestGrower: null, biggestFaller: null };
      if (p.net > 0) pos.growers++;
      if (p.net < 0) pos.fallers++;
      for (const a of Object.values(p.attributes)) { pos.positive += a.positive; pos.negative += a.negative; }
      if (p.net > 0 && (!pos.biggestGrower || p.net > pos.biggestGrower.net)) pos.biggestGrower = { player: p.player, net: p.net };
      if (p.net < 0 && (!pos.biggestFaller || p.net < pos.biggestFaller.net)) pos.biggestFaller = { player: p.player, net: p.net };
    }
    runs[label] = { positivePoints: replay.totals.positivePoints, negativePoints: replay.totals.negativePoints,
      upgradeEvents: replay.totals.upgradeEvents, downgradeEvents: replay.totals.downgradeEvents,
      unmatched: replay.unmatchedPlayers.length, positions,
      growers: rows.filter((p) => p.net > 0).sort((a, b) => b.net - a.net).slice(0, 15),
      fallers: rows.filter((p) => p.net < 0).sort((a, b) => a.net - b.net).slice(0, 15),
      weeklyCounts: Object.values(replay.weeks).map((w) => w.recommendations.length) };
    await fs.writeFile(path.join(output, `${season}-${label}.json`), JSON.stringify(replay, null, 2));
  }
  results.push({ season, baselineSyncId: entry.baseline.syncId, finalSyncId: snapshot.syncId, coverage, ...runs });
  await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(results, null, 2));
}
await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.map((r) => ({ season: r.season, skipped: r.skipped, positive: r.updated?.positivePoints, negative: r.updated?.negativePoints }))));
