import fs from 'fs';
import path from 'path';
import { getDataFilePath } from '../leaguebuddy/paths.js';

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

export function normalizeMaddenDraftClassId(value = '') {
  const text = String(value || '').trim().toLowerCase();
  const direct = text.match(/cus[_\s-]?(\d{1,2})/i);
  if (direct) return `cus_${String(Number(direct[1])).padStart(2, '0')}`;
  const digits = text.match(/^(\d{1,2})$/);
  if (digits) return `cus_${String(Number(digits[1])).padStart(2, '0')}`;
  return text.replace(/[^a-z0-9]/g, '') || null;
}

export function displayMaddenDraftClassId(value = '') {
  const normalized = normalizeMaddenDraftClassId(value);
  return String(normalized || '').replace('_', '').toUpperCase();
}

export function formatMaddenProspectClassLabel(player = null) {
  const raw = player?.year ?? player?.classYear ?? player?.academicYear ?? player?.eligibility ?? '';
  const text = String(raw || '').trim().toUpperCase();
  if (text) {
    return text
      .replace(/\s+/g, '')
      .replace(/^SO$/, 'SPH')
      .replace(/^SOPH$/, 'SPH')
      .replace(/^SOPHOMORE$/, 'SPH')
      .replace(/^FRESHMAN$/, 'FR')
      .replace(/^JUNIOR$/, 'JR')
      .replace(/^SENIOR$/, 'SR')
      .replace(/^R-?FR$/, 'FR(RS)')
      .replace(/^R-?SO$/, 'SPH(RS)')
      .replace(/^R-?SOPH$/, 'SPH(RS)')
      .replace(/^R-?JR$/, 'JR(RS)')
      .replace(/^R-?SR$/, 'SR(RS)');
  }
  const classText = String(player?.className || player?.schoolClass || '').trim().toUpperCase();
  if (classText) return classText.replace(/\s+/g, '');
  return '';
}

export function formatMaddenProspectIdentity(player = null, fallbackPosition = 'POS') {
  const parts = [
    player?.position || player?.position_1 || fallbackPosition,
    formatMaddenProspectClassLabel(player),
  ].filter(Boolean);
  return parts.join(' ');
}

function bundledDraftClassDir() {
  return path.join(process.cwd(), 'bundled_data', 'draft_classes', 'madden');
}

function dataDraftClassDirs() {
  return unique([
    getDataFilePath(path.join('draft_classes', 'madden')),
    path.join(process.cwd(), 'data', 'draft_classes', 'madden'),
  ]);
}

function jsonFilesInDir(dir) {
  const out = [];
  const walk = (current) => {
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
        out.push(fullPath);
      }
    }
  };
  walk(dir);
  return out.sort((a, b) => a.localeCompare(b));
}

function classIdFromFile(fileName = '') {
  const match = String(fileName || '').match(/CUS[_\s-]?(\d{1,2})/i);
  if (!match) return null;
  return `cus_${String(Number(match[1])).padStart(2, '0')}`;
}

function fileKindPattern(kind = 'bigboard') {
  const normalized = String(kind || 'bigboard').toLowerCase();
  if (normalized === 'recruiting') return /recruiting\.json$/i;
  return /big board\.json$/i;
}

export function listMaddenDraftClassFiles(kind = 'bigboard') {
  const byClass = new Map();
  const bundledDir = bundledDraftClassDir();
  const bundledFiles = fs.existsSync(bundledDir)
    ? jsonFilesInDir(bundledDir).filter((filePath) => fileKindPattern(kind).test(path.basename(filePath)))
    : [];
  const dirs = bundledFiles.length ? [bundledDir] : dataDraftClassDirs();

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const filePath of jsonFilesInDir(dir)) {
      const fileName = path.basename(filePath);
      if (!fileKindPattern(kind).test(fileName)) continue;
      const classId = classIdFromFile(fileName);
      if (!classId || byClass.has(classId)) continue;
      byClass.set(classId, {
        classId,
        display: displayMaddenDraftClassId(classId),
        file: filePath,
      });
    }
  }
  return [...byClass.values()].sort((a, b) => a.classId.localeCompare(b.classId));
}

export function getMaddenDraftClassChoices(kind = 'bigboard') {
  return listMaddenDraftClassFiles(kind)
    .slice(0, 24)
    .map((entry) => ({ name: entry.display, value: entry.classId }));
}

export function findMaddenDraftClassFile(classId, kind = 'bigboard') {
  const normalized = normalizeMaddenDraftClassId(classId);
  if (!normalized) return null;
  const hit = listMaddenDraftClassFiles(kind).find((entry) => entry.classId === normalized);
  return hit?.file || null;
}

export function loadMaddenDraftClassRaw(classId, kind = 'bigboard') {
  const file = findMaddenDraftClassFile(classId, kind);
  if (!file) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function loadMaddenDraftClassArray(classId, kind = 'bigboard') {
  const raw = loadMaddenDraftClassRaw(classId, kind);
  if (!raw) return null;
  return Array.isArray(raw) ? raw : Object.values(raw || {});
}
