// Tiny local harness to validate plan + packs gating without running the Discord bot.
// Usage:
//   node scripts/test_access_gate.js <guildId> <featureKey>
// Example:
//   node scripts/test_access_gate.js 123 sportsbook

import { hasFeatureAccess } from '../src/leaguebuddy/access.js';
import { loadGuildMaddenConfig } from '../src/shared/madden_guild_config.js';

const guildId = String(process.argv[2] || '');
const featureKey = String(process.argv[3] || '');

if (!guildId || !featureKey) {
    console.error('Expected: node scripts/test_access_gate.js <guildId> <featureKey>');
    process.exitCode = 2;
} else {
    const cfg = loadGuildMaddenConfig(guildId);
    const packs = Array.isArray(cfg?.packsEnabled) ? cfg.packsEnabled : [];
    const packEnabled = packs.includes(featureKey);
    const access = hasFeatureAccess(guildId, featureKey);

    console.log(JSON.stringify({ guildId, featureKey, packEnabled, access }, null, 2));
    process.exitCode = access.ok ? 0 : 1;
}
