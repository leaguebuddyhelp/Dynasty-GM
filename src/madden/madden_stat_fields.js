export const MADDEN_STAT_FIELD_ALIASES = Object.freeze({
  fumbles: ['rushFum'],
  defForcedFumbles: ['defForcedFum'],
  defRecoveredFumbles: ['defFumRec'],
  defPassDeflections: ['defDeflections'],
  fg50PlusAtt: ['fG50PlusAtt'],
  fg50PlusMade: ['fG50PlusMade'],
  fgAtt: ['fGAtt'],
  fgCompPct: ['fGCompPct'],
  fgLongest: ['fGLongest'],
  fgMade: ['fGMade'],
  xpAtt: ['xPAtt'],
  xpCompPct: ['xPCompPct'],
  xpMade: ['xPMade'],
  pntAtt: ['puntAtt'],
  pntInside20: ['puntsIn20'],
  pntLongest: ['puntLongest'],
  pntNetYds: ['puntNetYds'],
  pntNetYdsPerAtt: ['puntNetYdsPerAtt'],
  pntTBs: ['puntTBs'],
  pntYds: ['puntYds'],
  pntYdsPerAtt: ['puntYdsPerAtt'],
});

const ALIAS_TO_CANONICAL = new Map(
  Object.entries(MADDEN_STAT_FIELD_ALIASES)
    .flatMap(([canonical, aliases]) => aliases.map((alias) => [alias, canonical])),
);

export function normalizeMaddenStatField(field) {
  return ALIAS_TO_CANONICAL.get(String(field)) || String(field);
}

export function getMaddenStatValue(row, field) {
  const canonical = normalizeMaddenStatField(field);
  for (const candidate of [canonical, ...(MADDEN_STAT_FIELD_ALIASES[canonical] || [])]) {
    if (row?.[candidate] !== null && row?.[candidate] !== undefined) return row[candidate];
  }
  return undefined;
}

export default { getMaddenStatValue, normalizeMaddenStatField };
