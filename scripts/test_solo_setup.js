import assert from 'node:assert/strict';
import { Collection, ChannelType, PermissionFlagsBits } from 'discord.js';
import { execute, SOLO_CHANNELS, SOLO_CATEGORIES } from '../src/madden/staff/madden-setup.js';
import { execute as showSetup } from '../src/madden/staff/setup_dashboard.js';
import { execute as setupButton } from '../src/interactions/madden_setup_dashboard.js';
import { loadGuildMaddenConfig, saveGuildMaddenConfig } from '../src/shared/madden_guild_config.js';
import { getLeagueConnectionDashboard, beginLeagueConnection } from '../src/madden/services/export_first_connection_service.js';
import repository from '../src/leaguebuddy/repositories/madden_connection_repository.js';

process.env.MADDEN_SOLO_USER_ID = 'operator-1';
process.env.MADDEN_SOLO_GUILD_ID = 'guild-1';
const cache = new Collection();
let created = 0;
const guild = {
  id: 'guild-1', name: 'Solo Test', roles: { everyone: { id: 'guild-1' } },
  members: { me: { id: 'bot-1', permissions: { has: () => true } } },
  channels: {
    cache, fetch: async () => cache,
    create: async (spec) => {
      const channel = {
        id: `channel-${++created}`, name: spec.name, type: spec.type, parentId: spec.parent,
        overwrites: spec.permissionOverwrites,
        permissionOverwrites: { set: async (entries) => { channel.overwrites = entries; } },
        setParent: async (id) => { channel.parentId = id; },
      };
      cache.set(channel.id, channel);
      return channel;
    },
  },
};
// Existing unrelated and former multiplayer channels are preserved.
cache.set('old-trade', { id: 'old-trade', name: 'lb-trade-block', type: ChannelType.GuildText });
saveGuildMaddenConfig('guild-1', { license: { tier: 'premium' }, packsEnabled: ['sportsbook'], compat: { maddenChannelMap: {} } });
let payload;
const interaction = {
  guild, guildId: guild.id, user: { id: 'operator-1' }, deferred: true,
  editReply: async (value) => { payload = value; },
};
await execute(interaction);
assert.equal(created, SOLO_CHANNELS.length + SOLO_CATEGORIES.length);
const firstCreated = created;
await execute(interaction);
assert.equal(created, firstCreated, 'Retry should reuse all channels');
assert.ok(cache.has('old-trade'));
const config = loadGuildMaddenConfig(guild.id);
assert.equal(config.status, 'complete');
assert.equal(config.license, undefined);
assert.equal(config.packsEnabled, undefined);
assert.deepEqual(config.compat.maddenRoleMap, {});
for (const channel of [...cache.values()].filter((channel) => channel.id !== 'old-trade')) {
  assert.ok(channel.overwrites.find((entry) => entry.id === guild.id).deny.includes(PermissionFlagsBits.ViewChannel));
  assert.ok(channel.overwrites.some((entry) => entry.id === 'operator-1'));
}
const boardKeys = ['Weekly Top 100', 'Yearly Top 100', 'All-Pro Teams'];
const oldBoardIds = boardKeys.map((key) => config.compat.maddenChannelMap[key]);
cache.delete(oldBoardIds[0]);
cache.delete(oldBoardIds[1]);
for (const key of boardKeys) delete config.compat.maddenChannelMap[key];
saveGuildMaddenConfig(guild.id, config);
const originalOtherChannels = [...cache.keys()];
await showSetup(interaction);
assert.equal(payload.embeds[0].toJSON().title, 'Solo Franchise Setup');
assert.equal(created, firstCreated + 2, 'Setup creates missing boards and reuses an existing board');
const updated = loadGuildMaddenConfig(guild.id);
assert.equal(updated.compat.maddenChannelMap['All-Pro Teams'], oldBoardIds[2]);
for (const key of boardKeys) {
  const channel = cache.get(updated.compat.maddenChannelMap[key]);
  assert.equal(channel.parentId, updated.compat.maddenChannelMap['Franchise HQ']);
  assert.ok(channel.overwrites.find((entry) => entry.id === guild.id).deny.includes(PermissionFlagsBits.ViewChannel));
}
assert.ok(originalOtherChannels.every((id) => cache.has(id)), 'Existing channels remain intact');
assert.match(JSON.stringify(payload), /Top 100 and All-Pro channels updated/);
await showSetup(interaction);
assert.equal(created, firstCreated + 2, 'Repeat setup does not duplicate boards');

cache.delete(updated.compat.maddenChannelMap['Weekly Top 100']);
guild.members.me.permissions.has = () => false;
await showSetup(interaction);
assert.match(JSON.stringify(payload), /Manage Channels/);
assert.equal(created, firstCreated + 2);
guild.members.me.permissions.has = () => true;
await showSetup(interaction);
assert.equal(created, firstCreated + 3, 'A later setup repairs the missing channel');
assert.doesNotMatch(JSON.stringify(payload), /claim|checkout|subscription|premium|pricing/i);
let staleMessage;
await setupButton({ customId: 'madden_setup|roles', reply: async (value) => { staleMessage = value; } });
assert.match(staleMessage.content, /no longer available/);
const own = beginLeagueConnection({ guildId: 'guild-1', createdByUserId: 'operator-1' });
assert.equal(getLeagueConnectionDashboard(own.session.token).ok, true);
assert.throws(() => beginLeagueConnection({ guildId: 'other-guild', createdByUserId: 'operator-1' }));
const legacy = repository.createConnectSession({ guildId: 'guild-1', createdByUserId: 'other-user', expiresAt: new Date(Date.now() + 60000).toISOString() });
assert.equal(getLeagueConnectionDashboard(legacy.token).code, 'unauthorized_session');
console.log('PASS private setup, retry recovery, no plan state, stale controls, and operator-only connection sessions');
