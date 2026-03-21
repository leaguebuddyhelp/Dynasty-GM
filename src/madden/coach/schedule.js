import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { loadLeagueSnapshot, currentWeek, requireLeagueIdForGuild } from '../../../madden/madden_data.js';
import { getFullTeamName } from '../../shared/madden_team_names.js';
import { loadWeeklyGameLog } from '../weekly_game_log.js';
import { coachCommandDescription } from '../../shared/madden_coach_voice.js';
export const data = new SlashCommandBuilder()
  .setName('schedule')
  .setDescription(coachCommandDescription('schedule'));

function buildTeamMaps(snapshot) {
  const names = new Map();
  const byId = new Map();
  for (const team of snapshot?.teams?.leagueTeamInfoList || []) {
    const fullName = getFullTeamName(team, `Team ${team.teamId}`);
    names.set(Number(team.teamId), fullName);
    byId.set(Number(team.teamId), team);
  }
  return { names, byId };
}

function standingsMap(snapshot) {
  const map = new Map();
  for (const standing of snapshot?.standings?.teamStandingInfoList || []) {
    map.set(Number(standing.teamId), standing);
  }
  return map;
}

function formatRecord(standing) {
  if (!standing) return '0-0';
  const wins = Number(standing.totalWins || 0);
  const losses = Number(standing.totalLosses || 0);
  const ties = Number(standing.totalTies || 0);
  return ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

function teamShortName(teamName = '') {
  const parts = String(teamName || '').trim().split(/\s+/);
  return parts[parts.length - 1] || teamName || 'Team';
}

function labelForTeam(teamName) {
  return teamShortName(teamName);
}

function regularSeasonGames(snapshot) {
  return (snapshot?.schedule?.schedules || [])
    .filter((game) => Number(game?.stageIndex ?? game?.stage ?? -1) === 1)
    .slice()
    .sort((a, b) => Number(a.weekIndex ?? 0) - Number(b.weekIndex ?? 0) || Number(a.scheduleId ?? 0) - Number(b.scheduleId ?? 0));
}

function totalRegularWeeks(snapshot) {
  const weeks = regularSeasonGames(snapshot).map((game) => Number(game.weekIndex ?? -1));
  return weeks.length ? Math.max(...weeks) + 1 : 18;
}

function weekGames(snapshot, weekIndex) {
  return regularSeasonGames(snapshot).filter((game) => Number(game.weekIndex ?? -1) === Number(weekIndex));
}

function latestCompletedRegularWeekIndex(snapshot) {
  const weeks = (snapshot?.weeklyStats || [])
    .filter((week) => Number(week?.stage ?? week?.stageIndex ?? 0) === 1)
    .map((week) => Number(week?.weekIndex ?? -1))
    .filter((week) => week >= 0);
  return weeks.length ? Math.max(...weeks) : -1;
}

function gameStatus(game) {
  const status = Number(game?.status ?? 0);
  if (status >= 2) return 'played';
  if (status === 1) return 'scheduled';
  return 'upcoming';
}

function inferredGameStatus(snapshot, game) {
  const explicit = gameStatus(game);
  if (explicit === 'played') return 'played';
  const latestCompleted = latestCompletedRegularWeekIndex(snapshot);
  const weekIndex = Number(game?.weekIndex ?? -1);
  if (weekIndex >= 0 && weekIndex <= latestCompleted) return 'played_inferred';
  return explicit;
}

function ledgerEntryForGame(ledger, game) {
  return ledger?.games?.find((entry) =>
    String(entry?.scheduleId || '') === String(game?.scheduleId || '')
  ) || null;
}

function playerName(row) {
  return row?.fullName || row?.displayName || `${row?.firstName || ''} ${row?.lastName || ''}`.trim() || 'Unknown';
}

function teamWeeklyTotals(snapshot, weekIndex, teamId) {
  const weekEntries = (snapshot?.weeklyStats || []).filter((week) =>
    Number(week?.weekIndex ?? -1) === Number(weekIndex) &&
    Number(week?.stage ?? week?.stageIndex ?? 0) === 1
  );
  const weekly = weekEntries.sort((a, b) => Number(b?.playerCount || 0) - Number(a?.playerCount || 0))[0];
  if (!weekly) return null;

  const sum = (list, fields) => {
    const out = {};
    for (const row of list || []) {
      if (Number(row?.teamId) !== Number(teamId)) continue;
      for (const field of fields) out[field] = (out[field] || 0) + Number(row?.[field] || 0);
    }
    return out;
  };

  // Team-level weekly totals aren't always present/consistent in exports.
  // Our most reliable per-game totals are simply summing *all* player stat rows for that team
  // (starters + backups). We'll use teamstats only as a fallback for missing categories.
  const teamstats = (weekly?.teamstats?.teamStatInfoList || []).find((row) => Number(row?.teamId) === Number(teamId)) || null;

  const passingFromPlayers = sum(weekly?.passing?.playerPassingStatInfoList, ['passYds', 'passTDs', 'passInts', 'passComp', 'passAtt']);
  const rushingFromPlayers = sum(weekly?.rushing?.playerRushingStatInfoList, ['rushYds', 'rushTDs', 'rushAtt']);
  const receivingFromPlayers = sum(weekly?.receiving?.playerReceivingStatInfoList, ['recYds', 'recTDs', 'recCatches']);

  const passing = {
    passYds: Number(passingFromPlayers?.passYds || 0),
    passTDs: Number(passingFromPlayers?.passTDs || 0),
    passInts: Number(passingFromPlayers?.passInts || 0),
    passComp: Number(passingFromPlayers?.passComp || 0),
    passAtt: Number(passingFromPlayers?.passAtt || 0),
  };

  const rushing = {
    rushYds: Number(rushingFromPlayers?.rushYds || 0),
    rushTDs: Number(rushingFromPlayers?.rushTDs || 0),
    rushAtt: Number(rushingFromPlayers?.rushAtt || 0),
  };

  // Receiving totals aren't always needed for the box score, but they're useful for leader lines.
  // Prefer summed receiver yards; if for some reason it's missing, fall back to pass yards.
  const receiving = {
    recYds: Number(receivingFromPlayers?.recYds || 0) || passing.passYds,
    recTDs: Number(receivingFromPlayers?.recTDs || 0) || passing.passTDs,
    recCatches: Number(receivingFromPlayers?.recCatches || 0) || Number(teamstats?.receptions ?? teamstats?.recCatches ?? 0),
  };

  // Keep defense aggregation from player list (teamstats isn't always consistent for sacks/ints).
  const defense = sum(weekly?.defense?.playerDefensiveStatInfoList, ['defSacks', 'defInts', 'defTotalTackles', 'defPassDeflections']);

  const best = (list, scoreFn) =>
    (list || [])
      .filter((row) => Number(row?.teamId) === Number(teamId))
      .slice()
      .sort((a, b) => scoreFn(b) - scoreFn(a))[0] || null;

  return {
    passing,
    rushing,
    receiving,
    defense,
    teamstats,
    kicking: sum(weekly?.kicking?.playerKickingStatInfoList, ['fGMade', 'xPMade']),
    passer: best(weekly?.passing?.playerPassingStatInfoList, (row) => Number(row?.passYds || 0)),
    rusher: best(weekly?.rushing?.playerRushingStatInfoList, (row) => Number(row?.rushYds || 0)),
    receiver: best(weekly?.receiving?.playerReceivingStatInfoList, (row) => Number(row?.recYds || 0)),
    defender: best(
      weekly?.defense?.playerDefensiveStatInfoList,
      (row) => (Number(row?.defSacks || 0) * 5) + (Number(row?.defInts || 0) * 6) + Number(row?.defTotalTackles || 0),
    ),
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

function gameDisplayScores(snapshot, game, leagueId = null) {
  const ledger = loadWeeklyGameLog(leagueId);
  const logged = ledgerEntryForGame(ledger, game);
  if (logged && (Number(logged.awayScore || 0) > 0 || Number(logged.homeScore || 0) > 0)) {
    return {
      awayScore: Number(logged.awayScore || 0),
      homeScore: Number(logged.homeScore || 0),
      inferred: String(logged.scoreSource || '') !== 'schedule',
    };
  }
  const explicitAway = Number(game?.awayScore || 0);
  const explicitHome = Number(game?.homeScore || 0);
  // Madden exports sometimes mark a game as "played" but still show 0-0 for CPU-simmed results.
  // In that case, fall back to weekly export stats (or the weekly game log inference).
  if (Number(game?.status ?? 0) >= 2 && explicitAway === 0 && explicitHome === 0) {
    const weekIndex = Number(game?.weekIndex ?? -1);
    const awayTotals = teamWeeklyTotals(snapshot, weekIndex, Number(game?.awayTeamId));
    const homeTotals = teamWeeklyTotals(snapshot, weekIndex, Number(game?.homeTeamId));
    const awayScore = inferredPoints(awayTotals);
    const homeScore = inferredPoints(homeTotals);
    if (awayScore !== null && homeScore !== null) {
      return { awayScore, homeScore, inferred: true };
    }
    // As a last resort, if the weekly game log has an inferred score, use it.
    if (logged && (Number(logged.awayScore || 0) > 0 || Number(logged.homeScore || 0) > 0)) {
      return {
        awayScore: Number(logged.awayScore || 0),
        homeScore: Number(logged.homeScore || 0),
        inferred: true,
      };
    }
  }
  if (explicitAway > 0 || explicitHome > 0 || Number(game?.status ?? 0) >= 2) {
    return { awayScore: explicitAway, homeScore: explicitHome, inferred: false };
  }
  const weekIndex = Number(game?.weekIndex ?? -1);
  const awayTotals = teamWeeklyTotals(snapshot, weekIndex, Number(game?.awayTeamId));
  const homeTotals = teamWeeklyTotals(snapshot, weekIndex, Number(game?.homeTeamId));
  const awayScore = inferredPoints(awayTotals);
  const homeScore = inferredPoints(homeTotals);
  if (awayScore === null || homeScore === null) return null;
  return { awayScore, homeScore, inferred: true };
}

function formatMatchupContext(awayLabel, awayRecord, homeLabel, homeRecord) {
  return `${awayLabel} (${awayRecord}) @ ${homeLabel} (${homeRecord})`;
}

function winnerFlagsForScore(scoreView) {
  if (!scoreView) return { awayFlag: '', homeFlag: '', awayWon: null, homeWon: null };
  const away = Number(scoreView.awayScore ?? 0);
  const home = Number(scoreView.homeScore ?? 0);
  if (!Number.isFinite(away) || !Number.isFinite(home)) return { awayFlag: '', homeFlag: '', awayWon: null, homeWon: null };
  // Avoid marking unplayed 0-0 games as ties.
  if (away === 0 && home === 0) return { awayFlag: '', homeFlag: '', awayWon: null, homeWon: null };
  if (away === home) return { awayFlag: '(T)', homeFlag: '(T)', awayWon: false, homeWon: false };
  const awayWon = away > home;
  return {
    awayFlag: awayWon ? '(W)' : '(L)',
    homeFlag: awayWon ? '(L)' : '(W)',
    awayWon,
    homeWon: !awayWon,
  };
}

function formatResultContext({ status, scoreView, ledgerEntry }) {
  if (status === 'played' || status === 'played_inferred') {
    if (scoreView) {
      const away = Number(scoreView.awayScore || 0);
      const home = Number(scoreView.homeScore || 0);
      // Madden exports can mark games played but still show 0-0 when no reliable score is present.
      // Don't present that as a final.
      if (away === 0 && home === 0) return 'Upcoming';
      return `Final: ${away}-${home}`;
    }
    return 'Final logged';
  }
  if (status === 'played_special') {
    return `Outcome: ${ledgerEntry?.outcomeLabel || 'Result Logged'}`;
  }
  return 'Upcoming';
}

function compactGameLine(snapshot, game, names, standings, ledger = null) {
  const awayId = Number(game.awayTeamId);
  const homeId = Number(game.homeTeamId);
  const awayName = names.get(awayId) || 'Away';
  const homeName = names.get(homeId) || 'Home';
  const awayLabel = labelForTeam(awayName);
  const homeLabel = labelForTeam(homeName);
  const awayRecord = formatRecord(standings.get(awayId));
  const homeRecord = formatRecord(standings.get(homeId));
  const ledgerEntry = ledgerEntryForGame(ledger, game);
  const status = ledgerEntry?.played ? (ledgerEntry?.outcomeLabel ? 'played_special' : 'played') : inferredGameStatus(snapshot, game);
  const scoreView = gameDisplayScores(snapshot, game, null);

  const { awayFlag, homeFlag, awayWon, homeWon } = winnerFlagsForScore(
    ['played', 'played_inferred'].includes(status) ? scoreView : null,
  );

  const awaySide = `${awayLabel} ${awayFlag} (${awayRecord})`;
  const homeSide = `${homeLabel} ${homeFlag} (${homeRecord})`;
  const matchup = (awayWon === true)
    ? `**${awaySide}** @ ${homeSide}`
    : (homeWon === true)
      ? `${awaySide} @ **${homeSide}**`
      : `${awaySide} @ ${homeSide}`;
  const result = formatResultContext({ status, scoreView, ledgerEntry });
  return `${matchup} • ${result}`;
}

function weekMenuOptions(totalWeeks, selectedWeek) {
  return Array.from({ length: totalWeeks }, (_, index) => ({
    label: `Week ${index + 1}`,
    value: String(index),
    default: index === Number(selectedWeek),
  })).slice(0, 25);
}

function getScheduleLeaguePhaseLabel(snapshot) {
  const liveWeek = Number(currentWeek(snapshot) || 1);
  if (!Number.isFinite(liveWeek) || liveWeek <= 0) return 'Week 1';
  if (liveWeek >= 1 && liveWeek <= 18) return `Week ${liveWeek}`;
  if (liveWeek === 19) return 'Wild Card';
  if (liveWeek === 20) return 'Divisional Round';
  if (liveWeek === 21) return 'Conference Championship';
  if (liveWeek >= 22) return 'Super Bowl';
  return `Week ${liveWeek}`;
}

export function buildScheduleWeekView(snapshot, weekIndex, leagueId = null) {
  const ledger = loadWeeklyGameLog(leagueId);
  const { names } = buildTeamMaps(snapshot);
  const standings = standingsMap(snapshot);
  const totalWeeks = totalRegularWeeks(snapshot);
  const clampedWeek = Math.max(0, Math.min(totalWeeks - 1, Number(weekIndex || 0)));
  const snapshotGames = weekGames(snapshot, clampedWeek);
  const ledgerGames = (ledger?.games || []).filter((entry) =>
    Number(entry?.stageIndex ?? 0) === 1 &&
    Number(entry?.weekIndex ?? -1) === clampedWeek
  );
  const games = snapshotGames.map((game) => {
    const logged = ledgerEntryForGame(ledger, game);
    return logged ? {
      ...game,
      awayScore: logged.awayScore,
      homeScore: logged.homeScore,
      status: logged.played ? 2 : game.status,
    } : game;
  });
  const current = Math.max(1, Number(currentWeek(snapshot) || 1));
  const playedGames = games.filter((game) => {
    const ledgerEntry = ledgerEntryForGame(ledger, game);
    if (ledgerEntry?.played) return true;
    return ['played', 'played_inferred'].includes(inferredGameStatus(snapshot, game));
  });

  const embed = new EmbedBuilder()
    .setColor(0x00b0f4)
    .setTitle(`Madden Schedule — Week ${clampedWeek + 1}`)
    .setDescription(
      games.length
        ? games.map((game) => compactGameLine(snapshot, game, names, standings, ledger)).join('\n')
        : (ledgerGames.length
          ? ledgerGames.map((game) => compactGameLine(snapshot, game, names, standings, ledger)).join('\n')
          : 'No regular-season games found for this week.'),
    )
    .setFooter({ text: `Regular season only • current league phase: ${getScheduleLeaguePhaseLabel(snapshot)}` });

  const weekRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('madden_schedule_page')
      .setPlaceholder(`Week ${clampedWeek + 1}`)
      .addOptions(weekMenuOptions(totalWeeks, clampedWeek)),
  );

  const gameRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`madden_schedule_game|${clampedWeek}`)
      .setPlaceholder(playedGames.length ? 'View Game Stats' : 'No played games this week')
      .setDisabled(!playedGames.length)
      .addOptions(
        (playedGames.length ? playedGames : games.slice(0, 1)).map((game) => {
          const awayName = names.get(Number(game.awayTeamId)) || 'Away';
          const homeName = names.get(Number(game.homeTeamId)) || 'Home';
          const scoreView = gameDisplayScores(snapshot, game, leagueId);
          const awayScore = scoreView?.awayScore ?? Number(game.awayScore || 0);
          const homeScore = scoreView?.homeScore ?? Number(game.homeScore || 0);
          const label = playedGames.length
            ? `${teamShortName(awayName)} ${awayScore} vs ${homeScore} ${teamShortName(homeName)}`
            : 'No played games';
          return {
            label: label.slice(0, 100),
            value: String(game.scheduleId || `${clampedWeek}:${game.awayTeamId}:${game.homeTeamId}`),
          };
        }),
      ),
  );

  return { embed, components: [gameRow, weekRow], weekIndex: clampedWeek };
}

function teamTotalsLine(totals) {
  if (!totals) return 'No weekly stat export found for this game.';
  const passYds = Number(totals?.passing?.passYds || 0);
  const rushYds = Number(totals?.rushing?.rushYds || 0);
  const totalYds = passYds + rushYds;
  return [
    `Pass ${passYds} yds`,
    `Rush ${rushYds} yds`,
    `Total ${totalYds} yds`,
    `TO ${Number(totals.passing?.passInts || 0)}`,
    `Sacks ${Number(totals.defense?.defSacks || 0)}`,
  ].join(' • ');
}

function playerStatLine(row, type) {
  if (!row) return 'No stat line';
  if (type === 'pass') return `${playerName(row)} • ${Number(row.passYds || 0)} yds • ${Number(row.passTDs || 0)} TD • ${Number(row.passInts || 0)} INT`;
  if (type === 'rush') return `${playerName(row)} • ${Number(row.rushYds || 0)} yds • ${Number(row.rushTDs || 0)} TD`;
  if (type === 'rec') return `${playerName(row)} • ${Number(row.recYds || 0)} yds • ${Number(row.recTDs || 0)} TD`;
  return `${playerName(row)} • ${Number(row.defTotalTackles || 0)} tk • ${Number(row.defSacks || 0)} sacks • ${Number(row.defInts || 0)} INT`;
}

export function buildGameDetailView(snapshot, weekIndex, scheduleId, leagueId = null) {
  const ledger = loadWeeklyGameLog(leagueId);
  const { names } = buildTeamMaps(snapshot);
  const standings = standingsMap(snapshot);
  const games = weekGames(snapshot, weekIndex);
  const game = games.find((entry) => String(entry.scheduleId || `${weekIndex}:${entry.awayTeamId}:${entry.homeTeamId}`) === String(scheduleId));
  if (!game) return null;

  const awayId = Number(game.awayTeamId);
  const homeId = Number(game.homeTeamId);
  const awayName = names.get(awayId) || 'Away';
  const homeName = names.get(homeId) || 'Home';
  const awayLabel = labelForTeam(awayName);
  const homeLabel = labelForTeam(homeName);
  const awayRecord = formatRecord(standings.get(awayId));
  const homeRecord = formatRecord(standings.get(homeId));
  const awayTotals = teamWeeklyTotals(snapshot, weekIndex, awayId);
  const homeTotals = teamWeeklyTotals(snapshot, weekIndex, homeId);
  const scoreView = gameDisplayScores(snapshot, game, leagueId);
  const awayScore = scoreView?.awayScore ?? Number(game.awayScore || 0);
  const homeScore = scoreView?.homeScore ?? Number(game.homeScore || 0);
  const ledgerEntry = ledgerEntryForGame(ledger, game);
  const status = ledgerEntry?.played ? (ledgerEntry?.outcomeLabel ? 'played_special' : 'played') : inferredGameStatus(snapshot, game);
  const matchupLine = formatMatchupContext(awayLabel, awayRecord, homeLabel, homeRecord);
  const resultLine = formatResultContext({ status, scoreView, ledgerEntry });

  const awayScoreNum = Number(awayScore || 0);
  const homeScoreNum = Number(homeScore || 0);
  const awayTotalYds = Number(awayTotals?.passing?.passYds || 0) + Number(awayTotals?.rushing?.rushYds || 0);
  const homeTotalYds = Number(homeTotals?.passing?.passYds || 0) + Number(homeTotals?.rushing?.rushYds || 0);
  const awayTO = Number(awayTotals?.passing?.passInts || 0);
  const homeTO = Number(homeTotals?.passing?.passInts || 0);
  const awaySacks = Number(awayTotals?.defense?.defSacks || 0);
  const homeSacks = Number(homeTotals?.defense?.defSacks || 0);

  const boxTop = [
    '```',
    `${teamShortName(awayName).padEnd(12)} ${String(awayScoreNum).padStart(3)}   |   ${String(homeScoreNum).padStart(3)} ${teamShortName(homeName)}`,
    `${'TOTAL YDS'.padEnd(12)} ${String(awayTotalYds).padStart(3)}   |   ${String(homeTotalYds).padStart(3)} ${'TOTAL YDS'}`,
    `${'PASS'.padEnd(12)} ${String(Number(awayTotals?.passing?.passYds || 0)).padStart(3)}   |   ${String(Number(homeTotals?.passing?.passYds || 0)).padStart(3)} ${'PASS'}`,
    `${'RUSH'.padEnd(12)} ${String(Number(awayTotals?.rushing?.rushYds || 0)).padStart(3)}   |   ${String(Number(homeTotals?.rushing?.rushYds || 0)).padStart(3)} ${'RUSH'}`,
    `${'TURNOVERS'.padEnd(12)} ${String(awayTO).padStart(3)}   |   ${String(homeTO).padStart(3)} ${'TURNOVERS'}`,
    `${'SACKS'.padEnd(12)} ${String(awaySacks).padStart(3)}   |   ${String(homeSacks).padStart(3)} ${'SACKS'}`,
    '```',
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(0x00b0f4)
    .setTitle(`Week ${weekIndex + 1} — Game Stats`)
    .setDescription([
      matchupLine,
      resultLine,
      '',
      '🏟️ **Box Score**',
      boxTop,
    ].filter(Boolean).join('\n'))
    .addFields(
      {
        name: teamShortName(awayName),
        value: [
          '📊 **Team totals**',
          teamTotalsLine(awayTotals),
          '',
          '⭐ **Leaders**',
          `QB: ${playerStatLine(awayTotals?.passer, 'pass')}`,
          `RB: ${playerStatLine(awayTotals?.rusher, 'rush')}`,
          `WR: ${playerStatLine(awayTotals?.receiver, 'rec')}`,
          `DEF: ${playerStatLine(awayTotals?.defender, 'def')}`,
        ].join('\n'),
      },
      {
        name: teamShortName(homeName),
        value: [
          '📊 **Team totals**',
          teamTotalsLine(homeTotals),
          '',
          '⭐ **Leaders**',
          `QB: ${playerStatLine(homeTotals?.passer, 'pass')}`,
          `RB: ${playerStatLine(homeTotals?.rusher, 'rush')}`,
          `WR: ${playerStatLine(homeTotals?.receiver, 'rec')}`,
          `DEF: ${playerStatLine(homeTotals?.defender, 'def')}`,
        ].join('\n'),
      },
    )
    .setFooter({ text: 'Pulled from weekly export stats' });

  const components = [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`madden_schedule_game|${weekIndex}`)
        .setPlaceholder('View Game Stats')
        .addOptions(
          weekGames(snapshot, weekIndex)
            .filter((entry) => {
              const logged = ledgerEntryForGame(ledger, entry);
              if (logged?.played) return true;
              return ['played', 'played_inferred'].includes(inferredGameStatus(snapshot, entry));
            })
            .map((entry) => {
              const away = names.get(Number(entry.awayTeamId)) || 'Away';
              const home = names.get(Number(entry.homeTeamId)) || 'Home';
              const scoreView = gameDisplayScores(snapshot, entry, leagueId);
              return {
                label: `${teamShortName(away)} ${scoreView?.awayScore ?? Number(entry.awayScore || 0)} vs ${scoreView?.homeScore ?? Number(entry.homeScore || 0)} ${teamShortName(home)}`.slice(0, 100),
                value: String(entry.scheduleId || `${weekIndex}:${entry.awayTeamId}:${entry.homeTeamId}`),
                default: String(entry.scheduleId || `${weekIndex}:${entry.awayTeamId}:${entry.homeTeamId}`) === String(scheduleId),
              };
            }),
        ),
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('madden_schedule_page')
        .setPlaceholder(`Week ${weekIndex + 1}`)
        .addOptions(weekMenuOptions(totalRegularWeeks(snapshot), weekIndex)),
    ),
  ];

  return { embed, components };
}

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const leagueId = requireLeagueIdForGuild(interaction.guildId);
    const snapshot = loadLeagueSnapshot(leagueId);
    const initialWeek = Math.max(0, Math.min(totalRegularWeeks(snapshot) - 1, Number(currentWeek(snapshot) || 1) - 1));
    const view = buildScheduleWeekView(snapshot, initialWeek, leagueId);
    await interaction.editReply({ embeds: [view.embed], components: view.components });
  } catch (err) {
    await interaction.editReply({ content: `Failed to load schedule: ${err.message}` });
  }
}

export default { data, execute };
