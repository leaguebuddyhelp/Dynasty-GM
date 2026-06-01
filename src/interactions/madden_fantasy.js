import { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import { requireLeagueIdForGuild, loadLeagueSnapshot } from '../madden/madden_data.js';
import { hasStaffRole, loadRoleMapForGuild } from '../madden/staff/staffUtils.js';
import {
  buildFantasyBoardPayload,
  buildFantasyDraftPayload,
  buildFantasyHubPayload,
  buildFantasyStandingsPayload,
  buildFantasyTeamPayload,
  buildFantasyTradePayload,
  ensureFantasyLeague,
  findFantasyAsset,
  getFantasyLeagueKey,
  autoSimFantasyUntilUser,
  makeFantasyPick,
  mutateFantasyLeague,
  normalizeFantasyMode,
  resetFantasyDraft,
  resolveCoachTeamIds,
  startFantasyDraft,
  upsertFantasyManager,
} from '../shared/madden_fantasy.js';

export const customId = /^madden_fantasy\|/;

function parseParts(interaction) {
  const [, action = 'hub', value = '0'] = interaction.customId.split('|');
  if (String(action || '').startsWith('mock_')) {
    return { action: action.replace(/^mock_/, ''), value, mode: 'mock' };
  }
  return { action, value, mode: 'live' };
}

async function loadContext(interaction, mode = 'live') {
  const leagueId = requireLeagueIdForGuild(interaction.guildId);
  const snapshot = loadLeagueSnapshot(leagueId);
  const normalizedMode = normalizeFantasyMode(mode);
  const baseSeasonKey = getFantasyLeagueKey(snapshot, normalizedMode);
  const seasonKey = normalizedMode === 'mock' ? `${baseSeasonKey}:${interaction.user.id}` : baseSeasonKey;
  ensureFantasyLeague({ guildId: interaction.guildId, seasonKey });
  const maddenTeamIds = resolveCoachTeamIds(interaction.member, snapshot);
  const fantasyLeague = mutateFantasyLeague({ guildId: interaction.guildId, seasonKey }, (league) => (
    upsertFantasyManager(league, interaction.member, maddenTeamIds)
  ));
  return { snapshot, seasonKey, fantasyLeague };
}

async function replyError(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content, embeds: [], components: [] });
  } else if (interaction.isButton() || interaction.isStringSelectMenu()) {
    await interaction.reply({ content, flags: 64 });
  }
}

export async function execute(interaction) {
  if (!(interaction instanceof ButtonInteraction) && !(interaction instanceof StringSelectMenuInteraction)) return;
  const { action, value, mode } = parseParts(interaction);

  if (!interaction.deferred && !interaction.replied) {
    if (action === 'pick') await interaction.deferUpdate();
    else await interaction.deferUpdate();
  }

  let context;
  try {
    context = await loadContext(interaction, mode);
  } catch {
    await replyError(interaction, 'Fantasy could not load the connected Madden league. Run `/sync`, then open `/fantasy` again.');
    return;
  }

  const { snapshot, seasonKey } = context;
  let league = context.fantasyLeague;
  const userId = interaction.user.id;

  if (action === 'join') {
    league = mutateFantasyLeague({ guildId: interaction.guildId, seasonKey }, (draftLeague) => (
      upsertFantasyManager(draftLeague, interaction.member, resolveCoachTeamIds(interaction.member, snapshot))
    ));
    await interaction.editReply(buildFantasyHubPayload(league, snapshot, userId, { mode }));
    return;
  }

  if (action === 'start') {
    const roleMap = loadRoleMapForGuild(interaction.guildId);
    if (mode !== 'mock' && !hasStaffRole(interaction.member, roleMap)) {
      await replyError(interaction, 'Only staff can start the fantasy draft.');
      return;
    }
    let result = null;
    league = mutateFantasyLeague({ guildId: interaction.guildId, seasonKey }, (draftLeague) => {
      if (mode === 'mock') resetFantasyDraft(draftLeague);
      result = startFantasyDraft(draftLeague, mode === 'mock' ? { soloMockUserId: userId } : {});
      if (result?.ok && mode === 'mock') autoSimFantasyUntilUser(draftLeague, snapshot, userId);
      return draftLeague;
    });
    if (!result?.ok) {
      await replyError(interaction, result?.reason || 'Fantasy draft could not be started.');
      return;
    }
    await interaction.editReply(buildFantasyDraftPayload(league, snapshot, userId, { mode }));
    return;
  }

  if (action === 'reset') {
    if (mode !== 'mock') {
      await replyError(interaction, 'Only the mock draft can be reset from this button.');
      return;
    }
    league = mutateFantasyLeague({ guildId: interaction.guildId, seasonKey }, (draftLeague) => {
      resetFantasyDraft(draftLeague);
      return draftLeague;
    });
    await interaction.editReply(buildFantasyHubPayload(league, snapshot, userId, { mode }));
    return;
  }

  if (action === 'pick') {
    const assetId = interaction.values?.[0];
    let result = null;
    league = mutateFantasyLeague({ guildId: interaction.guildId, seasonKey }, (draftLeague) => {
      const asset = findFantasyAsset(draftLeague, snapshot, assetId, userId);
      result = asset ? makeFantasyPick(draftLeague, asset, userId) : { ok: false, reason: 'That board item is no longer available.' };
      if (result?.ok && mode === 'mock') autoSimFantasyUntilUser(draftLeague, snapshot, userId);
      return draftLeague;
    });
    if (!result?.ok) {
      await replyError(interaction, result?.reason || 'Pick could not be made.');
      return;
    }
    await interaction.editReply(buildFantasyDraftPayload(league, snapshot, userId, { mode }));
    return;
  }

  if (action === 'board') {
    await interaction.editReply(buildFantasyBoardPayload(league, snapshot, userId, Number(value || 0), { mode }));
    return;
  }

  if (action === 'team') {
    await interaction.editReply(buildFantasyTeamPayload(league, snapshot, userId));
    return;
  }

  if (action === 'standings') {
    await interaction.editReply(buildFantasyStandingsPayload(league, snapshot));
    return;
  }

  if (action === 'draft') {
    await interaction.editReply(buildFantasyDraftPayload(league, snapshot, userId, { mode }));
    return;
  }

  if (action === 'trade') {
    await interaction.editReply(buildFantasyTradePayload(league, userId));
    return;
  }

  if (mode === 'mock' && action === 'hub' && league.draft?.status !== 'live') {
    league = mutateFantasyLeague({ guildId: interaction.guildId, seasonKey }, (draftLeague) => {
      resetFantasyDraft(draftLeague);
      startFantasyDraft(draftLeague, { soloMockUserId: userId });
      autoSimFantasyUntilUser(draftLeague, snapshot, userId);
      return draftLeague;
    });
    await interaction.editReply(buildFantasyDraftPayload(league, snapshot, userId, { mode }));
    return;
  }

  await interaction.editReply(buildFantasyHubPayload(league, snapshot, userId, { mode }));
}

export default { customId, execute };
