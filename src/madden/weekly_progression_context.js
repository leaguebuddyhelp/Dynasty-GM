// Season production earns weekly priority and points; it never creates a
// separate season-end award or changes a player without current-game evidence.
export function seasonProductionReward({ position, games, averages, totals, seasonScore, policy }) {
  if (!policy || !Number.isFinite(seasonScore) || games < Number(policy.minimumGames) || seasonScore < Number(policy.minimumSeasonScore)) return null;
  for (const tier of policy.tiers || []) {
    const match = (tier.positions?.[position] || []).find((minimums) => Object.entries(minimums)
      .every(([field, minimum]) => Number.isFinite(averages[field]) && averages[field] >= Number(minimum)));
    if (match) return { label: tier.label, games, seasonScore, selectionBonus: Number(tier.selectionBonus),
      extraPoints: Number(tier.extraPoints), attributes: Number(tier.attributes),
      evidence: Object.fromEntries(Object.keys(match).map((field) => [field, totals[field]])) };
  }
  return null;
}

export function buildTeamFormContexts(snapshot, weekIndex, policy) {
  const result = new Map();
  if (!policy) return result;
  const games = new Map();
  const conflicts = new Set();
  for (const game of snapshot.schedule?.schedules || []) {
    const index = Number(game.weekIndex), stage = Number(game.stageIndex ?? game.stage);
    if (![1, 2].includes(stage) || !Number.isInteger(index) || index < 0 || index > weekIndex || (stage === 2 && index < 18)
      || !(Number(game.status) >= 2) || game.homeTeamId == null || game.awayTeamId == null) continue;
    const validScore = (score) => score != null && score !== '' && typeof score !== 'boolean' && Number.isFinite(Number(score)) && Number(score) >= 0;
    const scored = validScore(game.homeScore) && validScore(game.awayScore);
    const key = `${index}:${game.homeTeamId}:${game.awayTeamId}`;
    const row = { index, home: String(game.homeTeamId), away: String(game.awayTeamId), homeScore: scored ? Number(game.homeScore) : null, awayScore: scored ? Number(game.awayScore) : null };
    const old = games.get(key);
    if (old?.homeScore !== null && old?.homeScore !== undefined && !scored) continue;
    if (old?.homeScore != null && scored && (old.homeScore !== row.homeScore || old.awayScore !== row.awayScore)) conflicts.add(key);
    games.set(key, row);
  }
  const byTeam = new Map();
  for (const [key, game] of games) {
    const unknown = conflicts.has(key) || game.homeScore === null;
    for (const [teamId, scored, conceded] of [[game.home, game.homeScore, game.awayScore], [game.away, game.awayScore, game.homeScore]]) {
      const rows = byTeam.get(teamId) || [];
      rows.push({ index: game.index, win: unknown ? null : scored > conceded ? 1 : scored === conceded ? 0.5 : 0 });
      byTeam.set(teamId, rows);
    }
  }
  for (const [teamId, rows] of byTeam) {
    const recent = rows.sort((a, b) => a.index - b.index).slice(-Number(policy.recentGames));
    if (recent.length < Number(policy.minimumGames) || recent.some((game) => game.win === null)) continue;
    const winShare = recent.reduce((sum, game) => sum + game.win, 0) / recent.length;
    const multiplier = (share) => share === 1 && recent.length >= Number(policy.recentGames)
      ? Number(policy.streakMultiplier) : share >= Number(policy.minimumShare) ? Number(policy.formMultiplier) : 1;
    result.set(teamId, { games: recent.length, wins: recent.filter((game) => game.win === 1).length,
      losses: recent.filter((game) => game.win === 0).length,
      upgradeMultiplier: multiplier(winShare), downgradeMultiplier: multiplier(1 - winShare) });
  }
  return result;
}
