import { getTeamApplicationEmojiData } from './application_emojis.js';

const ROLE_ICON_IMAGE_LIMIT_BYTES = 256 * 1024;

function emojiCdnUrl(emoji) {
  if (!emoji?.id) return '';
  const extension = emoji.animated ? 'gif' : 'png';
  return `https://cdn.discordapp.com/emojis/${emoji.id}.${extension}?quality=lossless`;
}

async function fetchEmojiIconBuffer(emoji) {
  const url = emojiCdnUrl(emoji);
  if (!url || typeof fetch !== 'function') return null;
  const response = await fetch(url);
  if (!response.ok) return null;
  const arrayBuffer = await response.arrayBuffer();
  if (!arrayBuffer || arrayBuffer.byteLength > ROLE_ICON_IMAGE_LIMIT_BYTES) return null;
  return Buffer.from(arrayBuffer);
}

function roleIconLooksSet(role) {
  return Boolean(role?.icon || role?.unicodeEmoji);
}

export async function applyTeamEmojiRoleIcon(role, teamName, { logger = console } = {}) {
  if (!role?.editable || !teamName || roleIconLooksSet(role)) return { ok: false, skipped: true };

  const emoji = getTeamApplicationEmojiData(teamName);
  if (!emoji?.id) return { ok: false, skipped: true };

  try {
    const icon = await fetchEmojiIconBuffer(emoji);
    if (!icon) return { ok: false, skipped: true };

    await role.edit({ icon }, `Attach ${emoji.name} app emoji to coach role`);
    return { ok: true, emojiName: emoji.name };
  } catch (error) {
    logger?.warn?.('[role-icon] unable to attach app emoji to role', {
      guildId: role.guild?.id,
      roleId: role.id,
      roleName: role.name,
      teamName,
      message: error?.message || String(error),
      code: error?.code || error?.rawError?.code || null,
      status: error?.status || error?.rawError?.status || null,
    });
    return { ok: false, skipped: false, error };
  }
}

export default {
  applyTeamEmojiRoleIcon,
};
