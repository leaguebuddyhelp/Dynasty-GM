import { SlashCommandBuilder } from 'discord.js';
import path from 'path';
import fs from 'fs';
import { resolveLeagueIdWithConfig, loadLeagueSnapshot } from '../madden_data.js';
import { getMaddenLeaguesDir } from '../../leaguebuddy/paths.js';
import { getMaddenDataFilePath } from '../../leaguebuddy/paths.js';
import { getFullTeamName } from '../../shared/madden_team_names.js';
import { stablePlayerKey } from '../player_identity.js';
import { computeDraftGrades } from '../draft_grades_auto.js';
import { hasStaffRole, loadRoleMapForGuild } from './staffUtils.js';
import { isSoloModeEnabled } from '../../leaguebuddy/solo_mode.js';

const EXPORT_DIR = getMaddenDataFilePath('draft_exports');

function devLabel(devTrait) {
  if (devTrait === null || devTrait === undefined || devTrait === '') return 'Unknown';
  switch (Number(devTrait)) {
    case 3: return 'X-Factor';
    case 2: return 'Superstar';
    case 1: return 'Star';
    case 0: return 'Normal';
    default: return 'Unknown';
  }
}

function numberFrom(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function playerName(player = {}) {
  return [player.firstName, player.lastName].map((part) => String(part || '').trim()).filter(Boolean).join(' ').trim();
}

export function collectDraft(snapshot) {
  const snapshots = Array.isArray(snapshot) ? snapshot : [snapshot];
  const playersByKey = new Map();
  for (const [snapshotIndex, currentSnapshot] of snapshots.entries()) {
    const teams = currentSnapshot?.teams?.leagueTeamInfoList || [];
    const teamNames = new Map(teams.map((team) => [
      String(team.teamId),
      getFullTeamName(team, `Team ${team.teamId}`),
    ]));
    const rosters = currentSnapshot?.rosters?.teams || {};
    for (const [currentTeamId, roster] of Object.entries(rosters)) {
      for (const player of roster?.rosterInfoList || roster?.rosterPlayerInfoList || []) {
        if (Number(player?.yearsPro ?? 1) !== 0) continue;
        const key = stablePlayerKey(player)
          || (player.rosterId != null ? `roster:${player.rosterId}` : '');
        if (!key) continue;
        const explicitDraftTeamId = player.draftingTeamId
          ?? player.draftTeamId
          ?? player.draftedByTeamId
          ?? player.originalTeamId
          ?? player.teamIdAtDraft
          ?? null;
        const round = numberFrom(player.draftRound ?? player.draftYearRound ?? player.collegeDraftRound);
        const pickInRound = numberFrom(player.draftPick ?? player.draftSelection);
        const overallPick = numberFrom(player.overallPick ?? player.draftOverallPick);
        const prior = playersByKey.get(key);
        playersByKey.set(key, {
          ...prior,
          ...player,
          playerKey: key,
          currentTeamId: String(currentTeamId),
          currentTeamName: teamNames.get(String(currentTeamId)) || `Team ${currentTeamId}`,
          draftingTeamId: explicitDraftTeamId == null
            ? prior?.draftingTeamId ?? null
            : String(explicitDraftTeamId),
          draftingTeamName: explicitDraftTeamId == null
            ? prior?.draftingTeamName ?? 'Unresolved'
            : teamNames.get(String(explicitDraftTeamId)) || `Team ${explicitDraftTeamId}`,
          draftRound: round ?? prior?.draftRound ?? null,
          draftPickInRound: pickInRound ?? prior?.draftPickInRound ?? null,
          overallPick: overallPick ?? prior?.overallPick ?? null,
          observedInCurrentSnapshot: snapshotIndex === snapshots.length - 1,
          lastSeenSnapshotIndex: snapshotIndex,
        });
      }
    }
  }
  return [...playersByKey.values()]
    .map((player) => ({
      playerKey: player.playerKey,
      rosterId: player.rosterId ?? null,
      presentationId: player.presentationId ?? null,
      draftingTeamId: player.draftingTeamId,
      draftingTeam: player.draftingTeamName,
      currentTeamId: player.currentTeamId,
      currentTeam: player.currentTeamName,
      currentRosterStatus: player.observedInCurrentSnapshot ? 'On current roster' : 'Not on current roster; last seen team shown',
      position: player.position || '',
      name: playerName(player),
      firstName: player.firstName || '',
      lastName: player.lastName || '',
      college: player.college || '',
      ovr: numberFrom(player.playerBestOvr),
      devTrait: numberFrom(player.devTrait),
      devLabel: devLabel(player.devTrait),
      draftRound: player.draftRound,
      draftPickInRound: player.draftPickInRound,
      overallPick: player.overallPick,
      pickVerification: player.overallPick !== null
        ? 'Verified overall selection'
        : player.draftRound !== null && player.draftPickInRound !== null
          ? 'Round/pick available; overall pick unresolved'
          : 'Selection unresolved',
    }))
    .sort((a, b) => (a.overallPick ?? Number.MAX_SAFE_INTEGER) - (b.overallPick ?? Number.MAX_SAFE_INTEGER)
      || (a.draftRound ?? Number.MAX_SAFE_INTEGER) - (b.draftRound ?? Number.MAX_SAFE_INTEGER)
      || (a.draftPickInRound ?? Number.MAX_SAFE_INTEGER) - (b.draftPickInRound ?? Number.MAX_SAFE_INTEGER)
      || a.name.localeCompare(b.name));
}

function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function draftCsvRows(draft, gradesByTeam = {}) {
  const columns = [
    ['Overall Pick', 'overallPick'],
    ['Pick Verification', 'pickVerification'],
    ['Round', 'draftRound'],
    ['Pick in Round', 'draftPickInRound'],
    ['Drafting Team', 'draftingTeam'],
    ['Current Team', 'currentTeam'],
    ['Current Roster Status', 'currentRosterStatus'],
    ['Player', 'name'],
    ['Position', 'position'],
    ['College', 'college'],
    ['Rookie OVR', 'ovr'],
    ['Development Trait', 'devLabel'],
    ['Draft Grade', 'draftGrade'],
    ['Roster ID', 'rosterId'],
    ['Presentation ID', 'presentationId'],
  ];
  const rows = [columns.map(([label]) => label)];
  for (const player of draft) {
    const grade = player.draftingTeam === 'Unresolved'
      ? ''
      : gradesByTeam[player.draftingTeam] ?? '';
    rows.push(columns.map(([, key]) => key === 'draftGrade' ? grade : player[key] ?? ''));
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export const data = new SlashCommandBuilder()
  .setName('draftexport')
  .setDescription('Export drafted rookies as JSON and Google Sheets-compatible CSV.')
  .addStringOption((option) => option
    .setName('format')
    .setDescription('Export format')
    .addChoices(
      { name: 'Both JSON and CSV', value: 'both' },
      { name: 'CSV for Google Sheets', value: 'csv' },
      { name: 'JSON', value: 'json' },
    ))
  .setDefaultMemberPermissions(null);

async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  if (!isSoloModeEnabled()) {
    const roleMap = loadRoleMapForGuild(interaction.guildId);
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!hasStaffRole(member, roleMap)) {
      await interaction.editReply({ content: 'Only LB Commish/Co-Commish can use this command.' });
      return;
    }
  }
  const leagueId = resolveLeagueIdWithConfig(interaction.guildId);
  if (!leagueId) {
    await interaction.editReply({ content: 'No league is connected yet. Run `/setup` and press Open Setup Dashboard.' });
    return;
  }
  try {
    const snapshot = loadLeagueSnapshot(leagueId);
    if (!snapshot) {
      await interaction.editReply({ content: 'No snapshot found. Run /weeklyupdate first.' });
      return;
    }
    const historyDirectory = path.join(getMaddenLeaguesDir(), 'history', String(leagueId));
    const historicalSnapshots = [];
    try {
      const historyFiles = (await fs.promises.readdir(historyDirectory))
        .filter((file) => file.endsWith('.json') && file !== 'index.json')
        .sort();
      for (const file of historyFiles) {
        try {
          historicalSnapshots.push(JSON.parse(await fs.promises.readFile(path.join(historyDirectory, file), 'utf8')));
        } catch (error) {
          console.warn(`[draftexport] skipping unreadable snapshot ${file}`, error?.message || error);
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const currentSnapshotId = snapshot.syncId;
    const exportSnapshots = historicalSnapshots
      .filter((entry) => entry.syncId !== currentSnapshotId)
      .sort((a, b) => String(a.syncedAt || a.fetchedAt || '').localeCompare(String(b.syncedAt || b.fetchedAt || '')));
    exportSnapshots.push(snapshot);
    const draft = collectDraft(exportSnapshots);
    const computedGrades = computeDraftGrades(snapshot);
    const gradesByTeam = Object.fromEntries(computedGrades.map((grade) => [grade.teamName, grade.grade]));
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
    const filePath = path.join(EXPORT_DIR, `${leagueId}_draft_export.json`);
    const payload = {
      leagueId,
      fetchedAt: snapshot.fetchedAt || new Date().toISOString(),
      seasonYear: snapshot?.info?.careerHubInfo?.seasonInfo?.seasonYear,
      rookies: draft,
    };
    const format = interaction.options.getString('format') || 'both';
    const files = [];
    if (format === 'json' || format === 'both') {
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
      files.push(filePath);
    }
    if (format === 'csv' || format === 'both') {
      const csvPath = path.join(EXPORT_DIR, `${leagueId}_draft_export.csv`);
      fs.writeFileSync(csvPath, draftCsvRows(draft, gradesByTeam), 'utf8');
      files.push(csvPath);
    }
    await interaction.editReply({
      content: `Draft export ready (${draft.length} players; ${format.toUpperCase()}). Overall picks without verified source data are explicitly marked unresolved.`,
      files,
    });
  } catch (e) {
    await interaction.editReply({ content: `Draft export failed: ${e.message || e}` });
  }
}

export default { data, execute };
