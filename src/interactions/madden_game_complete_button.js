import { ButtonInteraction, EmbedBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { getGuildRoleMap } from '../shared/madden_guild_config.js';
import { hasStaffRole, isStaffRoleName } from '../madden/staff/staffUtils.js';

const ROLE_MAP_FILE = path.join(process.cwd(), 'data', 'madden', 'madden_role_ids.json');

function loadRoleMap(guildId = null) {
  const overlay = guildId ? getGuildRoleMap(guildId) : null;
  if (overlay && Object.keys(overlay).length) return overlay;
  try { return JSON.parse(fs.readFileSync(ROLE_MAP_FILE, 'utf8')); } catch { return {}; }
}

function normalize(name) {
  if (!name) return name;
  const lower = name.toLowerCase();
  if (lower === 'g-men' || lower === 'gmen') return 'Giants';
  if (lower === 'pack' || lower === 'packers') return 'Packers';
  if (lower === 'jags') return 'Jaguars';
  if (lower === 'vikes' || lower === 'vikings') return 'Vikings';
  if (lower === 'fins' || lower === 'fins up' || lower === 'phins' || lower === 'dolphins') return 'Dolphins';
  if (lower === 'bucs' || lower === 'buccs' || lower === 'buccaneers') return 'Buccaneers';
  if (lower === 'pats' || lower === 'patriots') return 'Patriots';
  if (lower === 'bolts' || lower === 'chargers') return 'Chargers';
  return name;
}

function parseTeams(threadName) {
  // Expect formats like "Away vs Home - W1"
  const match = threadName.match(/(.+)\s+vs\s+(.+?)(?:\s+-\s+w\d+)?$/i);
  if (!match) return { away: null, home: null };
  return { away: normalize(match[1].trim()), home: normalize(match[2].trim()) };
}

function allowedCoachRoleIds(threadName, roleMap) {
  const { away, home } = parseTeams(threadName || '');
  const ids = [];
  if (away && roleMap[`${away} Coach`]) ids.push(roleMap[`${away} Coach`]);
  if (home && roleMap[`${home} Coach`]) ids.push(roleMap[`${home} Coach`]);
  return ids.filter(Boolean);
}

export const customId = /^madden_game_complete_/;

export async function execute(interaction) {
  if (!(interaction instanceof ButtonInteraction)) return;
  const roleMap = loadRoleMap(interaction.guildId);
  const thread = interaction.channel;
  const coachRoleIds = allowedCoachRoleIds(thread?.name || '', roleMap);
  const allowedIds = new Set([
    ...coachRoleIds,
    ...Object.entries(roleMap || {})
      .filter(([name]) => isStaffRoleName(name))
      .map(([, id]) => id)
      .filter(Boolean),
  ]);

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const authorized = hasStaffRole(member, roleMap) || member.roles.cache.some(r => allowedIds.has(r.id));
  if (!authorized) {
    await interaction.reply({ content: 'Only the two coaches for this game or LB Commish/Co-Commish can mark it complete.', ephemeral: true });
    return;
  }

  const staffMentions = Object.entries(roleMap || {})
    .filter(([name]) => isStaffRoleName(name))
    .map(([, id]) => `<@&${id}>`)
    .join(' ');
  const embed = new EmbedBuilder()
    .setTitle('Game Completed')
    .setDescription(`Marked by: ${interaction.user}`)
    .setTimestamp(new Date())
    .setColor(0x57F287);
  await thread.send({ content: staffMentions || null, embeds: [embed] });
  await interaction.reply({ content: 'Marked complete.', ephemeral: true });
}

export default { customId, execute };
