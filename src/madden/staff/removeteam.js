import { SlashCommandBuilder } from 'discord.js';
import { updateAvailableTeamsPin } from '../../../madden/available_teams.js';
import { updateFairSimBoard } from '../../shared/fairsim_board.js';
import { loadLeagueSnapshot, resolveLeagueIdWithConfig } from '../../../madden/madden_data.js';
import { resetRecognitionUserSeason } from '../../shared/league_recognition.js';
import { resetSportsbookUserSeason } from '../../shared/madden_sportsbook.js';
import { appendMaddenStaffLog, postMaddenStaffLog } from '../../shared/madden_staff_ops.js';
import { removeCoachAssignment } from '../../shared/madden_coach_assignments.js';
import { getMaddenSeasonKey } from '../../shared/madden_metadata.js';
import { hasStaffRole, loadRoleMapForGuild } from './staffUtils.js';

const ASSIGNABLE = [
  'Trade Committee',
  'Ghost Legacy Trade Committee',
  'Madden Trade Committee',
  'Madden Trade Committe',
  'LB Trade Committee',
  'LEAGUEbuddy Trade Committee',
  'LB Coaches',
  'LEAGUEbuddy Coaches',
];

// Founder/test-protection: removing the founder's coach role for testing shouldn't wipe their state.
// Add IDs here as needed.
const PROTECTED_USER_IDS = new Set([
  // biccboyyy (founder)
  '1076243288056664234',
]);

function isProtectedCoachTarget(user) {
  const id = String(user?.id || '');
  if (id && PROTECTED_USER_IDS.has(id)) return true;
  const tag = String(user?.tag || '').toLowerCase();
  if (tag && tag.includes('biccboyy')) return true;
  return false;
}

function coachRoleIds(roleMap) {
  return Object.entries(roleMap)
    .filter(([name]) => / coach$/i.test(name))
    .map(([, id]) => id)
    .filter(Boolean);
}

function hasAnyCoachRole(member, roleMap) {
  const ids = coachRoleIds(roleMap);
  return ids.some((id) => member.roles.cache.has(id));
}

function getLeaguebuddyCoachesRole(guild, roleMap) {
  const roleId = roleMap['LEAGUEbuddy Coaches'] || roleMap['LB Coaches'] || roleMap['Ghost Legacy'] || null;
  return roleId ? guild.roles.cache.get(roleId) || null : null;
}

function roleNamePriority(name = '') {
  if (name === 'LEAGUEbuddy Coaches') return 95;
  if (name === 'LB Coaches') return 94;
  if (name === 'LEAGUEbuddy Trade Committee') return 100;
  if (ASSIGNABLE.includes(name)) return 90;
  const words = String(name).trim().split(/\s+/).length;
  return name.endsWith(' Coach') ? words : 0;
}

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
  if (optionName !== 'role2' && optionName !== 'extra_role') return 0;
  if (name === 'LEAGUEbuddy Coaches') return 1000;
  if (name === 'LB Coaches') return 950;
  if (name === 'LEAGUEbuddy Trade Committee') return 850;
  if (name === 'LB Trade Committee') return 800;
  if (name === 'Trade Committee') return 750;
  return 0;
}

const roleChoices = (roleMap, guild = null) => {
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
  if (guild?.roles?.cache) {
    guild.roles.cache.forEach((role) => {
      const name = String(role.name || '');
      if (!name.endsWith(' Coach') && !ASSIGNABLE.includes(name)) return;
      const key = String(role.id);
      const existing = byRoleId.get(key);
      if (!existing || roleNamePriority(name) > roleNamePriority(existing.name)) {
        byRoleId.set(key, { name, value: name });
      }
    });
  }
  return [...byRoleId.values()].sort((a, b) => a.name.localeCompare(b.name));
};

export const data = new SlashCommandBuilder()
  .setName('removerole')
  .setDescription('Remove up to two Madden roles (coach or trade committee) from a user (Commish/Co-Commish only).')
  .addUserOption(o => o.setName('user').setDescription('User to update').setRequired(true))
  .addStringOption(o => o.setName('role1').setDescription('First role to remove').setRequired(true).setAutocomplete(true))
  .addStringOption(o => o.setName('role2').setDescription('Second role to remove (optional)').setRequired(false).setAutocomplete(true))
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
  let roleName1 = interaction.options.getString('role') || interaction.options.getString('role1');
  const roleName2 = interaction.options.getString('extra_role') || interaction.options.getString('role2');

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

  // Resolve role1; if target doesn't have it, fall back to first assignable role they do have.
  let r1 = resolveRole(roleName1);
  if (r1 && !guildMember.roles.cache.has(r1.id)) {
    r1 = null;
  }
  if (!r1) {
    const assignableRoles = Object.entries(roleMap).filter(([n]) =>
      n.endsWith(' Coach') || ASSIGNABLE.includes(n)
    );
    const found = assignableRoles.find(([, id]) => guildMember.roles.cache.has(id));
    if (found) {
      roleName1 = found[0];
      r1 = resolveRole(roleName1);
    }
  }

  if (!r1) {
    await interaction.editReply({ content: `Could not resolve a coach role to remove for ${target.tag}.` });
    return;
  }
  let r2 = null;
  if (roleName2) {
    r2 = resolveRole(roleName2);
    if (!r2) {
      await interaction.editReply({ content: `Role "${roleName2}" not found.` });
      return;
    }
  }

  try {
    await guildMember.roles.remove(r1);
    if (r2) await guildMember.roles.remove(r2);
    for (const role of [r1, r2].filter(Boolean)) {
      if (!/ coach$/i.test(role.name)) continue;
      const teamName = role.name.replace(/ coach$/i, '').trim();
      removeCoachAssignment({
        guildId: interaction.guildId,
        userId: target.id,
        teamName,
        roleId: role.id,
      });
    }
    const refreshedMember = await interaction.guild.members.fetch(target.id).catch(() => guildMember);
    const removedCoachRole = [/ coach$/i.test(r1.name), / coach$/i.test(r2?.name || '')].some(Boolean);
    let systemsResetMessage = null;
    if (removedCoachRole && refreshedMember && !hasAnyCoachRole(refreshedMember, roleMap)) {
      const coachGroupRole = getLeaguebuddyCoachesRole(interaction.guild, roleMap);
      if (coachGroupRole && refreshedMember.roles.cache.has(coachGroupRole.id)) {
        await refreshedMember.roles.remove(coachGroupRole).catch(() => null);
      }
      if (isProtectedCoachTarget(target)) {
        systemsResetMessage = ' Note: coach systems reset was skipped because this user is protected for testing.';
      } else {
        const leagueId = resolveLeagueIdWithConfig(interaction.guildId);
        const snapshot = leagueId ? loadLeagueSnapshot(leagueId) : null;
        const seasonKey = getMaddenSeasonKey(snapshot);
        const resetReason = `Coach role removed via /removerole (${[r1?.name, r2?.name].filter(Boolean).join(', ')})`;
        const recognitionReset = resetRecognitionUserSeason({
          guildId: interaction.guildId,
          league: 'madden',
          seasonKey,
          userId: target.id,
          reason: resetReason,
        });
        const sportsbookReset = resetSportsbookUserSeason({
          seasonKey,
          userId: target.id,
          reason: resetReason,
        });
        systemsResetMessage = ' Current-season recognition and sportsbook state were refreshed because the user no longer has a coach role.';
        appendMaddenStaffLog({
          type: 'coach_role_removed_systems_reset',
          guildId: interaction.guildId,
          targetUserId: target.id,
          targetTag: target.tag,
          seasonKey,
          recognitionReset: recognitionReset?.ok === true,
          sportsbookReset: sportsbookReset?.ok === true,
        });
        await postMaddenStaffLog(
          interaction.client,
          interaction.guildId,
          'Coach Systems Refreshed',
          `${target.tag} no longer has a coach role, so current-season coach systems were refreshed.`,
          [
            { name: 'Recognition', value: recognitionReset?.ok ? 'reset' : 'no active state', inline: true },
            { name: 'Sportsbook', value: sportsbookReset?.ok ? 'reset' : 'no active state', inline: true },
            { name: 'Season', value: seasonKey, inline: true },
          ],
        ).catch(() => null);
      }
    }
    await interaction.editReply({ content: `Removed ${r2 ? `"${r1.name}" and "${r2.name}"` : `"${r1.name}"`} from ${target.tag}.${systemsResetMessage || ''}` });
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
      console.warn('[madden-removeteam] available teams pin update skipped:', e?.message || e);
    }
    // Refresh sim strike board to reflect coach removal
    try { await updateFairSimBoard(interaction.client, interaction.guildId); } catch (e) { console.warn('[madden-removeteam] fair sim board update skipped:', e?.message || e); }
  } catch (err) {
    await interaction.editReply({ content: `Failed to remove roles: ${err.message || err}` });
  }
}

export async function autocomplete(interaction) {
  if (!interaction.isAutocomplete()) return;
  const roleMap = loadRoleMapForGuild(interaction.guildId);
  const focused = interaction.options.getFocused();
  const focusedName = interaction.options.getFocused(true)?.name || 'role1';
  const selectedRole1 = interaction.options.getString('role') || interaction.options.getString('role1');

  let filteredRoles = [];
  try {
    const targetOpt = interaction.options.get('user');
    const targetId = targetOpt?.value;
    if (!targetId) {
      await interaction.respond([]);
      return;
    }
    const member = await interaction.guild.members.fetch(targetId).catch(() => null);
    if (!member) {
      await interaction.respond([]);
      return;
    }
    filteredRoles = roleChoices(roleMap, interaction.guild).filter(r => {
      const id = roleMap[r.name];
      const role = (id ? interaction.guild.roles.cache.get(id) : null)
        || interaction.guild.roles.cache.find((item) => item.name === r.name)
        || null;
      return role && member.roles.cache.has(role.id);
    });
  } catch {
    filteredRoles = [];
  }

  const options = filteredRoles
    .filter((item) => !['role2', 'extra_role'].includes(focusedName) || normalizeKey(item.name) !== normalizeKey(selectedRole1))
    .map((item) => ({ ...item, score: scoreAutocompleteChoice(item.name, focused) + baseRoleBoost(item.name, focusedName) }))
    .filter((item) => !focused || item.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 25);
  await interaction.respond(options.map(({ name, value }) => ({ name, value })));
}

export default { data, execute, autocomplete };
