export const WEEKLY_RECOGNITION_CHALLENGES = [
  {
    key: 'air_show',
    title: 'Challenge: Air Show',
    line: 'Any coach with a 325+ passing yard game gets +1 Impact. A rookie QB doing it gets +2.',
  },
  {
    key: 'ground_control',
    title: 'Challenge: Ground Control',
    line: '150+ team rushing yards earns +1 Impact. A rookie with 100+ rushing yards earns +2.',
  },
  {
    key: 'turnover_chain',
    title: 'Challenge: Turnover Chain',
    line: 'Force 3+ turnovers for +1 Impact. A defensive player with 2 takeaways earns +2.',
  },
  {
    key: 'yardage_avalanche',
    title: 'Challenge: Yardage Avalanche',
    line: '450+ total team yards earns +1 Impact. 550+ total yards earns +2.',
  },
  {
    key: 'rookie_spotlight',
    title: 'Challenge: Rookie Spotlight',
    line: 'Any rookie with 100+ scrimmage yards, 2 TD, or a defensive takeaway earns +2 Impact.',
  },
  {
    key: 'award_multiplier',
    title: 'Challenge: Award Multiplier',
    line: 'Weekly award winners pay double Impact this advance, up to +4 total for the week.',
  },
];

export function getWeeklyRecognitionChallenge(weekNumber) {
  const index = Math.max(0, Number(weekNumber || 1) - 1) % WEEKLY_RECOGNITION_CHALLENGES.length;
  return WEEKLY_RECOGNITION_CHALLENGES[index];
}

export function formatWeeklyRecognitionChallenge({ weekNumber, featuredGame = null }) {
  const challenge = getWeeklyRecognitionChallenge(weekNumber);
  const gotw = featuredGame
    ? `GOTW bonus stays live: ${featuredGame.awayTeam} vs ${featuredGame.homeTeam} winner gets double Impact.`
    : 'GOTW bonus sets when a featured matchup is available.';
  return `**${challenge.title}**\n${challenge.line}\n${gotw}`;
}

function rosterLookup(snapshot = null) {
  const lookup = new Map();
  const addList = (list = []) => {
    for (const player of list || []) {
      if (player?.rosterId === undefined || player?.rosterId === null) continue;
      lookup.set(String(player.rosterId), player);
    }
  };
  for (const roster of Object.values(snapshot?.rosters?.teams || {})) {
    addList(roster?.rosterInfoList || roster?.rosterPlayerInfoList || []);
  }
  addList(snapshot?.rosters?.freeAgents?.rosterInfoList || snapshot?.rosters?.freeAgents || []);
  return lookup;
}

function isRookieStat(player = null, lookup = new Map()) {
  if (!player) return false;
  const rosterMatch = player.rosterId !== undefined && player.rosterId !== null
    ? lookup.get(String(player.rosterId))
    : null;
  if (player.isRookie === true || rosterMatch?.isRookie === true) return true;
  const yearsPro = player.yearsPro ?? rosterMatch?.yearsPro;
  return yearsPro !== undefined && yearsPro !== null && Number(yearsPro) === 0;
}

function positionOf(player = null, lookup = new Map()) {
  const rosterMatch = player?.rosterId !== undefined && player?.rosterId !== null
    ? lookup.get(String(player.rosterId))
    : null;
  return String(player?.position || player?.displayPos || rosterMatch?.position || '').toUpperCase();
}

function teamKey(teamId) {
  const numeric = Number(teamId);
  return Number.isFinite(numeric) ? String(numeric) : null;
}

function addTeamAward(awards, coachIndex, teamId, amount, reason, awardKey) {
  const ids = coachIndex?.resolveByTeam?.(teamId, null) || [];
  for (const userId of ids) {
    awards.push({
      userId: String(userId),
      amount,
      reason,
      awardKey,
    });
  }
}

function teamTotalsFromWeekly(weeklyStats = null) {
  const totals = new Map();
  const ensure = (teamId) => {
    const key = teamKey(teamId);
    if (!key) return null;
    if (!totals.has(key)) {
      totals.set(key, {
        teamId: Number(teamId),
        passYds: 0,
        rushYds: 0,
        forcedTurnovers: 0,
      });
    }
    return totals.get(key);
  };
  for (const player of weeklyStats?.passing?.playerPassingStatInfoList || []) {
    const row = ensure(player.teamId);
    if (!row) continue;
    row.passYds += Number(player.passYds || 0);
  }
  for (const player of weeklyStats?.rushing?.playerRushingStatInfoList || []) {
    const row = ensure(player.teamId);
    if (!row) continue;
    row.rushYds += Number(player.rushYds || 0);
  }
  for (const player of weeklyStats?.defense?.playerDefensiveStatInfoList || []) {
    const row = ensure(player.teamId);
    if (!row) continue;
    row.forcedTurnovers += Number(player.defInts || 0)
      + Number(player.defRecoveredFumbles || 0);
  }
  return totals;
}

function weeklyPlayerRows(weeklyStats = null, lookup = new Map()) {
  const rows = new Map();
  const ensure = (player) => {
    const id = player?.rosterId ?? player?.id ?? player?.playerId ?? player?.playerName ?? player?.fullName;
    if (id === undefined || id === null) return null;
    const key = String(id);
    if (!rows.has(key)) {
      rows.set(key, {
        ...player,
        passYds: 0,
        passTDs: 0,
        rushYds: 0,
        rushTDs: 0,
        recYds: 0,
        recTDs: 0,
        defInts: 0,
        defForcedFumbles: 0,
        defRecoveredFumbles: 0,
      });
    }
    const row = rows.get(key);
    row.teamId = row.teamId ?? player.teamId;
    row.position = row.position || positionOf(player, lookup);
    row.isRookie = row.isRookie || isRookieStat(player, lookup);
    return row;
  };
  for (const player of weeklyStats?.passing?.playerPassingStatInfoList || []) {
    const row = ensure(player);
    if (!row) continue;
    row.passYds += Number(player.passYds || 0);
    row.passTDs += Number(player.passTDs || 0);
  }
  for (const player of weeklyStats?.rushing?.playerRushingStatInfoList || []) {
    const row = ensure(player);
    if (!row) continue;
    row.rushYds += Number(player.rushYds || 0);
    row.rushTDs += Number(player.rushTDs || 0);
  }
  for (const player of weeklyStats?.receiving?.playerReceivingStatInfoList || []) {
    const row = ensure(player);
    if (!row) continue;
    row.recYds += Number(player.recYds || 0);
    row.recTDs += Number(player.recTDs || 0);
  }
  for (const player of weeklyStats?.defense?.playerDefensiveStatInfoList || []) {
    const row = ensure(player);
    if (!row) continue;
    row.defInts += Number(player.defInts || 0);
    row.defForcedFumbles += Number(player.defForcedFumbles || 0);
    row.defRecoveredFumbles += Number(player.defRecoveredFumbles || 0);
  }
  return [...rows.values()];
}

export function evaluateWeeklyRecognitionChallenge({
  weekNumber,
  snapshot = null,
  weeklyStats = null,
  leagueAwards = {},
  coachIndex = null,
  weeklyAwardPointValue = 1,
}) {
  const challenge = getWeeklyRecognitionChallenge(weekNumber);
  const awards = [];
  const lookup = rosterLookup(snapshot);
  const teamTotals = teamTotalsFromWeekly(weeklyStats);
  const players = weeklyPlayerRows(weeklyStats, lookup);
  const weekKey = `week_${Number(weekNumber || 0)}`;

  if (challenge.key === 'air_show') {
    for (const player of players) {
      if (Number(player.passYds || 0) < 325) continue;
      const rookieQb = player.isRookie && positionOf(player, lookup) === 'QB';
      addTeamAward(
        awards,
        coachIndex,
        player.teamId,
        rookieQb ? 2 : 1,
        rookieQb ? 'Weekly challenge bonus: rookie QB Air Show' : 'Weekly challenge bonus: Air Show passing game',
        `challenge:${challenge.key}:${weekKey}:${player.rosterId || player.id || player.teamId}`,
      );
    }
  }

  if (challenge.key === 'ground_control') {
    for (const row of teamTotals.values()) {
      if (Number(row.rushYds || 0) >= 150) {
        addTeamAward(awards, coachIndex, row.teamId, 1, 'Weekly challenge bonus: Ground Control team rushing', `challenge:${challenge.key}:${weekKey}:team:${row.teamId}`);
      }
    }
    for (const player of players) {
      if (!player.isRookie || Number(player.rushYds || 0) < 100) continue;
      addTeamAward(awards, coachIndex, player.teamId, 2, 'Weekly challenge bonus: rookie 100-yard rushing game', `challenge:${challenge.key}:${weekKey}:rookie:${player.rosterId || player.id || player.teamId}`);
    }
  }

  if (challenge.key === 'turnover_chain') {
    for (const row of teamTotals.values()) {
      if (Number(row.forcedTurnovers || 0) >= 3) {
        addTeamAward(awards, coachIndex, row.teamId, 1, 'Weekly challenge bonus: Turnover Chain team defense', `challenge:${challenge.key}:${weekKey}:team:${row.teamId}`);
      }
    }
    for (const player of players) {
      const takeaways = Number(player.defInts || 0) + Number(player.defRecoveredFumbles || 0);
      if (takeaways < 2) continue;
      addTeamAward(awards, coachIndex, player.teamId, 2, 'Weekly challenge bonus: defender with 2 takeaways', `challenge:${challenge.key}:${weekKey}:defender:${player.rosterId || player.id || player.teamId}`);
    }
  }

  if (challenge.key === 'yardage_avalanche') {
    for (const row of teamTotals.values()) {
      const yards = Number(row.passYds || 0) + Number(row.rushYds || 0);
      const amount = yards >= 550 ? 2 : yards >= 450 ? 1 : 0;
      if (amount > 0) {
        addTeamAward(awards, coachIndex, row.teamId, amount, 'Weekly challenge bonus: Yardage Avalanche', `challenge:${challenge.key}:${weekKey}:team:${row.teamId}`);
      }
    }
  }

  if (challenge.key === 'rookie_spotlight') {
    for (const player of players) {
      if (!player.isRookie) continue;
      const scrimmage = Number(player.rushYds || 0) + Number(player.recYds || 0);
      const touchdowns = Number(player.passTDs || 0) + Number(player.rushTDs || 0) + Number(player.recTDs || 0);
      const takeaways = Number(player.defInts || 0) + Number(player.defRecoveredFumbles || 0);
      if (scrimmage < 100 && touchdowns < 2 && takeaways < 1) continue;
      addTeamAward(awards, coachIndex, player.teamId, 2, 'Weekly challenge bonus: Rookie Spotlight', `challenge:${challenge.key}:${weekKey}:rookie:${player.rosterId || player.id || player.teamId}`);
    }
  }

  if (challenge.key === 'award_multiplier') {
    const byUser = new Map();
    for (const award of Object.values(leagueAwards?.[String(weekNumber)] || {})) {
      if (!award) continue;
      const ids = coachIndex?.resolveByTeam?.(award.teamId, award.teamName || award.team) || [];
      for (const userId of ids) {
        const key = String(userId);
        byUser.set(key, Math.min(2, Number(byUser.get(key) || 0) + Number(weeklyAwardPointValue || 1)));
      }
    }
    for (const [userId, amount] of byUser.entries()) {
      awards.push({
        userId,
        amount,
        reason: 'Weekly challenge bonus: Award Multiplier',
        awardKey: `challenge:${challenge.key}:${weekKey}:${userId}`,
      });
    }
  }

  const capped = new Map();
  for (const award of awards) {
    const key = `${award.userId}:${award.awardKey}`;
    if (!capped.has(key)) capped.set(key, award);
  }
  return [...capped.values()];
}
