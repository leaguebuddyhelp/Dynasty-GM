import { hasForeignSeasonStats } from './season_stat_isolation.js';
import { getMaddenSeasonKey } from '../shared/madden_metadata.js';
import { getFranchisePhase } from './franchise_phase.js';
import { loadFullSeasonRun, saveFullSeasonRun, archiveFullSeasonRun, fullSeasonIdentity, matchesFullSeason, findArchivedSeasonBaseline, isStartingSeasonSnapshot } from './full_season_store.js';
import { regularSeasonWeeks, seasonCoverage, replayFullSeason, buildSeasonApplication } from './full_season_engine.js';
import { updateAwards, publishWeeklyAwards } from './awards.js';
import { publishFullSeasonTotals, readProgressionRules, hasIssuedSeasonWeeklyChanges } from './progression.js';

const queues = new Map();
export async function logFullSeasonStatus(guildId) {
  const { resolveLeagueIdWithConfig, loadLeagueSnapshot } = await import('./madden_data.js');
  const leagueId = resolveLeagueIdWithConfig(guildId, 'full-season:diagnostics');
  const snapshot = await loadLeagueSnapshot(leagueId);
  if (!snapshot) return;
  const run = await loadFullSeasonRun(guildId, leagueId);
  if (!matchesFullSeason(run, snapshot) || run.status === 'complete') return;
  const games = run.importedSchedule || [];
  const weeks = Object.values(run.importedWeeks || {}).map((week) => ({
    week: Number(week.weekIndex) + 1,
    games: games.filter((game) => Number(game.weekIndex) === Number(week.weekIndex)).length,
    statuses: [...new Set(games.filter((game) => Number(game.weekIndex) === Number(week.weekIndex)).map((game) => game.status))],
    passTeams: [...new Set((week.passing?.playerPassingStatInfoList || []).filter((row) => Number(row.passAtt) > 0).map((row) => row.teamId))],
    ...(run.coverage?.missingWeeks?.includes(Number(week.weekIndex) + 1) ? {
      scheduleRows: games.filter((game) => Number(game.weekIndex) === Number(week.weekIndex)),
      statGames: [...new Map((week.passing?.playerPassingStatInfoList || []).map((row) => [String(row.teamId), { teamId: row.teamId, scheduleId: row.scheduleId, seasonIndex: row.seasonIndex, weekIndex: row.weekIndex, stageIndex: row.stageIndex }])).values()],
    } : {}),
    defenseTeams: [...new Set((week.defense?.playerDefensiveStatInfoList || []).filter((row) => ['defTotalTackles', 'defSacks', 'defInts', 'defPassDeflections'].some((field) => Number(row[field]) > 0)).map((row) => row.teamId))],
    ...(Number(week.weekIndex) === 0 ? { defenseFields: Object.keys(week.defense?.playerDefensiveStatInfoList?.[0] || {}) } : {}),
  }));
  console.log('[full-season] saved diagnostics', JSON.stringify({ leagueId, status: run.status, phase: getFranchisePhase(snapshot), coverage: run.coverage, seasonInfo: snapshot.info?.careerHubInfo?.seasonInfo, weeks }));
}
export async function resolveSyncMode({ guildId, snapshot, requestedMode = null }) {
  if (requestedMode !== null && !['weekly', 'full-season'].includes(requestedMode)) throw new Error('Choose weekly or full-season sync mode.');
  const run = await loadFullSeasonRun(guildId, snapshot.leagueId);
  const current = matchesFullSeason(run, snapshot) ? run : null;
  if (requestedMode === 'weekly' && current && current.status !== 'complete') {
    throw new Error('Full-season mode is active for this season. Use /sync mode:full-season to avoid issuing the same changes twice.');
  }
  return { mode: requestedMode || (current && current.status !== 'complete' ? 'full-season' : 'weekly'), run: current };
}
function baselineSnapshot(snapshot) {
  return structuredClone({ leagueId: snapshot.leagueId, syncId: snapshot.syncId, syncedAt: snapshot.syncedAt,
    currentWeek: snapshot.currentWeek, info: snapshot.info, season: snapshot.season, stage: snapshot.stage,
    teams: snapshot.teams, rosters: snapshot.rosters, weeklyStats: [], schedule: { schedules: [] } });
}
function regularSnapshot(snapshot, run) {
  return { ...snapshot, info: { ...snapshot.info, careerHubInfo: { ...snapshot.info?.careerHubInfo,
    seasonInfo: { ...snapshot.info?.careerHubInfo?.seasonInfo, calendarYear: Number(run.seasonKey.replace('year_', '')), seasonWeekType: 1 } } } };
}
async function processSeason({ client, guildId, snapshot, onProgress }) {
  let run = await loadFullSeasonRun(guildId, snapshot.leagueId);
  if (run && !matchesFullSeason(run, snapshot)) {
    if (run.status !== 'complete') throw new Error('A different season has an unfinished full-season run. Finish or review that run before starting another.');
    await archiveFullSeasonRun(run);
    run = null;
  }
  const phase = getFranchisePhase(snapshot);
  if (!run) {
    if (await hasIssuedSeasonWeeklyChanges(snapshot)) throw new Error('Weekly rating changes have already been issued for this season. Full-season mode cannot overlap them.');
    const starting = isStartingSeasonSnapshot(snapshot) ? snapshot : await findArchivedSeasonBaseline(snapshot);
    if (!starting) throw new Error('No starting baseline was found in this season’s saved preseason/Week 1 syncs. Full-season mode needs a complete starting roster from before regular-season games; playoff ratings cannot replace it.');
    run = { version: 1, guildId: String(guildId), leagueId: String(snapshot.leagueId), seasonKey: getMaddenSeasonKey(starting),
      identity: fullSeasonIdentity(starting), status: 'prepared', applicationMode: 'add_net',
      baseline: baselineSnapshot(starting), baselineSyncId: starting.syncId, preparedAt: new Date().toISOString(),
      ...(starting !== snapshot ? { recoveredBaseline: true, baselineSource: 'sync_history' } : {}),
      importedWeeks: {}, importedSchedule: [], weeks: {}, awardPosts: {} };
    await saveFullSeasonRun(run);
    if (starting !== snapshot) {
      console.log('[full-season] recovered starting baseline', { leagueId: run.leagueId, baselineSyncId: run.baselineSyncId, phase: getFranchisePhase(starting), currentWeek: starting.currentWeek });
      if (onProgress) await onProgress('Recovered starting ratings', 'Found your saved preseason/Week 1 sync. Continuing the season evaluation from those original ratings.');
    } else return { mode: 'full-season', status: run.status, published: false, recommendationCount: 0,
      reason: 'Full-season baseline saved. Simulate Weeks 1–18, then run /sync mode:full-season in the first playoff week.' };
  }
  if (run.recoveredBaseline && !run.calculationComplete && getFranchisePhase(run.baseline) === 'preseason') {
    const recovered = await findArchivedSeasonBaseline(snapshot);
    if (recovered && getFranchisePhase(recovered) === 'regular') {
      run.baseline = baselineSnapshot(recovered);
      run.baselineSyncId = recovered.syncId;
      await saveFullSeasonRun(run);
    }
  }
  if (run.status === 'complete') return { ...run.result, duplicate: true, reason: 'The season upgrade/downgrade cards are already posted in your team threads. Apply the targets once; playoff syncs use normal weekly progression.' };
  if (phase === 'preseason' || (phase === 'regular' && Number(snapshot.currentWeek) === 1)) return {
    mode: 'full-season', status: run.status, published: false, recommendationCount: 0,
    reason: 'Starting baseline is already saved. Simulate Weeks 1–18, then use full-season sync in the first playoff week. Optional checkpoint syncs preserve earlier stats.',
  };
  const cap = phase === 'regular' ? Math.min(17, Number(snapshot.currentWeek) - 2) : 17;
  const currentWeeks = (snapshot.weeklyStats || []).filter((entry) => Number(entry.weekIndex) <= cap);
  const merged = regularSeasonWeeks({ ...snapshot, weeklyStats: [...Object.values(run.importedWeeks), ...currentWeeks] });
  const schedule = new Map(run.importedSchedule.map((game) => [`${game.weekIndex}:${game.homeTeamId}:${game.awayTeamId}`, game]));
  const teamIds = new Set((snapshot.teams?.leagueTeamInfoList || []).map((team) => String(team.teamId)));
  for (const game of snapshot.schedule?.schedules || []) {
    if (!teamIds.has(String(game.homeTeamId)) || !teamIds.has(String(game.awayTeamId))) continue;
    if (Number(game.stageIndex ?? game.stage) === 1 && Number(game.weekIndex) >= 0 && Number(game.weekIndex) <= 17) {
      const key = `${game.weekIndex}:${game.homeTeamId}:${game.awayTeamId}`;
      if (!schedule.has(key) || Number(game.status) >= Number(schedule.get(key).status)) schedule.set(key, game);
    }
  }
  run.importedWeeks = merged;
  run.importedSchedule = [...schedule.values()];
  run.latestSyncId = snapshot.syncId;
  const regular = { ...regularSnapshot(snapshot, run), schedule: { schedules: run.importedSchedule }, weeklyStats: Object.values(merged) };
  run.coverage = seasonCoverage(regular, merged);
  console.log('[full-season] coverage', JSON.stringify({ leagueId: run.leagueId, phase, ...run.coverage }));
  if (phase === 'preseason' || phase === 'regular') {
    run.status = 'collecting';
    await saveFullSeasonRun(run);
    return { mode: 'full-season', status: run.status, published: false, recommendationCount: 0, coverage: run.coverage,
      reason: `Season data saved: ${run.coverage.completedWeeks}/18 complete weeks. Season upgrade/downgrade cards post in your existing team threads in the first playoff week.` };
  }
  if (phase !== 'playoffs') throw new Error('Full-season rating totals are delivered during playoffs, not offseason.');
  if (!run.coverage.complete) {
    run.status = 'awaiting_data';
    await saveFullSeasonRun(run);
    return { mode: 'full-season', status: run.status, published: false, recommendationCount: 0, coverage: run.coverage,
      reason: `Season totals are not ready. Missing/incomplete weeks: ${run.coverage.missingWeeks.join(', ')}. No weeks or changes were invented.` };
  }
  if (!run.calculationComplete) {
    const rules = readProgressionRules();
    if (onProgress) await onProgress('Calculating full season', 'Evaluating all 18 weeks in order and carrying earned attribute changes forward.');
    const replay = await replayFullSeason({ baseline: run.baseline, snapshot: regular, weeks: merged, rules,
      onWeek: onProgress ? async (week, record) => onProgress('Calculating full season', `Week ${week}/18: ${record.recommendations.filter((item) => item.direction === 'upgrade').length} upgrades, ${record.recommendations.filter((item) => item.direction === 'downgrade').length} downgrades; attribute points +${record.attributeTotals.positive}/−${record.attributeTotals.negative}.`) : null,
      computeAwards: async (view, week) => {
        const result = await updateAwards(null, run.leagueId, week, { guildId, snapshot: view, stage: 1, captureOnly: true, refreshProgression: false });
        if (!result.winners) throw new Error(`Week ${week} awards could not be calculated.`);
        return result.winners;
      } });
    run.weeks = replay.weeks;
    run.totals = replay.totals;
    run.unmatchedPlayers = replay.unmatchedPlayers;
    run.application = buildSeasonApplication({ totals: run.totals, baseline: run.baseline, snapshot, applicationMode: run.applicationMode });
    run.calculationComplete = true;
    run.finalSnapshotSyncId = snapshot.syncId;
    run.formula = rules;
    run.calculatedAt = new Date().toISOString();
    run.status = 'publishing';
    await saveFullSeasonRun(run);
  }
  if (onProgress) await onProgress('Posting weekly awards', 'Publishing one awards post for each of the 18 weeks; existing posts are not duplicated.');
  for (let week = 1; week <= 18; week++) {
    if (run.awardPosts[week]) continue;
    const view = { ...regular, currentWeek: week + 1, weeklyStats: Object.values(merged).filter((entry) => entry.weekIndex < week),
      schedule: { schedules: run.importedSchedule.filter((game) => Number(game.weekIndex) < week) } };
    const result = await publishWeeklyAwards({ client, guildId, snapshot: view, weekNumber: week, winnersOverride: run.weeks[week].awardWinners,
      dedupScope: `${run.seasonKey}_${run.identity.index ?? 'unknown'}_full` });
    if (!result.posted && !result.duplicate) throw new Error(`Week ${week} awards were not posted: ${result.reason || result.error || 'Unknown error'}`);
    run.awardPosts[week] = result.messageId || 'existing';
    await saveFullSeasonRun(run);
  }
  if (onProgress) await onProgress('Posting season upgrades and downgrades', 'Posting summed player attribute changes in your existing team threads. Apply each final target once.');
  const progression = await publishFullSeasonTotals({ client, guildId, snapshot, run });
  run.status = 'complete';
  run.completedAt = new Date().toISOString();
  run.result = { ...progression, mode: 'full-season', status: 'complete', awardsPosted: Object.keys(run.awardPosts).length,
    weeklyTallies: Object.values(run.weeks).map((week) => ({ weekNumber: week.weekNumber,
      upgrades: week.recommendations.filter((item) => item.direction === 'upgrade').length,
      downgrades: week.recommendations.filter((item) => item.direction === 'downgrade').length,
      attributeUpgrades: week.attributeTotals.positive, attributeDowngrades: week.attributeTotals.negative })),
    seasonTotals: { positivePoints: run.totals.positivePoints, negativePoints: run.totals.negativePoints,
      netPoints: run.totals.netPoints, upgradeEvents: run.totals.upgradeEvents, downgradeEvents: run.totals.downgradeEvents } };
  await saveFullSeasonRun(run);
  return run.result;
}
export async function runFullSeasonSync(options) {
  const key = `${options.guildId}:${options.snapshot.leagueId}`;
  const previous = queues.get(key) || Promise.resolve();
  const pending = previous.catch(() => {}).then(() => processSeason(options));
  queues.set(key, pending);
  try { return await pending; } finally { if (queues.get(key) === pending) queues.delete(key); }
}

// Resume only an explicitly requested season run affected by the stale-year bug.
// No baseline is armed and no unrelated league is synced by this repair.
export async function repairSavedFullSeasonSync(client, guildId) {
  const { resolveLeagueIdWithConfig, loadLeagueSnapshot } = await import('./madden_data.js');
  const leagueId = resolveLeagueIdWithConfig(guildId, 'full-season:season-repair');
  const snapshot = await loadLeagueSnapshot(leagueId);
  if (!snapshot || getFranchisePhase(snapshot) !== 'playoffs') return;
  const run = await loadFullSeasonRun(guildId, leagueId);
  if (!matchesFullSeason(run, snapshot) || run.status !== 'awaiting_data' || run.calculationComplete
    || !hasForeignSeasonStats(Object.values(run.importedWeeks || {}), snapshot)) return;
  console.log('[full-season] repairing stale-season imports', JSON.stringify({ leagueId, baselineSyncId: run.baselineSyncId }));
  const { runSync } = await import('./sync.js');
  const result = await runSync(leagueId, null, { client, guildId, mode: 'full-season',
    requestId: `season-isolation-repair-v1:${guildId}:${leagueId}:${run.baselineSyncId}` });
  console.log('[full-season] season repair result', JSON.stringify({ leagueId, fullSeason: result.fullSeason, progression: result.progression }));
}
