import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { requireLeagueIdForGuild, loadLeagueSnapshot } from '../../../madden/madden_data.js';
import { computePlayerValue as computeValueBase } from '../../../madden/madden_trade_modal_submit.js';
import { coachCommandDescription } from '../../shared/madden_coach_voice.js';
import { loadMaddenChannelMap } from '../../shared/madden_metadata.js';
import { getGuildRoleMap } from '../../shared/madden_guild_config.js';
import { getUserTeam } from '../../shared/user_team_lookup.js';
import { getMaddenDataFilePath } from '../../leaguebuddy/paths.js';
import { applyEmbedThumbnailFromAsset, getNflTeamLogoAsset } from '../../shared/madden_assets.js';
import { getDevTraitEmoji } from '../../shared/application_emojis.js';
import { getFullTeamName } from '../../shared/madden_team_names.js';

export const featureKey = 'trades_basic';

const BLOCK_FILE = getMaddenDataFilePath('trade_block.json');
const ROLE_MAP_FILE = getMaddenDataFilePath('madden_role_ids.json');
function loadJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function saveJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function loadTradeBlockStore() {
  const raw = loadJson(BLOCK_FILE);
  if (raw && typeof raw === 'object' && raw.byGuild && typeof raw.byGuild === 'object') {
    return raw;
  }
  return { byGuild: { __legacy_global__: raw && typeof raw === 'object' ? raw : {} } };
}

function getGuildTradeBlock(store, guildId) {
  if (!store.byGuild[String(guildId)]) {
    store.byGuild[String(guildId)] = {};
  }
  return store.byGuild[String(guildId)];
}

function saveTradeBlockStore(store) {
  saveJson(BLOCK_FILE, store);
}

function normalizeName(name) {
  if (!name) return '';
  return String(name).trim().toLowerCase();
}

function getOptionString(interaction, name) {
  const direct = interaction.options.getString(name);
  if (direct !== null && direct !== undefined) return direct;
  const stack = Array.isArray(interaction.options?.data) ? [...interaction.options.data] : [];
  while (stack.length) {
    const item = stack.shift();
    if (item?.name === name && item.value !== undefined && item.value !== null) return String(item.value);
    if (Array.isArray(item?.options)) stack.push(...item.options);
  }
  return null;
}

function normalizeTeamKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizePosition(position) {
  const raw = String(position || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const aliases = {
    RB: 'HB',
    EDG: 'EDGE',
    LEDGE: 'LEDG',
    REDGE: 'REDG',
    OLB: 'LB',
    ILB: 'LB',
  };
  return aliases[raw] || raw;
}

function playerPosition(player) {
  return normalizePosition(
    player?.position ||
    player?.displayPos ||
    player?.defaultPosition ||
    player?.positionName ||
    player?.playerPosition
  );
}

function playerMatchesPosition(player, positionFilter) {
  if (!positionFilter) return true;
  const selected = normalizePosition(positionFilter);
  const actual = playerPosition(player);
  if (!actual) return false;
  if (selected === actual) return true;
  if (selected === 'HB') return actual === 'RB';
  if (selected === 'LEDG') return actual === 'LE' || actual === 'LDE' || actual === 'LEDGE';
  if (selected === 'REDG') return actual === 'RE' || actual === 'RDE' || actual === 'REDGE';
  if (['SAM', 'MIKE', 'WILL'].includes(selected)) return ['LOLB', 'ROLB', 'MLB', 'LB', selected].includes(actual);
  return false;
}

function formatHeight(heightInches) {
  if (!heightInches || Number.isNaN(Number(heightInches))) return null;
  const total = Number(heightInches);
  const ft = Math.floor(total / 12);
  const inch = Math.round(total % 12);
  return `${ft}'${inch}"`;
}

function computeTradeValue(player) {
  try {
    return computeValueBase(player);
  } catch {
    const ovr = player?.overallRating ?? player?.playerBestOvr ?? player?.ovrRating ?? 0;
    return Math.max(1, Number(ovr) || 1);
  }
}



function rosterListFromBucket(bucket) {
  if (!bucket) return [];
  if (Array.isArray(bucket)) return bucket;
  if (Array.isArray(bucket.rosterInfoList)) return bucket.rosterInfoList;
  if (Array.isArray(bucket.rosterPlayerInfoList)) return bucket.rosterPlayerInfoList;
  if (Array.isArray(bucket.players)) return bucket.players;
  return [];
}

function getRoster(snapshot, teamIdOrName) {
  const rosters = snapshot?.rosters?.teams || {};
  const teams = snapshot?.teams?.leagueTeamInfoList || [];
  const teamObj = typeof teamIdOrName === 'object'
    ? teamIdOrName
    : findTeam(snapshot, teamIdOrName) || teams.find((team) =>
        String(team.teamId ?? '') === String(teamIdOrName ?? '') ||
        String(team.teamIndex ?? '') === String(teamIdOrName ?? '')
      );
  const matchIds = new Set([
    String(teamIdOrName ?? ''),
    String(teamObj?.teamId ?? ''),
    String(teamObj?.teamIndex ?? ''),
    teamObj?.displayName,
    teamObj?.nickName,
    teamObj?.teamName,
    teamObj?.abbrName,
    teamObj?.cityName,
    getFullTeamName(teamObj, ''),
  ].filter(Boolean).map((value) => normalizeTeamKey(value)));

  const directKeys = [
    String(teamObj?.teamId ?? ''),
    String(teamObj?.teamIndex ?? ''),
    String(teamIdOrName ?? ''),
  ].filter(Boolean);
  for (const key of directKeys) {
    const direct = rosterListFromBucket(rosters[key]);
    if (direct.length) return direct;
  }

  for (const [key, bucket] of Object.entries(rosters)) {
    const bucketTeam = teams.find((team) =>
      String(team.teamId ?? '') === String(bucket?.teamId ?? '') ||
      String(team.teamIndex ?? '') === String(bucket?.teamIndex ?? '') ||
      String(team.teamId ?? '') === String(key) ||
      String(team.teamIndex ?? '') === String(key)
    );
    const bucketIds = [
      key,
      bucket?.teamId,
      bucket?.teamIndex,
      bucketTeam?.displayName,
      bucketTeam?.nickName,
      bucketTeam?.teamName,
      bucketTeam?.abbrName,
      bucketTeam?.cityName,
      getFullTeamName(bucketTeam, ''),
    ].filter(Boolean).map((value) => normalizeTeamKey(value));
    if (bucketIds.some((id) => matchIds.has(id))) {
      const list = rosterListFromBucket(bucket);
      if (list.length) return list;
    }
  }

  const targetTeamId = String(teamObj?.teamId ?? teamIdOrName ?? '');
  if (targetTeamId) {
    const allPlayers = Object.values(rosters).flatMap(rosterListFromBucket);
    const filtered = allPlayers.filter((player) => String(player?.teamId ?? '') === targetTeamId);
    if (filtered.length) return filtered;
  }

  return [];
}

function getTeamCandidates(team = {}) {
  const fullName = getFullTeamName(team, '');
  return [
    team.displayName,
    team.nickName,
    team.teamName,
    team.abbrName,
    team.cityName,
    fullName,
  ].filter(Boolean);
}

function findTeam(snapshot, teamName) {
  const teams = snapshot?.teams?.leagueTeamInfoList || [];
  const target = normalizeTeamKey(teamName);
  if (!target) return null;
  const withCandidates = teams.map((team) => ({
    team,
    candidates: getTeamCandidates(team).map(normalizeTeamKey).filter(Boolean),
  }));
  const exact = withCandidates.find(({ candidates }) => candidates.includes(target));
  if (exact) return exact.team;
  const fuzzy = withCandidates.find(({ candidates }) =>
    candidates.some((candidate) => candidate.includes(target) || target.includes(candidate))
  );
  return fuzzy?.team || null;
}

function loadChannelMap(guildId = null) {
  return loadMaddenChannelMap(guildId);
}

function loadRoleMap(guildId = null) {
  const overlay = getGuildRoleMap(guildId);
  if (overlay && Object.keys(overlay).length) return overlay;
  return loadJson(ROLE_MAP_FILE);
}

async function announce(client, roleMap, channelMap, teamName, cleanLabelText, detailText, positionText, rosterId) {
  const coachRoleId = roleMap['LEAGUEbuddy Coaches'] || roleMap['LB Coaches'] || roleMap['Ghost Legacy'];
  const coachTag = coachRoleId ? `<@&${coachRoleId}>` : null;
  const tradeChannelId = channelMap['Trade Block'] || channelMap['tradeSubmit'] || channelMap['Pending Trades'] || null;
  if (!tradeChannelId) return;
  const channel = await client.channels.fetch(tradeChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  // Find or create a team-specific thread inside the trade block channel
  const normTeam = (teamName || '').toLowerCase();
  const matchesTeam = (t) => {
    const name = (t?.name || '').toLowerCase();
    return name.includes(normTeam) || normTeam.includes(name.replace('trade block', '').trim());
  };
  let thread = null;
  try {
    const active = await channel.threads.fetchActive().catch(() => null);
    thread = active?.threads?.find(matchesTeam) || null;
    if (!thread) {
      const archived = await channel.threads.fetchArchived().catch(() => null);
      thread = archived?.threads?.find(matchesTeam) || null;
    }
    if (!thread) {
      thread = await channel.threads.create({
        name: `${teamName} Trade Block`,
        autoArchiveDuration: 10080, // 7 days
        reason: `Trade block thread for ${teamName}`,
      }).catch(() => null);
    }
  } catch { /* ignore thread discovery/creation errors */ }
  const target = thread || channel;

  // Short customId: mtrade:team:rosterId:label (kept well under Discord limits)
  const safeTeam = encodeURIComponent((teamName || 'team').slice(0, 12));
  const safeId = rosterId ? String(rosterId).slice(0, 18) : 'p';
  let shortLabel = (cleanLabelText || 'player').slice(0, 25);
  const base = `mtrade:${safeTeam}:${safeId}:`;
  const room = 90 - base.length; // ensure well under 100
  if (shortLabel.length > room) shortLabel = shortLabel.slice(0, Math.max(5, room));
  const customId = `${base}${encodeURIComponent(shortLabel)}`;
  const embed = new EmbedBuilder()
    .setTitle('New Trade Block Addition')
    .setDescription(`${detailText || cleanLabelText}\nTeam: ${teamName}`)
    .setColor(0x00AE86)
    .setTimestamp(new Date());
  let files = [];
  files = applyEmbedThumbnailFromAsset(embed, files, getNflTeamLogoAsset(teamName, 'trade_team.png'));
  const btn = new ButtonBuilder()
    .setCustomId(customId)
    .setLabel('Trade For')
    .setStyle(ButtonStyle.Primary);
  const row = new ActionRowBuilder().addComponents(btn);
  const msg = await target.send({ content: coachTag || null, embeds: [embed], components: [row], files }).catch(() => null);
  return msg ? { messageId: msg.id, threadId: thread?.id || null } : null;
}

function getPositions(snapshot, teamId) {
  const roster = getRoster(snapshot, teamId);
  const set = new Set(roster.map(p => playerPosition(p)).filter(Boolean));
  return Array.from(set).sort();
}

function playerLabel(p) {
  const fn = p.firstName || '';
  const ln = p.lastName || '';
  const name = `${fn} ${ln}`.trim() || (p.fullName || p.displayName || '').trim();
  return name || `#${p.rosterId}`;
}

function findPlayer(roster, name) {
  const target = normalizeName(name);
  const exact = roster.find(p => normalizeName(playerLabel(p)) === target);
  if (exact) return exact;
  return roster.find(p => {
    const candidate = normalizeName(playerLabel(p));
    return candidate && target && (candidate.includes(target) || target.includes(candidate));
  });
}

function formatDev(dev) {
  return getDevTraitEmoji(dev, { fallbackText: true });
}

const data = new SlashCommandBuilder()
  .setName('tradeblock')
  .setDescription(coachCommandDescription('tradeblock'))
  .addStringOption(o =>
    o.setName('action')
      .setDescription('add or remove')
      .setRequired(true)
      .addChoices(
        { name: 'add', value: 'add' },
        { name: 'remove', value: 'remove' },
      )
  )
  // Required player after action to satisfy Discord ordering
  .addStringOption(o =>
    o.setName('position')
      .setDescription('Filter by position')
      .setRequired(true)
      .addChoices(
        { name: 'All positions', value: 'ALL' },
        { name: 'QB', value: 'QB' },
        { name: 'HB', value: 'HB' },
        { name: 'FB', value: 'FB' },
        { name: 'WR', value: 'WR' },
        { name: 'TE', value: 'TE' },
        { name: 'LT', value: 'LT' },
        { name: 'LG', value: 'LG' },
        { name: 'C', value: 'C' },
        { name: 'RG', value: 'RG' },
        { name: 'RT', value: 'RT' },
        { name: 'LEDG', value: 'LEDG' },
        { name: 'REDG', value: 'REDG' },
        { name: 'DT', value: 'DT' },
        { name: 'SAM', value: 'SAM' },
        { name: 'MIKE', value: 'MIKE' },
        { name: 'WILL', value: 'WILL' },
        { name: 'CB', value: 'CB' },
        { name: 'FS', value: 'FS' },
        { name: 'SS', value: 'SS' },
        { name: 'K', value: 'K' },
        { name: 'P', value: 'P' }
      )
  )
  .addStringOption(o =>
    o.setName('player')
      .setDescription('Player name')
      .setRequired(true)
      .setAutocomplete(true)
  );

async function autocomplete(interaction) {
  let responded = false;
  const timeout = setTimeout(async () => {
    if (!responded) {
      responded = true;
      try { await interaction.respond([]); } catch { }
    }
  }, 1500);
  try {
    const focused = interaction.options.getFocused(true);
    const leagueId = requireLeagueIdForGuild(interaction.guildId);
    const snapshot = loadLeagueSnapshot(leagueId);
    const userTeamName = getUserTeam(interaction.guildId, interaction.user.id);
    if (!userTeamName) {
      responded = true;
      clearTimeout(timeout);
      await interaction.respond([]);
      return;
    }
    const teamObj = findTeam(snapshot, userTeamName);
    if (!teamObj) throw new Error('no team');
    const teamId = teamObj.teamId;
    const action = getOptionString(interaction, 'action');
    const positionChoice = getOptionString(interaction, 'position');
    const positionFilter = positionChoice === 'ALL' ? null : positionChoice;
    const roster = getRoster(snapshot, teamId);
    const blockStore = loadTradeBlockStore();
    const block = getGuildTradeBlock(blockStore, interaction.guildId);

    if (focused.name === 'player') {
      if (action === 'remove') {
        const existing = block[teamId] || [];
        const filtered = existing.filter(p => playerMatchesPosition(p, positionFilter));
        const list = filtered.map(p => p.name).filter(n => !focused.value || n.toLowerCase().includes(focused.value.toLowerCase()));
        responded = true;
        clearTimeout(timeout);
        await interaction.respond(list.slice(0, 25).map(n => ({ name: n, value: n })));
        return;
      }
      const list = roster
        .filter(p => playerMatchesPosition(p, positionFilter))
        .map(p => playerLabel(p))
        .filter(n => !focused.value || n.toLowerCase().includes(focused.value.toLowerCase()));
      responded = true;
      clearTimeout(timeout);
      await interaction.respond(list.slice(0, 25).map(n => ({ name: n, value: n })));
      return;
    }

    responded = true;
    clearTimeout(timeout);
    await interaction.respond([]);
  } catch (e) {
    if (!responded) {
      responded = true;
      clearTimeout(timeout);
      try { await interaction.respond([]); } catch { }
    }
  }
}

async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const action = getOptionString(interaction, 'action');
    const positionChoice = getOptionString(interaction, 'position');
    const positionFilter = positionChoice === 'ALL' ? null : positionChoice;
    const playerName = getOptionString(interaction, 'player');
    const leagueId = requireLeagueIdForGuild(interaction.guildId);
    const snapshot = loadLeagueSnapshot(leagueId);
    const channelMap = loadChannelMap(interaction.guildId);
    const roleMap = loadRoleMap(interaction.guildId);
    const userTeamName = getUserTeam(interaction.guildId, interaction.user.id);
    if (!userTeamName) {
      // Debug: show all teams assigned to this user in this guild
      const { getAllUserTeams } = await import('../../shared/user_team_lookup.js');
      const allTeams = getAllUserTeams(interaction.guildId, interaction.user.id);
      await interaction.editReply({ content: `Could not determine your team assignment. (Debug: assigned teams: ${JSON.stringify(allTeams)})` });
      return;
    }
    const teams = snapshot?.teams?.leagueTeamInfoList || [];
    const teamObj = findTeam(snapshot, userTeamName);
    if (!teamObj) {
      // Show debug info: list all official team names (normalized)
      const officialNames = teams.map(t => {
        return {
          displayName: t.displayName,
          nickName: t.nickName,
          teamName: t.teamName,
          abbrName: t.abbrName,
          cityName: t.cityName,
          fullName: getFullTeamName(t, ''),
          normalized: getTeamCandidates(t).map(normalizeTeamKey).join(' | ')
        };
      });
      await interaction.editReply({ content: `Could not match your assigned team (\`${userTeamName}\`) to a league team.\n\nOfficial team names (normalized):\n\n\`${JSON.stringify(officialNames, null, 2)}\`` });
      return;
    }
    const teamId = teamObj.teamId;
    const roster = getRoster(snapshot, teamId);
    if (!roster.length) {
      await interaction.editReply({ content: `No roster data found for ${getFullTeamName(teamObj, userTeamName)}. Run /sync, then try again.` });
      return;
    }
    const blockStore = loadTradeBlockStore();
    const block = getGuildTradeBlock(blockStore, interaction.guildId);
    block[teamId] = block[teamId] || [];

    if (action === 'add') {
      const player = findPlayer(
        roster.filter(p => playerMatchesPosition(p, positionFilter)),
        playerName
      );
      if (!player) {
        await interaction.editReply({ content: 'Player not found on your roster (check position filter if set).' });
        return;
      }
      const already = block[teamId].some(p => p.rosterId === player.rosterId);
      if (already) {
        await interaction.editReply({ content: `${playerLabel(player)} is already on your trade block.` });
        return;
      }
      block[teamId].push({
        rosterId: player.rosterId,
        name: playerLabel(player),
        position: playerPosition(player) || player.position,
        ovr: player.playerBestOvr || player.teamSchemeOvr || player.playerSchemeOvr || '',
        age: player.age || '',
        dev: formatDev(player.devTrait),
        messageId: null,
      });
      saveTradeBlockStore(blockStore);
      const position = playerPosition(player) || player.position || 'N/A';
      await interaction.editReply({ content: `${playerLabel(player)} (${position}) added to your trade block.` });
      const teamName = (snapshot.teams?.leagueTeamInfoList || []).find(t => t.teamId === teamId)?.displayName || 'Team';
      // Build a rich description for the post while keeping the modal label clean
      const cleanLabel = `${playerLabel(player)} (${position})`;
      const height = formatHeight(player.heightInches ?? player.height);
      const weight = player.weight ?? player.weightLbs ?? null;
      const dev = formatDev(player.devTrait);
      const ovr = player.playerBestOvr || player.teamSchemeOvr || player.playerSchemeOvr || player.overallRating || player.ovrRating;
      const tradeValue = computeTradeValue(player);
      const detailParts = [
        cleanLabel,
        ovr ? `OVR: ${ovr}` : null,
        player.age ? `Age: ${player.age}` : null,
        height ? `Ht: ${height}` : null,
        weight ? `Wt: ${weight} lbs` : null,
        dev ? `Dev: ${dev}` : null,
        tradeValue ? `Trade Value: ${tradeValue}` : null,
      ].filter(Boolean);
      const detailText = detailParts.join('\n');
      const msgInfo = await announce(interaction.client, roleMap, channelMap, teamName, cleanLabel, detailText, position, player.rosterId);
      if (msgInfo?.messageId) {
        block[teamId][block[teamId].length - 1].messageId = msgInfo.messageId;
        block[teamId][block[teamId].length - 1].threadId = msgInfo.threadId || null;
        saveTradeBlockStore(blockStore);
      }
      return;
    }

    if (action === 'remove') {
      const idx = block[teamId].findIndex(p => normalizeName(p.name) === normalizeName(playerName));
      if (idx === -1) {
        await interaction.editReply({ content: `${playerName} is not on your trade block.` });
        return;
      }
      const removed = block[teamId][idx];
      block[teamId].splice(idx, 1);
      saveTradeBlockStore(blockStore);
      // try to delete the trade block message if we created one
      try {
        if (removed.messageId) {
          const tradeChannelId = channelMap['Trade Block'] || channelMap['tradeSubmit'] || channelMap['Pending Trades'] || null;
          const threadId = removed.threadId;
          const targetChannelId = threadId || tradeChannelId;
          if (targetChannelId) {
            const targetChannel = await interaction.client.channels.fetch(targetChannelId).catch(() => null);
            if (targetChannel && targetChannel.isTextBased()) {
              const msg = await targetChannel.messages.fetch(removed.messageId).catch(() => null);
              if (msg) await msg.delete().catch(() => null);
            }
          }
        }
      } catch { /* ignore */ }
      await interaction.editReply({ content: `${removed.name} removed from your trade block.` });
      return;
    }

    await interaction.editReply({ content: 'Invalid action.' });
  } catch (e) {
    await interaction.editReply({ content: `Trade block failed: ${e?.message || e}` });
  }
}

export default { data, execute, autocomplete };
