import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { requireLeagueIdForGuild, loadLeagueSnapshot } from '../madden/madden_data.js';
import { hasStaffRole, loadRoleMapForGuild } from '../madden/staff/staffUtils.js';
import { getCoachAssignmentMap } from '../shared/madden_coach_assignments.js';
import {
  buildFantasyBoardPayload,
  buildFantasyDraftPayload,
  buildFantasyDraftRecaps,
  buildFantasyHubPayload,
  buildFantasyStandingsPayload,
  buildFantasyTeamPayload,
  buildFantasyTradePayload,
  ensureFantasyLeague,
  fantasyMockToken,
  findFantasyAsset,
  getFantasyLeagueKey,
  autoSimFantasyUntilManualPick,
  makeFantasyPick,
  mutateFantasyLeague,
  normalizeFantasyMode,
  resetFantasyDraft,
  resolveFantasyMockToken,
  resolveCoachTeamIds,
  startFantasyDraft,
  toggleFantasyAutoPick,
  upsertFantasyManager,
  FANTASY_CHAT_CHANNEL_ID,
  FANTASY_ACCESS_ROLE_ID,
} from '../shared/madden_fantasy.js';
import { coachTeamsForMember } from '../shared/madden_mock_draft_live.js';

export const customId = /^madden_fantasy\|/;
const INVITE_TTL_MS = 1000 * 60 * 60 * 24;

function parseParts(interaction) {
  const [, action = 'hub', value = '0'] = interaction.customId.split('|');
  if (String(action || '').startsWith('mockkey_')) {
    const resolved = resolveFantasyMockToken(value);
    const decoded = decodeURIComponent(value || '');
    const [legacyGuildId, legacySeasonKey] = decoded.includes('::') ? decoded.split('::') : [null, decoded];
    return {
      action: action.replace(/^mockkey_/, ''),
      value: interaction.customId.split('|')[3] || '0',
      mode: 'mock',
      guildIdOverride: resolved?.guildId || legacyGuildId,
      seasonKeyOverride: resolved?.seasonKey || legacySeasonKey,
    };
  }
  if (String(action || '').startsWith('mock_')) {
    return { action: action.replace(/^mock_/, ''), value, mode: 'mock' };
  }
  return { action, value, mode: 'live' };
}

async function loadContext(interaction, mode = 'live', seasonKeyOverride = null, guildIdOverride = null) {
  const guildId = guildIdOverride || interaction.guildId;
  const leagueId = requireLeagueIdForGuild(guildId);
  const snapshot = loadLeagueSnapshot(leagueId);
  const normalizedMode = normalizeFantasyMode(mode);
  const baseSeasonKey = getFantasyLeagueKey(snapshot, normalizedMode);
  const seasonKey = seasonKeyOverride || (normalizedMode === 'mock' ? `${baseSeasonKey}:${interaction.user.id}` : baseSeasonKey);
  ensureFantasyLeague({ guildId, seasonKey });
  const member = interaction.member?.roles?.cache
    ? interaction.member
    : await fetchGuildMember(interaction.client, guildId, interaction.user.id);
  const maddenTeamIds = resolveCoachTeamIds(member, snapshot);
  const fantasyLeague = mutateFantasyLeague({ guildId, seasonKey }, (league) => {
    upsertFantasyManager(league, member || { id: interaction.user.id, user: interaction.user }, maddenTeamIds);
    if (normalizedMode === 'mock' && !league.hostId) {
      league.hostId = seasonKeyOverride ? String(seasonKey).split(':').pop() : interaction.user.id;
    }
    return league;
  });
  return { snapshot, seasonKey, fantasyLeague, guildId };
}

async function replyError(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content, embeds: [], components: [] });
  } else if (interaction.isButton() || interaction.isStringSelectMenu()) {
    await interaction.reply({ content, flags: 64 });
  }
}

function hasFantasyAccess(member) {
  return Boolean(member?.roles?.cache?.has?.(FANTASY_ACCESS_ROLE_ID));
}

async function fetchGuildMember(client, guildId, userId) {
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return null;
  return guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
}

async function ensureFantasyAccess(interaction, guildId) {
  const member = interaction.member?.roles?.cache
    ? interaction.member
    : await fetchGuildMember(interaction.client, guildId, interaction.user.id);
  if (hasFantasyAccess(member)) return { ok: true, member };
  await replyError(interaction, 'You need the fantasy role to use this fantasy feature.');
  return { ok: false, member };
}

function normalizeAssignedTeamNames(entries = []) {
  return [...new Set(
    (entries || [])
      .map((entry) => (typeof entry === 'string' ? entry : entry?.teamName || entry?.displayName || null))
      .filter(Boolean),
  )];
}

function coachRoleIds(guildId = null) {
  const roleMap = loadRoleMapForGuild(guildId);
  return Object.entries(roleMap || {})
    .filter(([name, id]) => name.endsWith(' Coach') && id)
    .map(([, id]) => String(id));
}

async function buildFantasyInviteOptions(guild, league, hostId) {
  if (!guild) return [];
  const membersById = new Map();
  const assignments = getCoachAssignmentMap({ guildId: guild.id });
  for (const userId of assignments?.userToTeams?.keys() || []) {
    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    if (!member?.user || member.user.bot) continue;
    if (!hasFantasyAccess(member)) continue;
    membersById.set(member.id, member);
  }
  if (!membersById.size) {
    for (const roleId of coachRoleIds(guild.id)) {
      const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
      for (const member of role?.members?.values?.() || []) {
        if (!member?.user || member.user.bot) continue;
        if (!hasFantasyAccess(member)) continue;
        membersById.set(member.id, member);
      }
    }
  }
  return [...membersById.values()]
    .filter((member) => member.id !== hostId)
    .sort((a, b) => (a.displayName || a.user?.username || a.id).localeCompare(b.displayName || b.user?.username || b.id))
    .map((member) => {
      const assignedTeams = normalizeAssignedTeamNames(
        assignments?.userToTeams?.get(member.id) || coachTeamsForMember(member) || [],
      );
      const display = member.displayName || member.user?.globalName || member.user?.username || member.id;
      const joined = Boolean(league.managers?.[member.id]);
      return new StringSelectMenuOptionBuilder()
        .setLabel(`${display} • ${assignedTeams.length ? assignedTeams.join(' / ') : 'Unassigned Team'}`.slice(0, 100))
        .setDescription(`${member.user?.username || member.id}${joined ? ' • already joined' : ''}`.slice(0, 100))
        .setValue(member.id);
    });
}

function inviteActionId(mode, action, page = 0, seasonKey = null) {
  if (mode === 'mock' && seasonKey) return `madden_fantasy|mockkey_${action}|${seasonKey}|${page}`;
  return `madden_fantasy|${action}|${page}`;
}

function buildFantasyInvitePickerPayload(league, inviteOptions = [], page = 0, content = null, { mode = 'live', seasonKey = null } = {}) {
  const totalPages = Math.max(1, Math.ceil(inviteOptions.length / 25));
  const safePage = Math.max(0, Math.min(Number(page) || 0, totalPages - 1));
  const visibleOptions = inviteOptions.slice(safePage * 25, (safePage + 1) * 25);
  const joined = Object.values(league.managers || {}).filter((manager) => !manager.isCpu).length;
  const target = Number(league.settings?.leagueSize || 10);
  const embed = new EmbedBuilder()
    .setTitle('Invite Fantasy Coaches')
    .setColor(0x5865f2)
    .setDescription(`Send fantasy season invites by DM. Accepted invites join the live ${target}-team league and use <#${FANTASY_CHAT_CHANNEL_ID}>.`)
    .addFields(
      { name: 'League', value: `${joined}/${target} teams joined`, inline: true },
      { name: 'Invite Pool', value: inviteOptions.length ? `${inviteOptions.length} coaches available${totalPages > 1 ? ` • Page ${safePage + 1}/${totalPages}` : ''}` : 'No coaches found from assignments/coach roles.', inline: false },
    );
  const components = [];
  if (visibleOptions.length) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(inviteActionId(mode, 'invite_select', safePage, seasonKey))
        .setPlaceholder('Invite coaches to fantasy')
        .setMinValues(1)
        .setMaxValues(Math.min(target, visibleOptions.length))
        .addOptions(visibleOptions),
    ));
  }
  if (totalPages > 1) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(inviteActionId(mode, 'invite_prev', safePage, seasonKey)).setLabel('Prev Coaches').setStyle(ButtonStyle.Secondary).setDisabled(safePage <= 0),
      new ButtonBuilder().setCustomId(inviteActionId(mode, 'invite_next', safePage, seasonKey)).setLabel('Next Coaches').setStyle(ButtonStyle.Secondary).setDisabled(safePage >= totalPages - 1),
    ));
  }
  return { content: content || undefined, embeds: [embed], components };
}

async function sendFantasyInviteDM(client, guildId, seasonKey, hostUser, member) {
  const user = member?.user || await client.users.fetch(member?.id || '').catch(() => null);
  if (!user) return false;
  const isMockInvite = String(seasonKey || '').includes(':mock');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`madden_fantasy|invite_accept|${guildId}|${encodeURIComponent(seasonKey)}`)
      .setLabel(isMockInvite ? 'Accept Mock Invite' : 'Accept Fantasy Invite')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`madden_fantasy|invite_decline|${guildId}|${encodeURIComponent(seasonKey)}`)
      .setLabel('Decline')
      .setStyle(ButtonStyle.Danger),
  );
  const assignedTeams = coachTeamsForMember(member);
  const embed = new EmbedBuilder()
    .setTitle(isMockInvite ? 'Fantasy Mock Draft Invite' : 'Madden Fantasy Invite')
    .setColor(0x5865f2)
    .setDescription(`<@${hostUser.id}> invited you to ${isMockInvite ? 'a fantasy mock draft' : 'the 10-team Madden fantasy season'}.\n\nPress **${isMockInvite ? 'Accept Mock Invite' : 'Accept Fantasy Invite'}** to join. Fantasy chat is <#${FANTASY_CHAT_CHANNEL_ID}>.`)
    .addFields(
      { name: 'Your Madden Team', value: assignedTeams.length ? assignedTeams.join(', ') : 'No team assignment found', inline: false },
      { name: 'Format', value: '10 teams max • 2 conferences of 5 • top 3 per conference • #1 seed gets a bye', inline: false },
    );
  const sent = await user.send({ embeds: [embed], components: [row] }).catch(() => null);
  return Boolean(sent);
}

async function notifyFantasyInviteHost(client, hostId, message) {
  const host = await client.users.fetch(hostId).catch(() => null);
  await host?.send?.({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('Fantasy Invite Update').setDescription(message)] }).catch(() => null);
}

async function sendFantasyDraftRecapDMs(client, guildId, seasonKey, league, snapshot) {
  if (league.summarySentAt || league.draft?.status !== 'complete') return;
  const recaps = buildFantasyDraftRecaps(league, snapshot);
  for (const recap of recaps) {
    const user = await client.users.fetch(recap.userId).catch(() => null);
    await user?.send?.({ embeds: [recap.embed] }).catch(() => null);
  }
  mutateFantasyLeague({ guildId, seasonKey }, (draftLeague) => {
    draftLeague.summarySentAt = Date.now();
    return draftLeague;
  });
}

export async function execute(interaction) {
  if (!(interaction instanceof ButtonInteraction) && !(interaction instanceof StringSelectMenuInteraction)) return;
  const parts = interaction.customId.split('|');
  const { action, value, mode, seasonKeyOverride, guildIdOverride } = parseParts(interaction);

  if (!interaction.deferred && !interaction.replied) {
    if (action === 'pick') await interaction.deferUpdate();
    else await interaction.deferUpdate();
  }

  if (action === 'invite_accept' || action === 'invite_decline') {
    const guildId = parts[2];
    const seasonKey = decodeURIComponent(parts[3] || '');
    if (!guildId || !seasonKey) {
      await interaction.editReply({ content: 'That fantasy invite is missing league context.', embeds: [], components: [] });
      return;
    }
    const access = await ensureFantasyAccess(interaction, guildId);
    if (!access.ok) return;
    const inviteLeague = ensureFantasyLeague({ guildId, seasonKey });
    const pending = inviteLeague.pendingInvites?.[interaction.user.id];
    if (!pending || (pending.expiresAt && Date.now() > pending.expiresAt)) {
      await interaction.editReply({ content: 'That fantasy invite is no longer pending.', embeds: [], components: [] });
      return;
    }
    if (action === 'invite_decline') {
      mutateFantasyLeague({ guildId, seasonKey }, (draftLeague) => {
        draftLeague.pendingInvites = draftLeague.pendingInvites || {};
        delete draftLeague.pendingInvites[interaction.user.id];
        return draftLeague;
      });
      await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('Fantasy Invite Declined').setColor(0xe74c3c).setDescription('No problem. You can ignore this invite.')], components: [] });
      await notifyFantasyInviteHost(interaction.client, pending.hostId, `<@${interaction.user.id}> declined the fantasy invite.`);
      return;
    }
    const guild = interaction.client.guilds.cache.get(guildId) || await interaction.client.guilds.fetch(guildId).catch(() => null);
    const member = guild?.members?.cache?.get(interaction.user.id) || await guild?.members?.fetch?.(interaction.user.id).catch(() => null);
    const leagueId = requireLeagueIdForGuild(guildId);
    const snapshot = loadLeagueSnapshot(leagueId);
    const maddenTeamIds = resolveCoachTeamIds(member, snapshot);
    const joinedLeague = mutateFantasyLeague({ guildId, seasonKey }, (draftLeague) => {
      upsertFantasyManager(draftLeague, member || { id: interaction.user.id, user: interaction.user }, maddenTeamIds);
      draftLeague.pendingInvites = draftLeague.pendingInvites || {};
      delete draftLeague.pendingInvites[interaction.user.id];
      return draftLeague;
    });
    const joinedCount = Object.values(joinedLeague.managers || {}).filter((manager) => !manager.isCpu).length;
    const isMockInvite = String(seasonKey || '').includes(':mock');
    const components = isMockInvite
      ? [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`madden_fantasy|mockkey_draft|${fantasyMockToken(guildId, seasonKey)}`)
          .setLabel('Open Mock Draft Room')
          .setStyle(ButtonStyle.Primary),
      )]
      : [];
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle(isMockInvite ? 'Mock Invite Accepted' : 'Fantasy Invite Accepted').setColor(0x2ecc71).setDescription(`You’re in. Fantasy chat is <#${FANTASY_CHAT_CHANNEL_ID}>.\n\n${isMockInvite ? 'Open the mock draft room below when the host starts.' : `League: ${joinedCount}/${joinedLeague.settings?.leagueSize || 10} teams joined.`}`)],
      components,
    });
    await notifyFantasyInviteHost(interaction.client, pending.hostId, `<@${interaction.user.id}> accepted the ${isMockInvite ? 'fantasy mock' : 'fantasy'} invite.${isMockInvite ? '' : ` League is now ${joinedCount}/${joinedLeague.settings?.leagueSize || 10}.`}`);
    return;
  }

  const accessGuildId = guildIdOverride || interaction.guildId;
  const access = await ensureFantasyAccess(interaction, accessGuildId);
  if (!access.ok) return;

  let context;
  try {
    context = await loadContext(interaction, mode, seasonKeyOverride, guildIdOverride);
  } catch {
    await replyError(interaction, 'Fantasy could not load the connected Madden league. Run `/sync`, then open `/fantasy` again.');
    return;
  }

  const { snapshot, seasonKey } = context;
  const activeGuildId = context.guildId || interaction.guildId;
  const componentSeasonKey = mode === 'mock' ? fantasyMockToken(activeGuildId, seasonKey) : seasonKey;
  let league = context.fantasyLeague;
  const userId = interaction.user.id;

  if (action === 'join') {
    league = mutateFantasyLeague({ guildId: activeGuildId, seasonKey }, (draftLeague) => (
      upsertFantasyManager(draftLeague, interaction.member, resolveCoachTeamIds(interaction.member, snapshot))
    ));
    await interaction.editReply(buildFantasyHubPayload(league, snapshot, userId, { mode, seasonKey: componentSeasonKey }));
    return;
  }

  if (action === 'invite') {
    const roleMap = loadRoleMapForGuild(activeGuildId);
    if (mode === 'mock' && league.hostId && league.hostId !== userId) {
      await replyError(interaction, 'Only the mock host can send invites for this draft.');
      return;
    }
    if (mode !== 'mock' && !hasStaffRole(interaction.member, roleMap)) {
      await replyError(interaction, 'Only staff can send fantasy invites.');
      return;
    }
    const activeGuild = interaction.guild || await interaction.client.guilds.fetch(activeGuildId).catch(() => null);
    const inviteOptions = await buildFantasyInviteOptions(activeGuild, league, userId);
    await interaction.editReply(buildFantasyInvitePickerPayload(league, inviteOptions, 0, inviteOptions.length ? 'Choose coaches to invite.' : null, { mode, seasonKey: componentSeasonKey }));
    return;
  }

  if (action === 'invite_prev' || action === 'invite_next') {
    const roleMap = loadRoleMapForGuild(activeGuildId);
    if (mode === 'mock' && league.hostId && league.hostId !== userId) {
      await replyError(interaction, 'Only the mock host can page fantasy invites.');
      return;
    }
    if (mode !== 'mock' && !hasStaffRole(interaction.member, roleMap)) {
      await replyError(interaction, 'Only staff can page fantasy invites.');
      return;
    }
    const activeGuild = interaction.guild || await interaction.client.guilds.fetch(activeGuildId).catch(() => null);
    const inviteOptions = await buildFantasyInviteOptions(activeGuild, league, userId);
    const totalPages = Math.max(1, Math.ceil(inviteOptions.length / 25));
    const currentPage = Number.isFinite(Number(value)) ? Number(value) : 0;
    const nextPage = action === 'invite_next'
      ? Math.min(totalPages - 1, currentPage + 1)
      : Math.max(0, currentPage - 1);
    await interaction.editReply(buildFantasyInvitePickerPayload(league, inviteOptions, nextPage, null, { mode, seasonKey: componentSeasonKey }));
    return;
  }

  if (action === 'invite_select') {
    const roleMap = loadRoleMapForGuild(activeGuildId);
    if (mode === 'mock' && league.hostId && league.hostId !== userId) {
      await replyError(interaction, 'Only the mock host can send fantasy invites.');
      return;
    }
    if (mode !== 'mock' && !hasStaffRole(interaction.member, roleMap)) {
      await replyError(interaction, 'Only staff can send fantasy invites.');
      return;
    }
    const selectedIds = Array.from(new Set(interaction.values || [])).filter(Boolean);
    let invited = 0;
    let alreadyJoined = 0;
    let alreadyPending = 0;
    let dmFailed = 0;
    for (const invitedUserId of selectedIds) {
      const freshLeague = ensureFantasyLeague({ guildId: activeGuildId, seasonKey });
      if (freshLeague.managers?.[invitedUserId]) {
        alreadyJoined += 1;
        continue;
      }
      const pending = freshLeague.pendingInvites?.[invitedUserId];
      if (pending && (!pending.expiresAt || pending.expiresAt > Date.now())) {
        alreadyPending += 1;
        continue;
      }
      const activeGuild = interaction.guild || await interaction.client.guilds.fetch(activeGuildId).catch(() => null);
      const member = activeGuild?.members?.cache?.get(invitedUserId) || await activeGuild?.members?.fetch?.(invitedUserId).catch(() => null);
      if (!member) {
        dmFailed += 1;
        continue;
      }
      mutateFantasyLeague({ guildId: activeGuildId, seasonKey }, (draftLeague) => {
        draftLeague.pendingInvites = draftLeague.pendingInvites || {};
        draftLeague.pendingInvites[invitedUserId] = {
          hostId: interaction.user.id,
          createdAt: Date.now(),
          expiresAt: Date.now() + INVITE_TTL_MS,
        };
        return draftLeague;
      });
      const ok = await sendFantasyInviteDM(interaction.client, activeGuildId, seasonKey, interaction.user, member);
      if (ok) {
        invited += 1;
      } else {
        dmFailed += 1;
        mutateFantasyLeague({ guildId: activeGuildId, seasonKey }, (draftLeague) => {
          draftLeague.pendingInvites = draftLeague.pendingInvites || {};
          delete draftLeague.pendingInvites[invitedUserId];
          return draftLeague;
        });
      }
    }
    league = ensureFantasyLeague({ guildId: activeGuildId, seasonKey });
    const activeGuild = interaction.guild || await interaction.client.guilds.fetch(activeGuildId).catch(() => null);
    const inviteOptions = await buildFantasyInviteOptions(activeGuild, league, userId);
    await interaction.editReply(buildFantasyInvitePickerPayload(league, inviteOptions, Number(value || 0), [
      invited ? `Invited: **${invited}**` : null,
      alreadyJoined ? `Already joined: **${alreadyJoined}**` : null,
      alreadyPending ? `Already pending: **${alreadyPending}**` : null,
      dmFailed ? `DM failed: **${dmFailed}**` : null,
    ].filter(Boolean).join(' • ') || 'No invites sent.', { mode, seasonKey: componentSeasonKey }));
    return;
  }

  if (action === 'start') {
    const roleMap = loadRoleMapForGuild(activeGuildId);
    if (mode === 'mock' && league.hostId && league.hostId !== userId) {
      await replyError(interaction, 'Only the mock host can start this fantasy mock draft.');
      return;
    }
    if (mode !== 'mock' && !hasStaffRole(interaction.member, roleMap)) {
      await replyError(interaction, 'Only staff can start the fantasy draft.');
      return;
    }
    let result = null;
    league = mutateFantasyLeague({ guildId: activeGuildId, seasonKey }, (draftLeague) => {
      if (mode === 'mock') resetFantasyDraft(draftLeague);
      result = startFantasyDraft(draftLeague, mode === 'mock' ? { soloMockUserId: userId } : {});
      if (result?.ok) autoSimFantasyUntilManualPick(draftLeague, snapshot);
      return draftLeague;
    });
    if (!result?.ok) {
      await replyError(interaction, result?.reason || 'Fantasy draft could not be started.');
      return;
    }
    await interaction.editReply(buildFantasyDraftPayload(league, snapshot, userId, { mode, seasonKey: componentSeasonKey }));
    return;
  }

  if (action === 'reset') {
    if (mode !== 'mock') {
      await replyError(interaction, 'Only the mock draft can be reset from this button.');
      return;
    }
    if (league.hostId && league.hostId !== userId) {
      await replyError(interaction, 'Only the mock host can reset this fantasy mock draft.');
      return;
    }
    league = mutateFantasyLeague({ guildId: activeGuildId, seasonKey }, (draftLeague) => {
      resetFantasyDraft(draftLeague);
      return draftLeague;
    });
    await interaction.editReply(buildFantasyHubPayload(league, snapshot, userId, { mode, seasonKey: componentSeasonKey }));
    return;
  }

  if (action === 'autopick') {
    let result = null;
    league = mutateFantasyLeague({ guildId: activeGuildId, seasonKey }, (draftLeague) => {
      result = toggleFantasyAutoPick(draftLeague, userId);
      if (result?.ok) autoSimFantasyUntilManualPick(draftLeague, snapshot);
      return draftLeague;
    });
    if (!result?.ok) {
      await replyError(interaction, result?.reason || 'Could not update auto pick.');
      return;
    }
    await sendFantasyDraftRecapDMs(interaction.client, activeGuildId, seasonKey, league, snapshot);
    await interaction.editReply({
      content: `Auto Pick is now **${result.enabled ? 'ON' : 'OFF'}**.`,
      ...buildFantasyDraftPayload(league, snapshot, userId, { mode, seasonKey: componentSeasonKey }),
    });
    return;
  }

  if (action === 'pick') {
    const assetId = interaction.values?.[0];
    let result = null;
    league = mutateFantasyLeague({ guildId: activeGuildId, seasonKey }, (draftLeague) => {
      const asset = findFantasyAsset(draftLeague, snapshot, assetId, userId);
      result = asset ? makeFantasyPick(draftLeague, asset, userId) : { ok: false, reason: 'That board item is no longer available.' };
      if (result?.ok) autoSimFantasyUntilManualPick(draftLeague, snapshot);
      return draftLeague;
    });
    if (!result?.ok) {
      await replyError(interaction, result?.reason || 'Pick could not be made.');
      return;
    }
    await sendFantasyDraftRecapDMs(interaction.client, activeGuildId, seasonKey, league, snapshot);
    await interaction.editReply(buildFantasyDraftPayload(league, snapshot, userId, { mode, seasonKey: componentSeasonKey }));
    return;
  }

  if (action === 'board') {
    await interaction.editReply(buildFantasyBoardPayload(league, snapshot, userId, Number(value || 0), { mode, seasonKey: componentSeasonKey }));
    return;
  }

  if (action === 'team') {
    await interaction.editReply(buildFantasyTeamPayload(league, snapshot, userId, { seasonKey: componentSeasonKey }));
    return;
  }

  if (action === 'standings') {
    await interaction.editReply(buildFantasyStandingsPayload(league, snapshot, { seasonKey: componentSeasonKey }));
    return;
  }

  if (action === 'draft') {
    await interaction.editReply(buildFantasyDraftPayload(league, snapshot, userId, { mode, seasonKey: componentSeasonKey }));
    return;
  }

  if (action === 'trade') {
    await interaction.editReply(buildFantasyTradePayload(league, userId));
    return;
  }

  await interaction.editReply(buildFantasyHubPayload(league, snapshot, userId, { mode, seasonKey: componentSeasonKey }));
}

export default { customId, execute };
