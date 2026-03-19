import {
  getGuildChannelMap,
  getGuildCompatMaps,
  getGuildLicense,
  getGuildPinsMap,
  getGuildRoleMap,
  loadGuildMaddenConfig,
  loadGuildMaddenConfigIfComplete,
  saveGuildMaddenConfig,
  upsertGuildPin,
} from '../../shared/madden_guild_config.js';

export function getGuildConfig(guildId) {
  return loadGuildMaddenConfig(guildId);
}

export function getCompleteGuildConfig(guildId) {
  return loadGuildMaddenConfigIfComplete(guildId);
}

export function saveGuildConfig(guildId, cfg) {
  return saveGuildMaddenConfig(guildId, cfg);
}

export function getPacksEnabled(guildId) {
  const cfg = getGuildConfig(guildId);
  return Array.isArray(cfg?.packsEnabled) ? cfg.packsEnabled : [];
}

export function hasPackEnabled(guildId, featureKey) {
  return getPacksEnabled(guildId).includes(String(featureKey));
}

export function getChannelMap(guildId) {
  return getGuildChannelMap(guildId);
}

export function getRoleMap(guildId) {
  return getGuildRoleMap(guildId);
}

export function getPinsMap(guildId) {
  return getGuildPinsMap(guildId);
}

export function getLicense(guildId) {
  return getGuildLicense(guildId);
}

export function getCompatMaps(guildId) {
  return getGuildCompatMaps(guildId);
}

export { upsertGuildPin };

export default {
  getGuildConfig,
  getCompleteGuildConfig,
  saveGuildConfig,
  getPacksEnabled,
  hasPackEnabled,
  getChannelMap,
  getRoleMap,
  getPinsMap,
  getLicense,
  getCompatMaps,
  upsertGuildPin,
};
