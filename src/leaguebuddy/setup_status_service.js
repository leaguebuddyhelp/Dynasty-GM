import { FEATURES, getFeature } from './plans.js';
import { hasFeatureAccess } from './access.js';
import planRepository from './repositories/guild_plan_repository.js';
import overlayRepository from './repositories/guild_overlay_repository.js';
import { getTestingBypassBilling } from './testing_bypass.js';

const CORE_REQUIRED_CHANNEL_KEYS = [
  'League Staff',
  'Available Teams',
  'Standings',
  'Stat Leaders',
  'Power Rankings',
  'Playoff Picture',
  'Top 100',
  'Game threads',
  'Yearly Awards',
];

const STANDARD_REQUIRED_CHANNEL_KEYS = [
  'scoutingHub',
];

const TRADE_REQUIRED_CHANNEL_KEYS = [
  'tradeSubmit',
  'Trade Block',
  'Trades',
  'Trade Counts',
  'Trade Committee',
  'Approved trades',
  'Denied trades',
];

const BASE_REQUIRED_ROLE_KEYS = [
  'Ghost Legacy Commish',
  'Ghost Legacy Co-Commish',
  'Ghost Legacy',
];

const TRADE_REQUIRED_ROLE_KEYS = [
  'Trade Committee',
];

const SETUP_ITEM_LABELS = {
  'Ghost Legacy Commish': 'LB Commish',
  'Ghost Legacy Co-Commish': 'LB Co-Commish',
  'Ghost Legacy': 'LEAGUEbuddy Coaches',
  'Trade Committee': 'LEAGUEbuddy Trade Committee',
  tradeSubmit: 'Submit Trade',
  scoutingHub: 'Scouting Hub',
};

function summarizeMappedEntries(mapObj) {
  const entries = Object.entries(mapObj && typeof mapObj === 'object' ? mapObj : {}).filter(([, value]) => !!value);
  return {
    mappedCount: entries.length,
    mappedKeys: entries.map(([key]) => key),
    summary: entries.length ? entries.map(([key, value]) => `${key}: ${value}`).slice(0, 12) : [],
  };
}

function diffMissingKeys(mapObj, requiredKeys) {
  const map = mapObj && typeof mapObj === 'object' ? mapObj : {};
  return requiredKeys.filter((key) => !map[key]);
}

function displaySetupItemName(key) {
  return SETUP_ITEM_LABELS[key] || key;
}

function requiredChannelKeysForSetup(overlayConfig) {
  const tier = String(overlayConfig?.license?.tier || 'free').toLowerCase();
  const packsEnabled = Array.isArray(overlayConfig?.packsEnabled) ? overlayConfig.packsEnabled : [];
  return [
    ...CORE_REQUIRED_CHANNEL_KEYS,
    ...((tier === 'standard' || tier === 'premium') ? STANDARD_REQUIRED_CHANNEL_KEYS : []),
    ...(packsEnabled.includes('trades_basic') ? TRADE_REQUIRED_CHANNEL_KEYS : []),
  ];
}

function requiredRoleKeysForSetup(overlayConfig) {
  const packsEnabled = Array.isArray(overlayConfig?.packsEnabled) ? overlayConfig.packsEnabled : [];
  return [
    ...BASE_REQUIRED_ROLE_KEYS,
    ...(packsEnabled.includes('trades_basic') ? TRADE_REQUIRED_ROLE_KEYS : []),
  ];
}

function buildFeatureSummary(guildId, packsEnabled = []) {
  const unlockedFeatures = [];
  const blockedFeatures = [];

  for (const featureKey of Object.keys(FEATURES)) {
    const feature = getFeature(featureKey);
    const check = hasFeatureAccess(guildId, featureKey);
    const row = {
      featureKey,
      label: feature?.label || featureKey,
      minPlan: feature?.minPlan || 'free',
      requiresSetup: feature?.requiresSetup === true,
    };
    if (packsEnabled.includes(featureKey)) {
      unlockedFeatures.push({ ...row, source: 'pack_enabled' });
      continue;
    }
    if (check.ok) {
      unlockedFeatures.push({ ...row, source: 'plan_access' });
    } else {
      blockedFeatures.push({ ...row, reason: check.reason });
    }
  }

  return { unlockedFeatures, blockedFeatures };
}

function buildRecommendedNextAction({ overlayExists, overlayComplete, setupCompleted, syncNeeded, blockedFeatures }) {
  if (!overlayExists) return 'Run /setup-channels to create the LEAGUEbuddy category and channel layout for this server.';
  if (!overlayComplete) return 'Finish the LEAGUEbuddy setup flow: rerun /setup-channels, then /setup-pins, then /setup-roles, then /syncsetupstatus.';
  if (syncNeeded) return 'Run /syncsetupstatus so LEAGUEbuddy access state matches the completed Madden overlay.';
  if (!setupCompleted) return 'Mark setup complete by syncing setup status after verifying the overlay configuration.';
  return 'Setup is complete. Use /server-check for server readiness and plan status.';
}

export function getSetupStatus(guildId) {
  const rec = planRepository.getGuild(guildId, { createIfMissing: false });
  const bypass = getTestingBypassBilling(guildId);
  const overlayConfig = overlayRepository.getGuildConfig(guildId);
  const overlayCompleteConfig = overlayRepository.getCompleteGuildConfig(guildId);
  const channelMap = overlayConfig?.compat?.maddenChannelMap || {};
  const roleMap = overlayConfig?.compat?.maddenRoleMap || {};
  const packsEnabled = Array.isArray(overlayConfig?.packsEnabled) ? overlayConfig.packsEnabled : [];
  const overlayExists = !!overlayConfig;
  const overlayComplete = !!overlayCompleteConfig;
  const setupCompleted = rec?.setupCompleted === true;
  const syncNeeded = overlayComplete !== setupCompleted;
  const channels = summarizeMappedEntries(channelMap);
  const roles = summarizeMappedEntries(roleMap);
  const requiredChannelKeys = requiredChannelKeysForSetup(overlayConfig);
  const requiredRoleKeys = requiredRoleKeysForSetup(overlayConfig);
  const missingRequiredChannels = diffMissingKeys(channelMap, requiredChannelKeys);
  const missingRequiredRoles = diffMissingKeys(roleMap, requiredRoleKeys);
  const { unlockedFeatures, blockedFeatures } = buildFeatureSummary(guildId, packsEnabled);

  return {
    guildId: String(guildId),
    overlayStatus: {
      exists: overlayExists,
      status: String(overlayConfig?.status || 'missing'),
      isComplete: overlayComplete,
      tier: overlayConfig?.license?.tier || 'free',
      updatedAt: overlayConfig?.updatedAt || null,
    },
    setupCompleted,
    syncNeeded,
    plan: bypass?.plan || rec?.plan || 'free',
    subscriptionStatus: bypass?.subscriptionStatus || rec?.subscriptionStatus || 'inactive',
    packsEnabled,
    channels,
    roles,
    missingRequiredChannels,
    missingRequiredRoles,
    unlockedFeatures,
    blockedFeatures,
    recommendedNextAction: buildRecommendedNextAction({
      overlayExists,
      overlayComplete,
      setupCompleted,
      syncNeeded,
      blockedFeatures,
    }),
    facts: {
      overlayConfigFound: overlayExists,
      overlayConfigComplete: overlayComplete,
      leaguebuddyRecordFound: !!rec,
      activatedAt: rec?.activatedAt || null,
      setupCompletedAt: rec?.setupCompletedAt || null,
      testingBypass: !!bypass,
    },
  };
}

export default {
  getSetupStatus,
  requiredChannelKeysForSetup,
  requiredRoleKeysForSetup,
  displaySetupItemName,
};
