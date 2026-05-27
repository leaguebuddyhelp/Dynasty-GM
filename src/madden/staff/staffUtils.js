import fs from 'fs';
import path from 'path';
import { PermissionFlagsBits } from 'discord.js';
import { getGuildRoleMap } from '../../shared/madden_guild_config.js';

const ROLE_MAP_FILE = path.join(process.cwd(), 'data', 'madden', 'madden_role_ids.json');
const FALLBACK_STAFF_ROLE_IDS = new Set([
  '1506384868391522555',
  '1506384871453626528',
  ...String(process.env.LB_STAFF_ROLE_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
]);
export const STAFF_ROLE_NAMES = [
  'LB Commish',
  'LB Co-Commish',
  'LB Co Commish',
  'LB CoCommissioner',
  'LB Co-Commissioner',
  'LB Co Commissioner',
  'Commish',
  'Co-Commish',
  'Co Commish',
  'CoCommissioner',
  'Co-Commissioner',
  'Co Commissioner',
  'Ghost Legacy Commish',
  'Ghost Legacy Co-Commish',
];

function normalizedRoleName(name = '') {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

const STAFF_ROLE_KEYS = new Set(STAFF_ROLE_NAMES.map(normalizedRoleName));

export function isStaffRoleName(name = '') {
  return STAFF_ROLE_KEYS.has(normalizedRoleName(name));
}

function memberRoleIds(member) {
  if (member?.roles?.cache) {
    return [...member.roles.cache.keys()].map(String);
  }
  if (Array.isArray(member?.roles)) {
    return member.roles.map(String);
  }
  return [];
}

function memberRoleNames(member) {
  if (member?.roles?.cache) {
    return [...member.roles.cache.values()].map((role) => role?.name).filter(Boolean);
  }
  return [];
}

function guildRoleNameForId(member, roleId) {
  return member?.guild?.roles?.cache?.get?.(String(roleId))?.name || '';
}

function hasPermission(member, permission) {
  if (member?.permissions?.has?.(permission)) return true;
  const raw = member?.permissions?.bitfield ?? member?.permissions;
  if (raw === undefined || raw === null) return false;
  try {
    return (BigInt(raw) & BigInt(permission)) === BigInt(permission);
  } catch {
    return false;
  }
}

export function loadRoleMap() {
  try {
    return JSON.parse(fs.readFileSync(ROLE_MAP_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function loadRoleMapForGuild(guildId) {
  const overlay = guildId ? getGuildRoleMap(guildId) : null;
  if (overlay && Object.keys(overlay).length) return overlay;
  return loadRoleMap();
}

export function hasStaffRole(member, roleMap = null) {
  if (hasPermission(member, PermissionFlagsBits.Administrator) || hasPermission(member, PermissionFlagsBits.ManageGuild)) {
    return true;
  }
  const map = roleMap || loadRoleMapForGuild(member?.guild?.id);
  const ids = Object.entries(map || {})
    .filter(([name]) => isStaffRoleName(name))
    .map(([, id]) => id)
    .filter(Boolean);
  const roleIds = memberRoleIds(member);
  if (roleIds.some((roleId) => FALLBACK_STAFF_ROLE_IDS.has(String(roleId)))) {
    return true;
  }
  if (ids.some(id => roleIds.includes(String(id)))) {
    return true;
  }
  if (memberRoleNames(member).some(name => isStaffRoleName(name))) {
    return true;
  }
  return roleIds.some((roleId) => isStaffRoleName(guildRoleNameForId(member, roleId)));
}

export function staffOnlyMessage(action = 'use this command') {
  return `Only server admins, LB Commish, or LB Co-Commish can ${action}.`;
}

export async function ensureStaffInteraction(interaction, { action = 'use this command', roleMap = null } = {}) {
  let member = interaction?.member || null;
  if (!member?.roles?.cache && interaction?.guild?.members && interaction?.user?.id) {
    member = await interaction.guild.members.fetch(interaction.user.id).catch(() => member);
  }
  if (hasStaffRole(member, roleMap)) return true;
  const payload = { content: staffOnlyMessage(action), flags: 64 };
  if (interaction?.deferred || interaction?.replied) {
    await interaction.editReply({ content: payload.content }).catch(() => null);
  } else {
    await interaction.reply(payload).catch(() => null);
  }
  return false;
}
