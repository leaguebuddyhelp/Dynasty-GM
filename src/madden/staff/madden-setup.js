import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    MessageFlags,
    EmbedBuilder,
} from 'discord.js';

import {
    loadGuildMaddenConfig,
    saveGuildMaddenConfig,
} from '../../shared/madden_guild_config.js';
import { getBillingSummary } from '../../leaguebuddy/manual_billing_service.js';
import { getLeagueForGuild } from '../madden_config.js';
import { loadLeagueSnapshot } from '../madden_data.js';
import { inspectSetupReadiness } from './setup_readiness.js';

export const data = new SlashCommandBuilder()
    .setName('setup-channels')
    .setDescription('Admin-only: build the category, channels, and config for this server\'s current package.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

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
    const billingStatus = String(billing?.subscriptionStatus || '').toLowerCase();
    const paidPlanActive =
        storedPlan !== 'free' &&
        (
            billing?.testingBypass === true ||
            billingStatus === 'active' ||
            billingStatus === 'trialing'
        );

    if (paidPlanActive || String(billing?.plan || '').toLowerCase() === 'free') {
        return {
            tier: paidPlanActive ? storedPlan : 'free',
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

const CORE_CHANNEL_SPECS = [
    { key: 'League Staff', name: 'lb-league-staff', type: ChannelType.GuildText },
    { key: 'Madden League Buddy Announcements', name: 'lb-announcements', type: ChannelType.GuildText },
    { key: 'Available Teams', name: 'lb-available-teams', type: ChannelType.GuildText },
    { key: 'Standings', name: 'lb-standings', type: ChannelType.GuildText },
    { key: 'Stat Leaders', name: 'lb-stat-leaders', type: ChannelType.GuildText },
    { key: 'Power Rankings', name: 'lb-power-rankings', type: ChannelType.GuildText },
    { key: 'Playoff Picture', name: 'lb-playoff-picture', type: ChannelType.GuildText },
    { key: 'Transaction Log', name: 'lb-transactions', type: ChannelType.GuildText },
    { key: 'Injuries Log', name: 'lb-injuries-log', type: ChannelType.GuildText },
    { key: 'Player Change Log', name: 'lb-player-change-log', type: ChannelType.GuildText },
    { key: 'Game threads', name: 'lb-game-threads', type: ChannelType.GuildText },
];

const STANDARD_PLUS_CHANNEL_SPECS = [
    { key: 'scoutingHub', name: 'lb-scouting-hub', type: ChannelType.GuildText },
    { key: 'Top 100', name: 'lb-top-100', type: ChannelType.GuildText },
    { key: 'Weekly Awards', name: 'lb-weekly-awards', type: ChannelType.GuildText },
    { key: 'Yearly Awards', name: 'lb-yearly-awards', type: ChannelType.GuildText },
    { key: 'Streaming links', name: 'lb-streamlink', type: ChannelType.GuildText },
    { key: 'Strike Board', name: 'lb-strike-board', type: ChannelType.GuildText },
    { key: 'Draft Grades', name: 'lb-draft-grades', type: ChannelType.GuildText },
    { key: 'Activity Checks', name: 'lb-activitycheck', type: ChannelType.GuildText },
];

const TRADE_CHANNEL_SPECS = [
    { key: 'tradeSubmit', name: 'lb-submit-trade', type: ChannelType.GuildText },
    { key: 'Trade Block', name: 'lb-trade-block', type: ChannelType.GuildText },
    { key: 'Trade Counts', name: 'lb-trade-counts', type: ChannelType.GuildText },
    { key: 'Trade Committee', name: 'lb-trade-committee', type: ChannelType.GuildText },
    { key: 'Approved trades', name: 'lb-approved-trades', type: ChannelType.GuildText },
    { key: 'Denied trades', name: 'lb-denied-trades', type: ChannelType.GuildText },
];

const DEFAULT_CATEGORY_SPECS = [
    { key: 'LB Madden', name: 'LEAGUEbuddy Madden' },
];

const LEGACY_UNSUPPORTED_CHANNEL_KEYS = ['rulesOps', 'breakdown', 'LG Logs'];

function channelSpecsForTier(tier, tradeEnabled) {
    return [
        ...CORE_CHANNEL_SPECS,
        ...(tier === 'standard' || tier === 'premium' ? STANDARD_PLUS_CHANNEL_SPECS : []),
        ...(tradeEnabled ? TRADE_CHANNEL_SPECS : []),
    ];
}

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
    if (!channel || !Array.isArray(overwrites) || !overwrites.length) {
        return { channel, ok: true, error: null };
    }
    try {
        await channel.permissionOverwrites.set(overwrites, 'Madden v2 setup permissions');
        return { channel, ok: true, error: null };
    } catch (error) {
        console.warn('[setup] permission overwrite skipped', {
            channelId: channel?.id || null,
            channelName: channel?.name || null,
            error: error?.message || error,
        });
        return { channel, ok: false, error };
    }
}

function allow(...perms) {
    return perms;
}

function deny(...perms) {
    return perms;
}

function roleIdFor(roleMap = {}, aliases = []) {
    for (const alias of aliases) {
        const id = roleMap[alias];
        if (id) return id;
    }
    return null;
}

export function buildSetupOverwrites(guild, roleMap = {}) {
    const everyoneId = guild.roles.everyone.id;
    const botRoleId = guild.members.me?.roles?.botRole?.id || null;
    const commishId = roleIdFor(roleMap, ['LB Commish', 'Ghost Legacy Commish']);
    const coCommishId = roleIdFor(roleMap, ['LB Co-Commish', 'Ghost Legacy Co-Commish']);
    const tradeCommitteeId = roleIdFor(roleMap, [
        'Trade Committee',
        'Ghost Legacy Trade Committee',
        'Madden Trade Committee',
        'Madden Trade Committe',
        'LB Trade Committee',
        'LEAGUEbuddy Trade Committee',
    ]);
    const coachGroupId = roleIdFor(roleMap, ['LEAGUEbuddy Coaches', 'LB Coaches', 'Ghost Legacy']);

    const botAccess = botRoleId ? [{
        id: botRoleId,
        allow: allow(
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.UseApplicationCommands,
            PermissionFlagsBits.AddReactions,
            PermissionFlagsBits.ManageMessages,
            PermissionFlagsBits.ManageThreads,
            PermissionFlagsBits.SendMessagesInThreads,
            PermissionFlagsBits.CreatePublicThreads,
            PermissionFlagsBits.CreatePrivateThreads,
        ),
        deny: [],
    }] : [];

    const staffRoleAccess = [
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

    const coachGroupAccess = coachGroupId ? [{
        id: coachGroupId,
        allow: allow(
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.SendMessagesInThreads,
            PermissionFlagsBits.CreatePublicThreads,
            PermissionFlagsBits.UseApplicationCommands,
        ),
        deny: [],
    }] : [];

    function withBotAccess(overwrites = []) {
        return [...botAccess, ...overwrites];
    }

    function withCommonRoleAccess(overwrites = []) {
        return withBotAccess([
            ...staffRoleAccess,
            ...coachGroupAccess,
            ...overwrites,
        ]);
    }

    const publicReadOnly = withCommonRoleAccess([
        {
            id: everyoneId,
            allow: allow(PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory),
            deny: deny(
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.SendMessagesInThreads,
                PermissionFlagsBits.CreatePublicThreads,
                PermissionFlagsBits.CreatePrivateThreads,
            ),
        },
    ]);

    const publicInteractive = withCommonRoleAccess([
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
    ]);

    const publicReadOnlyWithStaffPosting = withBotAccess([
        {
            id: everyoneId,
            allow: allow(PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory),
            deny: deny(
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.SendMessagesInThreads,
                PermissionFlagsBits.CreatePublicThreads,
                PermissionFlagsBits.CreatePrivateThreads,
            ),
        },
        ...staffRoleAccess,
    ]);

    const publicReactionCheck = withBotAccess([
        {
            id: everyoneId,
            allow: allow(
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AddReactions,
                PermissionFlagsBits.UseApplicationCommands,
            ),
            deny: deny(
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.SendMessagesInThreads,
                PermissionFlagsBits.CreatePublicThreads,
                PermissionFlagsBits.CreatePrivateThreads,
            ),
        },
        ...staffRoleAccess,
    ]);

    const publicInteractiveWithCoachAccess = withBotAccess([
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
        ...coachGroupAccess,
    ]);

    const staffOnly = withBotAccess([
        {
            id: everyoneId,
            deny: deny(PermissionFlagsBits.ViewChannel),
            allow: [],
        },
        ...staffRoleAccess,
    ]);

    const tradeCommitteeOnly = withBotAccess([
        {
            id: everyoneId,
            deny: deny(PermissionFlagsBits.ViewChannel),
            allow: [],
        },
        ...staffRoleAccess.map((entry) => ({
            ...entry,
            allow: allow(
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ManageMessages,
            ),
        })),
        ...(tradeCommitteeId ? [{
            id: tradeCommitteeId,
            allow: allow(
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.SendMessages,
            ),
            deny: [],
        }] : []),
    ]);

    return {
        category: publicInteractive,
        channels: {
            // Staff/admin only
            'League Staff': staffOnly,
            'LG Logs': staffOnly,

            // Announcements and league-wide info (staff post, public read)
            'Madden League Buddy Announcements': publicReadOnlyWithStaffPosting,
            rulesOps: publicReadOnlyWithStaffPosting,
            breakdown: publicReadOnlyWithStaffPosting,
            scoutingHub: publicReadOnlyWithStaffPosting,
            'Strike Board': publicReadOnly,

            // Public read-only boards
            'Available Teams': publicReadOnly,
            Standings: publicReadOnly,
            'Stat Leaders': publicReadOnly,
            'Power Rankings': publicReadOnly,
            'Playoff Picture': publicReadOnly,
            'Top 100': publicReadOnly,
            'Weekly Awards': publicReadOnly,
            'Yearly Awards': publicReadOnly,
            'Streaming links': publicReadOnly,
            'Draft Grades': publicReadOnly,
            'Transaction Log': publicReadOnly,
            'Injuries Log': publicReadOnly,
            'Player Change Log': publicReadOnly,
            'Trade Counts': publicReadOnly,
            Trades: publicReadOnly,
            'Approved trades': publicReadOnly,
            'Denied trades': publicReadOnly,

            // Activity checks (public read, react, staff post)
            'Activity Checks': publicReactionCheck,

            // Game threads and trade block (coaches can post, public can read)
            'Game threads': publicInteractiveWithCoachAccess,
            'Trade Block': publicInteractiveWithCoachAccess,

            // Trade submit: everyone can view/use commands, only bot can post
            tradeSubmit: withBotAccess([
                {
                    id: everyoneId,
                    allow: allow(
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.UseApplicationCommands,
                    ),
                    deny: deny(
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.SendMessagesInThreads,
                        PermissionFlagsBits.CreatePublicThreads,
                        PermissionFlagsBits.CreatePrivateThreads,
                    ),
                },
            ]),

            // Trade Committee: only committee and staff
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

function buildProgressEmbed({ step, details = [], tier = null, tradeEnabled = null }) {
    return new EmbedBuilder()
        .setColor(0xffd700)
        .setTitle('Setup Channels')
        .setDescription(`Current step: **${step}**`)
        .addFields(
            ...(tier ? [{ name: 'Package', value: String(tier), inline: true }] : []),
            ...(tradeEnabled === null ? [] : [{ name: 'Trade Center', value: tradeEnabled ? 'included' : 'not included', inline: true }]),
            { name: 'Live Progress', value: details.filter(Boolean).map((detail) => `• ${detail}`).join('\n') || 'Working...' },
        );
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

async function pruneUnsupportedSetupChannels(guild, cfg, allowedSpecs) {
    const allowedKeys = new Set(allowedSpecs.map((spec) => spec.key));
    const categoryId = cfg?.compat?.maddenChannelMap?.['LB Madden'] || null;
    const category = categoryId
        ? guild.channels.cache.get(categoryId) || await guild.channels.fetch(categoryId).catch(() => null)
        : null;

    const optionalManagedKeys = [
        ...STANDARD_PLUS_CHANNEL_SPECS.map((spec) => spec.key),
        ...TRADE_CHANNEL_SPECS.map((spec) => spec.key),
    ];
    const removableKeys = [
        ...LEGACY_UNSUPPORTED_CHANNEL_KEYS,
        ...optionalManagedKeys.filter((key) => !allowedKeys.has(key)),
    ];

    for (const key of removableKeys) {
        const channelId = cfg?.compat?.maddenChannelMap?.[key];
        const channel = channelId
            ? guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null)
            : null;
        const isManagedLeaguebuddyChannel = channel
            && channel.parentId === category?.id
            && String(channel.name || '').startsWith('lb-');
        if (isManagedLeaguebuddyChannel) {
            await channel.delete('Removing unsupported LEAGUEbuddy setup channel for this package').catch(() => null);
        }
        if (cfg?.compat?.maddenChannelMap?.[key]) {
            delete cfg.compat.maddenChannelMap[key];
        }
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
        await interaction.editReply({ content: '', embeds: [buildProgressEmbed({ step, details })] });
    };

    await interaction.reply({
        content: '',
        embeds: [buildProgressEmbed({ step: 'starting', details: ['Checking tier, packs, and existing server config'] })],
        flags: MessageFlags.Ephemeral,
    });

    try {
        const readiness = await inspectSetupReadiness(guild);
        await guild.roles.fetch().catch(() => null);
        const roleCount = guild.roles.cache.size;
        if (!readiness.hasRequiredPermissions) {
            await interaction.editReply({
                content: [
                    '**Channel setup needs permissions**',
                    'LEAGUEbuddy is missing required Discord permissions.',
                    ...readiness.missingPermissions.map((name) => `- ${name}`),
                    readiness.hierarchyWarning ? readiness.hierarchyWarning : null,
                    'Fix this, then return to `/setup`.',
                ].join('\n'),
            });
            return;
        }
        if (readiness.hierarchyWarning) {
            await interaction.editReply({
                content: [
                    '**Before You Continue**',
                    readiness.hierarchyWarning,
                    '',
                    'Move the LEAGUEbuddy role higher in Server Settings, then return to `/setup`.',
                ].filter(Boolean).join('\n'),
            });
            return;
        }
        if (roleCount >= 240) {
            await interaction.editReply({
                content: [
                    '**Too many Discord roles**',
                    `This server already has **${roleCount} roles**.`,
                    'Delete old coach/LB roles, then return to `/setup`.',
                ].join('\n'),
            });
            return;
        }

        const tierChoice = detectSetupTier(guild.id, null);
        const tier = tierChoice.tier;
        const packsEnabled = [...(DEFAULT_PACKS[tier] || DEFAULT_PACKS.free)];
        const tradeEnabled = packsEnabled.includes('trades_basic');
        const activeChannelSpecs = channelSpecsForTier(tier, tradeEnabled);

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
        const overwriteFailures = [];
        for (const cat of DEFAULT_CATEGORY_SPECS) {
            rootCategory = await ensureCategoryWithRetry(guild, cat);
            cfg.compat.maddenChannelMap[cat.key] = rootCategory.id;
        }
        const overwritePlan = buildSetupOverwrites(guild, cfg.compat.maddenRoleMap);
        const categoryOverwrite = await applyOverwrites(rootCategory, overwritePlan.category);
        if (!categoryOverwrite.ok) {
            overwriteFailures.push({
                name: rootCategory?.name || 'LEAGUEbuddy Madden',
                error: categoryOverwrite.error?.message || String(categoryOverwrite.error || 'Missing Permissions'),
            });
        }
        await pruneUnsupportedSetupChannels(guild, cfg, activeChannelSpecs);

        // Channels (created under category when possible)
        for (const spec of activeChannelSpecs) {
            const ch = await ensureTextChannelInCategoryWithRetry(guild, spec, rootCategory?.id || null);
            const overwriteResult = await applyOverwrites(ch, overwritePlan.channels[spec.key] || []);
            if (!overwriteResult.ok) {
                overwriteFailures.push({
                    name: ch?.name || spec.name,
                    error: overwriteResult.error?.message || String(overwriteResult.error || 'Missing Permissions'),
                });
            }
            cfg.compat.maddenChannelMap[spec.key] = ch.id;
        }

        if (overwriteFailures.length) {
            const details = overwriteFailures
                .slice(0, 10)
                .map((item) => `- ${item.name}: ${item.error}`)
                .join('\n');
            await interaction.editReply({
                content: [
                    '**Channel setup needs permissions**',
                    'LEAGUEbuddy found the channels, but Discord blocked permission updates.',
                    '',
                    'Failed channels:',
                    details,
                    '',
                    'Fix the bot role permissions, then return to `/setup`.',
                ].join('\n'),
            });
            return;
        }

        if (cfg.compat.maddenChannelMap['Transaction Log']) {
            cfg.compat.maddenChannelMap['Trades'] = cfg.compat.maddenChannelMap['Transaction Log'];
        }
        if (tradeEnabled && cfg.compat.maddenChannelMap['Trade Committee']) {
            cfg.compat.maddenChannelMap['Pending Trades'] = cfg.compat.maddenChannelMap['Trade Committee'];
        }

        cfg.status = 'incomplete';
        saveGuildMaddenConfig(guild.id, cfg);

        await interaction.editReply({
            content: '',
            embeds: [buildProgressEmbed({
                step: 'saving server config',
                tier,
                tradeEnabled,
                details: [
                    'Overlay config saved',
                    'Channels are ready for the next setup commands',
                ],
            })],
        });

        let snapshotReady = false;
        if (leagueId) {
            try {
                snapshotReady = !!loadLeagueSnapshot(leagueId);
            } catch {
                snapshotReady = false;
            }
        }

        await interaction.editReply({
            content: '',
            embeds: [
                new EmbedBuilder()
                    .setColor(0x57f287)
                    .setTitle('Channels Ready')
                    .setDescription('Return to `/setup` and press Refresh Setup.')
                    .addFields(
                        {
                            name: 'Package',
                            value: `${tier}${snapshotReady ? '' : '\nLeague data is still loading.'}`,
                        },
                    ),
            ],
        });

        cfg.status = 'incomplete';
        saveGuildMaddenConfig(guild.id, cfg);
    } catch (error) {
        console.error('[setup] failed', { guildId: guild.id, step: currentStep, error: error?.message || error });
        await interaction.editReply({
            content: '',
            embeds: [
                new EmbedBuilder()
                    .setColor(0xed4245)
                    .setTitle('Setup Channels Failed')
                    .setDescription(`Step: **${currentStep}**`)
                    .addFields(
                        { name: 'Reason', value: String(error?.message || error) },
                        { name: 'Fix', value: 'Check the bot role has Manage Roles and Manage Channels, and that its role sits above the roles it needs to manage.' },
                    ),
            ],
        });
    }
}

export default { data, execute };
