import { PermissionFlagsBits } from 'discord.js';

const REQUIRED_SETUP_PERMISSIONS = [
  { bit: PermissionFlagsBits.ViewChannel, label: 'View Channels' },
  { bit: PermissionFlagsBits.SendMessages, label: 'Send Messages' },
  { bit: PermissionFlagsBits.ReadMessageHistory, label: 'Read Message History' },
  { bit: PermissionFlagsBits.ManageChannels, label: 'Manage Channels' },
  { bit: PermissionFlagsBits.ManageMessages, label: 'Manage Messages' },
  { bit: PermissionFlagsBits.PinMessages, label: 'Pin Messages' },
  { bit: PermissionFlagsBits.ManageRoles, label: 'Manage Roles' },
];

function roleNames(roles = [], limit = 5) {
  return roles.slice(0, limit).map((role) => `• ${role.name}`).join('\n');
}

export async function inspectSetupReadiness(guild) {
  if (!guild) {
    return {
      missingPermissions: [],
      hasRequiredPermissions: false,
      hierarchyWarning: null,
      higherRoles: [],
      botRoleName: null,
    };
  }

  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  await guild.roles.fetch().catch(() => null);

  const permissions = me?.permissions;
  const missingPermissions = REQUIRED_SETUP_PERMISSIONS
    .filter((entry) => !permissions?.has(entry.bit))
    .map((entry) => entry.label);

  const botRole = me?.roles?.highest || null;
  const higherRoles = botRole
    ? guild.roles.cache
      .filter((role) =>
        role.id !== guild.roles.everyone.id &&
        role.id !== botRole.id &&
        !role.managed &&
        role.position > botRole.position)
      .sort((a, b) => b.position - a.position)
      .map((role) => ({ id: role.id, name: role.name, position: role.position }))
    : [];

  return {
    missingPermissions,
    hasRequiredPermissions: missingPermissions.length === 0,
    hierarchyWarning: higherRoles.length
      ? [
          `Move the **${botRole?.name || 'LEAGUEbuddy'}** role above these roles before role setup:`,
          roleNames(higherRoles),
        ].join('\n')
      : null,
    higherRoles,
    botRoleName: botRole?.name || null,
  };
}

export function buildSetupReadinessLines(report) {
  const missing = report?.missingPermissions?.length
    ? report.missingPermissions.map((name) => `❌ ${name}`).join('\n')
    : '✅ Required setup permissions look good';
  const hierarchy = report?.hierarchyWarning
    ? `⚠️ Role hierarchy needs attention\n${report.hierarchyWarning}`
    : '✅ Bot role hierarchy looks safe for first-time setup';
  return [missing, hierarchy].join('\n');
}

export function buildSetupReadinessNextSteps(report) {
  if (!report?.hasRequiredPermissions) {
    return [
      'A server admin needs to fix the LEAGUEbuddy bot role permissions in Discord.',
      'After the permissions are fixed, run `/setup` again.',
      report?.hierarchyWarning ? 'After that, move the bot role higher in Server Settings > Roles.' : null,
    ].filter(Boolean).join('\n');
  }
  if (report?.hierarchyWarning) {
    return 'Before `/setup-roles`, move the LEAGUEbuddy role higher in Server Settings > Roles, then rerun `/setup`.';
  }
  return 'Bot permissions look ready. Continue with `/connectleague`, then `/setup-channels`.';
}

export default {
  inspectSetupReadiness,
  buildSetupReadinessLines,
  buildSetupReadinessNextSteps,
};
