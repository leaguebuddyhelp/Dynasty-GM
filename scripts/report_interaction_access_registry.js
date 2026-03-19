#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { INTERACTION_ACCESS_RULES } from '../src/leaguebuddy/interaction_access_registry.js';
import { resolveInteractionAccess } from '../src/leaguebuddy/interaction_access_resolver.js';

const ROOTS = [
  path.join(process.cwd(), 'src', 'interactions'),
  path.join(process.cwd(), 'src', 'madden'),
  path.join(process.cwd(), 'src', 'shared'),
];

function walkFiles(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  const out = [];
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        out.push(fullPath);
      }
    }
  }
  return out;
}

function extractFamilies(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const families = new Set();

  const customIdRegex = /setCustomId\(`([^`$|]+(?:_[^`$|]+)*)/g;
  for (const match of text.matchAll(customIdRegex)) {
    const raw = String(match[1] || '').trim();
    if (raw) families.add(raw);
  }

  const exportRegex = /export const customId(?:_[a-zA-Z0-9_]+)?\s*=\s*(\/\^([^/]+)\/|["'`]([^"'`]+)["'`])/g;
  for (const match of text.matchAll(exportRegex)) {
    const regexBody = match[2];
    const literal = match[3];
    const source = regexBody || literal || '';
    const cleaned = String(source)
      .replace(/\\\|/g, '|')
      .replace(/\(\?:.*$/, '')
      .replace(/\(.+$/, '')
      .replace(/\[\^.*$/, '')
      .replace(/\.\*$/, '')
      .replace(/\$$/, '')
      .replace(/\^/, '')
      .trim();
    if (cleaned) families.add(cleaned);
  }

  return [...families];
}

function fakeInteraction(customId) {
  return {
    guildId: 'report-guild',
    customId,
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
  };
}

function normalizeFamily(family) {
  return String(family || '')
    .replace(/\|.*$/, '')
    .replace(/\(\?:.*$/, '')
    .replace(/\(.+$/, '')
    .replace(/\.\*$/, '')
    .trim();
}

const files = ROOTS.flatMap(walkFiles);
const discovered = [];
for (const filePath of files) {
  for (const family of extractFamilies(filePath)) {
    discovered.push({
      family: normalizeFamily(family),
      filePath: path.relative(process.cwd(), filePath),
    });
  }
}

const uniqueFamilies = new Map();
for (const row of discovered) {
  if (!row.family) continue;
  if (!uniqueFamilies.has(row.family)) uniqueFamilies.set(row.family, []);
  uniqueFamilies.get(row.family).push(row.filePath);
}

console.log('INTERACTION ACCESS REGISTRY RULES');
for (const rule of INTERACTION_ACCESS_RULES) {
  console.log(`- ${rule.id}: ${rule.featureKey} :: ${rule.description || '(no description)'}`);
}

console.log('\nDISCOVERED CUSTOM ID FAMILIES');
for (const [family, filePaths] of [...uniqueFamilies.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const resolved = resolveInteractionAccess(fakeInteraction(family));
  const marker = resolved ? 'MAPPED' : 'UNMATCHED';
  console.log(`- ${marker} ${family} :: ${filePaths[0]}`);
}

console.log('\nLIKELY UNMATCHED FAMILIES FOR REVIEW');
for (const [family, filePaths] of [...uniqueFamilies.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const resolved = resolveInteractionAccess(fakeInteraction(family));
  if (resolved) continue;
  const lower = family.toLowerCase();
  const likelyInteresting =
    lower.startsWith('madden_') ||
    lower.startsWith('trade_') ||
    lower.startsWith('committee_') ||
    lower.startsWith('inseason_') ||
    lower.startsWith('freeagency_') ||
    lower.startsWith('resigning_');
  if (!likelyInteresting) continue;
  console.log(`- ${family} :: ${filePaths[0]}`);
}
