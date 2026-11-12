// EA uses global week numbers through the playoffs; some exports also expose
// an explicit phase. Keep preseason snapshots from reusing last year's stats.
export function getFranchisePhase(snapshot) {
  const info = snapshot?.info?.careerHubInfo?.seasonInfo || {};
  const raw = info.seasonWeekType ?? info.seasonWeekTypeId ?? snapshot?.seasonWeekType ?? snapshot?.stage;
  const phaseLabel = `${info.seasonTitle || ''} ${info.phase || ''} ${snapshot?.phase || ''}`;
  if (/off[ -]?season/i.test(phaseLabel)) return 'offseason';
  const type = raw == null ? null : Number(raw);
  if (/play[ -]?offs?|wild[ -]?card|divisional|conference championship|super[ -]?bowl|pro[ -]?bowl/i.test(phaseLabel)) return 'playoffs';
  if (type === 0) return 'preseason';
  if ([3, 8].includes(type) || (type !== 1 && type !== 2 &&
    (Number(info.offSeasonStage || 0) > 0 || /offseason/i.test(info.seasonTitle || '')))) return 'offseason';
  if (type === 2 || Number(snapshot?.currentWeek ?? info.displayWeek ?? 0) > 18) return 'playoffs';
  return 'regular';
}
