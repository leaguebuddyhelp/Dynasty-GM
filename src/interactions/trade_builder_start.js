import { ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { requireLeagueIdForGuild, loadLeagueSnapshot } from '../madden/madden_data.js';
import { saveTradeDraft, deleteDraftsForUser } from '../utils/trade_draft_store.js';
import { normalizeName } from '../shared/rosterUtils.js';
import { resolveTeamNameForRoster } from '../shared/rosterUtils.js';
import { getFullTeamName } from '../shared/madden_team_names.js';

export const customId = /^trade_builder_start$/;

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
    await safeReply(interaction, { content: error?.message || 'No league is mapped to this server yet. Run `/connectleague`, finish the dashboard flow, then run `/sync`.', flags: 64 });
    return;
  }

  let detectedTeam = null;
  if (matches.size === 1) {
    const only = Array.from(matches)[0];
    detectedTeam = /timberwolves/i.test(only) ? 'Minnesota Timberwolves'
      : /bucks/i.test(only) ? 'Milwaukee Bucks'
        : resolveTeamNameForRoster(only);
  }
  console.log('[trade_builder_start][detect]', {
    userId: interaction.user.id,
    userRoles: userRoleIds,
    roleMatches: Array.from(matches),
    detectedTeam,
    overrideTeam: USER_TEAM_OVERRIDES[interaction.user.id] || null,
  });

  // Only Madden/NFL mode supported
  let snapshot = null;
  let teams = [];
  try { snapshot = loadLeagueSnapshot(leagueId); } catch { snapshot = null; }
  teams = snapshot?.teams?.leagueTeamInfoList || [];

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
        // Our NBA seasons are labeled so seasonNo:1 corresponds to the 2025-26 season,
        // meaning draft picks are in the calendar year 2026.
        const baseStartYear = 2025;
        seasonYear = baseStartYear + Number(s.seasonNo); // season 1 -> 2026, season 2 -> 2027, etc.
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
    yourTeamId: null,
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
  const rows = [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`trade_builder_team_yours|${draftId}`)
        .setPlaceholder('Your team')
        .addOptions(limitOptions(optionsAll))
    ),
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
