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

export const data = new SlashCommandBuilder()
    .setName('setup-channels')
    .setDescription('Admin-only: build the category, channels, and config for this server\'s current package.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
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
    const commishId = roleIdFor(roleMap, ['Ghost Legacy Commish', 'LB Commish']);
    const coCommishId = roleIdFor(roleMap, ['Ghost Legacy Co-Commish', 'LB Co-Commish']);
    const tradeCommitteeId = roleIdFor(roleMap, [
        'Trade Committee',
        'Ghost Legacy Trade Committee',
        'Madden Trade Committee',
        'Madden Trade Committe',
        'LB Trade Committee',
        'LEAGUEbuddy Trade Committee',
    ]);
    const coachGroupId = roleIdFor(roleMap, ['Ghost Legacy', 'LEAGUEbuddy Coaches', 'LB Coaches']);

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

    function withBotAccess(overwrites = []) {
        return [...botAccess, ...overwrites];
    }

    const publicReadOnly = withBotAccess([
        {
            id: everyoneId,
            allow: allow(PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory),
            deny: deny(PermissionFlagsBits.SendMessages),
        },
    ]);

    const publicInteractive = withBotAccess([
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
            deny: deny(PermissionFlagsBits.SendMessages),
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
        ...(coachGroupId ? [{
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
        }] : []),
    ]);

    const staffOnly = withBotAccess([
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
    ]);

    const tradeCommitteeOnly = withBotAccess([
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
    ]);

    return {
        category: publicInteractive,
        channels: {
            'League Staff': staffOnly,
            'LG Logs': staffOnly,
            rulesOps: publicReadOnlyWithStaffPosting,
            'Available Teams': publicReadOnly,
            Standings: publicReadOnly,
            'Stat Leaders': publicReadOnly,
            'Power Rankings': publicReadOnly,
            'Playoff Picture': publicReadOnly,
            'Top 100': publicReadOnly,
            'Yearly Awards': publicReadOnly,
            'Game threads': publicInteractiveWithCoachAccess,
            scoutingHub: publicReadOnlyWithStaffPosting,
            breakdown: publicReadOnlyWithStaffPosting,
            tradeSubmit: withBotAccess([
                {
                    id: everyoneId,
                    allow: allow(
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.UseApplicationCommands,
                    ),
                    deny: deny(PermissionFlagsBits.SendMessages),
                },
            ]),
            'Trade Counts': publicReadOnly,
            'Trade Block': publicInteractiveWithCoachAccess,
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

function tierSetupNotes(tier, tradeEnabled) {
    if (tier === 'premium') {
        return [
            'Premium setup includes the full channel pack, trade center, scouting hub, ops channels, recognition, and sportsbook boards.',
            'After channels are ready, continue with `/setup-pins`, `/setup-roles`, `/syncsetupstatus`, and `/server-check`.',
        ];
    }
    if (tier === 'standard') {
        return [
            'Standard setup includes the core league boards, trade center, scouting hub, and light staff ops channels.',
            'After channels are ready, continue with `/setup-pins`, `/setup-roles`, `/syncsetupstatus`, and `/server-check`.',
        ];
    }
    return [
        'Free setup includes the core league boards, game threads, standings, stat leaders, and awards boards.',
        tradeEnabled ? 'Trade center is included in this package.' : 'Trade center is not included in the Free plan.',
    ];
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
        await interaction.editReply({ content: '', embeds: [buildProgressEmbed({ step, details })] });
    };

    await interaction.reply({
        content: '',
        embeds: [buildProgressEmbed({ step: 'starting', details: ['Checking tier, packs, and existing server config'] })],
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
                    .setTitle('Setup Channels Complete')
                    .setDescription(`Package: **${tier}**`)
                    .addFields(
                        {
                            name: 'What this command did',
                            value: [
                                '• Created or verified the LEAGUEbuddy category',
                                '• Created the plan-appropriate channels',
                                '• Saved the overlay config for this server',
                            ].join('\n'),
                        },
                        {
                            name: 'Plan notes',
                            value: tierSetupNotes(tier, tradeEnabled).map((line) => `• ${line}`).join('\n'),
                        },
                        {
                            name: 'Next',
                            value: snapshotReady
                                ? 'Run `/setup-pins`, then `/setup-roles`. `/setup-roles` will finish the final role-based channel access in the same pass.'
                                : 'Run `/setup-pins` next. If the league snapshot is still missing, connect the league first and rerun `/setup-pins` after `/league-status` looks healthy.',
                        },
                    ),
            ],
        });

        cfg.status = 'complete';
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
