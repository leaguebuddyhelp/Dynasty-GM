import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { requireLeagueIdForGuild, loadLeagueSnapshot } from '../madden/madden_data.js';
import { hasStaffRole, loadRoleMapForGuild } from '../madden/staff/staffUtils.js';
import { getCoachAssignmentMap } from '../shared/madden_coach_assignments.js';
import { getTeamEmojiByName } from '../shared/madden_visuals.js';
import {
  buildFantasyBoard,
  buildFantasyBoardPayload,
  buildFantasyDraftPayload,
  buildFantasyDraftRecaps,
  buildFantasyHubPayload,
  buildFantasyStandingsPayload,
  buildFantasyTeamPayload,
  buildFantasyTradePayload,
  currentFantasyDrafter,
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
const MOCK_ROOM_IDLE_MS = 1000 * 60 * 60 * 6;
const FANTASY_PICK_TIMER_MS = 1000 * 30;
const FAST_CPU_PICK_MS = 250;
const activeFantasyMockTickers = new Set();

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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCpuFantasyUser(userId = '') {
  return String(userId || '').startsWith('cpu_');
}

function fantasyUserLabel(userId = '') {
  return isCpuFantasyUser(userId) ? 'CPU' : `<@${userId}>`;
}

function fantasyTeamEmoji(teamName = '') {
  return getTeamEmojiByName(teamName) || '';
}

function fantasyAssetButtonLabel(asset) {
  const raw = `${asset.position} ${asset.name}`.trim();
  return raw.slice(0, 80);
}

function discordEmojiData(rawEmoji = '') {
  const match = String(rawEmoji || '').match(/^<a?:([^:>]+):(\d+)>$/);
  if (!match) return null;
  return { name: match[1], id: match[2], animated: String(rawEmoji).startsWith('<a:') };
}

function fantasyPickEmbed(pick, title = 'Fantasy Pick Is In') {
  const emoji = fantasyTeamEmoji(pick.teamName);
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(0x2ecc71)
    .setDescription(`Pick ${pick.pickNo}: ${fantasyUserLabel(pick.userId)} selected ${emoji ? `${emoji} ` : ''}**${pick.position} ${pick.name}**`)
    .addFields(
      { name: 'Team', value: pick.teamName || 'N/A', inline: true },
      { name: 'Production', value: `${pick.points ?? 0} pts • ${pick.statLine || 'No stat line'}`.slice(0, 1024), inline: false },
    );
}

function fantasyOnClockPayload(league, snapshot, userId, componentSeasonKey) {
  const board = buildFantasyBoard(league, snapshot, { userId }).slice(0, 25);
  const pickNo = (league.draft?.picks || []).length + 1;
  const quickPicks = board.slice(0, 4);
  const embed = new EmbedBuilder()
    .setTitle(`Fantasy Mock Pick ${pickNo} • On The Clock`)
    .setColor(0xf39c12)
    .setDescription(`<@${userId}> is up. Use a quick-pick button or open the full menu.\n\nYou have **30 seconds**. If the clock expires, LEAGUEbuddy takes the top board value.`)
    .addFields(
      { name: 'Top Board', value: board.slice(0, 8).map((asset, idx) => `${idx + 1}. ${fantasyTeamEmoji(asset.teamName)} ${asset.position} **${asset.name}** (${asset.teamName}) - ${asset.draftValue} value`).join('\n') || 'No eligible players available.', inline: false },
    );
  const components = [];
  if (quickPicks.length) {
    components.push(new ActionRowBuilder().addComponents(
      ...quickPicks.map((asset, idx) => {
        const button = new ButtonBuilder()
          .setCustomId(`madden_fantasy|mockkey_quickpick|${componentSeasonKey}|${encodeURIComponent(asset.assetId)}`)
          .setLabel(`${idx + 1}. ${fantasyAssetButtonLabel(asset)}`)
          .setStyle(idx === 0 ? ButtonStyle.Primary : ButtonStyle.Secondary);
        const emoji = discordEmojiData(fantasyTeamEmoji(asset.teamName));
        if (emoji) button.setEmoji(emoji);
        return button;
      }),
    ));
  }
  if (board.length) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`madden_fantasy|mockkey_pick|${componentSeasonKey}|0`)
        .setPlaceholder('Make your fantasy pick')
        .addOptions(board.map((asset) => (
          new StringSelectMenuOptionBuilder()
            .setLabel(`${asset.position} ${asset.name}`.slice(0, 100))
            .setDescription(`${asset.teamName} • ${asset.draftValue} value • ${asset.points} pts • ${asset.statLine}`.slice(0, 100))
            .setValue(asset.assetId)
        ))),
    ));
  }
  components.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`madden_fantasy|mockkey_simpick|${componentSeasonKey}`)
      .setLabel('Sim My Pick')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`madden_fantasy|mockkey_autopick|${componentSeasonKey}`)
      .setLabel('Toggle Auto Pilot')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`madden_fantasy|mockkey_board|${componentSeasonKey}|0`)
      .setLabel('Full Board')
      .setStyle(ButtonStyle.Secondary),
  ));
  return { content: `<@${userId}> is on the clock.`, embeds: [embed], components };
}

function makeFantasyAutoPickForCurrent({ guildId, seasonKey, snapshot }) {
  let result = null;
  const league = mutateFantasyLeague({ guildId, seasonKey }, (draftLeague) => {
    const onClock = currentFantasyDrafter(draftLeague);
    const board = onClock ? buildFantasyBoard(draftLeague, snapshot, { userId: onClock, includeOwnTeam: isCpuFantasyUser(onClock) }) : [];
    const asset = board[0];
    result = asset && onClock
      ? makeFantasyPick(draftLeague, asset, onClock)
      : { ok: false, reason: 'No eligible fantasy asset available.' };
    return draftLeague;
  });
  return { league, result };
}

async function fantasyMockRoomIsUsable(client, league) {
  const roomId = league?.room?.channelId;
  if (!roomId) return false;
  if (!league?.room?.messageId) return false;
  if ((Date.now() - Number(league.room?.updatedAt || league.room?.createdAt || 0)) > MOCK_ROOM_IDLE_MS) return false;
  const room = await client.channels.fetch(roomId).catch(() => null);
  if (!room) return false;
  if (league.room?.messageId && room.messages?.fetch) {
    const message = await room.messages.fetch(league.room.messageId).catch(() => null);
    if (!message) return false;
  }
  return true;
}

async function syncFantasyMockRoomMessage(client, guildId, seasonKey, league, snapshot, userId, componentSeasonKey) {
  const roomId = league?.room?.channelId;
  const messageId = league?.room?.messageId;
  if (!roomId || !messageId) return null;
  const room = await client.channels.fetch(roomId).catch(() => null);
  const message = room?.messages?.fetch ? await room.messages.fetch(messageId).catch(() => null) : null;
  if (!message) return null;
  const payload = buildFantasyHubPayload(league, snapshot, userId, { mode: 'mock', seasonKey: componentSeasonKey });
  await message.edit(payload).catch(() => null);
  mutateFantasyLeague({ guildId, seasonKey }, (draftLeague) => {
    draftLeague.room = {
      ...(draftLeague.room || {}),
      updatedAt: Date.now(),
    };
    return draftLeague;
  });
  return message;
}

async function ensureFantasyMockRoom(interaction, guildId, seasonKey, league, snapshot, userId, componentSeasonKey) {
  if (await fantasyMockRoomIsUsable(interaction.client, league)) {
    const room = await interaction.client.channels.fetch(league.room.channelId).catch(() => null);
    await room?.members?.add?.(userId).catch(() => null);
    await syncFantasyMockRoomMessage(interaction.client, guildId, seasonKey, league, snapshot, userId, componentSeasonKey);
    return { ok: true, roomId: league.room.channelId, created: false };
  }

  let parent = interaction.guild?.channels?.cache?.get(FANTASY_CHAT_CHANNEL_ID) || null;
  if (!parent && interaction.guild?.channels?.fetch) {
    parent = await interaction.guild.channels.fetch(FANTASY_CHAT_CHANNEL_ID).catch(() => null);
  }
  if (!parent?.threads?.create) {
    return { ok: false, reason: `Fantasy chat <#${FANTASY_CHAT_CHANNEL_ID}> cannot create private mock rooms right now.` };
  }

  const roomName = `Fantasy Mock ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  const room = await parent.threads.create({
    name: roomName,
    autoArchiveDuration: 60,
    type: ChannelType.PrivateThread,
    reason: 'Private fantasy mock draft room',
    invitable: false,
  }).catch(() => null);
  if (!room) return { ok: false, reason: 'Could not create the private fantasy mock room.' };

  await room.members.add(userId).catch(() => null);
  let savedLeague = league;
  savedLeague = mutateFantasyLeague({ guildId, seasonKey }, (draftLeague) => {
    draftLeague.room = {
      channelId: room.id,
      parentChannelId: FANTASY_CHAT_CHANNEL_ID,
      hostId: userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    if (!draftLeague.hostId) draftLeague.hostId = userId;
    return draftLeague;
  });
  const message = await room.send(buildFantasyHubPayload(savedLeague, snapshot, userId, { mode: 'mock', seasonKey: componentSeasonKey })).catch(() => null);
  if (!message) return { ok: false, reason: 'Private fantasy mock room was created, but I could not post the draft controls inside it.' };
  if (message) {
    savedLeague = mutateFantasyLeague({ guildId, seasonKey }, (draftLeague) => {
      draftLeague.room = {
        ...(draftLeague.room || {}),
        messageId: message.id,
        updatedAt: Date.now(),
      };
      return draftLeague;
    });
  }
  return { ok: true, roomId: room.id, created: true, league: savedLeague };
}

async function runFantasyMockTicker(client, guildId, seasonKey, snapshot, hostId, componentSeasonKey) {
  const tickerKey = `${guildId}:${seasonKey}`;
  if (activeFantasyMockTickers.has(tickerKey)) return;
  activeFantasyMockTickers.add(tickerKey);
  try {
    while (true) {
      let league = ensureFantasyLeague({ guildId, seasonKey });
      if (league.draft?.status !== 'live') break;
      const roomId = league.room?.channelId;
      const room = roomId ? await client.channels.fetch(roomId).catch(() => null) : null;
      if (!room) break;
      const onClock = currentFantasyDrafter(league);
      if (!onClock) break;

      if (isCpuFantasyUser(onClock) || league.managers?.[onClock]?.autoPick) {
        await delay(FAST_CPU_PICK_MS);
        const { league: pickedLeague, result } = makeFantasyAutoPickForCurrent({ guildId, seasonKey, snapshot });
        if (!result?.ok) {
          await room.send({ embeds: [new EmbedBuilder().setTitle('Fantasy Pick Failed').setColor(0xe74c3c).setDescription(result?.reason || 'Could not make the CPU pick.')] }).catch(() => null);
          break;
        }
        await room.send({ embeds: [fantasyPickEmbed(result.pick, isCpuFantasyUser(onClock) ? 'CPU Fantasy Pick' : 'Auto Pick')] }).catch(() => null);
        await syncFantasyMockRoomMessage(client, guildId, seasonKey, pickedLeague, snapshot, hostId, componentSeasonKey);
        if (pickedLeague.draft?.status === 'complete') {
          await room.send({ embeds: [new EmbedBuilder().setTitle('Fantasy Mock Complete').setColor(0x2ecc71).setDescription('The fantasy mock draft is complete. Draft recaps are being sent by DM.')] }).catch(() => null);
          await sendFantasyDraftRecapDMs(client, guildId, seasonKey, pickedLeague, snapshot);
          break;
        }
        continue;
      }

      const pickNo = (league.draft?.picks || []).length + 1;
      const prompt = await room.send(fantasyOnClockPayload(league, snapshot, onClock, componentSeasonKey)).catch(() => null);
      const user = await client.users.fetch(onClock).catch(() => null);
      await user?.send?.({
        embeds: [
          new EmbedBuilder()
            .setTitle('You Are On The Clock')
            .setColor(0x5865f2)
            .setDescription(`It is your fantasy mock pick.\n\nOpen <#${roomId}> and make your pick. The timer is **30 seconds**.`),
        ],
      }).catch(() => null);

      await delay(FANTASY_PICK_TIMER_MS);
      league = ensureFantasyLeague({ guildId, seasonKey });
      const stillOnClock = league.draft?.status === 'live'
        && currentFantasyDrafter(league) === onClock
        && ((league.draft?.picks || []).length + 1) === pickNo;
      if (!stillOnClock) continue;

      const { league: pickedLeague, result } = makeFantasyAutoPickForCurrent({ guildId, seasonKey, snapshot });
      if (!result?.ok) {
        await prompt?.edit?.({ content: 'Timer expired, but no eligible auto pick was available.', embeds: [], components: [] }).catch(() => null);
        break;
      }
      await prompt?.edit?.({ content: `Time expired. Auto-picked **${result.pick.position} ${result.pick.name}** for <@${onClock}>.`, embeds: [fantasyPickEmbed(result.pick, 'Timer Auto Pick')], components: [] }).catch(() => null);
      await syncFantasyMockRoomMessage(client, guildId, seasonKey, pickedLeague, snapshot, hostId, componentSeasonKey);
      if (pickedLeague.draft?.status === 'complete') {
        await room.send({ embeds: [new EmbedBuilder().setTitle('Fantasy Mock Complete').setColor(0x2ecc71).setDescription('The fantasy mock draft is complete. Draft recaps are being sent by DM.')] }).catch(() => null);
        await sendFantasyDraftRecapDMs(client, guildId, seasonKey, pickedLeague, snapshot);
        break;
      }
    }
  } finally {
    activeFantasyMockTickers.delete(tickerKey);
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
  const isMock = normalizeFantasyMode(mode) === 'mock';
  const totalPages = Math.max(1, Math.ceil(inviteOptions.length / 25));
  const safePage = Math.max(0, Math.min(Number(page) || 0, totalPages - 1));
  const visibleOptions = inviteOptions.slice(safePage * 25, (safePage + 1) * 25);
  const joined = Object.values(league.managers || {}).filter((manager) => !manager.isCpu).length;
  const target = Number(league.settings?.leagueSize || 10);
  const participants = Object.values(league.managers || {})
    .filter((manager) => !manager.isCpu)
    .map((manager) => `<@${manager.userId}>${manager.teamName ? ` - ${manager.teamName}` : ''}`)
    .slice(0, 10);
  const embed = new EmbedBuilder()
    .setTitle(isMock ? 'Fantasy Mock Draft Host Panel' : 'Invite Fantasy Coaches')
    .setColor(0x5865f2)
    .setDescription(isMock
      ? `Invite coaches, start the mock, and jump back into the draft room from this panel. Mock chat lives in <#${FANTASY_CHAT_CHANNEL_ID}>.`
      : `Send fantasy season invites by DM. Accepted invites join the live ${target}-team league and use <#${FANTASY_CHAT_CHANNEL_ID}>.`)
    .addFields(
      { name: 'League', value: `${joined}/${target} teams joined`, inline: true },
      ...(isMock ? [
        { name: 'Room', value: league.room?.channelId ? `<#${league.room.channelId}>` : 'Private room will be created when the mock opens.', inline: true },
        { name: 'Participants', value: participants.length ? participants.join('\n') : 'No coaches added yet.', inline: false },
        { name: 'How To Use It', value: '1. Invite coaches\n2. Press `Start Mock`\n3. Coaches pick when they are on the clock\n4. CPU teams and auto-pick fill the gaps\n5. Draft recaps go to DMs when it ends', inline: false },
      ] : []),
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
  components.push(new ActionRowBuilder().addComponents(
    ...(isMock ? [
      new ButtonBuilder().setCustomId(inviteActionId(mode, 'invite', safePage, seasonKey)).setLabel('Invite Coaches').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(inviteActionId(mode, 'start', safePage, seasonKey)).setLabel('Start Mock').setStyle(ButtonStyle.Primary).setDisabled(league.draft?.status === 'live'),
      new ButtonBuilder().setCustomId(inviteActionId(mode, 'draft', safePage, seasonKey)).setLabel('Draft Room').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(inviteActionId(mode, 'hub', safePage, seasonKey)).setLabel('Mock Hub').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(inviteActionId(mode, 'reset', safePage, seasonKey)).setLabel('Reset Mock').setStyle(ButtonStyle.Danger),
    ] : [
      new ButtonBuilder().setCustomId(inviteActionId(mode, 'hub', safePage, seasonKey)).setLabel('Back to Hub').setStyle(ButtonStyle.Secondary),
    ]),
  ));
  return { content: content || undefined, embeds: [embed], components };
}

async function sendFantasyInviteDM(client, guildId, seasonKey, hostUser, member) {
  const user = member?.user || await client.users.fetch(member?.id || '').catch(() => null);
  if (!user) return false;
  const isMockInvite = String(seasonKey || '').includes(':mock');
  const inviteLeague = ensureFantasyLeague({ guildId, seasonKey });
  const roomLine = isMockInvite && inviteLeague.room?.channelId ? `\n\nRoom: <#${inviteLeague.room.channelId}>` : '';
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
    .setDescription(`<@${hostUser.id}> invited you to ${isMockInvite ? 'a fantasy mock draft' : 'the 10-team Madden fantasy season'}.${roomLine}\n\nPress **${isMockInvite ? 'Accept Mock Invite' : 'Accept Fantasy Invite'}** to join. Fantasy chat is <#${FANTASY_CHAT_CHANNEL_ID}>.`)
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
    if (isMockInvite && joinedLeague.room?.channelId) {
      const room = await interaction.client.channels.fetch(joinedLeague.room.channelId).catch(() => null);
      await room?.members?.add?.(interaction.user.id).catch(() => null);
      await syncFantasyMockRoomMessage(
        interaction.client,
        guildId,
        seasonKey,
        joinedLeague,
        snapshot,
        pending.hostId || interaction.user.id,
        fantasyMockToken(guildId, seasonKey),
      ).catch(() => null);
    }
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle(isMockInvite ? 'Mock Invite Accepted' : 'Fantasy Invite Accepted').setColor(0x2ecc71).setDescription(`You’re in. Fantasy chat is <#${FANTASY_CHAT_CHANNEL_ID}>.\n\n${isMockInvite ? `Open <#${joinedLeague.room?.channelId || FANTASY_CHAT_CHANNEL_ID}> to follow the mock and pick when you are on the clock.` : `League: ${joinedCount}/${joinedLeague.settings?.leagueSize || 10} teams joined.`}`)],
      components: [],
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

  if (mode === 'mock' && action === 'hub' && interaction.channelId !== league.room?.channelId) {
    const roomResult = await ensureFantasyMockRoom(interaction, activeGuildId, seasonKey, league, snapshot, userId, componentSeasonKey);
    if (!roomResult.ok) {
      await replyError(interaction, roomResult.reason || 'Could not open the private fantasy mock room.');
      return;
    }
    league = roomResult.league || ensureFantasyLeague({ guildId: activeGuildId, seasonKey });
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(roomResult.created ? 'Private Fantasy Mock Room Created' : 'Private Fantasy Mock Room Ready')
          .setColor(0x2ecc71)
          .setDescription(`Your fantasy mock draft room is ready: <#${roomResult.roomId}>.\n\nOpen that private thread to invite coaches, start the mock, and make picks.`),
      ],
      components: [],
    });
    return;
  }

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
    if (mode === 'mock' && league.draft?.status === 'live') {
      await interaction.editReply({
        content: `Fantasy mock is already live in <#${league.room?.channelId || interaction.channelId}>.`,
        embeds: [],
        components: [],
      });
      void runFantasyMockTicker(interaction.client, activeGuildId, seasonKey, snapshot, league.hostId || userId, componentSeasonKey).catch((error) => {
        console.error('[fantasy_mock] ticker failed', error?.message || error);
      });
      return;
    }
    let result = null;
    league = mutateFantasyLeague({ guildId: activeGuildId, seasonKey }, (draftLeague) => {
      if (mode === 'mock') resetFantasyDraft(draftLeague);
      result = startFantasyDraft(draftLeague, mode === 'mock' ? { soloMockUserId: userId } : {});
      if (result?.ok && mode !== 'mock') autoSimFantasyUntilManualPick(draftLeague, snapshot);
      return draftLeague;
    });
    if (!result?.ok) {
      await replyError(interaction, result?.reason || 'Fantasy draft could not be started.');
      return;
    }
    if (mode === 'mock') {
      await syncFantasyMockRoomMessage(interaction.client, activeGuildId, seasonKey, league, snapshot, userId, componentSeasonKey);
      await interaction.editReply({
        content: `Fantasy mock started in <#${league.room?.channelId || interaction.channelId}>. Picks now run live with a 30 second clock.`,
        embeds: [],
        components: [],
      });
      void runFantasyMockTicker(interaction.client, activeGuildId, seasonKey, snapshot, league.hostId || userId, componentSeasonKey).catch((error) => {
        console.error('[fantasy_mock] ticker failed', error?.message || error);
      });
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
      if (result?.ok && mode !== 'mock') autoSimFantasyUntilManualPick(draftLeague, snapshot);
      return draftLeague;
    });
    if (!result?.ok) {
      await replyError(interaction, result?.reason || 'Could not update auto pick.');
      return;
    }
    await sendFantasyDraftRecapDMs(interaction.client, activeGuildId, seasonKey, league, snapshot);
    if (mode === 'mock') {
      await interaction.editReply({
        content: `Auto Pick is now **${result.enabled ? 'ON' : 'OFF'}**.`,
        embeds: [],
        components: [],
      });
      void runFantasyMockTicker(interaction.client, activeGuildId, seasonKey, snapshot, league.hostId || userId, componentSeasonKey).catch((error) => {
        console.error('[fantasy_mock] ticker failed', error?.message || error);
      });
      return;
    }
    await interaction.editReply({
      content: `Auto Pick is now **${result.enabled ? 'ON' : 'OFF'}**.`,
      ...buildFantasyDraftPayload(league, snapshot, userId, { mode, seasonKey: componentSeasonKey }),
    });
    return;
  }

  if (action === 'simpick') {
    if (mode !== 'mock') {
      await replyError(interaction, 'Sim My Pick is only available inside fantasy mock drafts.');
      return;
    }
    if (currentFantasyDrafter(league) !== userId) {
      await replyError(interaction, 'You can only sim your pick when you are on the clock.');
      return;
    }
    const { league: pickedLeague, result } = makeFantasyAutoPickForCurrent({ guildId: activeGuildId, seasonKey, snapshot });
    if (!result?.ok) {
      await replyError(interaction, result?.reason || 'Could not sim your pick.');
      return;
    }
    await interaction.editReply({
      content: `Simmed pick: **${result.pick.position} ${result.pick.name}**.`,
      embeds: [fantasyPickEmbed(result.pick, 'Simmed Fantasy Pick')],
      components: [],
    });
    await syncFantasyMockRoomMessage(interaction.client, activeGuildId, seasonKey, pickedLeague, snapshot, pickedLeague.hostId || userId, componentSeasonKey);
    await sendFantasyDraftRecapDMs(interaction.client, activeGuildId, seasonKey, pickedLeague, snapshot);
    void runFantasyMockTicker(interaction.client, activeGuildId, seasonKey, snapshot, pickedLeague.hostId || userId, componentSeasonKey).catch((error) => {
      console.error('[fantasy_mock] ticker failed', error?.message || error);
    });
    return;
  }

  if (action === 'pick' || action === 'quickpick') {
    const assetId = action === 'quickpick' ? decodeURIComponent(value || '') : interaction.values?.[0];
    let result = null;
    league = mutateFantasyLeague({ guildId: activeGuildId, seasonKey }, (draftLeague) => {
      const asset = findFantasyAsset(draftLeague, snapshot, assetId, userId);
      result = asset ? makeFantasyPick(draftLeague, asset, userId) : { ok: false, reason: 'That board item is no longer available.' };
      if (result?.ok && mode !== 'mock') autoSimFantasyUntilManualPick(draftLeague, snapshot);
      return draftLeague;
    });
    if (!result?.ok) {
      await replyError(interaction, result?.reason || 'Pick could not be made.');
      return;
    }
    await sendFantasyDraftRecapDMs(interaction.client, activeGuildId, seasonKey, league, snapshot);
    if (mode === 'mock') {
      await interaction.editReply({
        content: `Pick submitted: **${result.pick.position} ${result.pick.name}**.`,
        embeds: [fantasyPickEmbed(result.pick)],
        components: [],
      });
      await syncFantasyMockRoomMessage(interaction.client, activeGuildId, seasonKey, league, snapshot, league.hostId || userId, componentSeasonKey);
      void runFantasyMockTicker(interaction.client, activeGuildId, seasonKey, snapshot, league.hostId || userId, componentSeasonKey).catch((error) => {
        console.error('[fantasy_mock] ticker failed', error?.message || error);
      });
      return;
    }
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
