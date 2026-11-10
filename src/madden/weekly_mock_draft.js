import fs from 'node:fs/promises';
import path from 'node:path';
import { getMaddenDataFilePath } from '../leaguebuddy/paths.js';
import { getMaddenChannelId, getMaddenSeasonKey } from '../shared/madden_metadata.js';
import { getLatestReliableRegularSeasonWeekIndex } from './top_players.js';

const HISTORY_DIR = getMaddenDataFilePath('mock_draft_history');

function historyPath(leagueId, seasonKey, weekNumber) {
  const safeLeagueId = String(leagueId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeSeasonKey = String(seasonKey).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(HISTORY_DIR, safeLeagueId, `${safeSeasonKey}_week_${weekNumber}.json`);
}

export function getNewlyCompletedMockWeek(snapshot, previousSnapshot) {
  if (!snapshot || !previousSnapshot) return null;
  const seasonKey = getMaddenSeasonKey(snapshot);
  if (seasonKey !== getMaddenSeasonKey(previousSnapshot)) return null;
  const latest = getLatestReliableRegularSeasonWeekIndex(snapshot);
  const previous = getLatestReliableRegularSeasonWeekIndex(previousSnapshot);
  if (latest === null || previous === null || latest <= previous) return null;
  return latest + 1;
}

export async function publishWeeklyMockDraft({ client, guildId, snapshot, previousSnapshot }) {
  const weekNumber = getNewlyCompletedMockWeek(snapshot, previousSnapshot);
  if (!weekNumber) return { posted: false, reason: 'No newly completed regular-season week.' };

  const seasonKey = getMaddenSeasonKey(snapshot);
  const filePath = historyPath(snapshot.leagueId, seasonKey, weekNumber);
  try {
    const stored = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (stored.messageId) return { posted: false, duplicate: true, weekNumber };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const channelId = getMaddenChannelId('Mock Draft', guildId)
    || getMaddenChannelId('mock-draft', guildId);
  if (!channelId) return { posted: false, reason: 'Mock Draft channel is not configured.' };
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased()) throw new Error('Configured Mock Draft channel is not text-based.');

  const { default: command } = await import('./coach/mockdraft.js');
  let payload = null;
  const captureInteraction = {
    guildId,
    user: { id: String(process.env.MADDEN_SOLO_USER_ID || '') },
    client,
    deferred: true,
    replied: false,
    editReply: async (value) => {
      payload = value;
      return value;
    },
  };
  await command.execute(captureInteraction);
  if (!payload?.embeds?.length) {
    throw new Error('The existing mock-draft command did not produce a publishable report.');
  }

  const message = await channel.send({ embeds: payload.embeds, components: [] });
  const record = {
    version: 1,
    leagueId: String(snapshot.leagueId),
    seasonKey,
    weekNumber,
    syncId: snapshot.syncId || null,
    generatedAt: new Date().toISOString(),
    messageId: message.id,
    channelId,
    embed: payload.embeds.map((embed) => embed.toJSON?.() || embed),
  };
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(record, null, 2), { flag: 'wx' });
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
  return { posted: true, weekNumber, messageId: message.id };
}

export default {
  getNewlyCompletedMockWeek,
  publishWeeklyMockDraft,
};
