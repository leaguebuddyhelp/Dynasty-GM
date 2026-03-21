import { SlashCommandBuilder } from 'discord.js';
import { updateAvailableTeamsPin } from '../../../madden/available_teams.js';
import { updateFairSimBoard } from '../../shared/fairsim_board.js';
import { setCoachAssignment } from '../../shared/madden_coach_assignments.js';
import { hasStaffRole, loadRoleMapForGuild } from './staffUtils.js';
import { resolveLeagueIdWithConfig, loadLeagueSnapshot } from '../../../madden/madden_data.js';
import { getFullTeamName } from '../../shared/madden_team_names.js';
import { saveGuildMaddenConfig, loadGuildMaddenConfig } from '../../shared/madden_guild_config.js';

const ASSIGNABLE = [
  'Trade Committee',
  'Ghost Legacy Trade Committee',
  'Madden Trade Committee',
  'LB Trade Committee',
  'LEAGUEbuddy Trade Committee',
  'LB Coaches',
  'LEAGUEbuddy Coaches',
];

function normalizeKey(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function scoreAutocompleteChoice(name = '', focused = '') {
  const normalizedName = normalizeKey(name);
  const normalizedFocused = normalizeKey(focused);
  if (!normalizedFocused) return 0;
  if (normalizedName === normalizedFocused) return 400;
  if (normalizedName.startsWith(normalizedFocused)) return 300;
  if (normalizedName.includes(normalizedFocused)) return 200;
  const words = String(name || '').toLowerCase().split(/\s+/);
  if (words.some((word) => word.startsWith(String(focused || '').toLowerCase()))) return 150;
  return 0;
}

function baseRoleBoost(name = '', optionName = 'role1') {
  if (optionName !== 'role2') return 0;
  if (name === 'LEAGUEbuddy Coaches') return 1000;
  if (name === 'LB Coaches') return 950;
  if (name === 'LEAGUEbuddy Trade Committee') return 850;
  if (name === 'LB Trade Committee') return 800;
  if (name === 'Trade Committee') return 750;
  return 0;
}

function buildCoachRoleNamesFromSnapshot(snapshot) {
  const teams = snapshot?.teams?.leagueTeamInfoList || [];
  return teams.map((team) => {
    const fullName = getFullTeamName(team, '').trim();
    return fullName ? `${fullName} Coach` : null;
  }).filter(Boolean);
}

function getLeaguebuddyCoachesRole(guild, roleMap) {
  const roleId = roleMap['LEAGUEbuddy Coaches'] || roleMap['LB Coaches'] || roleMap['Ghost Legacy'] || null;
  return roleId ? guild.roles.cache.get(roleId) || null : null;
}

async function ensureCoachRole(interaction, roleName) {
  let role = interaction.guild.roles.cache.find((item) => item.name === roleName) || null;
  if (!role) {
    role = await interaction.guild.roles.create({
      name: roleName,
      mentionable: false,
      reason: 'Coach role created on assignment',
    });
  }

  const cfg = loadGuildMaddenConfig(interaction.guildId) || {};
  cfg.compat = cfg.compat || {};
  cfg.compat.maddenRoleMap = cfg.compat.maddenRoleMap || {};
  const baseName = roleName.replace(/ coach$/i, '').trim();
  cfg.compat.maddenRoleMap[roleName] = role.id;
  cfg.compat.maddenRoleMap[baseName] = cfg.compat.maddenRoleMap[baseName] || role.id;
  saveGuildMaddenConfig(interaction.guildId, cfg);
  return role;
}

function persistCoachRoleMapping(guildId, role) {
  if (!guildId || !role?.id || !/ coach$/i.test(role.name || '')) return;
  const cfg = loadGuildMaddenConfig(guildId) || {};
  cfg.compat = cfg.compat || {};
  cfg.compat.maddenRoleMap = cfg.compat.maddenRoleMap || {};
  const roleName = role.name;
  const baseName = roleName.replace(/ coach$/i, '').trim();
  cfg.compat.maddenRoleMap[roleName] = role.id;
  cfg.compat.maddenRoleMap[baseName] = cfg.compat.maddenRoleMap[baseName] || role.id;
  saveGuildMaddenConfig(guildId, cfg);
}

function roleNamePriority(name = '') {
  if (name === 'LEAGUEbuddy Coaches') return 95;
  if (name === 'LB Coaches') return 94;
  if (name === 'LEAGUEbuddy Trade Committee') return 100;
  if (ASSIGNABLE.includes(name)) return 90;
  const words = String(name).trim().split(/\s+/).length;
  return name.endsWith(' Coach') ? words : 0;
}

const roleChoices = (roleMap) => {
  const byRoleId = new Map();
  for (const [name, roleId] of Object.entries(roleMap || {})) {
    if (!roleId) continue;
    if (!name.endsWith(' Coach') && !ASSIGNABLE.includes(name)) continue;
    const key = String(roleId);
    const existing = byRoleId.get(key);
    if (!existing || roleNamePriority(name) > roleNamePriority(existing.name)) {
      byRoleId.set(key, { name, value: name });
    }
  }
  return [...byRoleId.values()].sort((a, b) => a.name.localeCompare(b.name));
};

function coachChoicesFromSnapshot(interaction, roleMap) {
  const leagueId = resolveLeagueIdWithConfig(interaction.guildId);
  if (!leagueId) return [];
  let snapshot = null;
  try {
    snapshot = loadLeagueSnapshot(leagueId);
  } catch {
    return [];
  }
  const names = buildCoachRoleNamesFromSnapshot(snapshot);
  return names.map((name) => {
    const mappedId = roleMap[name];
    const existingRole = mappedId ? interaction.guild.roles.cache.get(mappedId) : interaction.guild.roles.cache.find((role) => role.name === name);
    return {
      name,
      value: name,
      existing: !!existingRole,
    };
  });
}

export const data = new SlashCommandBuilder()
  .setName('assignrole')
  .setDescription('Assign up to two Madden roles (coach or trade committee) to a user (Commish/Co-Commish only).')
  .addUserOption(o => o.setName('user').setDescription('User to assign').setRequired(true))
  .addStringOption(o => o.setName('role1').setDescription('First role to assign').setRequired(true).setAutocomplete(true))
  .addStringOption(o => o.setName('role2').setDescription('Second role to assign (optional)').setRequired(false).setAutocomplete(true))
  .setDefaultMemberPermissions(null);

export const skipDeploy = true;

export async function execute(interaction) {
  const roleMap = loadRoleMapForGuild(interaction.guildId);
  await interaction.deferReply({ ephemeral: true });
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!hasStaffRole(member, roleMap)) {
    await interaction.editReply({ content: 'Only server admins, LB Commish, or LB Co-Commish can use this command.' });
    return;
  }
  const target = interaction.options.getUser('user');
  const roleName1 = interaction.options.getString('role1');
  const roleName2 = interaction.options.getString('role2');

  const guildMember = await interaction.guild.members.fetch(target.id).catch(() => null);
  if (!guildMember) {
    await interaction.editReply({ content: 'User not found in this server.' });
    return;
  }

  const resolveRole = (name) => {
    const id = roleMap[name];
    if (id) return interaction.guild.roles.cache.get(id) || null;
    return interaction.guild.roles.cache.find((role) => role.name === name) || null;
  };

  let r1 = resolveRole(roleName1);
  if (!r1 && / coach$/i.test(roleName1)) {
    r1 = await ensureCoachRole(interaction, roleName1);
  }
  if (!r1) {
    await interaction.editReply({ content: `Role "${roleName1}" not found.` });
    return;
  }
  let r2 = null;
  if (roleName2) {
    r2 = resolveRole(roleName2);
    if (!r2 && / coach$/i.test(roleName2)) {
      r2 = await ensureCoachRole(interaction, roleName2);
    }
    if (!r2) {
      await interaction.editReply({ content: `Role "${roleName2}" not found.` });
      return;
    }
  }

  try {
    await guildMember.roles.add(r1);
    if (r2) await guildMember.roles.add(r2);
    persistCoachRoleMapping(interaction.guildId, r1);
    persistCoachRoleMapping(interaction.guildId, r2);
    const coachGroupRole = getLeaguebuddyCoachesRole(interaction.guild, roleMap);
    if (coachGroupRole && [/ coach$/i.test(r1.name), / coach$/i.test(r2?.name || '')].some(Boolean)) {
      await guildMember.roles.add(coachGroupRole).catch(() => null);
    }
    for (const role of [r1, r2].filter(Boolean)) {
      if (!/ coach$/i.test(role.name)) continue;
      const teamName = role.name.replace(/ coach$/i, '').trim();
      setCoachAssignment({
        guildId: interaction.guildId,
        userId: target.id,
        teamName,
        roleId: role.id,
        assignedByUserId: interaction.user.id,
        assignedByTag: interaction.user.tag,
      });
    }
    await interaction.editReply({ content: `Assigned ${r2 ? `"${r1.name}" and "${r2.name}"` : `"${r1.name}"`} to ${target.tag}.` });
    // Refresh available teams pin
    try {
      const leagueId = resolveLeagueIdWithConfig(interaction.guildId);
      await updateAvailableTeamsPin(interaction.client, interaction.guildId, {
        leagueId,
        allowCreate: true,
        delayMs: 0,
        retries: 3,
        retryDelayMs: 800,
        guild: interaction.guild,
        // fetch members to keep availability accurate right after role change
        skipMemberFetch: false
      });
    } catch (e) {
      console.warn('[madden-assignteam] available teams pin update skipped:', e?.message || e);
    }
    // Refresh sim strike board to reflect new coach assignment
    try { await updateFairSimBoard(interaction.client, interaction.guildId); } catch (e) { console.warn('[madden-assignteam] fair sim board update skipped:', e?.message || e); }
  } catch (err) {
    await interaction.editReply({ content: `Failed to assign roles: ${err.message || err}` });
  }
}

export async function autocomplete(interaction) {
  if (!interaction.isAutocomplete()) return;
  const roleMap = loadRoleMapForGuild(interaction.guildId);
  const focused = interaction.options.getFocused();
  const focusedName = interaction.options.getFocused(true)?.name || 'role1';
  const selectedRole1 = interaction.options.getString('role1');
  const options = [...roleChoices(roleMap), ...coachChoicesFromSnapshot(interaction, roleMap)]
    .filter((item, index, arr) => arr.findIndex((other) => normalizeKey(other.name) === normalizeKey(item.name)) === index)
    .filter((item) => focusedName !== 'role2' || normalizeKey(item.name) !== normalizeKey(selectedRole1))
    .map((item) => ({ ...item, score: scoreAutocompleteChoice(item.name, focused) + baseRoleBoost(item.name, focusedName) }))
    .filter((item) => !focused || item.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 25);
  try {
    await interaction.respond(options.map(({ name, value }) => ({ name, value })));
  } catch (err) {
    // Ignore stale/unknown interaction errors; they occur if the client cancels the autocomplete
    console.warn('[madden-assignrole autocomplete] respond failed:', err?.message || err);
  }
}

export default { data, execute, autocomplete };
