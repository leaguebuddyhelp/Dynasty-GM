import { EmbedBuilder } from 'discord.js';
import { resolveLeagueIdWithConfig } from '../madden_data.js';
import { formatMaddenDraftClassLock, getMaddenDraftClassId } from '../../shared/madden_draft_class.js';
import { displayMaddenDraftClassId, formatMaddenProspectIdentity, loadMaddenDraftClassRaw, normalizeMaddenDraftClassId } from '../../shared/madden_draft_class_files.js';

function classIdForSeason(calendarYear) {
  return getMaddenDraftClassId({ calendarYear });
}

function classIdForSnapshot(snapshot) {
  return getMaddenDraftClassId(snapshot);
}

function loadDraftClass(classId) {
  return loadMaddenDraftClassRaw(classId);
}

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function displayClassId(classId) {
  return displayMaddenDraftClassId(classId);
}

export function buildPages(snapshot, classIdOverride = null, leagueId = null, options = {}) {
  const classId = normalizeMaddenDraftClassId(classIdOverride || classIdForSnapshot(snapshot));
  const classLock = options.manualClassOverride
    ? `Manual class override -> ${displayClassId(classId)} • Auto lock: ${formatMaddenDraftClassLock(snapshot)}`
    : formatMaddenDraftClassLock(snapshot);
  const draftData = loadDraftClass(classId);
  if (!draftData) throw new Error(`Draft class ${classId} not found`);

  const prospects = Object.values(draftData || {}).sort((a, b) => (a.RNK ?? a.rank ?? a.order ?? 9999) - (b.RNK ?? b.rank ?? b.order ?? 9999));
  const lines = prospects.map((p, idx) => `${idx + 1}. ${formatMaddenProspectIdentity(p, p.position || '')} ${p.name || 'Unknown'} - ${p.school || 'N/A'}`);
  const pages = chunk(lines, 32);
  const embeds = pages.map((page, idx) => new EmbedBuilder()
    .setTitle(`Madden Big Board — ${displayClassId(classId)} (Page ${idx + 1}/${pages.length})`)
    .setDescription(page.join('\n'))
    .setColor(0x00b0f4)
    .setFooter({ text: classLock })
  );
  const baseId = leagueId ? `madden_bigboard_page_${leagueId}_${classId}` : `madden_bigboard_page_${classId}`;
  return { embeds, baseId };
}

export { classIdForSeason, classIdForSnapshot, loadDraftClass };
