import fs from 'fs';
import path from 'path';
import { getDataRoot, getDataFilePath, getGuildsRoot, getLeaguebuddyDir, getMaddenLeaguesDir, getMaddenRoot } from './paths.js';
import { validateSoloModeConfig } from './solo_mode.js';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
}
function seedBundledDraftClasses() {
  const target = getDataFilePath(path.join('draft_classes', 'madden'));
  // Both the original subdirectory and the newer flat bundle layout are supported.
  for (const source of [path.join(process.cwd(), 'bundled_data', 'draft_classes', 'madden'), path.join(process.cwd(), 'bundled_data', 'draft_classes')]) {
    if (!fs.existsSync(source)) continue;
    ensureDir(target);
    for (const file of fs.readdirSync(source).filter((name) => name.toLowerCase().endsWith('.json'))) {
      const destination = path.join(target, file);
      if (!fs.existsSync(destination)) fs.copyFileSync(path.join(source, file), destination);
    }
  }
}
export function validateStartupConfig() {
  const config = validateSoloModeConfig();
  if (!String(process.env.DISCORD_TOKEN || process.env.TOKEN || '').trim()) throw new Error('DISCORD_TOKEN is not set in environment.');
  for (const dir of [getDataRoot(), getLeaguebuddyDir(), getGuildsRoot(), getMaddenRoot(), getMaddenLeaguesDir()]) ensureDir(dir);
  seedBundledDraftClasses();
  console.log('[startup] solo franchise', { guildId: config.guildId, dataRoot: getDataRoot(), writable: 'ok' });
  return { dataRoot: getDataRoot(), soloMode: true, tokenConfigured: true };
}
export default { validateStartupConfig };
