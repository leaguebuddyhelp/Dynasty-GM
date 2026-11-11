import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getMaddenDraftClassId } from '../src/shared/madden_draft_class.js';
import {
  findMaddenDraftClassFile,
  loadMaddenDraftClassArray,
  normalizeMaddenDraftClassId,
} from '../src/shared/madden_draft_class_files.js';

const suppliedClass = findMaddenDraftClassFile('CUS02');
assert.equal(suppliedClass, path.resolve('bundled_data/draft_classes/Madden 26 CUS02 - Big Board.json'));
const suppliedProspects = loadMaddenDraftClassArray('cus_02');
assert.ok(suppliedProspects.length > 0);
assert.equal(Number(suppliedProspects[0].class), 2);
const firstClass = loadMaddenDraftClassArray('cus_01');
assert.equal(findMaddenDraftClassFile('CUS01'), path.resolve('bundled_data/draft_classes/Madden 26 CUS01 - Big Board.json'));
assert.ok(firstClass.length >= 32);
assert.ok(firstClass.every((prospect) => Number(prospect.class) === 1), 'CUS01 must contain first-year prospects');

for (const seasonYear of [0, 1, 2, 3, 9, 99]) {
  const snapshot = { info: { careerHubInfo: { seasonInfo: { seasonYear } } } };
  assert.equal(getMaddenDraftClassId(snapshot), `cus_${String(seasonYear + 1).padStart(2, '0')}`);
}
assert.equal(normalizeMaddenDraftClassId('CUS100'), 'cus_100');

const originalDirectory = process.cwd();
const originalDataRoot = process.env.LB_DATA_ROOT;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'madden-draft-class-test-'));
try {
  process.chdir(root);
  process.env.LB_DATA_ROOT = path.join(root, 'storage');
  const bundled = path.join(root, 'bundled_data', 'draft_classes');
  const nested = path.join(bundled, 'madden');
  const stored = path.join(root, 'storage', 'draft_classes', 'madden');
  for (const dir of [nested, stored]) fs.mkdirSync(dir, { recursive: true });
  const writeClass = (dir, number, value) => fs.writeFileSync(
    path.join(dir, `Madden 26 CUS${number} - Big Board.json`), JSON.stringify({ 1: { name: value } }),
  );
  writeClass(bundled, '02', 'direct');
  writeClass(nested, '02', 'nested');
  writeClass(nested, '03', 'third');
  writeClass(stored, '04', 'fourth');
  assert.equal(loadMaddenDraftClassArray('CUS02')[0].name, 'direct');
  assert.equal(loadMaddenDraftClassArray('CUS03')[0].name, 'third');
  assert.equal(loadMaddenDraftClassArray('CUS04')[0].name, 'fourth');
  assert.equal(findMaddenDraftClassFile('CUS05'), null);
  fs.writeFileSync(path.join(bundled, 'Madden 26 CUS05 - Big Board.json'), '{invalid');
  assert.throws(() => loadMaddenDraftClassArray('CUS05'), SyntaxError);
} finally {
  process.chdir(originalDirectory);
  if (originalDataRoot === undefined) delete process.env.LB_DATA_ROOT;
  else process.env.LB_DATA_ROOT = originalDataRoot;
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('PASS season-specific draft class lookup, file precedence, fallback, and invalid JSON');
