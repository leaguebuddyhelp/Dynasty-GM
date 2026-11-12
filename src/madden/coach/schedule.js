import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { loadLeagueSnapshot, currentWeek, requireLeagueIdForGuild } from '../madden_data.js';
import { getMessageForWeek } from '../madden_utils.js';
import { getFullTeamName } from '../../shared/madden_team_names.js';
import { formatTeamLabelWithEmoji } from '../../shared/madden_visuals.js';
import { loadWeeklyGameLog } from '../weekly_game_log.js';
import { commandDescription } from '../../shared/madden_voice.js';
export const data = new SlashCommandBuilder()
  .setName('schedule')
  .setDescription(commandDescription('schedule'));

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
  return formatTeamLabelWithEmoji(teamName);
}

function snapshotSeasonInfo(snapshot) {
  return snapshot?.info?.careerHubInfo?.seasonInfo || {};
}

function scheduleEntries(snapshot) {
  return snapshot?.schedule?.schedules || [];
}

function gameWeekIndex(game) {
  return Number(game?.weekIndex ?? game?.week ?? -1);
}

function gameStageIndex(game) {
  return Number(game?.stageIndex ?? game?.stage ?? -1);
}

function gameSeasonIndex(game) {
  return Number(game?.seasonIndex ?? game?.seasonId ?? NaN);
}

function currentSeasonIndex(snapshot, phase = null) {
  const seasonInfo = snapshotSeasonInfo(snapshot);
  const explicit = Number(seasonInfo?.seasonIndex);
  const activePhase = phase || currentSchedulePhase(snapshot);
  const allGames = scheduleEntries(snapshot);
  const targetWeekIndex = Math.max(0, Number(activePhase?.currentWeekValue || 1) - 1);
  const phaseMatches = allGames.filter((game) => {
    const weekIndex = gameWeekIndex(game);
    const stage = gameStageIndex(game);
    if (weekIndex !== targetWeekIndex) return false;
    if (activePhase?.kind === 'preseason') return stage === 0;
    if (activePhase?.kind === 'playoffs') return stage === 2 || (stage === 1 && weekIndex >= 18);
    if (activePhase?.kind === 'regular') return stage === 1 && weekIndex >= 0 && weekIndex <= 17;
    return false;
  });
  const matchedSeasonIndexes = phaseMatches
    .map((game) => gameSeasonIndex(game))
    .filter((value) => Number.isFinite(value));
  if (matchedSeasonIndexes.length) return Math.max(...matchedSeasonIndexes);
  if (Number.isFinite(explicit) && allGames.some((game) => gameSeasonIndex(game) === explicit)) return explicit;
  const seasonIndexes = allGames
    .map((game) => gameSeasonIndex(game))
    .filter((value) => Number.isFinite(value));
  return seasonIndexes.length ? Math.max(...seasonIndexes) : null;
}

function currentSeasonGames(snapshot, phase = null) {
  const targetSeasonIndex = currentSeasonIndex(snapshot, phase);
  const allGames = scheduleEntries(snapshot);
  if (targetSeasonIndex === null) return allGames;
  const matches = allGames.filter((game) => gameSeasonIndex(game) === targetSeasonIndex);
  return matches.length ? matches : allGames;
}

function currentSchedulePhase(snapshot) {
  const seasonInfo = snapshotSeasonInfo(snapshot);
  const stage = Number(seasonInfo.seasonWeekType ?? seasonInfo.seasonWeekTypeId ?? snapshot?.stage ?? 1);
  const offSeasonStage = Number(seasonInfo.offSeasonStage ?? 0) || 0;
  const displayWeekRaw = Number(
    seasonInfo.displayWeek
    ?? snapshot?.currentWeek
    ?? seasonInfo.seasonWeek
    ?? 1,
  );
  const currentWeekValue = Number.isFinite(displayWeekRaw) && displayWeekRaw > 0 ? displayWeekRaw : 1;
  const draftInactive = seasonInfo.isDraftActive === false && seasonInfo.isLeagueStarted === true && stage !== 1;
  const allGames = scheduleEntries(snapshot);
  const currentWeekIndex = Math.max(0, currentWeekValue - 1);
  const preseasonEvidence = allGames.some((game) =>
    gameWeekIndex(game) === currentWeekIndex && gameStageIndex(game) === 0
  );
  const regularEvidence = allGames.some((game) =>
    gameWeekIndex(game) === currentWeekIndex && gameStageIndex(game) === 1 && currentWeekIndex <= 17
  );
  const playoffEvidence = allGames.some((game) =>
    gameWeekIndex(game) === currentWeekIndex && (gameStageIndex(game) === 2 || (gameStageIndex(game) === 1 && currentWeekIndex >= 18))
  );

  if (stage === 0 || (currentWeekValue <= 3 && preseasonEvidence && !regularEvidence)) {
    return { kind: 'preseason', stage, offSeasonStage, currentWeekValue };
  }
  if ((stage === 1 && currentWeekValue >= 1 && currentWeekValue <= 18 && regularEvidence) || (regularEvidence && !preseasonEvidence && !playoffEvidence)) {
    return { kind: 'regular', stage: 1, offSeasonStage: 0, currentWeekValue };
  }
  if (stage === 2 || currentWeekValue >= 19 || playoffEvidence) {
    return { kind: 'playoffs', stage: 2, offSeasonStage: 0, currentWeekValue };
  }
  if (offSeasonStage > 0 || stage === 3 || stage === 8 || draftInactive) {
    return { kind: 'offseason', stage, offSeasonStage, currentWeekValue };
  }
  return { kind: 'regular', stage: 1, offSeasonStage, currentWeekValue };
}

function phaseWeekLabel(kind, weekIndex) {
  if (kind === 'preseason') return `Preseason Week ${Number(weekIndex) + 1}`;
  if (kind === 'playoffs') return getMessageForWeek(Number(weekIndex) + 1, 2, 0);
  return `Week ${Number(weekIndex) + 1}`;
}

function phaseFooterLabel(snapshot) {
  const phase = currentSchedulePhase(snapshot);
  if (phase.kind === 'preseason') return `Preseason Week ${Math.max(1, Number(phase.currentWeekValue || 1))}`;
  if (phase.kind === 'playoffs') return getMessageForWeek(Number(phase.currentWeekValue || 19), 2, 0);
  if (phase.kind === 'offseason') return `Offseason Stage ${phase.offSeasonStage || 1}`;
  return `Week ${Math.max(1, Number(phase.currentWeekValue || 1))}`;
}

function gamesForPhase(snapshot, kind = 'regular') {
  const phase = currentSchedulePhase(snapshot);
  return currentSeasonGames(snapshot, phase)
    .filter((game) => {
      const stage = gameStageIndex(game);
      const weekIndex = gameWeekIndex(game);
      if (kind === 'preseason') return stage === 0;
      if (kind === 'playoffs') return stage === 2 || (stage === 1 && weekIndex >= 18);
      if (kind === 'regular') return stage === 1 && weekIndex >= 0 && weekIndex <= 17;
      return false;
    })
    .slice()
    .sort((a, b) => Number(a.weekIndex ?? 0) - Number(b.weekIndex ?? 0) || Number(a.scheduleId ?? 0) - Number(b.scheduleId ?? 0));
}

function totalWeeksForPhase(snapshot, kind = 'regular') {
  const weeks = gamesForPhase(snapshot, kind).map((game) => Number(game.weekIndex ?? -1));
  return weeks.length ? Math.max(...weeks) + 1 : (kind === 'preseason' ? 4 : kind === 'regular' ? 18 : 23);
}

function phaseWeekGames(snapshot, kind, weekIndex) {
  return gamesForPhase(snapshot, kind).filter((game) => Number(game.weekIndex ?? -1) === Number(weekIndex));
}

function latestCompletedWeekIndexForStage(snapshot, stage) {
  const phase = currentSchedulePhase(snapshot);
  const weeks = (snapshot?.weeklyStats || [])
    .filter((week) => Number(week?.stage ?? week?.stageIndex ?? 0) === Number(stage))
    .map((week) => Number(week?.weekIndex ?? -1))
    .filter((week) => week >= 0);
  const latest = weeks.length ? Math.max(...weeks) : -1;
  if (stage === 0) {
    const cap = phase.kind === 'preseason' ? Math.max(-1, Number(phase.currentWeekValue || 1) - 2) : 3;
    return Math.min(latest, cap);
  }
  if (stage === 1) {
    const cap = phase.kind === 'regular'
      ? Math.max(-1, Number(phase.currentWeekValue || 1) - 2)
      : 17;
    return Math.min(latest, cap);
  }
  if (stage === 2) {
    const cap = phase.kind === 'playoffs'
      ? Math.max(-1, Number(phase.currentWeekValue || 19) - 2)
      : latest;
    return Math.min(latest, cap);
  }
  return latest;
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
  const stage = Number(game?.stageIndex ?? game?.stage ?? 1);
  const latestCompleted = latestCompletedWeekIndexForStage(snapshot, stage);
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

function phaseMenuOptions(snapshot, kind, selectedWeek) {
  const weeks = [...new Set(gamesForPhase(snapshot, kind).map((game) => Number(game.weekIndex ?? -1)).filter((week) => week >= 0))]
    .sort((a, b) => a - b);
  return weeks.map((weekIndex) => ({
    label: phaseWeekLabel(kind, weekIndex),
    value: `${kind}:${weekIndex}`,
    default: weekIndex === Number(selectedWeek),
  })).slice(0, 25);
}

function scheduleTimelineOptions(snapshot, selectedKind, selectedWeek) {
  const phaseOrder = ['preseason', 'regular', 'playoffs'];
  const options = [];
  for (const kind of phaseOrder) {
    const weeks = [...new Set(gamesForPhase(snapshot, kind).map((game) => gameWeekIndex(game)).filter((week) => week >= 0))]
      .sort((a, b) => a - b);
    for (const weekIndex of weeks) {
      options.push({
        label: phaseWeekLabel(kind, weekIndex),
        value: `${kind}:${weekIndex}`,
        default: kind === selectedKind && weekIndex === Number(selectedWeek),
      });
    }
  }
  return options.slice(0, 25);
}

function fallbackSelectOption(label, value = 'none') {
  return [{ label: label.slice(0, 100), value }];
}

export function buildScheduleWeekView(snapshot, weekIndex, leagueId = null, phaseKind = null) {
  const ledger = loadWeeklyGameLog(leagueId);
  const { names } = buildTeamMaps(snapshot);
  const standings = standingsMap(snapshot);
  const activePhaseKind = phaseKind || currentSchedulePhase(snapshot).kind;
  const totalWeeks = totalWeeksForPhase(snapshot, activePhaseKind);
  const clampedWeek = Math.max(0, Math.min(totalWeeks - 1, Number(weekIndex || 0)));
  const snapshotGames = phaseWeekGames(snapshot, activePhaseKind, clampedWeek);
  const ledgerGames = (ledger?.games || []).filter((entry) =>
    Number(entry?.stageIndex ?? 0) === (activePhaseKind === 'preseason' ? 0 : activePhaseKind === 'playoffs' ? 2 : 1) &&
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
  const weekOptions = scheduleTimelineOptions(snapshot, activePhaseKind, clampedWeek);
  const gameOptions = (playedGames.length ? playedGames : games.slice(0, 1))
    .map((game) => {
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
    })
    .slice(0, 25);

  const embed = new EmbedBuilder()
    .setColor(0x00b0f4)
    .setTitle(`Madden Schedule — ${phaseWeekLabel(activePhaseKind, clampedWeek)}`)
    .setDescription(
      games.length
        ? games.map((game) => compactGameLine(snapshot, game, names, standings, ledger)).join('\n')
        : (ledgerGames.length
          ? ledgerGames.map((game) => compactGameLine(snapshot, game, names, standings, ledger)).join('\n')
          : `No ${activePhaseKind === 'preseason' ? 'preseason' : activePhaseKind === 'playoffs' ? 'playoff' : 'regular-season'} games found for this week.`),
    )
    .setFooter({ text: `Current league phase: ${phaseFooterLabel(snapshot)}` });

  const weekRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('madden_schedule_page')
      .setPlaceholder(weekOptions.length ? phaseWeekLabel(activePhaseKind, clampedWeek) : 'No schedule weeks')
      .setDisabled(!weekOptions.length)
      .addOptions(weekOptions.length ? weekOptions : fallbackSelectOption('No schedule weeks', `${activePhaseKind}:0`)),
  );

  const gameRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`madden_schedule_game|${activePhaseKind}|${clampedWeek}`)
      .setPlaceholder(playedGames.length ? 'View Game Stats' : 'No played games this week')
      .setDisabled(!playedGames.length)
      .addOptions(gameOptions.length ? gameOptions : fallbackSelectOption('No played games', `${activePhaseKind}:${clampedWeek}:none`)),
  );

  return { embed, components: [gameRow, weekRow], weekIndex: clampedWeek, phaseKind: activePhaseKind };
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

export function buildGameDetailView(snapshot, weekIndex, scheduleId, leagueId = null, phaseKind = null) {
  const ledger = loadWeeklyGameLog(leagueId);
  const { names } = buildTeamMaps(snapshot);
  const standings = standingsMap(snapshot);
  const activePhaseKind = phaseKind || currentSchedulePhase(snapshot).kind;
  const games = phaseWeekGames(snapshot, activePhaseKind, weekIndex);
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
    .setTitle(`${phaseWeekLabel(activePhaseKind, weekIndex)} — Game Stats`)
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
        .setCustomId(`madden_schedule_game|${activePhaseKind}|${weekIndex}`)
        .setPlaceholder('View Game Stats')
        .addOptions(
          phaseWeekGames(snapshot, activePhaseKind, weekIndex)
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
        .setCustomId(`madden_schedule_page|${activePhaseKind}`)
        .setPlaceholder(phaseWeekLabel(activePhaseKind, weekIndex))
        .addOptions(scheduleTimelineOptions(snapshot, activePhaseKind, weekIndex)),
    ),
  ];

  return { embed, components };
}

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const leagueId = requireLeagueIdForGuild(interaction.guildId);
    const snapshot = loadLeagueSnapshot(leagueId);
    const phase = currentSchedulePhase(snapshot);
    const currentWeekValue = Math.max(1, Number(snapshotSeasonInfo(snapshot).displayWeek ?? currentWeek(snapshot) ?? 1));
    const initialWeek = phase.kind === 'playoffs'
      ? Math.max(18, currentWeekValue - 1)
      : Math.max(0, currentWeekValue - 1);
    const view = buildScheduleWeekView(snapshot, initialWeek, leagueId, phase.kind);
    await interaction.editReply({ embeds: [view.embed], components: view.components });
  } catch (err) {
    await interaction.editReply({ content: `Failed to load schedule: ${err.message}` });
  }
}

export default { data, execute };
