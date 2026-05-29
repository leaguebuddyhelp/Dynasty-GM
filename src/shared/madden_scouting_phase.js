export const REGULAR_SCOUT_POINTS = 60;
export const OFFSEASON_SCOUT_POINTS = 300;

function numeric(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getMaddenScoutingPhase(snapshot = null) {
  const seasonInfo = snapshot?.info?.careerHubInfo?.seasonInfo || {};
  const calendarYear = numeric(
    seasonInfo.calendarYear ?? snapshot?.info?.calendarYear ?? snapshot?.calendarYear,
    new Date().getFullYear(),
  );
  const currentWeek = numeric(snapshot?.currentWeek ?? seasonInfo.displayWeek ?? seasonInfo.week ?? 0, 0);
  const weekType = numeric(seasonInfo.seasonWeekType ?? seasonInfo.seasonWeekTypeId ?? seasonInfo.weekType ?? snapshot?.stage, null);
  const seasonTitle = String(seasonInfo.seasonTitle || '').toLowerCase();
  const offSeasonStage = numeric(seasonInfo.offSeasonStage, 0);

  const titleLooksPlayoff = seasonTitle.includes('playoff') || seasonTitle.includes('super bowl');
  const titleLooksOffseason = seasonTitle.includes('offseason') || seasonTitle.includes('off-season');
  const draftInactive =
    seasonInfo.isDraftActive === false &&
    seasonInfo.isLeagueStarted === true &&
    weekType !== 1;

  // Regular season must win over stale offseason metadata left in the export.
  if (weekType === 1 || (weekType == null && currentWeek >= 1 && currentWeek <= 18 && !titleLooksOffseason && !titleLooksPlayoff)) {
    return {
      kind: 'regular',
      label: `Regular Season Week ${Math.max(1, currentWeek)}`,
      open: currentWeek >= 1,
      calendarYear,
      currentWeek: Math.max(1, currentWeek),
      weekKey: `year_${calendarYear}_week_${Math.max(1, currentWeek)}`,
      baseAllowance: REGULAR_SCOUT_POINTS,
    };
  }

  if (weekType === 2 || titleLooksPlayoff) {
    return {
      kind: 'playoffs',
      label: 'Playoffs',
      open: false,
      calendarYear,
      currentWeek,
      weekKey: `year_${calendarYear}_playoffs_locked`,
      baseAllowance: 0,
    };
  }

  if (weekType === 3 || weekType === 8 || offSeasonStage > 0 || titleLooksOffseason || draftInactive) {
    return {
      kind: 'offseason',
      label: 'Offseason',
      open: true,
      calendarYear,
      currentWeek,
      weekKey: `year_${calendarYear}_offseason_total`,
      baseAllowance: OFFSEASON_SCOUT_POINTS,
    };
  }

  return {
    kind: 'preseason',
    label: 'Preseason',
    open: false,
    calendarYear,
    currentWeek,
    weekKey: `year_${calendarYear}_preseason_locked`,
    baseAllowance: 0,
  };
}
