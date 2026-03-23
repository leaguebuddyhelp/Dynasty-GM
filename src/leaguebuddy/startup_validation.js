import fs from 'fs';
import path from 'path';

import {
  getDataRoot,
  getDataFilePath,
  getGuildsRoot,
  getLeaguebuddyAuditLogPath,
  getLeaguebuddyClaimsStorePath,
  getLeaguebuddyDir,
  getLeaguebuddyGuildStorePath,
  getMaddenConfigPath,
  getMaddenLeaguesDir,
  getMaddenRoot,
} from './paths.js';

function configured(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return false;
  if (/^(YOUR_|OFFICIAL_|REPLACE_ME|PASTE_)/i.test(trimmed)) return false;
  return true;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  fs.accessSync(dirPath, fs.constants.R_OK | fs.constants.W_OK);
}

function ensureParent(filePath) {
  ensureDir(path.dirname(filePath));
}

function seedBundledDraftClasses() {
  const sourceDir = path.join(process.cwd(), 'bundled_data', 'draft_classes', 'madden');
  const targetDir = getDataFilePath(path.join('draft_classes', 'madden'));
  if (!fs.existsSync(sourceDir)) return;

  ensureDir(targetDir);
  const sourceFiles = fs.readdirSync(sourceDir).filter((file) => file.toLowerCase().endsWith('.json'));
  const copied = [];

  for (const file of sourceFiles) {
    const sourcePath = path.join(sourceDir, file);
    const targetPath = path.join(targetDir, file);
    if (fs.existsSync(targetPath)) continue;
    fs.copyFileSync(sourcePath, targetPath);
    copied.push(file);
  }

  if (copied.length) {
    console.log('[startup] seeded bundled draft classes', {
      targetDir,
      count: copied.length,
      files: copied,
    });
  }
}

export function validateStartupConfig() {
  const tokenConfigured = configured(process.env.DISCORD_TOKEN || process.env.TOKEN);
  const standardUrlConfigured = configured(process.env.LB_UPGRADE_URL_STANDARD || process.env.LB_UPGRADE_URL);
  const premiumUrlConfigured = configured(process.env.LB_UPGRADE_URL_PREMIUM || process.env.LB_UPGRADE_URL);
  const botInviteConfigured = configured(process.env.LB_BOT_INVITE_URL) || configured(process.env.CLIENT_ID);
  const stripeClaimsEnabled = String(process.env.LB_STRIPE_CLAIMS_WEBHOOK_ENABLED || '').toLowerCase() === 'true';
  const stripeWebhookSecretConfigured = configured(process.env.LB_STRIPE_WEBHOOK_SECRET);
  const stripeSecretKeyConfigured = configured(process.env.LB_STRIPE_SECRET_KEY);
  const stripeStandardPriceConfigured = configured(process.env.LB_STRIPE_STANDARD_PRICE_ID);
  const stripePremiumPriceConfigured = configured(process.env.LB_STRIPE_PREMIUM_PRICE_ID);
  const dataRoot = getDataRoot();
  const healthEnabled = String(process.env.LB_HEALTHCHECK_ENABLED || '').toLowerCase() === 'true' || configured(process.env.PORT);

  console.log('[startup] configuration', {
    appEnv: process.env.APP_ENV || process.env.NODE_ENV || 'undefined',
    dataRoot,
    stripeStandardUrl: standardUrlConfigured ? 'configured' : 'missing',
    stripePremiumUrl: premiumUrlConfigured ? 'configured' : 'missing',
    botInviteUrl: botInviteConfigured ? 'configured' : 'missing',
    stripeClaimsWebhook: stripeClaimsEnabled ? (stripeWebhookSecretConfigured ? 'enabled' : 'missing_secret') : 'disabled',
    stripeCheckoutBuy: stripeClaimsEnabled
      ? (stripeSecretKeyConfigured && stripeStandardPriceConfigured && stripePremiumPriceConfigured ? 'configured' : 'missing_keys')
      : 'disabled',
    healthcheck: healthEnabled ? 'enabled' : 'disabled',
  });

  if (!tokenConfigured) {
    throw new Error('DISCORD_TOKEN is not set in environment.');
  }

  if (stripeClaimsEnabled) {
    const missing = [];
    if (!standardUrlConfigured) missing.push('LB_UPGRADE_URL_STANDARD');
    if (!premiumUrlConfigured) missing.push('LB_UPGRADE_URL_PREMIUM');
    if (!stripeWebhookSecretConfigured) missing.push('LB_STRIPE_WEBHOOK_SECRET');
    if (!stripeSecretKeyConfigured) missing.push('LB_STRIPE_SECRET_KEY');
    if (!stripeStandardPriceConfigured) missing.push('LB_STRIPE_STANDARD_PRICE_ID');
    if (!stripePremiumPriceConfigured) missing.push('LB_STRIPE_PREMIUM_PRICE_ID');
    if (missing.length) {
      throw new Error(`Stripe claims/buy flow is enabled but missing required env: ${missing.join(', ')}`);
    }
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
    getLeaguebuddyClaimsStorePath(),
    getMaddenConfigPath(),
  ];
  for (const filePath of files) ensureParent(filePath);
  seedBundledDraftClasses();

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
