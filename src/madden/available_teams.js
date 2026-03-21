import fs from 'fs';
import path from 'path';
import { EmbedBuilder } from 'discord.js';
import { draftOrder, applyPickTrades } from './coach/mockdraft.js';
import { loadLeagueSnapshot } from './madden_data.js';
import { getFullTeamName } from '../shared/madden_team_names.js';
import { loadMaddenChannelMap } from '../shared/madden_metadata.js';
import { getGuildPinsMap, getGuildRoleMap, upsertGuildPin } from '../shared/madden_guild_config.js';
import { getMaddenDataFilePath, getMaddenLeaguesDir } from '../leaguebuddy/paths.js';
import { renderLeagueBoardImage } from '../shared/madden_board_renderer.js';

const ROLE_MAP_FILE = getMaddenDataFilePath('madden_role_ids.json');
const PIN_FILE = getMaddenDataFilePath('pins_available_teams.json');
const LEAGUE_DIR = getMaddenLeaguesDir();

const CONFERENCES = {
  AFC: new Set([
    'Bills', 'Dolphins', 'Patriots', 'Jets',
    'Ravens', 'Bengals', 'Browns', 'Steelers',
    'Texans', 'Colts', 'Jaguars', 'Titans',
    'Broncos', 'Chiefs', 'Raiders', 'Chargers'
  ]),
  NFC: new Set([
    'Cowboys', 'Giants', 'Eagles', 'Commanders',
    'Bears', 'Lions', 'Packers', 'Vikings',
    'Falcons', 'Panthers', 'Saints', 'Buccaneers',
    'Cardinals', 'Rams', '49ers', 'Seahawks'
  ]),
};

function isConferenceTeam(conference, teamName = '') {
  const raw = String(teamName || '').trim();
  if (!raw) return false;
  if (conference.has(raw)) return true;
  const normalized = normalizeKey(raw);
  for (const candidate of conference) {
    const normalizedCandidate = normalizeKey(candidate);
    if (normalized === normalizedCandidate) return true;
    if (normalized.endsWith(normalizedCandidate)) return true;
  }
  return false;
}

function loadJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function saveJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data ?? {}, null, 2));
}

function loadLatestLeagueSnapshot() {
  try {
    const files = fs.readdirSync(LEAGUE_DIR).filter(f => f.endsWith('.json')).sort((a, b) =>
      fs.statSync(path.join(LEAGUE_DIR, b)).mtimeMs - fs.statSync(path.join(LEAGUE_DIR, a)).mtimeMs
    );
    if (!files.length) return null;
    return JSON.parse(fs.readFileSync(path.join(LEAGUE_DIR, files[0]), 'utf8'));
  } catch {
    return null;
  }
}

function loadLeagueSnapshotForOptions(options = {}) {
  if (options?.snapshot) return options.snapshot;
  if (options?.leagueId) {
    try {
      return loadLeagueSnapshot(options.leagueId);
    } catch {
      return null;
    }
  }
  return loadLatestLeagueSnapshot();
}

function normalizeKey(name = '') {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function formatTeamName(team) {
  return getFullTeamName(team, `Team ${team?.teamId}`);
}

function buildPickMap(league) {
  if (!league) return new Map();
  let order = [];
  try {
    const seasonYear =
      league?.info?.careerHubInfo?.seasonInfo?.calendarYear ||
      league?.info?.calendarYear ||
      league?.calendarYear;
    order = applyPickTrades(draftOrder(league), seasonYear);
  } catch {
    return new Map();
  }
  const map = new Map();
  order.forEach((pick, idx) => {
    const ownerName = pick.name || pick.nick || '';
    const keys = [
      normalizeKey(ownerName),
      normalizeKey(ownerName.split(/\s+/).pop() || ownerName),
    ].filter(Boolean);
    if (!keys.length) return;
    const entry = { num: idx + 1, via: pick.via };
    keys.forEach(k => {
      const list = map.get(k) || [];
      list.push(entry);
      map.set(k, list);
    });
  });
  return map;
}

function roleNamePriority(name = '') {
  const words = String(name).trim().split(/\s+/).length;
  return words;
}

function teamRoles(roleMap) {
  const byRoleId = new Map();
  for (const [name, id] of Object.entries(roleMap || {})) {
    if (!name.endsWith(' Coach') || !id) continue;
    const key = String(id);
    const team = name.replace(/ Coach$/, '');
    const existing = byRoleId.get(key);
    if (!existing || roleNamePriority(name) > roleNamePriority(`${existing.team} Coach`)) {
      byRoleId.set(key, { team, roleId: id });
    }
  }
  return [...byRoleId.values()];
}

function resolveCoachRoleIdForTeam(team, roleMap) {
  const fullName = formatTeamName(team);
  const nickName = String(team?.displayName || team?.nickName || '').trim();
  const aliases = [
    `${fullName} Coach`,
    `${nickName} Coach`,
    fullName,
    nickName,
  ].filter(Boolean);
  for (const alias of aliases) {
    const exact = roleMap?.[alias];
    if (exact) return exact;
  }
  const normalizedAliases = aliases.map((alias) => normalizeKey(alias));
  for (const [name, roleId] of Object.entries(roleMap || {})) {
    if (!roleId) continue;
    if (normalizedAliases.includes(normalizeKey(name))) return roleId;
  }
  return null;
}

function buildTeamEntries(league, roleMap) {
  const snapshotTeams = league?.teams?.leagueTeamInfoList || [];
  if (snapshotTeams.length) {
    return snapshotTeams.map((team) => ({
      team: formatTeamName(team),
      rawTeam: String(team?.displayName || team?.nickName || formatTeamName(team)).trim(),
      roleId: resolveCoachRoleIdForTeam(team, roleMap),
    }));
  }
  return teamRoles(roleMap).map((entry) => ({
    team: entry.team,
    rawTeam: entry.team,
    roleId: entry.roleId,
  }));
}

function formatAssignments(guild, roles, opts = {}) {
  const { pickMap = new Map(), isOffseason = false, teamInfoByName = new Map() } = opts;
  return roles.map(r => {
    const role = guild.roles.cache.get(r.roleId);
    if (!role) return { team: r.team, value: 'Open' };
    const members = [...role.members.values()];
    // Show coach names without raw mention IDs to avoid ugly formatting
    const names = members.length
      ? members.map(m => m.displayName || m.user?.username || m.user?.tag || m.id).join(', ')
      : 'Open';
    let value = names;
    if (members.length === 0 && isOffseason) {
      const teamInfo = teamInfoByName.get(normalizeKey(r.team));
      const fullName = teamInfo ? formatTeamName(teamInfo) : r.team;
      const keys = [
        normalizeKey(fullName),
        normalizeKey(fullName.split(/\s+/).pop() || fullName),
        normalizeKey(r.team),
      ].filter(Boolean);
      let merged = [];
      const seen = new Set();
      for (const key of keys) {
        if (seen.has(key)) continue;
        seen.add(key);
        const picks = pickMap.get(key);
        if (picks?.length) merged = merged.concat(picks);
      }
      const unique = [...new Map(merged.map((pick) => [`${pick.num}|${pick.via || ''}`, pick])).values()]
        .sort((a, b) => a.num - b.num)
        .slice(0, 5);
      if (unique.length) {
        value = `Open\nOwns picks: ${unique.map((pick) => pick.via ? `${pick.num} via ${pick.via}` : `${pick.num}`).join(', ')}`;
      }
    }
    return { team: r.team, value, rawTeam: r.team };
  });
}

function chunkFields(fields) {
  const chunks = [];
  let current = [];
  let len = 0;
  let count = 0;
  for (const f of fields) {
    const addLen = (f.name?.length || 0) + (f.value?.length || 0);
    const nextCount = count + 1;
    if ((len + addLen > 5500 || nextCount > 25) && current.length) {
      chunks.push(current);
      current = [];
      len = 0;
      count = 0;
    }
    current.push(f);
    len += addLen;
    count += 1;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export async function updateAvailableTeamsPin(client, guildId, options = {}) {
  const attempt = async () => {
    const roleMap = getGuildRoleMap(guildId) || loadJson(ROLE_MAP_FILE);
    const channelMap = loadMaddenChannelMap(guildId);
    const channelId = channelMap['Available Teams'];
    if (!channelId) {
      console.warn('[available-teams] Channel ID missing in madden_channel_ids.json');
      return false;
    }
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      console.warn('[available-teams] Guild not found');
      return false;
    }
    try { await guild.members.fetch(); } catch { }
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      console.warn('[available-teams] Channel not text-based or missing');
      return false;
    }

    const league = loadLeagueSnapshotForOptions(options);
    const roles = buildTeamEntries(league, roleMap).sort((a, b) => a.team.localeCompare(b.team));
    const seasonInfo = league?.info?.careerHubInfo?.seasonInfo || {};
    const isOffseason = (seasonInfo.seasonWeekType === 8) ||
      (seasonInfo.seasonTitle || '').toLowerCase().includes('offseason') ||
      (seasonInfo.isDraftActive === false && seasonInfo.isLeagueStarted === true && seasonInfo.seasonWeekType !== 1);
    const pickMap = buildPickMap(league);
    const debug = process.env.MOCK_DEBUG === 'true';
    if (debug) {
      console.log('[available-teams] seasonInfo', seasonInfo);
      console.log('[available-teams] isOffseason', isOffseason);
    }
    const teamInfoByName = new Map((league?.teams?.leagueTeamInfoList || []).map((team) => [normalizeKey(formatTeamName(team)), team]));
    const assignments = formatAssignments(guild, roles, { pickMap, isOffseason, teamInfoByName });

    const byConf = { AFC: [], NFC: [] };
    assignments.forEach(a => {
      if (isConferenceTeam(CONFERENCES.AFC, a.rawTeam) || isConferenceTeam(CONFERENCES.AFC, a.team)) byConf.AFC.push(a);
      else if (isConferenceTeam(CONFERENCES.NFC, a.rawTeam) || isConferenceTeam(CONFERENCES.NFC, a.team)) byConf.NFC.push(a);
    });

    const seasonLabel = isOffseason
      ? `Offseason${seasonInfo.offSeasonStage ? ` Stage ${seasonInfo.offSeasonStage}` : ''}`
      : `Week ${seasonInfo.displayWeek ?? seasonInfo.seasonWeek ?? '?'}`;

    const boardImage = await renderLeagueBoardImage({
      title: 'Available Teams',
      subtitle: `Season ${seasonInfo.seasonNumber ?? seasonInfo.seasonIndex ?? 'Current'} • ${seasonLabel}`,
      attachmentName: 'available_teams_board.png',
      accentColor: '#00A3FF',
      columns: [
        {
          title: 'AFC',
          items: byConf.AFC
            .sort((a, b) => a.rawTeam.localeCompare(b.rawTeam))
            .map((entry) => ({
              label: entry.team,
              meta: entry.value || 'Open',
              teamLike: entry.rawTeam || entry.team,
            })),
        },
        {
          title: 'NFC',
          items: byConf.NFC
            .sort((a, b) => a.rawTeam.localeCompare(b.rawTeam))
            .map((entry) => ({
              label: entry.team,
              meta: entry.value || 'Open',
              teamLike: entry.rawTeam || entry.team,
            })),
        },
      ],
    });

    if (!boardImage) {
      console.warn('[available-teams] No embeds built (no assignments/teams). Skipping.');
      return false;
    }

    const embed = new EmbedBuilder()
      .setTitle('Available Teams')
      .setDescription(`Season ${seasonInfo.seasonNumber ?? seasonInfo.seasonIndex ?? 'Current'} • ${seasonLabel}\nAuto-updated when coaches are assigned or the league updates.`)
      .setColor(0x00a3ff)
      .setImage(`attachment://${boardImage.name}`)
      .setTimestamp(new Date());

    const stored = loadJson(PIN_FILE);
    const guildPins = getGuildPinsMap(guildId) || {};
    const staticPinId = '1479545575903858791';
    const candidateIds = [guildPins.available_teams, stored?.pinId, staticPinId].filter(Boolean);
    let botPin = null;
    for (const id of candidateIds) {
      botPin = await channel.messages.fetch(id).catch(() => null);
      if (botPin) break;
    }
    if (!botPin) {
      const pinned = await channel.messages.fetchPinned().catch(() => null);
      botPin = pinned?.find((msg) => msg.author?.id === client.user?.id) || null;
    }
    if (!botPin) {
      const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
      botPin = recent?.find((msg) => msg.author?.id === client.user?.id && /Available Teams/i.test(msg.embeds?.[0]?.title || '')) || null;
    }
    if (botPin) {
      await botPin.edit({ embeds: [embed], files: [boardImage], content: null }).catch(() => null);
      if (!botPin.pinned) await botPin.pin().catch(() => null);
      saveJson(PIN_FILE, { pinId: botPin.id, channelId });
      upsertGuildPin(guildId, 'available_teams', botPin.id);
      return true;
    }
    const sent = await channel.send({ embeds: [embed], files: [boardImage], content: null }).catch(() => null);
    if (!sent) {
      console.warn('[available-teams] Failed to create available teams pin message.');
      return false;
    }
    await sent.pin().catch(() => null);
    saveJson(PIN_FILE, { pinId: sent.id, channelId });
    upsertGuildPin(guildId, 'available_teams', sent.id);
    return true;
  };

  await attempt();
}

export default { updateAvailableTeamsPin };
