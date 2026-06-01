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
  getFantasySeasonKey,
  makeFantasyPick,
  mutateFantasyLeague,
  resolveCoachTeamIds,
  startFantasyDraft,
  upsertFantasyManager,
} from '../shared/madden_fantasy.js';

export const customId = /^madden_fantasy\|/;

function parseParts(interaction) {
  const [, action = 'hub', value = '0'] = interaction.customId.split('|');
  return { action, value };
}

async function loadContext(interaction) {
  const leagueId = requireLeagueIdForGuild(interaction.guildId);
  const snapshot = loadLeagueSnapshot(leagueId);
  const seasonKey = getFantasySeasonKey(snapshot);
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
  const { action, value } = parseParts(interaction);

  if (!interaction.deferred && !interaction.replied) {
    if (action === 'pick') await interaction.deferUpdate();
    else await interaction.deferUpdate();
  }

  let context;
  try {
    context = await loadContext(interaction);
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
    await interaction.editReply(buildFantasyHubPayload(league, snapshot, userId));
    return;
  }

  if (action === 'start') {
    const roleMap = loadRoleMapForGuild(interaction.guildId);
    if (!hasStaffRole(interaction.member, roleMap)) {
      await replyError(interaction, 'Only staff can start the fantasy draft.');
      return;
    }
    let result = null;
    league = mutateFantasyLeague({ guildId: interaction.guildId, seasonKey }, (draftLeague) => {
      result = startFantasyDraft(draftLeague);
      return draftLeague;
    });
    if (!result?.ok) {
      await replyError(interaction, result?.reason || 'Fantasy draft could not be started.');
      return;
    }
    await interaction.editReply(buildFantasyDraftPayload(league, snapshot, userId));
    return;
  }

  if (action === 'pick') {
    const assetId = interaction.values?.[0];
    let result = null;
    league = mutateFantasyLeague({ guildId: interaction.guildId, seasonKey }, (draftLeague) => {
      const asset = findFantasyAsset(draftLeague, snapshot, assetId, userId);
      result = asset ? makeFantasyPick(draftLeague, asset, userId) : { ok: false, reason: 'That board item is no longer available.' };
      return draftLeague;
    });
    if (!result?.ok) {
      await replyError(interaction, result?.reason || 'Pick could not be made.');
      return;
    }
    await interaction.editReply(buildFantasyDraftPayload(league, snapshot, userId));
    return;
  }

  if (action === 'board') {
    await interaction.editReply(buildFantasyBoardPayload(league, snapshot, userId, Number(value || 0)));
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
    await interaction.editReply(buildFantasyDraftPayload(league, snapshot, userId));
    return;
  }

  if (action === 'trade') {
    await interaction.editReply(buildFantasyTradePayload(league, userId));
    return;
  }

  await interaction.editReply(buildFantasyHubPayload(league, snapshot, userId));
}

export default { customId, execute };
