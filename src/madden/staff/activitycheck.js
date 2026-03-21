import { SlashCommandBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { loadMaddenChannelMap } from '../../shared/madden_metadata.js';
import { getGuildRoleMap } from '../../shared/madden_guild_config.js';

const STAFF_ROLES = ['LB Commish', 'LB Co-Commish', 'Ghost Legacy Commish', 'Ghost Legacy Co-Commish'];

function loadJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function loadRoleMap(guildId = null) {
  const overlay = getGuildRoleMap(guildId);
  if (overlay && Object.keys(overlay).length) return overlay;
  const ROLE_MAP_FILE = path.join(process.cwd(), 'data', 'madden', 'madden_role_ids.json');
  return loadJson(ROLE_MAP_FILE);
}

function hasStaffRole(member, roleMap) {
  return STAFF_ROLES.some(r => {
    const id = roleMap[r];
    return id && member.roles.cache.has(id);
  });
}

export const data = new SlashCommandBuilder()
  .setName('activitycheck')
  .setDescription('Post an activity check to the configured channel (staff only).')
  .setDefaultMemberPermissions(null);

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const roleMap = loadRoleMap(interaction.guildId);
  const channelMap = loadMaddenChannelMap(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!hasStaffRole(member, roleMap)) {
    await interaction.editReply({ content: 'Only LB Commish/Co-Commish can use this command.' });
    return;
  }

  const activityChannelId = channelMap['Activity Checks'];
  if (!activityChannelId) {
    await interaction.editReply({ content: 'Activity Checks channel not configured.' });
    return;
  }

  const channel = await interaction.client.channels.fetch(activityChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    await interaction.editReply({ content: 'Could not access the Activity Checks channel.' });
    return;
  }

  const coachRoleId = roleMap['LEAGUEbuddy Coaches'] || roleMap['LB Coaches'] || roleMap['Ghost Legacy'];
  const coachTag = coachRoleId ? `<@&${coachRoleId}>` : '';
  const deadline = Math.floor((Date.now() + 24 * 3600 * 1000) / 1000);

  const embed = {
    title: 'Madden Activity Check',
    description: `Please react to this message to confirm you are active.\n\nDeadline: <t:${deadline}:R> (<t:${deadline}:f>)`,
    color: 0xffcc00,
    timestamp: new Date().toISOString(),
  };

  try {
    await channel.send({ content: coachTag || null, embeds: [embed] });
    await interaction.editReply({ content: 'Activity check posted.' });
  } catch (e) {
    await interaction.editReply({ content: `Failed to post activity check: ${e?.message || e}` });
  }
}

export default { data, execute };
