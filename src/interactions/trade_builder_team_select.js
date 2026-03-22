import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { requireLeagueIdForGuild, loadLeagueSnapshot } from '../madden/madden_data.js';
import { getTradeDraft, saveTradeDraft } from '../shared/trade_draft_store.js';
import { getCoachAssignmentMap } from '../shared/madden_coach_assignments.js';
import { buildButtons } from './trade_builder_add_assets.js';
import { resolveTeamNameForRoster } from '../shared/rosterUtils.js';
import { getFullTeamName } from '../shared/madden_team_names.js';

export const customId = /^trade_builder_team_(yours|other_afc|other_nfc)\|/;

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
  const teams = snapshot?.teams?.leagueTeamInfoList || [];
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

  // Auto-detect user's team if not already set
  if (side === 'yourTeamId' && !draft.yourTeamId && interaction.member) {
    try {
      const { userToTeams } = getCoachAssignmentMap({ guildId: interaction.guildId });
      const userTeams = userToTeams?.[interaction.user.id];
      if (userTeams && userTeams.length > 0) {
        draft.yourTeamId = String(userTeams[0].teamId ?? userTeams[0].teamIndex ?? userTeams[0].displayName ?? userTeams[0].nickName);
        draft.yourTeamName = userTeams[0].teamName || userTeams[0].displayName || userTeams[0].nickName;
      }
    } catch (e) { /* ignore if mapping fails */ }
  }
  if (!draft) {
    await safeMessage(interaction, 'Trade builder expired. Press Start Trade Builder again.');
    return;
  }
  let leagueId = draft.leagueId || null;
  let snapshot = null;
  if (!leagueId) {
    try {
      leagueId = requireLeagueIdForGuild(interaction.guildId);
    } catch (error) {
      await safeMessage(interaction, error?.message || 'No league is mapped to this server yet. Run `/connectleague`, finish the dashboard flow, then run `/sync`.');
      return;
    }
  }
  try { snapshot = loadLeagueSnapshot(leagueId); } catch { snapshot = null; }

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

  const yourOptions = draft.yourTeamId
    ? [{ label: draft.yourTeamName || 'Your team', value: String(draft.yourTeamId) }]
    : limitOptions(buildTeamOptions(snapshot), draft.yourTeamId);
  components.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`trade_builder_team_yours|${draftId}`)
        .setPlaceholder(draft.yourTeamName ? `Your team: ${draft.yourTeamName}` : 'Select your team')
        .setDisabled(!!draft.yourTeamId)
        .addOptions(yourOptions)
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
