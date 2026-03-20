import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    MessageFlags,
} from 'discord.js';

import {
    loadGuildMaddenConfig,
    saveGuildMaddenConfig,
} from '../../shared/madden_guild_config.js';
import { getBillingSummary } from '../../leaguebuddy/manual_billing_service.js';
import { getLeagueForGuild } from '../madden_config.js';
import { loadLeagueSnapshot } from '../madden_data.js';
import { seedAndHydratePins } from './setup-pins.js';

export const data = new SlashCommandBuilder()
    .setName('setup-channels')
    .setDescription('Admin-only: build the category, channels, pins, and config for this server\'s current package.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o =>
        o.setName('tier')
            .setDescription('Optional override. Defaults to this server\'s current package.')
            .addChoices(
                { name: 'Free', value: 'free' },
                { name: 'Standard', value: 'standard' },
                { name: 'Premium', value: 'premium' },
            )
            .setRequired(false));

const DEFAULT_PACKS = {
    free: ['core', 'threads', 'stats_light'],
    standard: ['core', 'threads', 'trades_basic', 'stats_light', 'scouting_draft', 'ops_light'],
    premium: ['core', 'threads', 'trades_basic', 'stats_light', 'scouting_draft', 'ops_light', 'ops_full', 'recognition', 'sportsbook'],
};

function normalizeSetupTier(value) {
    const tier = String(value || '').trim().toLowerCase();
    if (tier === 'starter') return 'standard';
    if (tier === 'pro') return 'premium';
    if (tier === 'standard') return 'standard';
    if (tier === 'premium') return 'premium';
    return 'free';
}

function detectSetupTier(guildId, explicitTier = null) {
    if (explicitTier) {
        return {
            tier: normalizeSetupTier(explicitTier),
            source: 'override',
        };
    }

    const billing = guildId ? getBillingSummary(guildId) : null;
    const storedPlan = normalizeSetupTier(billing?.plan || '');
    if (storedPlan !== 'free' || String(billing?.plan || '').toLowerCase() === 'free') {
        return {
            tier: storedPlan,
            source: billing?.testingBypass ? 'testing_bypass' : 'package',
        };
    }

    const overlayTier = normalizeSetupTier(loadGuildMaddenConfig(guildId)?.license?.tier || '');
    return {
        tier: overlayTier,
        source: overlayTier === 'free' ? 'default' : 'overlay',
    };
}

function uniqueStrings(values = []) {
    return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

const DEFAULT_CHANNEL_SPECS = [
    { key: 'League Staff', name: 'lb-league-staff', type: ChannelType.GuildText },
    { key: 'Available Teams', name: 'lb-available-teams', type: ChannelType.GuildText },
    { key: 'Standings', name: 'lb-standings', type: ChannelType.GuildText },
    { key: 'Stat Leaders', name: 'lb-stat-leaders', type: ChannelType.GuildText },
    { key: 'Power Rankings', name: 'lb-power-rankings', type: ChannelType.GuildText },
    { key: 'Playoff Picture', name: 'lb-playoff-picture', type: ChannelType.GuildText },
    { key: 'Top 100', name: 'lb-top-100', type: ChannelType.GuildText },
    { key: 'Game threads', name: 'lb-game-threads', type: ChannelType.GuildText },
    { key: 'Yearly Awards', name: 'lb-yearly-awards', type: ChannelType.GuildText },
    { key: 'rulesOps', name: 'lb-rules-ops', type: ChannelType.GuildText },
    { key: 'scoutingHub', name: 'lb-scouting-hub', type: ChannelType.GuildText },
    { key: 'breakdown', name: 'lb-breakdown', type: ChannelType.GuildText },
    { key: 'LG Logs', name: 'lb-lg-logs', type: ChannelType.GuildText },
];

const TRADE_CHANNEL_SPECS = [
    { key: 'tradeSubmit', name: 'lb-submit-trade', type: ChannelType.GuildText },
    { key: 'Trade Block', name: 'lb-trade-block', type: ChannelType.GuildText },
    { key: 'Trades', name: 'lb-transactions', type: ChannelType.GuildText },
    { key: 'Trade Counts', name: 'lb-trade-counts', type: ChannelType.GuildText },
    { key: 'Trade Committee', name: 'lb-trade-committee', type: ChannelType.GuildText },
    { key: 'Approved trades', name: 'lb-approved-trades', type: ChannelType.GuildText },
    { key: 'Denied trades', name: 'lb-denied-trades', type: ChannelType.GuildText },
];

const DEFAULT_CATEGORY_SPECS = [
    { key: 'LB Madden', name: 'LEAGUEbuddy Madden' },
];

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

async function ensureCategoryWithRetry(guild, spec, attempts = 3) {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await withTimeout(ensureCategory(guild, spec), 30000, `category create: ${spec.name}`);
        } catch (error) {
            lastError = error;
            await guild.channels.fetch().catch(() => null);
            const existing = guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && channel.name === spec.name);
            if (existing) return existing;
            if (attempt < attempts) {
                console.warn('[setup] retrying category create', {
                    guildId: guild.id,
                    category: spec.name,
                    attempt,
                    error: error?.message || error,
                });
            }
        }
    }
    throw lastError;
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

export async function applyOverwrites(channel, overwrites = []) {
    if (!channel || !Array.isArray(overwrites) || !overwrites.length) return channel;
    try {
        await channel.permissionOverwrites.set(overwrites, 'Madden v2 setup permissions');
    } catch (error) {
        console.warn('[setup] permission overwrite skipped', {
            channelId: channel?.id || null,
            channelName: channel?.name || null,
            error: error?.message || error,
        });
    }
    return channel;
}

function allow(...perms) {
    return perms;
}

function deny(...perms) {
    return perms;
}

export function buildSetupOverwrites(guild, roleMap = {}) {
    const everyoneId = guild.roles.everyone.id;
    const commishId = roleMap['Ghost Legacy Commish'] || null;
    const coCommishId = roleMap['Ghost Legacy Co-Commish'] || null;
    const tradeCommitteeId = roleMap['Trade Committee'] || null;

    const publicReadOnly = [
        {
            id: everyoneId,
            allow: allow(PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory),
            deny: deny(PermissionFlagsBits.SendMessages),
        },
    ];

    const publicInteractive = [
        {
            id: everyoneId,
            allow: allow(
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.SendMessagesInThreads,
                PermissionFlagsBits.CreatePublicThreads,
                PermissionFlagsBits.CreatePrivateThreads,
                PermissionFlagsBits.UseApplicationCommands,
            ),
            deny: [],
        },
    ];

    const staffOnly = [
        {
            id: everyoneId,
            deny: deny(PermissionFlagsBits.ViewChannel),
            allow: [],
        },
        ...(commishId ? [{
            id: commishId,
            allow: allow(
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ManageMessages,
                PermissionFlagsBits.ManageThreads,
            ),
            deny: [],
        }] : []),
        ...(coCommishId ? [{
            id: coCommishId,
            allow: allow(
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ManageMessages,
                PermissionFlagsBits.ManageThreads,
            ),
            deny: [],
        }] : []),
    ];

    const tradeCommitteeOnly = [
        {
            id: everyoneId,
            deny: deny(PermissionFlagsBits.ViewChannel),
            allow: [],
        },
        ...(commishId ? [{
            id: commishId,
            allow: allow(
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ManageMessages,
            ),
            deny: [],
        }] : []),
        ...(coCommishId ? [{
            id: coCommishId,
            allow: allow(
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ManageMessages,
            ),
            deny: [],
        }] : []),
        ...(tradeCommitteeId ? [{
            id: tradeCommitteeId,
            allow: allow(
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.SendMessages,
            ),
            deny: [],
        }] : []),
    ];

    return {
        category: publicInteractive,
        channels: {
            'League Staff': staffOnly,
            'LG Logs': staffOnly,
            rulesOps: publicReadOnly,
            'Available Teams': publicReadOnly,
            Standings: publicReadOnly,
            'Stat Leaders': publicReadOnly,
            'Power Rankings': publicReadOnly,
            'Playoff Picture': publicReadOnly,
            'Top 100': publicReadOnly,
            'Yearly Awards': publicReadOnly,
            tradeSubmit: [
                {
                    id: everyoneId,
                    allow: allow(
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.UseApplicationCommands,
                    ),
                    deny: deny(PermissionFlagsBits.SendMessages),
                },
            ],
            'Trade Counts': publicReadOnly,
            Trades: publicReadOnly,
            'Approved trades': publicReadOnly,
            'Denied trades': publicReadOnly,
            'Trade Committee': tradeCommitteeOnly,
        },
    };
}

async function ensureTextChannelInCategoryWithRetry(guild, spec, categoryId = null, attempts = 3) {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await withTimeout(
                ensureTextChannelInCategory(guild, spec, categoryId),
                30000,
                `channel create: ${spec.name}`,
            );
        } catch (error) {
            lastError = error;
            await guild.channels.fetch().catch(() => null);
            const existing = guild.channels.cache.find((channel) => channel.type === ChannelType.GuildText && channel.name === spec.name);
            if (existing) return existing;
            if (attempt < attempts) {
                console.warn('[setup] retrying channel create', {
                    guildId: guild.id,
                    channel: spec.name,
                    attempt,
                    error: error?.message || error,
                });
            }
        }
    }
    throw lastError;
}

function buildProgressLines(step, details = []) {
    return [
        '**Madden v2 setup**',
        `Current step: ${step}`,
        ...details.filter(Boolean).map((detail) => `- ${detail}`),
    ].join('\n');
}

async function withTimeout(promise, ms, label) {
    let timer = null;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export async function execute(interaction) {
    const guild = interaction.guild;
    if (!guild) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
        return;
    }

    let currentStep = 'starting';
    const updateProgress = async (step, details = []) => {
        currentStep = step;
        await interaction.editReply({ content: buildProgressLines(step, details) });
    };

    await interaction.reply({
        content: buildProgressLines('starting', ['Checking tier, packs, and existing server config']),
        flags: MessageFlags.Ephemeral,
    });

    try {
        const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
        const perms = me?.permissions;
        await guild.roles.fetch().catch(() => null);
        const roleCount = guild.roles.cache.size;
        if (!perms?.has(PermissionFlagsBits.ManageRoles) || !perms?.has(PermissionFlagsBits.ManageChannels)) {
            await interaction.editReply({
                content: [
                    '**Madden v2 setup failed**',
                    'The bot is missing required Discord permissions.',
                    `- Manage Roles: ${perms?.has(PermissionFlagsBits.ManageRoles) ? 'yes' : 'no'}`,
                    `- Manage Channels: ${perms?.has(PermissionFlagsBits.ManageChannels) ? 'yes' : 'no'}`,
                    'Grant those permissions to the bot role, then run `/setup-channels` again.',
                ].join('\n'),
            });
            return;
        }
        if (roleCount >= 240) {
            await interaction.editReply({
                content: [
                    '**Madden v2 setup failed**',
                    `This server already has **${roleCount} roles**.`,
                    'Discord servers have a hard role limit, and repeated test setups can leave old coach roles behind.',
                    'Delete old coach/LB roles first, then run `/setup-reset` or `/setup-channels` again.',
                ].join('\n'),
            });
            return;
        }

        const tierChoice = detectSetupTier(guild.id, interaction.options.getString('tier'));
        const tier = tierChoice.tier;
        const packsEnabled = [...(DEFAULT_PACKS[tier] || DEFAULT_PACKS.free)];
        const tradeEnabled = packsEnabled.includes('trades_basic');

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

        const leagueId = getLeagueForGuild(guild.id);

        await updateProgress('creating channels', [
            `Package: ${tier}${tierChoice.source === 'override' ? ' (manual override)' : tierChoice.source === 'package' ? ' (auto-detected from this server)' : tierChoice.source === 'testing_bypass' ? ' (testing bypass)' : ''}`,
            `Current role count: ${roleCount}`,
            'Building the LEAGUEbuddy category and channel layout first',
        ]);

        // Category
        let rootCategory = null;
        for (const cat of DEFAULT_CATEGORY_SPECS) {
            rootCategory = await ensureCategoryWithRetry(guild, cat);
            cfg.compat.maddenChannelMap[cat.key] = rootCategory.id;
        }
        const overwritePlan = buildSetupOverwrites(guild, cfg.compat.maddenRoleMap);
        await applyOverwrites(rootCategory, overwritePlan.category);

        // Channels (created under category when possible)
        for (const spec of [...DEFAULT_CHANNEL_SPECS, ...(tradeEnabled ? TRADE_CHANNEL_SPECS : [])]) {
            const ch = await ensureTextChannelInCategoryWithRetry(guild, spec, rootCategory?.id || null);
            await applyOverwrites(ch, overwritePlan.channels[spec.key] || []);
            cfg.compat.maddenChannelMap[spec.key] = ch.id;
        }

        if (tradeEnabled && cfg.compat.maddenChannelMap['Trades']) {
            cfg.compat.maddenChannelMap['Transaction Log'] = cfg.compat.maddenChannelMap['Trades'];
        }
        if (tradeEnabled && cfg.compat.maddenChannelMap['Trade Committee']) {
            cfg.compat.maddenChannelMap['Pending Trades'] = cfg.compat.maddenChannelMap['Trade Committee'];
        }

        cfg.status = 'incomplete';
        saveGuildMaddenConfig(guild.id, cfg);

        await updateProgress('saving server config', [
            'Overlay config saved',
            'Channels and base pins can now be created before any role pass',
        ]);

        let snapshotReady = false;
        if (leagueId) {
            try {
                snapshotReady = !!loadLeagueSnapshot(leagueId);
            } catch {
                snapshotReady = false;
            }
        }

        let pinsSummary = null;
        await updateProgress('seeding pins', [
            'Creating or updating pinned league boards',
            snapshotReady ? 'Hydrating boards from the synced snapshot' : 'Some boards may stay placeholders until `/sync` runs',
        ]);
        try {
            const out = await withTimeout(
                seedAndHydratePins(interaction.client, guild.id),
                30000,
                'pin seeding',
            );
            const ok = Array.isArray(out?.results)
                ? out.results.filter(r => String(r).includes('✅')).length
                : null;
            pinsSummary = (ok === null) ? 'Pins: attempted' : `Pins: seeded ${ok}/6`;
        } catch {
            pinsSummary = 'Pins: attempted (some failed)';
        }
        const pinsNeedRetry = /some failed/i.test(pinsSummary);

        cfg.status = 'complete';
        saveGuildMaddenConfig(guild.id, cfg);

        await interaction.editReply({
            content: [
                '**Madden v2 setup complete**',
                `Package: **${tier}**`,
                `Packs: ${packsEnabled.join(', ')}`,
                `- Roles were not created during this step`,
                `- Trade center: ${tradeEnabled ? 'included' : 'not included in Free tier'}`,
                '',
                `Pins: ${pinsSummary.replace(/^Pins:\s*/, '')}`,
                !snapshotReady
                    ? 'Next: run `/install-league`, then `/sync`.'
                    : pinsNeedRetry
                        ? 'Next: run `/setup-pins`.'
                        : 'Next: run `/setup-roles`.'
            ].join('\n'),
        });
    } catch (error) {
        console.error('[setup] failed', { guildId: guild.id, step: currentStep, error: error?.message || error });
        await interaction.editReply({
            content: [
                '**Madden v2 setup failed**',
                `Step: ${currentStep}`,
                `Reason: ${error?.message || error}`,
                'If this keeps happening, check the bot role has Manage Roles and Manage Channels, and that its role sits above the roles it needs to manage.',
            ].join('\n'),
        });
    }
}

export default { data, execute };
