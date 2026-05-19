import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { requireLeagueIdForGuild, loadLeagueSnapshot } from '../madden/madden_data.js';
import { getTradeDraft, saveTradeDraft } from '../shared/trade_draft_store.js';
import { getCoachAssignmentMap } from '../shared/madden_coach_assignments.js';
import { buildButtons } from './trade_builder_add_assets.js';
import { resolveTeamNameForRoster } from '../shared/rosterUtils.js';
import { getFullTeamName } from '../shared/madden_team_names.js';
import { loadRoleMapForGuild } from '../madden/staff/staffUtils.js';

export const customId = /^trade_builder_team_(yours|other_afc|other_nfc)\|/;

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

async function safeUpdate(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(payload);
  }
  await interaction.deferUpdate();
  return interaction.editReply(payload);
}

async function safeMessage(interaction, content) {
  const payload = { content, embeds: [], components: [] };
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(payload);
  }
  return interaction.reply(interaction.inGuild() ? { ...payload, flags: 64 } : payload);
}



function buildTeamOptions(snapshot, conference) {
  // Support both Madden and custom league snapshot formats
  const teams = Array.isArray(snapshot?.teams?.leagueTeamInfoList)
    ? snapshot.teams.leagueTeamInfoList
    : Array.isArray(snapshot?.teams)
      ? snapshot.teams
      : [];
  return teams
    .filter(t => {
      if (!conference) return true;
      const div = (t.divName || '').toUpperCase();
      return conference === 'AFC' ? div.includes('AFC') : div.includes('NFC');
    })
    .map(t => ({
      label: getFullTeamName(t, 'Unknown'),
      value: String(t.teamId ?? t.teamIndex ?? t.displayName ?? t.nickName),
    }));
}

function limitOptions(options, keepValue) {
  if (options.length <= 25) return options;
  if (!keepValue) return options.slice(0, 25);
  const keep = options.find(o => o.value === String(keepValue));
  const others = options.filter(o => o.value !== String(keepValue));
  const trimmed = others.slice(0, 24);
  return keep ? [keep, ...trimmed] : options.slice(0, 25);
}

export async function execute(interaction) {
  if (!interaction.isStringSelectMenu()) return;
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate();
    }
  } catch {
    return;
  }
  // Extract prefix (e.g., 'yours', 'other_afc', 'other_nfc') from customId
  const match = interaction.customId.match(/^trade_builder_team_(yours|other_afc|other_nfc)\|(.+)$/);
  const prefix = match ? match[1] : '';
  const draftId = match ? match[2] : '';
  const side = prefix.includes('yours') ? 'yourTeamId' : 'otherTeamId';
  const draft = getTradeDraft(draftId);

  // Always initialize leagueId and snapshot before auto-detect
  let leagueId = draft.leagueId || null;
  let snapshot = null;
  if (!leagueId) {
    try {
      leagueId = requireLeagueIdForGuild(interaction.guildId);
    } catch (error) {
      await safeMessage(interaction, error?.message || 'No league is mapped to this server yet. Run `/setup` and press Connect League, then run `/sync`.');
      return;
    }
  }
  try { snapshot = loadLeagueSnapshot(leagueId); } catch { snapshot = null; }

  // Auto-detect user's team if not already set
  if (side === 'yourTeamId' && !draft.yourTeamId && interaction.member) {
    try {
      const { userToTeams } = getCoachAssignmentMap({ guildId: interaction.guildId });
      const userTeams = userToTeams.get(String(interaction.user.id));
      console.log('[TRADE_BUILDER_AUTO_DETECT] ' + JSON.stringify({
        userId: interaction.user.id,
        userTeams,
        userToTeamsKeys: Array.from(userToTeams.keys()),
        draftId,
        draft,
      }));
      const teams = Array.isArray(snapshot?.teams?.leagueTeamInfoList)
        ? snapshot.teams.leagueTeamInfoList
        : Array.isArray(snapshot?.teams)
          ? snapshot.teams
          : [];
      if (userTeams && userTeams.length > 0 && teams.length > 0) {
        // Debug: print all team names being checked
        console.log('[TRADE_BUILDER_AUTO_DETECT_TEAMS]', JSON.stringify({
          teamNames: teams.map(t => t.name || t.teamName || t.displayName || t.nickName),
          teamsRaw: teams
        }));
        // Only use the most recently assigned active team
        const activeTeams = userTeams.filter(t => t.active);
        const sortedTeams = activeTeams.sort((a, b) => (b.assignedAt || 0) - (a.assignedAt || 0));
        const mostRecent = sortedTeams[0];
        let match = null;
        let matchType = null;
        let matchedAssignment = null;
        if (mostRecent) {
          // 1. Exact match (now also checks 'name' field)
          match = teams.find(
            t => t.teamName === mostRecent.teamName ||
              t.displayName === mostRecent.teamName ||
              t.nickName === mostRecent.teamName ||
              t.name === mostRecent.teamName
          );
          if (match) { matchType = 'exact'; matchedAssignment = mostRecent; }
          // 2. Case-insensitive match (now also checks 'name' field)
          if (!match) {
            match = teams.find(
              t => t.teamName?.toLowerCase() === mostRecent.teamName?.toLowerCase() ||
                t.displayName?.toLowerCase() === mostRecent.teamName?.toLowerCase() ||
                t.nickName?.toLowerCase() === mostRecent.teamName?.toLowerCase() ||
                t.name?.toLowerCase() === mostRecent.teamName?.toLowerCase()
            );
            if (match) { matchType = 'case-insensitive'; matchedAssignment = mostRecent; }
          }
          // 3. Partial/alias match (now also checks 'name' field)
          if (!match) {
            match = teams.find(
              t => t.teamName?.toLowerCase().includes(mostRecent.teamName?.toLowerCase()) ||
                t.displayName?.toLowerCase().includes(mostRecent.teamName?.toLowerCase()) ||
                t.nickName?.toLowerCase().includes(mostRecent.teamName?.toLowerCase()) ||
                t.name?.toLowerCase().includes(mostRecent.teamName?.toLowerCase())
            );
            if (match) { matchType = 'partial'; matchedAssignment = mostRecent; }
          }
          // 4. Robust city+nickname match (for 'Denver Broncos' style)
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
              if (match) { matchType = 'city+nickname'; matchedAssignment = mostRecent; }
            }
          }
        }
        // Log the matching process for debugging
        console.log('[TRADE_BUILDER_AUTO_DETECT_MATCH]', JSON.stringify({
          userId: interaction.user.id,
          userTeams,
          mostRecent,
          matchType,
          matchedAssignment,
          matchedTeam: match ? { teamId: match.teamId, displayName: match.displayName, teamName: match.teamName, nickName: match.nickName } : null
        }));
        if (match) {
          if (typeof match.teamId !== 'undefined' && match.teamId !== null) {
            draft.yourTeamId = String(match.teamId);
          } else if (typeof match.teamIndex !== 'undefined' && match.teamIndex !== null) {
            draft.yourTeamId = String(match.teamIndex);
          } else {
            // Fallback: log and use displayName or nickName, but warn
            console.warn('[TRADE_BUILDER_AUTO_DETECT_NO_TEAMID]', {
              match,
              userTeams,
              draftId,
              draft
            });
            draft.yourTeamId = String(match.displayName || match.nickName || 'unknown');
          }
          draft.yourTeamName = match.displayName || match.teamName || match.nickName;
          // Debug: confirm after setting
          console.log('[TRADE_BUILDER_SET_TEAM]', JSON.stringify({
            yourTeamId: draft.yourTeamId,
            yourTeamName: draft.yourTeamName,
            draftId,
            draft
          }));
        } else if (mostRecent) {
          // fallback: use the most recent assigned teamName as name, but leave id null
          draft.yourTeamName = mostRecent.teamName;
        }
        // Always save the draft after auto-detect
        saveTradeDraft(draftId, draft);
        // Do NOT reload or overwrite draft.yourTeamId after this point!
      }
    } catch (e) {
      console.error('[TRADE_BUILDER_AUTO_DETECT_ERROR] ' + (e && e.stack ? e.stack : e));
    }

    if (!draft.yourTeamId && teams.length > 0) {
      const roleMatch = resolveCoachTeamFromRoles({
        member: interaction.member,
        guildId: interaction.guildId,
        teams,
      });
      if (roleMatch) {
        draft.yourTeamId = String(roleMatch.teamId ?? roleMatch.teamIndex ?? roleMatch.displayName ?? roleMatch.nickName);
        draft.yourTeamName = getFullTeamName(roleMatch, 'Your team');
        saveTradeDraft(draftId, draft);
      }
    }
  }

  const selected = interaction.values[0];
  const prevYour = draft.yourTeamId;
  const prevOther = draft.otherTeamId;
  draft[side] = selected;
  const optionsAll = limitOptions(buildTeamOptions(snapshot), draft.yourTeamId);
  const optionsAFC = limitOptions(buildTeamOptions(snapshot, 'AFC'));
  const optionsNFC = limitOptions(buildTeamOptions(snapshot, 'NFC'));
  const team = (snapshot?.teams?.leagueTeamInfoList || []).find(t => String(t.teamId ?? t.teamIndex) === String(selected));
  if (side === 'yourTeamId') draft.yourTeamName = getFullTeamName(team, selected);
  if (side === 'otherTeamId') draft.otherTeamName = getFullTeamName(team, selected);
  draft.yourTeam = draft.yourTeamName || draft.yourTeamId || draft.yourTeam;
  draft.otherTeam = draft.otherTeamName || draft.otherTeamId || draft.otherTeam;
  // If team selection changed, clear cached assets so roster list refreshes correctly.
  if (side === 'yourTeamId' && prevYour && prevYour !== selected && draft.assets?.your) {
    draft.assets.your = [];
  }
  if (side !== 'yourTeamId' && prevOther && prevOther !== selected && draft.assets?.other) {
    draft.assets.other = [];
  }
  saveTradeDraft(draftId, draft);

  const components = [];

  // Debug: log draft state before rendering select menu
  console.log('[TRADE_BUILDER_RENDER_SELECT]', JSON.stringify({
    yourTeamId: draft.yourTeamId,
    yourTeamName: draft.yourTeamName,
    draft
  }));
  // Always render with your team pre-selected and menu locked if auto-detect succeeded
  const yourOptions = draft.yourTeamId
    ? [{ label: draft.yourTeamName || 'Your team', value: String(draft.yourTeamId) }]
    : limitOptions(buildTeamOptions(snapshot), draft.yourTeamId);
  components.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`trade_builder_team_yours|${draftId}`)
        .setPlaceholder(draft.yourTeamName ? `Your team: ${draft.yourTeamName}` : 'Select your team')
        .setDisabled(!!draft.yourTeamId)
        .setOptions(yourOptions)
    )
  );

  const otherAFCOptions = limitOptions(buildTeamOptions(snapshot, 'AFC'));
  components.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`trade_builder_team_other_afc|${draftId}`)
        .setPlaceholder('Select other team (AFC)')
        .setDisabled(!!draft.otherTeamId)
        .addOptions(otherAFCOptions)
    )
  );

  const otherNFCOptions = limitOptions(buildTeamOptions(snapshot, 'NFC'));
  components.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`trade_builder_team_other_nfc|${draftId}`)
        .setPlaceholder('Select other team (NFC)')
        .setDisabled(!!draft.otherTeamId)
        .addOptions(otherNFCOptions)
    )
  );

  const haveBothTeams = draft.yourTeamId && draft.otherTeamId;
  if (haveBothTeams) {
    components.push(...buildButtons(draftId));
    // keep at most 5 rows to satisfy Discord limits
    components.splice(5);
  }

  const embed = new EmbedBuilder()
    .setTitle('Trade Builder')
    .setDescription('Select both teams, then add assets to see live values.')
    .addFields(
      { name: 'You', value: draft.yourTeamName || '—', inline: true },
      { name: 'Other', value: draft.otherTeamName || '—', inline: true },
    )
    .setColor(0x5865f2);

  await safeUpdate(interaction, {
    content: null,
    embeds: [embed],
    components,
  });
}

export default { customId, execute };
