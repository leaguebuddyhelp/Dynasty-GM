export function getMaddenSeasonCalendarYear(snapshotOrLeague = null) {
  const seasonInfo = snapshotOrLeague?.info?.careerHubInfo?.seasonInfo || {};
  const calendarYear = Number(
    seasonInfo?.calendarYear
    ?? snapshotOrLeague?.info?.calendarYear
    ?? snapshotOrLeague?.calendarYear
    ?? 0
  );
  return Number.isFinite(calendarYear) && calendarYear > 0 ? calendarYear : null;
}

export function getMaddenSeasonOrdinal(snapshotOrLeague = null) {
  const seasonInfo = snapshotOrLeague?.info?.careerHubInfo?.seasonInfo || {};
  const seasonOrdinal = Number(
    seasonInfo?.seasonYear
    ?? snapshotOrLeague?.info?.seasonYear
    ?? snapshotOrLeague?.seasonYear
    ?? 0
  );
  return Number.isFinite(seasonOrdinal) && seasonOrdinal >= 0 ? seasonOrdinal : null;
}

export function getMaddenDraftClassNumber(snapshotOrLeague = null) {
  const calendarYear = getMaddenSeasonCalendarYear(snapshotOrLeague);
  if (calendarYear && calendarYear >= 2026) {
    return Math.max(1, calendarYear - 2025);
  }

  const seasonOrdinal = getMaddenSeasonOrdinal(snapshotOrLeague);
  if (seasonOrdinal == null) return 1;
  if (seasonOrdinal <= 0) return 1;
  return seasonOrdinal;
}

export function getMaddenDraftClassId(snapshotOrLeague = null) {
  return `cus_${String(getMaddenDraftClassNumber(snapshotOrLeague)).padStart(2, '0')}`;
}
