import {
  buildDefaultGuildRecord,
  getGuildRecord,
  listGuildRecords,
  loadGuildStore,
  saveGuildStore,
  upsertGuildRecord,
} from '../guild_store.js';

export function getGuild(guildId, options = {}) {
  return getGuildRecord(guildId, options);
}

export function upsertGuild(guildId, partial) {
  return upsertGuildRecord(guildId, partial);
}

export function listGuilds() {
  return listGuildRecords();
}

export function createDefaultGuild(guildId) {
  return buildDefaultGuildRecord(guildId);
}

export { loadGuildStore, saveGuildStore };

export default {
  getGuild,
  upsertGuild,
  listGuilds,
  createDefaultGuild,
  loadGuildStore,
  saveGuildStore,
};
