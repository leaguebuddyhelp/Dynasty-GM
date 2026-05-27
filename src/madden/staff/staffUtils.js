import fs from 'fs';
import path from 'path';
import { PermissionFlagsBits } from 'discord.js';
import { getGuildRoleMap } from '../../shared/madden_guild_config.js';

const ROLE_MAP_FILE = path.join(process.cwd(), 'data', 'madden', 'madden_role_ids.json');
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
  if (member?.permissions?.has?.(PermissionFlagsBits.Administrator) || member?.permissions?.has?.(PermissionFlagsBits.ManageGuild)) {
    return true;
  }
  const map = roleMap || loadRoleMapForGuild(member?.guild?.id);
  const ids = STAFF_ROLE_NAMES.map(name => map[name]).filter(Boolean);
  if (!member?.roles?.cache) return false;
  if (ids.some(id => member.roles.cache.has(id))) {
    return true;
  }
  return member.roles.cache.some(r => STAFF_ROLE_KEYS.has(normalizedRoleName(r.name)));
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
