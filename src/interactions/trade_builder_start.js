import { ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { requireLeagueIdForGuild, loadLeagueSnapshot } from '../madden/madden_data.js';
import { saveTradeDraft, deleteDraftsForUser } from '../utils/trade_draft_store.js';
import { normalizeName } from '../shared/rosterUtils.js';
import { resolveTeamNameForRoster } from '../shared/rosterUtils.js';
import { getFullTeamName } from '../shared/madden_team_names.js';
import { loadRoleMapForGuild } from '../madden/staff/staffUtils.js';

export const customId = /^trade_builder_start$/;

function normalizeKey(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveCoachTeamFromRoles({ member, guildId, teams = [] }) {
  const roles = member?.roles?.cache;
  if (!roles || !guildId || !teams.length) return null;

  const roleMap = loadRoleMapForGuild(guildId);
  for (const [name, roleId] of Object.entries(roleMap || {})) {
    if (!/ coach$/i.test(name) || !roleId || !roles.has(roleId)) continue;
    const baseTeamName = name.replace(/ coach$/i, '').trim();
    const exact = teams.find((team) => getFullTeamName(team, '').toLowerCase() === baseTeamName.toLowerCase());
    if (exact) return exact;
  }

  for (const role of roles.values()) {
    const roleName = String(role?.name || '');
    if (!/ coach$/i.test(roleName)) continue;
    const baseTeamName = roleName.replace(/ coach$/i, '').trim();
    const normalizedBase = normalizeKey(baseTeamName);
    const match = teams.find((team) => {
      const candidates = [
        getFullTeamName(team, ''),
        team.teamName,
        team.displayName,
        team.nickName,
        team.cityName,
        team.name,
        team.abbrName,
      ].map(normalizeKey);
      return candidates.includes(normalizedBase);
    });
    if (match) return match;
  }

  return null;
}

async function safeReply(interaction, payload) {
  try {
    return await interaction.reply(payload);
  } catch (err) {
    // Only send ephemeral reply, do not send public channel message
    throw err;
  }
}

export async function execute(interaction) {
  if (!interaction.isButton()) return;
  if (!customId.test(interaction.customId)) return;
  let leagueId = null;
  try {
    leagueId = requireLeagueIdForGuild(interaction.guildId);
  } catch (error) {
    await safeReply(interaction, { content: error?.message || 'No league is mapped to this server yet. Run `/setup` and press Open Setup Dashboard.', flags: 64 });
    return;
  }


  // Only Madden/NFL mode supported
  let snapshot = null;
  let teams = [];
  try { snapshot = loadLeagueSnapshot(leagueId); } catch { snapshot = null; }
  teams = snapshot?.teams?.leagueTeamInfoList || [];

  // Auto-detect user's team assignment at draft creation
  let yourTeamId = null;
  let yourTeamName = null;
  try {
    const { getCoachAssignmentMap } = await import('./trade_builder_team_select.js');
    const userToTeams = getCoachAssignmentMap({ guildId: interaction.guildId }).userToTeams;
    const userTeams = userToTeams.get(String(interaction.user.id));
    if (userTeams && userTeams.length > 0 && teams.length > 0) {
      const activeTeams = userTeams.filter(t => t.active);
      const sortedTeams = activeTeams.sort((a, b) => (b.assignedAt || 0) - (a.assignedAt || 0));
      const mostRecent = sortedTeams[0];
      let match = null;
      if (mostRecent) {
        match = teams.find(
          t => t.teamName === mostRecent.teamName ||
            t.displayName === mostRecent.teamName ||
            t.nickName === mostRecent.teamName ||
            t.name === mostRecent.teamName
        );
        if (!match) {
          match = teams.find(
            t => t.teamName?.toLowerCase() === mostRecent.teamName?.toLowerCase() ||
              t.displayName?.toLowerCase() === mostRecent.teamName?.toLowerCase() ||
              t.nickName?.toLowerCase() === mostRecent.teamName?.toLowerCase() ||
              t.name?.toLowerCase() === mostRecent.teamName?.toLowerCase()
          );
        }
        if (!match) {
          match = teams.find(
            t => t.teamName?.toLowerCase().includes(mostRecent.teamName?.toLowerCase()) ||
              t.displayName?.toLowerCase().includes(mostRecent.teamName?.toLowerCase()) ||
              t.nickName?.toLowerCase().includes(mostRecent.teamName?.toLowerCase()) ||
              t.name?.toLowerCase().includes(mostRecent.teamName?.toLowerCase())
          );
        }
        if (!match && mostRecent.teamName) {
          const parts = mostRecent.teamName.split(' ');
          if (parts.length >= 2) {
            const city = parts[0].toLowerCase();
            const nickname = parts.slice(1).join(' ').toLowerCase();
            match = teams.find(t => {
              const tCity = (t.cityName || '').toLowerCase();
              const tDisplay = (t.displayName || '').toLowerCase();
              const tNick = (t.nickName || '').toLowerCase();
              return (tCity === city && (tDisplay === nickname || tNick === nickname)) ||
                (mostRecent.teamName.toLowerCase().includes(tCity) && mostRecent.teamName.toLowerCase().includes(tDisplay));
            });
          }
        }
        if (match) {
          yourTeamId = String(match.teamId ?? match.teamIndex ?? match.displayName ?? match.nickName);
          yourTeamName = match.displayName || match.teamName || match.nickName;
        } else if (mostRecent) {
          yourTeamName = mostRecent.teamName;
        }
      }
    }
  } catch (e) { /* ignore auto-detect errors */ }

  if (!yourTeamId && teams.length > 0) {
    const roleMatch = resolveCoachTeamFromRoles({
      member: interaction.member,
      guildId: interaction.guildId,
      teams,
    });
    if (roleMatch) {
      yourTeamId = String(roleMatch.teamId ?? roleMatch.teamIndex ?? roleMatch.displayName ?? roleMatch.nickName);
      yourTeamName = getFullTeamName(roleMatch, 'Your team');
    }
  }

  const limitOptions = (opts, keepValue) => {
    if (opts.length <= 25) return opts;
    const keep = opts.find(o => o.value === String(keepValue));
    const others = opts.filter(o => o.value !== String(keepValue));
    const trimmed = others.slice(0, 24);
    return keep ? [keep, ...trimmed] : opts.slice(0, 25);
  };

  const draftId = `builder_${interaction.user.id}_${Date.now()}`;
  // Clear stale drafts for this user to avoid reusing old team selections
  deleteDraftsForUser(interaction.user.id);
  // Pull current NBA season year (season.json) for pick parsing
  let seasonYear = null;
  try {
    const seasonPath = path.join(process.cwd(), 'data', 'season.json');
    if (fs.existsSync(seasonPath)) {
      const s = JSON.parse(fs.readFileSync(seasonPath, 'utf8'));
      if (s.seasonYear) {
        seasonYear = Number(s.seasonYear);
      } else if (s.seasonNo) {
        const baseStartYear = 2025;
        seasonYear = baseStartYear + Number(s.seasonNo);
      }
    }
  } catch { /* ignore */ }
  if (!seasonYear) {
    seasonYear = new Date().getFullYear();
  }

  saveTradeDraft(draftId, {
    draftId,
    userId: interaction.user.id,
    guildId: interaction.guildId,
    leagueId,
    mode: 'madden',
    yourTeamId,
    yourTeamName,
    otherTeamId: null,
    assets: { your: [], other: [] },
  });

  const optionsAll = teams.map(t => ({
    label: getFullTeamName(t, 'Unknown'),
    value: String(t.teamId ?? t.teamIndex ?? t.displayName ?? t.nickName),
  }));
  const optionsAFC = teams
    .filter(t => (t.divName || '').toUpperCase().includes('AFC'))
    .map(t => ({
      label: getFullTeamName(t, 'Unknown'),
      value: String(t.teamId ?? t.teamIndex ?? t.displayName ?? t.nickName),
    }));
  const optionsNFC = teams
    .filter(t => (t.divName || '').toUpperCase().includes('NFC'))
    .map(t => ({
      label: getFullTeamName(t, 'Unknown'),
      value: String(t.teamId ?? t.teamIndex ?? t.displayName ?? t.nickName),
    }));

  // If yourTeamId is detected, lock the select menu to only your team
  let yourTeamRow;
  if (yourTeamId && yourTeamName) {
    yourTeamRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`trade_builder_team_yours|${draftId}`)
        .setPlaceholder('Your team')
        .addOptions([
          {
            label: yourTeamName,
            value: String(yourTeamId),
            default: true,
            description: 'Auto-detected from your assignment',
          },
        ])
        .setDisabled(true)
    );
  } else {
    yourTeamRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`trade_builder_team_yours|${draftId}`)
        .setPlaceholder('Your team')
        .addOptions(limitOptions(optionsAll))
    );
  }

  const rows = [
    yourTeamRow,
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`trade_builder_team_other_afc|${draftId}`)
        .setPlaceholder('Select other team (AFC)')
        .addOptions(limitOptions(optionsAFC))
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`trade_builder_team_other_nfc|${draftId}`)
        .setPlaceholder('Select other team (NFC)')
        .addOptions(limitOptions(optionsNFC))
    ),
  ];

  await safeReply(interaction, {
    content: 'Select teams to start building the trade.',
    components: rows,
    ephemeral: true,
  });
}

export default { customId, execute };
