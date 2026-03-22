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

export const featureKey = 'trades_basic';

const BLOCK_FILE = getMaddenDataFilePath('trade_block.json');
const ROLE_MAP_FILE = getMaddenDataFilePath('madden_role_ids.json');
const DEV_EMOJI_FILE = getMaddenDataFilePath('dev_emojis.json');

function loadJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function saveJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function normalizeName(name) {
  if (!name) return '';
  return name.trim().toLowerCase();
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



function getRoster(snapshot, teamId) {
  return snapshot?.rosters?.teams?.[teamId]?.rosterInfoList || [];
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
  const set = new Set(roster.map(p => p.position).filter(Boolean));
  return Array.from(set).sort();
}

function playerLabel(p) {
  const fn = p.firstName || '';
  const ln = p.lastName || '';
  const name = `${fn} ${ln}`.trim() || (p.fullName || '').trim();
  return name || `#${p.rosterId}`;
}

function findPlayer(roster, name) {
  const target = normalizeName(name);
  return roster.find(p => normalizeName(playerLabel(p)) === target);
}

function formatDev(dev) {
  const map = { 0: 'Normal', 1: 'Star', 2: 'Superstar', 3: 'X-Factor' };
  return map[dev] || 'Normal';
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
      // Debug: show all teams assigned to this user in this guild
      const { getAllUserTeams } = await import('../../shared/user_team_lookup.js');
      const allTeams = getAllUserTeams(interaction.guildId, interaction.user.id);
      await interaction.editReply({ content: `Could not determine your team assignment. (Debug: assigned teams: ${JSON.stringify(allTeams)})` });
      return;
    }
    const teams = snapshot?.teams?.leagueTeamInfoList || [];
    const teamObj = teams.find(t => {
      const candidates = [t.displayName, t.nickName, t.abbrName, t.cityName].map(normalizeName);
      return candidates.includes(normalizeName(userTeamName));
    });
    if (!teamObj) throw new Error('no team');
    const teamId = teamObj.teamId;
    const action = interaction.options.getString('action');
    const positionChoice = interaction.options.getString('position');
    const positionFilter = positionChoice === 'ALL' ? null : positionChoice;
    const roster = getRoster(snapshot, teamId);
    const block = loadJson(BLOCK_FILE);

    if (focused.name === 'player') {
      if (action === 'remove') {
        const existing = block[teamId] || [];
        const filtered = existing.filter(p => !positionFilter || p.position === positionFilter);
        const list = filtered.map(p => p.name).filter(n => !focused.value || n.toLowerCase().includes(focused.value.toLowerCase()));
        responded = true;
        clearTimeout(timeout);
        await interaction.respond(list.slice(0, 25).map(n => ({ name: n, value: n })));
        return;
      }
      const list = roster
        .filter(p => !positionFilter || p.position === positionFilter)
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
    const action = interaction.options.getString('action');
    const positionChoice = interaction.options.getString('position');
    const positionFilter = positionChoice === 'ALL' ? null : positionChoice;
    const playerName = interaction.options.getString('player');
    const leagueId = requireLeagueIdForGuild(interaction.guildId);
    const snapshot = loadLeagueSnapshot(leagueId);
    const channelMap = loadChannelMap(interaction.guildId);
    const userTeamName = getUserTeam(interaction.guildId, interaction.user.id);
    if (!userTeamName) {
      // Debug: show all teams assigned to this user in this guild
      const { getAllUserTeams } = await import('../../shared/user_team_lookup.js');
      const allTeams = getAllUserTeams(interaction.guildId, interaction.user.id);
      await interaction.editReply({ content: `Could not determine your team assignment. (Debug: assigned teams: ${JSON.stringify(allTeams)})` });
      return;
    }
    const teams = snapshot?.teams?.leagueTeamInfoList || [];
    const normalizedUserTeam = normalizeName(userTeamName);
    let teamObj = teams.find(t => {
      const candidates = [t.displayName, t.nickName, t.abbrName, t.cityName].map(normalizeName);
      return candidates.includes(normalizedUserTeam);
    });
    if (!teamObj) {
      // Try fuzzy match: check if userTeamName is a substring of any official team name
      teamObj = teams.find(t => {
        const candidates = [t.displayName, t.nickName, t.abbrName, t.cityName].map(normalizeName);
        return candidates.some(c => c.includes(normalizedUserTeam) || normalizedUserTeam.includes(c));
      });
    }
    if (!teamObj) {
      // Show debug info: list all official team names (normalized)
      const officialNames = teams.map(t => {
        return {
          displayName: t.displayName,
          nickName: t.nickName,
          abbrName: t.abbrName,
          cityName: t.cityName,
          normalized: [t.displayName, t.nickName, t.abbrName, t.cityName].map(normalizeName).join(' | ')
        };
      });
      await interaction.editReply({ content: `Could not match your assigned team (\`${userTeamName}\`) to a league team.\n\nOfficial team names (normalized):\n\n\`${JSON.stringify(officialNames, null, 2)}\`` });
      return;
    }
    const teamId = teamObj.teamId;
    const roster = getRoster(snapshot, teamId);
    const block = loadJson(BLOCK_FILE);
    block[teamId] = block[teamId] || [];

    if (action === 'add') {
      const player = findPlayer(
        roster.filter(p => !positionFilter || p.position === positionFilter),
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
        position: player.position,
        ovr: player.playerBestOvr || player.teamSchemeOvr || player.playerSchemeOvr || '',
        age: player.age || '',
        dev: formatDev(player.devTrait),
        messageId: null,
      });
      saveJson(BLOCK_FILE, block);
      await interaction.editReply({ content: `${playerLabel(player)} (${player.position}) added to your trade block.` });
      const teamName = (snapshot.teams?.leagueTeamInfoList || []).find(t => t.teamId === teamId)?.displayName || 'Team';
      // Build a rich description for the post while keeping the modal label clean
      const cleanLabel = `${playerLabel(player)} (${player.position})`;
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
      const msgInfo = await announce(interaction.client, roleMap, channelMap, teamName, cleanLabel, detailText, player.position || 'N/A', player.rosterId);
      if (msgInfo?.messageId) {
        block[teamId][block[teamId].length - 1].messageId = msgInfo.messageId;
        block[teamId][block[teamId].length - 1].threadId = msgInfo.threadId || null;
        saveJson(BLOCK_FILE, block);
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
      saveJson(BLOCK_FILE, block);
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
