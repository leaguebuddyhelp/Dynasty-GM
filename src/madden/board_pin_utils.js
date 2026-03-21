import { getPinId, setPinId } from './pins_store.js';
import { upsertGuildPin } from '../shared/madden_guild_config.js';

async function findBoardMessage(channel, pinKey, guildId, matchTitle) {
  const pinId = getPinId(pinKey, guildId);
  if (pinId) {
    const direct = await channel.messages.fetch(pinId).catch(() => null);
    if (direct) return direct;
  }

  const pinned = await channel.messages.fetchPinned().catch(() => null);
  const pinnedMatch = pinned?.find((message) =>
    message?.author?.id === channel.client.user?.id &&
    (message.embeds || []).some((embed) => String(embed?.title || '').trim() === matchTitle)
  ) || null;
  if (pinnedMatch) return pinnedMatch;

  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  return recent?.find((message) =>
    message?.author?.id === channel.client.user?.id &&
    (message.embeds || []).some((embed) => String(embed?.title || '').trim() === matchTitle)
  ) || null;
}

export async function ensureBoardPinMessage(channel, {
  pinKey,
  guildId = null,
  matchTitle,
  payload,
}) {
  if (!channel || !channel.isTextBased()) {
    throw new Error('Board channel not accessible');
  }

  const existing = await findBoardMessage(channel, pinKey, guildId, matchTitle);
  if (existing) {
    await existing.edit(payload);
    if (!existing.pinned) {
      await existing.pin().catch(() => null);
    }
    if (guildId) upsertGuildPin(guildId, pinKey, existing.id);
    setPinId(pinKey, existing.id, guildId);
    return existing;
  }

  const created = await channel.send(payload);
  await created.pin().catch(() => null);
  if (guildId) upsertGuildPin(guildId, pinKey, created.id);
  setPinId(pinKey, created.id, guildId);
  return created;
}

export default {
  ensureBoardPinMessage,
};
