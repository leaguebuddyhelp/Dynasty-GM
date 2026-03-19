import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
} from 'discord.js';

import {
    loadGuildMaddenConfig,
    saveGuildMaddenConfig,
} from '../../shared/madden_guild_config.js';

import { execute as seedPinsExecute } from './setup-pins.js';

export const data = new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Admin-only: set up Madden v2 resources (channels/roles) for this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o =>
        o.setName('tier')
            .setDescription('License tier to apply (free | starter | pro)')
            .addChoices(
                { name: 'Free', value: 'free' },
                { name: 'Starter', value: 'starter' },
                { name: 'Pro', value: 'pro' },
            )
            .setRequired(false))
    .addBooleanOption(o =>
        o.setName('include_recognition')
            .setDescription('Enable recognition pack (Pro only)')
            .setRequired(false))
    .addBooleanOption(o =>
        o.setName('include_sportsbook')
            .setDescription('Enable sportsbook pack (Pro only)')
            .setRequired(false))
    .addBooleanOption(o =>
        o.setName('seed_pins')
            .setDescription('Create/pin the starter messages (recommended)')
            .setRequired(false));

const DEFAULT_PACKS = {
    free: ['core', 'threads', 'trades_basic', 'stats_light'],
    starter: ['core', 'threads', 'trades_basic', 'stats_light', 'scouting_draft', 'ops_light'],
    pro: ['core', 'threads', 'trades_basic', 'stats_light', 'scouting_draft', 'ops_light', 'ops_full', 'recognition', 'sportsbook'],
};

const DEFAULT_ROLE_SPECS = [
    { key: 'Ghost Legacy Commish', name: 'LB Commish', color: 0x5865F2, hoist: true },
    { key: 'Ghost Legacy Co-Commish', name: 'LB Co-Commish', color: 0x57F287, hoist: true },
];

const DEFAULT_CHANNEL_SPECS = [
    // Core keys referenced by v1 modules (keep keys stable for compatibility)
    { key: 'League Staff', name: 'lb-league-staff', type: ChannelType.GuildText },
    { key: 'LG Logs', name: 'lb-lg-logs', type: ChannelType.GuildText },
    { key: 'Game threads', name: 'lb-game-threads', type: ChannelType.GuildText },
    { key: 'Trade Committee', name: 'lb-trade-committee', type: ChannelType.GuildText },
    { key: 'Trades', name: 'lb-trades', type: ChannelType.GuildText },
    { key: 'Yearly Awards', name: 'lb-yearly-awards', type: ChannelType.GuildText },
    { key: 'Standings', name: 'lb-standings', type: ChannelType.GuildText },
    { key: 'Stat Leaders', name: 'lb-stat-leaders', type: ChannelType.GuildText },
    { key: 'Power Rankings', name: 'lb-power-rankings', type: ChannelType.GuildText },
    { key: 'Playoff Picture', name: 'lb-playoff-picture', type: ChannelType.GuildText },
    { key: 'Top 100', name: 'lb-top-100', type: ChannelType.GuildText },
    // Onboard.js important channels
    { key: 'rulesOps', name: 'lb-rules-ops', type: ChannelType.GuildText },
    { key: 'tradeSubmit', name: 'lb-trade-submit', type: ChannelType.GuildText },
    { key: 'scoutingHub', name: 'lb-scouting-hub', type: ChannelType.GuildText },
    // Sportsbook uses “breakdown” naming a lot
    { key: 'breakdown', name: 'lb-breakdown', type: ChannelType.GuildText },
];

const DEFAULT_CATEGORY_SPECS = [
    { key: 'LB Madden', name: 'LEAGUEbuddy Madden' },
];

async function ensureRole(guild, spec) {
    const existingByName = guild.roles.cache.find(r => r.name === spec.name);
    if (existingByName) return existingByName;
    return guild.roles.create({
        name: spec.name,
        color: spec.color,
        hoist: spec.hoist,
        mentionable: false,
        reason: 'Madden v2 setup',
    });
}

async function ensureTextChannel(guild, spec) {
    const existing = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === spec.name);
    if (existing) return existing;
    return guild.channels.create({
        name: spec.name,
        type: ChannelType.GuildText,
        reason: 'Madden v2 setup',
    });
}

async function ensureCategory(guild, spec) {
    const existing = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === spec.name);
    if (existing) return existing;
    return guild.channels.create({
        name: spec.name,
        type: ChannelType.GuildCategory,
        reason: 'Madden v2 setup',
    });
}

async function ensureTextChannelInCategory(guild, spec, categoryId = null) {
    const existing = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === spec.name);
    if (existing) return existing;
    return guild.channels.create({
        name: spec.name,
        type: ChannelType.GuildText,
        parent: categoryId || undefined,
        reason: 'Madden v2 setup',
    });
}

export async function execute(interaction) {
    const guild = interaction.guild;
    if (!guild) {
        await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
        return;
    }

    await interaction.reply({ content: 'Setting up Madden v2 resources… (this may take a few seconds)', ephemeral: true });

    const tier = interaction.options.getString('tier') || loadGuildMaddenConfig(guild.id)?.license?.tier || 'free';
    const packsEnabled = [...(DEFAULT_PACKS[tier] || DEFAULT_PACKS.free)];

    // Optional packs (Pro only)
    if (tier === 'pro') {
        if (interaction.options.getBoolean('include_recognition')) {
            if (!packsEnabled.includes('recognition')) packsEnabled.push('recognition');
        }
        if (interaction.options.getBoolean('include_sportsbook')) {
            if (!packsEnabled.includes('sportsbook')) packsEnabled.push('sportsbook');
        }
    }

    const cfg = {
        version: 2,
        status: 'incomplete',
        updatedAt: new Date().toISOString(),
        license: { tier },
        packsEnabled,
        compat: {
            maddenChannelMap: {},
            maddenRoleMap: {},
        },
        pins: {
            // known message pins used by modules
            available_teams: null,
            stat_leaders: null,
            standings: null,
            playoff_picture: null,
            power_rankings: null,
            top100: null,
            madden_awards_button: null,
            trade_counts: null,
        },
    };

    // Roles
    for (const spec of DEFAULT_ROLE_SPECS) {
        const role = await ensureRole(guild, spec);
        cfg.compat.maddenRoleMap[spec.key] = role.id;
    }

    // Category
    let rootCategory = null;
    for (const cat of DEFAULT_CATEGORY_SPECS) {
        rootCategory = await ensureCategory(guild, cat);
        cfg.compat.maddenChannelMap[cat.key] = rootCategory.id;
    }

    // Channels (created under category when possible)
    for (const spec of DEFAULT_CHANNEL_SPECS) {
        const ch = await ensureTextChannelInCategory(guild, spec, rootCategory?.id || null);
        cfg.compat.maddenChannelMap[spec.key] = ch.id;
    }

    cfg.status = 'complete';
    saveGuildMaddenConfig(guild.id, cfg);

    // Optional: seed pinned messages now so /setup-check shows green immediately.
    const seedPins = interaction.options.getBoolean('seed_pins');
    let pinsSummary = null;
    if (seedPins) {
        try {
            const out = await seedPinsExecute(interaction);
            const ok = Array.isArray(out?.results)
                ? out.results.filter(r => String(r).includes('✅')).length
                : null;
            pinsSummary = (ok === null) ? 'Pins: attempted' : `Pins: seeded ${ok}/6`;
        } catch {
            pinsSummary = 'Pins: attempted (some failed)';
        }
    }

    await interaction.editReply({
        content: [
            '**Madden v2 setup complete**',
            `Tier: **${tier}**`,
            `Packs: ${packsEnabled.join(', ')}`,
            '',
            'Next:',
            '- Run your existing league auth/sync commands (this setup does not auth).',
            '- Use `/setup-check` anytime to verify.',
            seedPins ? `- ${pinsSummary}` : '- Pins: not seeded (run `/setup-pins` anytime)',
        ].join('\n'),
    });
}

export default { data, execute };
