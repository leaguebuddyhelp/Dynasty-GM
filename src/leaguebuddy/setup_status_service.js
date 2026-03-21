import { FEATURES, getFeature } from './plans.js';
import { hasFeatureAccess } from './access.js';
import planRepository from './repositories/guild_plan_repository.js';
import overlayRepository from './repositories/guild_overlay_repository.js';
import { getTestingBypassBilling } from './testing_bypass.js';

const CORE_REQUIRED_CHANNEL_KEYS = [
  'League Staff',
  'Madden League Buddy Announcements',
  'Available Teams',
  'Standings',
  'Stat Leaders',
  'Power Rankings',
  'Playoff Picture',
  'Transaction Log',
  'Injuries Log',
  'Player Change Log',
  'Game threads',
];

const STANDARD_REQUIRED_CHANNEL_KEYS = [
  'scoutingHub',
  'Top 100',
  'Yearly Awards',
  'Streaming links',
  'Strike Board',
  'Draft Grades',
  'Activity Checks',
];

const TRADE_REQUIRED_CHANNEL_KEYS = [
  'tradeSubmit',
  'Trade Block',
  'Trade Counts',
  'Trade Committee',
  'Approved trades',
  'Denied trades',
];

const BASE_REQUIRED_ROLE_KEYS = [
  'LB Commish',
  'LB Co-Commish',
  'LEAGUEbuddy Coaches',
];

const TRADE_REQUIRED_ROLE_KEYS = [
  'Trade Committee',
];

const CORE_REQUIRED_PIN_KEYS = [
  'available_teams',
  'standings',
  'stat_leaders',
  'playoff_picture',
  'power_rankings',
];

const STANDARD_REQUIRED_PIN_KEYS = [
  'top100',
  'madden_awards_button',
];

const TRADE_REQUIRED_PIN_KEYS = [
  'trade_counts',
];

const SETUP_ITEM_LABELS = {
  'LB Commish': 'LB Commish',
  'LB Co-Commish': 'LB Co-Commish',
  'LEAGUEbuddy Coaches': 'LEAGUEbuddy Coaches',
  'Trade Committee': 'LEAGUEbuddy Trade Committee',
  tradeSubmit: 'Submit Trade',
  scoutingHub: 'Scouting Hub',
  'Streaming links': 'Stream Links',
  'Strike Board': 'Strike Board',
  'Draft Grades': 'Draft Grades',
  'Activity Checks': 'Activity Checks',
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

export function displaySetupItemName(key) {
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

function requiredPinKeysForSetup(overlayConfig) {
  const tier = String(overlayConfig?.license?.tier || 'free').toLowerCase();
  const packsEnabled = Array.isArray(overlayConfig?.packsEnabled) ? overlayConfig.packsEnabled : [];
  return [
    ...CORE_REQUIRED_PIN_KEYS,
    ...((tier === 'standard' || tier === 'premium') ? STANDARD_REQUIRED_PIN_KEYS : []),
    ...(packsEnabled.includes('trades_basic') ? TRADE_REQUIRED_PIN_KEYS : []),
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
  if (!overlayExists) return 'Run /setup. It will point you to the next required setup step.';
  if (!overlayComplete) return 'Run /setup and follow the next step it shows until setup is complete.';
  if (syncNeeded) return 'Run /setup once more so LEAGUEbuddy can finalize the setup state.';
  if (!setupCompleted) return 'Run /setup once more to finish the last setup pass.';
  return 'Setup is complete. You can move on to /create-threads or your normal weekly workflow.';
}

export function getSetupStatus(guildId) {
  const rec = planRepository.getGuild(guildId, { createIfMissing: false });
  const bypass = getTestingBypassBilling(guildId);
  const overlayConfig = overlayRepository.getGuildConfig(guildId);
  const overlayCompleteConfig = overlayRepository.getCompleteGuildConfig(guildId);
  const channelMap = overlayConfig?.compat?.maddenChannelMap || {};
  const roleMap = overlayConfig?.compat?.maddenRoleMap || {};
  const pinsMap = overlayConfig?.pins || {};
  const packsEnabled = Array.isArray(overlayConfig?.packsEnabled) ? overlayConfig.packsEnabled : [];
  const overlayExists = !!overlayConfig;
  const overlayComplete = !!overlayCompleteConfig;
  const setupCompleted = rec?.setupCompleted === true;
  const syncNeeded = overlayComplete !== setupCompleted;
  const channels = summarizeMappedEntries(channelMap);
  const roles = summarizeMappedEntries(roleMap);
  const pins = summarizeMappedEntries(pinsMap);
  const requiredChannelKeys = requiredChannelKeysForSetup(overlayConfig);
  const requiredRoleKeys = requiredRoleKeysForSetup(overlayConfig);
  const missingRequiredPins = diffMissingKeys(pinsMap, requiredPinKeysForSetup(overlayConfig));
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
    pins,
    missingRequiredPins,
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
