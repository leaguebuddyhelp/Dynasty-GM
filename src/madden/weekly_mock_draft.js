import fs from 'node:fs/promises';
import path from 'node:path';
import { getMaddenDataFilePath } from '../leaguebuddy/paths.js';
import { getMaddenChannelId, getMaddenSeasonKey } from '../shared/madden_metadata.js';
import { getFranchisePhase } from './franchise_phase.js';
import { getLatestReliableRegularSeasonWeekIndex } from './top_players.js';

const HISTORY_DIR = getMaddenDataFilePath('mock_draft_history');

function historyPath(leagueId, seasonKey, periodKey) {
  const safeLeagueId = String(leagueId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeSeasonKey = String(seasonKey).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(HISTORY_DIR, safeLeagueId, `${safeSeasonKey}_${periodKey}.json`);
}

export function getMockDraftPeriod(snapshot, previousSnapshot = null) {
  if (!snapshot) return null;
  const phase = getFranchisePhase(snapshot);
  if (phase === 'preseason') return null;
  const info = snapshot.info?.careerHubInfo?.seasonInfo || {};
  const currentWeek = Number(snapshot.currentWeek ?? info.displayWeek ?? 0);
  if (phase === 'offseason') {
    const stage = String(info.offSeasonStage ?? info.phase ?? (currentWeek || 'start')).replace(/[^a-zA-Z0-9_-]/g, '_');
    return { phase, key: `offseason_stage_${stage}_week_${currentWeek || 0}`, label: `Offseason · Stage ${stage}`, weekNumber: currentWeek || null };
  }
  if (phase === 'playoffs') {
    const postseasonWeeks = (snapshot.weeklyStats || [])
      .filter((entry) => Number(entry.stage ?? entry.stageIndex) === 2)
      .map((entry) => Number(entry.weekIndex) + 2).filter(Number.isFinite);
    const weekNumber = currentWeek > 0 ? currentWeek : Math.max(19, ...postseasonWeeks);
    return { phase, key: `playoffs_week_${weekNumber}`, label: `Playoffs · Week ${weekNumber}`, weekNumber };
  }
  const latest = getLatestReliableRegularSeasonWeekIndex(snapshot);
  if (latest === null) return null;
  const sameSeason = previousSnapshot && getMaddenSeasonKey(snapshot) === getMaddenSeasonKey(previousSnapshot);
  const previous = sameSeason ? getLatestReliableRegularSeasonWeekIndex(previousSnapshot) : null;
  if (previous !== null && latest < previous) return null;
  const weekNumber = latest + 1;
  return { phase, key: `week_${weekNumber}`, label: `Regular season · Week ${weekNumber}`, weekNumber };
}

export function getNewlyCompletedMockWeek(snapshot, previousSnapshot) {
  return getMockDraftPeriod(snapshot, previousSnapshot)?.weekNumber ?? null;
}

export async function publishWeeklyMockDraft({ client, guildId, snapshot, previousSnapshot }) {
  const period = getMockDraftPeriod(snapshot, previousSnapshot);
  if (!period) return { posted: false, reason: 'No eligible mock-draft week or stage.' };
  const { weekNumber } = period;
  const seasonKey = getMaddenSeasonKey(snapshot);
  const filePath = historyPath(snapshot.leagueId, seasonKey, period.key);
  try {
    const stored = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (stored.messageId) return { posted: false, duplicate: true, weekNumber, periodLabel: period.label };
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
    throw new Error(payload?.content || 'The existing mock-draft command did not produce a publishable report.');
  }

  const message = await channel.send({ embeds: payload.embeds, components: [] });
  const record = {
    version: 1,
    leagueId: String(snapshot.leagueId),
    seasonKey,
    weekNumber,
    periodKey: period.key,
    periodLabel: period.label,
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
  return { posted: true, weekNumber, periodLabel: period.label, messageId: message.id };
}

export default {
  getMockDraftPeriod,
  getNewlyCompletedMockWeek,
  publishWeeklyMockDraft,
};
