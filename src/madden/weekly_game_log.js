import { getMaddenDataFilePath } from '../leaguebuddy/paths.js';
import fs from 'fs';
import path from 'path';
import { getFullTeamName } from '../shared/madden_team_names.js';

const WEEKLY_GAME_LOG_PATH = getMaddenDataFilePath('weekly_game_log.json');

function safeReadJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function normalizeName(name = '') {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function latestCompletedRegularWeekIndex(snapshot) {
  const weeks = (snapshot?.weeklyStats || [])
    .filter((week) => Number(week?.stage ?? week?.stageIndex ?? 0) === 1)
    .map((week) => Number(week?.weekIndex ?? -1))
    .filter((week) => week >= 0);
  return weeks.length ? Math.max(...weeks) : -1;
}

function latestCompletedWeekIndexByStage(snapshot, stageIndex) {
  const weeks = (snapshot?.weeklyStats || [])
    .filter((week) => Number(week?.stage ?? week?.stageIndex ?? 0) === Number(stageIndex))
    .map((week) => Number(week?.weekIndex ?? -1))
    .filter((week) => week >= 0);
  return weeks.length ? Math.max(...weeks) : -1;
}

function sumTeamFields(list, teamId, fields) {
  const out = {};
  for (const row of list || []) {
    if (Number(row?.teamId) !== Number(teamId)) continue;
    for (const field of fields) out[field] = (out[field] || 0) + Number(row?.[field] || 0);
  }
  return out;
}

function teamWeeklyTotals(snapshot, stageIndex, weekIndex, teamId) {
  const weekly = (snapshot?.weeklyStats || []).find((week) =>
    Number(week?.weekIndex ?? -1) === Number(weekIndex) &&
    Number(week?.stage ?? week?.stageIndex ?? 0) === Number(stageIndex)
  );
  if (!weekly) return null;
  return {
    passing: sumTeamFields(weekly?.passing?.playerPassingStatInfoList, teamId, ['passTDs']),
    rushing: sumTeamFields(weekly?.rushing?.playerRushingStatInfoList, teamId, ['rushTDs']),
    defense: sumTeamFields(weekly?.defense?.playerDefensiveStatInfoList, teamId, ['defTDs', 'defSafeties']),
    kicking: sumTeamFields(weekly?.kicking?.playerKickingStatInfoList, teamId, ['fGMade', 'xPMade']),
    teamstats: (weekly?.teamstats?.teamStatInfoList || []).find((row) => Number(row?.teamId) === Number(teamId)) || null,
  };
}

function inferredPoints(totals) {
  if (!totals) return null;
  const passingTds = Number(totals?.passing?.passTDs || 0);
  const rushingTds = Number(totals?.rushing?.rushTDs || 0);
  const defensiveTds = Number(totals?.defense?.defTDs || 0);
  const fieldGoals = Number(totals?.kicking?.fGMade || 0);
  const patMade = Number(totals?.kicking?.xPMade || 0);
  const safeties = Number(totals?.defense?.defSafeties || 0);
  const twoPoint = Number(totals?.teamstats?.off2PtConv || 0);
  return ((passingTds + rushingTds + defensiveTds) * 6) + (fieldGoals * 3) + patMade + (safeties * 2) + (twoPoint * 2);
}

function stageLabel(stageIndex, weekIndex) {
  const stage = Number(stageIndex);
  const week = Number(weekIndex);
  if (stage === 1) return `Week ${week + 1}`;
  if (stage === 2) {
    if (week === 18) return 'Wild Card';
    if (week === 19) return 'Divisional';
    if (week === 20) return 'Conference Championship';
    if (week === 22) return 'Super Bowl';
    return `Playoffs ${week + 1}`;
  }
  return `Stage ${stage} Week ${week + 1}`;
}

export function updateWeeklyGameLog(leagueId, snapshot) {
  if (!leagueId || !snapshot) return null;
  const all = safeReadJSON(WEEKLY_GAME_LOG_PATH, {});
  const teamsById = new Map(
    (snapshot?.teams?.leagueTeamInfoList || []).map((team) => [Number(team.teamId), getFullTeamName(team, `Team ${team.teamId}`)]),
  );
  const latestCompletedWeek = latestCompletedRegularWeekIndex(snapshot);
  const games = (snapshot?.schedule?.schedules || [])
    .filter((game) => Number(game?.stageIndex ?? game?.stage ?? -1) >= 1)
    .map((game) => {
      const stageIndex = Number(game?.stageIndex ?? game?.stage ?? -1);
      const weekIndex = Number(game?.weekIndex ?? -1);
      const awayTeam = teamsById.get(Number(game?.awayTeamId)) || 'Away';
      const homeTeam = teamsById.get(Number(game?.homeTeamId)) || 'Home';
      const schedulePlayed = Number(game?.status ?? 0) >= 2 || Number(game?.homeScore || 0) > 0 || Number(game?.awayScore || 0) > 0;
      const latestCompletedForStage = latestCompletedWeekIndexByStage(snapshot, stageIndex);
      const statsAvailable = weekIndex >= 0 && weekIndex <= latestCompletedForStage;
      const awayTotals = statsAvailable ? teamWeeklyTotals(snapshot, stageIndex, weekIndex, Number(game?.awayTeamId)) : null;
      const homeTotals = statsAvailable ? teamWeeklyTotals(snapshot, stageIndex, weekIndex, Number(game?.homeTeamId)) : null;
      const inferredAwayScore = inferredPoints(awayTotals);
      const inferredHomeScore = inferredPoints(homeTotals);
      const explicitAwayScore = Number(game?.awayScore || 0);
      const explicitHomeScore = Number(game?.homeScore || 0);
      return {
        scheduleId: game?.scheduleId ?? null,
        stageIndex,
        stageLabel: stageLabel(stageIndex, weekIndex),
        weekIndex,
        awayTeamId: Number(game?.awayTeamId),
        homeTeamId: Number(game?.homeTeamId),
        awayTeam,
        homeTeam,
        scheduleStatus: Number(game?.status ?? 0),
        awayScore: explicitAwayScore || inferredAwayScore || 0,
        homeScore: explicitHomeScore || inferredHomeScore || 0,
        scoreSource: explicitAwayScore || explicitHomeScore || schedulePlayed ? 'schedule' : (statsAvailable ? 'weekly_stats' : null),
        played: schedulePlayed || statsAvailable,
        statsAvailable,
      };
    });

  all[String(leagueId)] = {
    leagueId: String(leagueId),
    updatedAt: Date.now(),
    latestCompletedWeek,
    latestCompletedWeekByStage: {
      1: latestCompletedWeek,
      2: latestCompletedWeekIndexByStage(snapshot, 2),
    },
    games,
  };

  fs.mkdirSync(path.dirname(WEEKLY_GAME_LOG_PATH), { recursive: true });
  fs.writeFileSync(WEEKLY_GAME_LOG_PATH, JSON.stringify(all, null, 2));
  return all[String(leagueId)];
}

export function loadWeeklyGameLog(leagueId) {
  const all = safeReadJSON(WEEKLY_GAME_LOG_PATH, {});
  return all?.[String(leagueId)] || null;
}
