// EA uses global week numbers through the playoffs; some exports also expose
// an explicit phase. Keep preseason snapshots from reusing last year's stats.
export function getFranchisePhase(snapshot) {
  const info = snapshot?.info?.careerHubInfo?.seasonInfo || {};
  const raw = info.seasonWeekType ?? info.seasonWeekTypeId ?? snapshot?.stage;
  const type = raw == null ? null : Number(raw);
  if (type === 0) return 'preseason';
  if ([3, 8].includes(type) || (type !== 1 && type !== 2 &&
    (Number(info.offSeasonStage || 0) > 0 || /offseason/i.test(info.seasonTitle || '')))) return 'offseason';
  if (type === 2 || Number(snapshot?.currentWeek ?? info.displayWeek ?? 0) > 18) return 'playoffs';
  return 'regular';
}
