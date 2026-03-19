import fs from 'fs';
import path from 'path';

import {
  getDataRoot,
  getGuildsRoot,
  getLeaguebuddyAuditLogPath,
  getLeaguebuddyDir,
  getLeaguebuddyGuildStorePath,
  getMaddenConfigPath,
  getMaddenLeaguesDir,
  getMaddenRoot,
} from './paths.js';

function configured(value) {
  return String(value || '').trim().length > 0;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  fs.accessSync(dirPath, fs.constants.R_OK | fs.constants.W_OK);
}

function ensureParent(filePath) {
  ensureDir(path.dirname(filePath));
}

export function validateStartupConfig() {
  const tokenConfigured = configured(process.env.DISCORD_TOKEN || process.env.TOKEN);
  const standardUrlConfigured = configured(process.env.LB_UPGRADE_URL_STANDARD || process.env.LB_UPGRADE_URL);
  const premiumUrlConfigured = configured(process.env.LB_UPGRADE_URL_PREMIUM || process.env.LB_UPGRADE_URL);
  const dataRoot = getDataRoot();
  const healthEnabled = String(process.env.LB_HEALTHCHECK_ENABLED || '').toLowerCase() === 'true' || configured(process.env.PORT);

  console.log('[startup] configuration', {
    appEnv: process.env.APP_ENV || process.env.NODE_ENV || 'undefined',
    dataRoot,
    stripeStandardUrl: standardUrlConfigured ? 'configured' : 'missing',
    stripePremiumUrl: premiumUrlConfigured ? 'configured' : 'missing',
    healthcheck: healthEnabled ? 'enabled' : 'disabled',
  });

  if (!tokenConfigured) {
    throw new Error('DISCORD_TOKEN is not set in environment.');
  }

  const dirs = [
    dataRoot,
    getLeaguebuddyDir(),
    getGuildsRoot(),
    getMaddenRoot(),
    getMaddenLeaguesDir(),
  ];
  for (const dir of dirs) ensureDir(dir);

  const files = [
    getLeaguebuddyGuildStorePath(),
    getLeaguebuddyAuditLogPath(),
    getMaddenConfigPath(),
  ];
  for (const filePath of files) ensureParent(filePath);

  console.log('[startup] storage', {
    guildStorePath: getLeaguebuddyGuildStorePath(),
    auditLogPath: getLeaguebuddyAuditLogPath(),
    maddenRoot: getMaddenRoot(),
    writable: 'ok',
  });

  return {
    dataRoot,
    tokenConfigured,
    standardUrlConfigured,
    premiumUrlConfigured,
    healthEnabled,
  };
}

export default {
  validateStartupConfig,
};
