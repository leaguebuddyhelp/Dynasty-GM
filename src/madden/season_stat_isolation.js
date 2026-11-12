// EA reuses team/player IDs across franchise years. A larger cached export
// must never override a smaller current-season week (especially bye weeks).
export function franchiseSeasonIndex(snapshot) {
  const info = snapshot?.info?.careerHubInfo?.seasonInfo || snapshot || {};
  const raw = info.seasonIndex ?? info.seasonYear ?? snapshot?.season;
  return raw != null && raw !== '' && Number.isInteger(Number(raw)) ? Number(raw) : null;
}
export function belongsToSeason(row, seasonIndex) {
  return seasonIndex === null || row?.seasonIndex == null || Number(row.seasonIndex) === seasonIndex;
}
export function isolateSeasonStats(entries, snapshot) {
  const seasonIndex = franchiseSeasonIndex(snapshot);
  return (entries || []).filter((entry) => belongsToSeason(entry, seasonIndex)).map((entry) => {
    const isolated = { ...entry };
    for (const [key, value] of Object.entries(entry)) {
      if (Array.isArray(value)) isolated[key] = value.filter((row) => belongsToSeason(row, seasonIndex));
      else if (value && typeof value === 'object') isolated[key] = Object.fromEntries(Object.entries(value)
        .map(([list, rows]) => [list, Array.isArray(rows) ? rows.filter((row) => belongsToSeason(row, seasonIndex)) : rows]));
    }
    return isolated;
  });
}
export function hasForeignSeasonStats(entries, snapshot) {
  const seasonIndex = franchiseSeasonIndex(snapshot);
  if (seasonIndex === null) return false;
  return (entries || []).some((entry) => !belongsToSeason(entry, seasonIndex) || Object.values(entry).some((value) =>
    Array.isArray(value) ? value.some((row) => !belongsToSeason(row, seasonIndex))
      : value && typeof value === 'object' && Object.values(value).some((rows) => Array.isArray(rows) && rows.some((row) => !belongsToSeason(row, seasonIndex)))));
}
