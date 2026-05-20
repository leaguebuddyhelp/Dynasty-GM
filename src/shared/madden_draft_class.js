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
  const rawSeasonOrdinal =
    seasonInfo?.seasonYear
    ?? snapshotOrLeague?.info?.seasonYear
    ?? snapshotOrLeague?.seasonYear
    ?? null;
  if (rawSeasonOrdinal == null || rawSeasonOrdinal === '') return null;
  const seasonOrdinal = Number(rawSeasonOrdinal);
  return Number.isFinite(seasonOrdinal) && seasonOrdinal >= 0 ? seasonOrdinal : null;
}

export function getMaddenDraftClassNumber(snapshotOrLeague = null) {
  const seasonOrdinal = getMaddenSeasonOrdinal(snapshotOrLeague);
  if (seasonOrdinal != null) return Math.max(1, seasonOrdinal + 1);

  const calendarYear = getMaddenSeasonCalendarYear(snapshotOrLeague);
  if (calendarYear && calendarYear >= 2025) {
    return Math.max(1, calendarYear - 2025);
  }

  return 1;
}

export function getMaddenDraftClassId(snapshotOrLeague = null) {
  return `cus_${String(getMaddenDraftClassNumber(snapshotOrLeague)).padStart(2, '0')}`;
}

export function getMaddenDraftYear(snapshotOrLeague = null) {
  return 2025 + getMaddenDraftClassNumber(snapshotOrLeague);
}

export function getMaddenSeasonSpanLabel(snapshotOrLeague = null) {
  const draftYear = getMaddenDraftYear(snapshotOrLeague);
  return `${draftYear - 1}/${draftYear}`;
}

export function formatMaddenDraftClassLock(snapshotOrLeague = null) {
  const classId = getMaddenDraftClassId(snapshotOrLeague).replace('_', '').toUpperCase();
  const draftYear = getMaddenDraftYear(snapshotOrLeague);
  return `Season ${draftYear - 1}/${draftYear} -> ${classId} -> ${draftYear} Draft`;
}
