import { positionThreadKey } from './position_reports.js';
import { hasForeignSeasonStats } from './season_stat_isolation.js';

const number = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const rowsFor = (week, teamId) => [...week.values()].filter((row) => !row.missingTeamId
  && row.observedTeamIds?.size === 1 && row.observedTeamIds.has(teamId));
function sumComplete(rows, volume, fields) {
  if (rows.some((row) => number(row.totals[volume]) === null && fields.some((field) => row.totals[field] != null))) return null;
  const selected = rows.filter((row) => number(row.totals[volume]) !== null && row.totals[volume] > 0);
  const valid = (field, value) => typeof value === 'number' && Number.isFinite(value)
    && (['rushYds', 'passYds'].includes(field) || value >= 0);
  if (!selected.length || selected.some((row) => fields.some((field) => !valid(field, row.totals[field])))) return null;
  return Object.fromEntries(fields.map((field) => [field, selected.reduce((sum, row) => sum + row.totals[field], 0)]));
}

// Save who was actually observed as a projected starter on this sync. Later
// promotions/trades cannot inherit another player's past unit observations.
export function buildDefensiveLineProxy({ snapshot, players, byWeek, weekIndex, seasonKey, history, policy }) {
  const observations = {}, declines = new Map();
  if (!policy?.enabled) return { observations, declines };
  const sourceWeeks = (snapshot.weeklyStats || []).filter((week) => Number(week.weekIndex) === weekIndex
    && [1, 2].includes(Number(week.stage ?? week.stageIndex)));
  if (hasForeignSeasonStats(sourceWeeks, snapshot)) return { observations, declines };
  const opponents = new Map(), conflicts = new Set();
  const teams = new Set(players.map((p) => String(p.teamId)));
  for (const game of snapshot.schedule?.schedules || []) {
    const stage = Number(game.stageIndex ?? game.stage);
    if (![1, 2].includes(stage) || Number(game.weekIndex) !== weekIndex || !(Number(game.status) >= 2)) continue;
    const home = String(game.homeTeamId), away = String(game.awayTeamId);
    if (!teams.has(home) || !teams.has(away) || home === away) continue;
    for (const [team, opponent] of [[home, away], [away, home]]) {
      if (opponents.has(team) && opponents.get(team) !== opponent) conflicts.add(team);
      opponents.set(team, opponent);
    }
  }
  const week = byWeek.get(weekIndex) || new Map();
  const units = new Map();
  for (const [team, opponent] of opponents) {
    if (conflicts.has(team)) continue;
    const rows = rowsFor(week, opponent);
    const rush = sumComplete(rows, 'rushAtt', ['rushAtt', 'rushYds']);
    const pass = sumComplete(rows, 'passAtt', ['passAtt', 'passYds', 'passSacks']);
    const runQualified = rush && rush.rushAtt >= policy.minimumRushAttempts;
    const passQualified = pass && pass.passAtt >= policy.minimumPassAttempts;
    if (!runQualified && !passQualified) continue;
    units.set(team, {
      opponent, rushAttempts: runQualified ? rush.rushAtt : null,
      allowedYpc: runQualified ? rush.rushYds / rush.rushAtt : null,
      passAttempts: passQualified ? pass.passAtt : null,
      allowedYpa: passQualified ? pass.passYds / pass.passAtt : null,
      sacks: passQualified ? pass.passSacks : null,
      sackRate: passQualified ? pass.passSacks / (pass.passAtt + pass.passSacks) : null,
      poorRun: Boolean(runQualified && rush.rushYds / rush.rushAtt >= policy.minimumPoorYpc),
      poorPass: Boolean(passQualified && pass.passYds / pass.passAtt >= policy.minimumPoorYpa && pass.passSacks <= policy.maximumPoorPassSacks
        && pass.passSacks / (pass.passAtt + pass.passSacks) <= policy.maximumPoorSackRate),
    });
  }
  const slots = new Map();
  for (const player of players) {
    const position = positionThreadKey(player.position);
    if (!['LEDG', 'REDG', 'DT'].includes(position) || player.ovr === null || Number(player.injuryLength || 0) > 0) continue;
    const slot = `${player.teamId}:${position}`, list = slots.get(slot) || [];
    list.push(player); slots.set(slot, list);
  }
  for (const list of slots.values()) {
    list.sort((a, b) => b.ovr - a.ovr || a.key.localeCompare(b.key));
    const position = positionThreadKey(list[0].position);
    for (const player of list.slice(0, position === 'DT' ? 2 : 1)) {
      const row = week.get(player.key), unit = units.get(String(player.teamId));
      if (!row || !unit || row.missingTeamId || row.observedTeamIds?.size !== 1 || !row.observedTeamIds.has(String(player.teamId))) continue;
      if (row.observedPositions?.size && ![...row.observedPositions].every((p) => positionThreadKey(p) === position)) continue;
      const stats = row.totals;
      const bigFields = ['defSacks', 'defInts', 'defForcedFumbles', 'defRecoveredFumbles', 'defSafeties', 'defTDs', 'defPassDeflections'];
      if (number(stats.defTotalTackles) === null || (stats.defTotalTackles < policy.minimumObservedTackles && !bigFields.some((field) => number(stats[field]) > 0))) continue;
      const quiet = stats.defTotalTackles <= policy.maximumQuietTackles && bigFields.every((field) => number(stats[field]) === 0);
      const observation = { teamId: String(player.teamId), position, quiet, ...unit };
      observations[player.key] = observation;
      if (!quiet || stats.defTotalTackles < policy.minimumCurrentTackles) continue;
      const sample = Object.values(history.periods || {}).filter((period) => period.type === 'weekly'
        && period.seasonKey === seasonKey && Number.isInteger(period.weekIndex) && period.weekIndex >= 0 && period.weekIndex < weekIndex)
        .map((period) => ({ index: period.weekIndex, row: period.defensiveLineProxyObservations?.[player.key] }))
        .filter(({ row }) => row?.teamId === String(player.teamId) && row.position === position);
      const unique = new Map(sample.map(({ index, row }) => [index, row]));
      unique.set(weekIndex, observation);
      if (unique.size < policy.minimumObservedGames) continue;
      const runGames = [...unique.values()].filter((p) => p.quiet && p.poorRun).length;
      const passGames = [...unique.values()].filter((p) => p.quiet && p.poorPass).length;
      const run = unit.poorRun && runGames >= policy.minimumPoorGames;
      const passRush = unit.poorPass && passGames >= policy.minimumPoorGames;
      if (!run && !passRush) continue;
      const kind = run && (!passRush || runGames >= passGames) ? 'runDefense' : 'passRush';
      declines.set(player.key, { type: 'defensiveLineUnit', kind, games: unique.size,
        poorGames: kind === 'runDefense' ? runGames : passGames, ...unit,
        attributes: kind === 'runDefense' ? ['Block Shedding', 'Pursuit'] : ['Power Moves', 'Finesse Moves'] });
    }
  }
  return { observations, declines };
}
