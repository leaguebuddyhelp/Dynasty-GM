const SOLO_MODE_COMMAND_BLOCKLIST = new Set([
  'activateplan',
  'activitycheck',
  'assignrole',
  'claim-plan',
  'deactivateplan',
  'draftclass',
  'draftprimer',
  'enablepack',
  'disablepack',
  'member',
  'myscouts',
  'onboard',
  'pricing',
  'recruiting',
  'scout',
  'setplan',
  'setsubscriptionstatus',
  'setup',
  'setup-check',
  'setup-reset',
  'setup-roles',
  'streamlink',
  'tradeblock',
  'tradevalue',
  'viewbilling',
]);

const SOLO_MODE_COMMAND_PREFIX_BLOCKLIST = ['madden-setup'];

const SOLO_MODE_INTERACTION_BLOCKLIST = [
  /^(?:madden_)?(?:trade|trade_builder|trade_for|trade_preview|trade_modal|committee_|trade_dm_)/i,
  /^(?:submit_score|game_complete|madden_game_complete|madden_game_status|set_game_info_modal_)/i,
  /^(?:madden_myscouts_|madden_bigboard_|madden_mockdraft|madden_recruiting_page_|scout_select_|mergedraft_)/i,
  /^(?:madden_content_review|madden_franchisehub_|madden_sportsbook_)/i,
  /^(?:lb_plan_|claim_|setup_claim_)/i,
];

function envFlag(value) {
  return ['true', '1', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

export function isSoloModeEnabled() {
  return envFlag(process.env.MADDEN_SOLO_MODE);
}

export function getSoloModeConfig() {
  return {
    enabled: isSoloModeEnabled(),
    userId: String(process.env.MADDEN_SOLO_USER_ID || '').trim(),
    guildId: String(process.env.MADDEN_SOLO_GUILD_ID || '').trim(),
  };
}

export function validateSoloModeConfig() {
  const config = getSoloModeConfig();
  if (!config.enabled) return config;
  const missing = [];
  if (!config.userId) missing.push('MADDEN_SOLO_USER_ID');
  if (!config.guildId) missing.push('MADDEN_SOLO_GUILD_ID');
  if (missing.length) {
    throw new Error(`MADDEN_SOLO_MODE requires ${missing.join(' and ')}.`);
  }
  return config;
}

export function isSoloCommandEnabled(commandName) {
  if (!isSoloModeEnabled()) return true;
  const normalized = String(commandName || '').trim().toLowerCase();
  if (SOLO_MODE_COMMAND_BLOCKLIST.has(normalized)) return false;
  return !SOLO_MODE_COMMAND_PREFIX_BLOCKLIST.some((prefix) => normalized.startsWith(prefix));
}

export function getSoloInteractionDenial({ userId, guildId, commandName, customId } = {}) {
  const config = getSoloModeConfig();
  if (!config.enabled) return null;
  if (!config.userId || !config.guildId) {
    return 'Solo mode is not configured. Set MADDEN_SOLO_USER_ID and MADDEN_SOLO_GUILD_ID.';
  }
  if (String(guildId || '') !== config.guildId) {
    return 'This bot is configured for a different Madden franchise server.';
  }
  if (String(userId || '') !== config.userId) {
    return 'This Madden Franchise HQ is restricted to its authorized operator.';
  }
  if (commandName && !isSoloCommandEnabled(commandName)) {
    return 'That multiplayer or customer-management command is disabled in solo mode.';
  }
  const interactionId = String(customId || '');
  if (interactionId && SOLO_MODE_INTERACTION_BLOCKLIST.some((pattern) => pattern.test(interactionId))) {
    return 'That multiplayer or customer-management interaction is disabled in solo mode.';
  }
  return null;
}

export default {
  getSoloModeConfig,
  getSoloInteractionDenial,
  isSoloCommandEnabled,
  isSoloModeEnabled,
  validateSoloModeConfig,
};
