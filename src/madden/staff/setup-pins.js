import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from 'discord.js';

import {
    loadGuildMaddenConfig,
    upsertGuildPin,
} from '../../shared/madden_guild_config.js';
import { getLeagueForGuild } from '../madden_config.js';
import { loadLeagueSnapshot } from '../madden_data.js';
import { updateAvailableTeamsPin } from '../../../madden/available_teams.js';
import { updateStandings } from '../../../madden/standings_pin.js';
import { updateStatLeaders } from '../../../madden/stat_leaders.js';
import { updatePlayoffPicture } from '../../../madden/playoff_picture.js';
import { updatePowerRankings } from '../../../madden/power_rankings.js';
import { updateTopPlayers } from '../../../madden/top_players.js';
import { setPinId } from '../pins_store.js';
import { loadTradeCounts, updateTradeCountsEmbed } from '../../../shared/madden_trade_utils.js';
import { getLeagueBuddyLogoEmoji } from '../../shared/application_emojis.js';

function fmtBool(v) {
    return v ? '✅' : '❌';
}

function formatPinError(error) {
    const text = String(error?.message || error || '').trim();
    if (!text) return 'refresh failed';
    if (text.includes('ENOENT') || text.includes('no such file or directory')) {
        return 'waiting for the latest league snapshot';
    }
    if (text.toLowerCase().includes('snapshot missing')) {
        return 'waiting for the latest league snapshot';
    }
    return text;
}

function formatPinningFailure(error) {
    const code = String(error?.code || '').trim();
    const text = String(error?.message || error || '').trim();
    const lower = text.toLowerCase();

    if (code === '50013' || lower.includes('missing permissions')) {
        return 'missing Discord permission: Manage Messages';
    }
    if (lower.includes('maximum number of pins') || lower.includes('max pins')) {
        return 'channel already has the maximum number of pinned messages';
    }
    return text || 'pin request failed';
}

function createBoardState(title) {
    return { title, seeded: false, hydrated: false, warning: null, info: null };
}

function buildPinsNextStepText(results = []) {
    const joined = results.join('\n');
    if (/missing Discord permission|Pin Messages|Manage Messages/i.test(joined)) {
        return 'Pins refreshed, but Discord is still blocking one or more pin actions. Fix the bot role/channel permissions, rerun `/setup-pins`, then rerun `/setup`.';
    }
    if (/Preseason|Offseason|will appear once the regular season starts|placeholder/i.test(joined)) {
        return 'Pins are healthy for the current phase. Season boards stay visible from last year through offseason and preseason, then reset at Regular Season Week 1. Rerun `/setup` for the next step.';
    }
    return 'Some league boards still need data. Run `/sync` if the league was just connected, rerun `/setup-pins`, then rerun `/setup`.';
}

function renderBoardState(state) {
    if (state.hydrated) return `✅ ${state.title}: ready`;
    if (state.seeded && !state.warning) return `✅ ${state.title}: seeded`;
    if (state.warning) return `⚠️ ${state.title}: ${state.warning}`;
    return `❌ ${state.title}: refresh failed`;
}

function getPinPermissionsIssue(channel) {
    const me = channel?.guild?.members?.me;
    const perms = me ? channel.permissionsFor(me) : null;
    if (!perms?.has(PermissionFlagsBits.ViewChannel)) return 'bot cannot view this channel';
    if (!perms?.has(PermissionFlagsBits.SendMessages)) return 'bot cannot send messages in this channel';
    if (!perms?.has(PermissionFlagsBits.PinMessages)) return 'missing Discord permission: Pin Messages';
    return null;
}

async function pinMessageAndVerify(channel, message) {
    const permissionIssue = getPinPermissionsIssue(channel);
    if (permissionIssue) {
        return { message, pinned: Boolean(message?.pinned), pinError: permissionIssue };
    }

    let pinError = null;
    try {
        await message.pin();
    } catch (error) {
        pinError = formatPinningFailure(error);
    }
    const refreshed = await channel.messages.fetch(message.id).catch(() => message);
    return {
        message: refreshed || message,
        pinned: Boolean(refreshed?.pinned),
        pinError: refreshed?.pinned ? null : (pinError || 'pin request failed'),
    };
}

async function ensurePinnedEmbedMessage(channel, embed, existingMessageId = null) {
    if (!channel || !channel.isTextBased()) return { message: null, pinError: 'channel not found' };

    if (existingMessageId) {
        const existing = await channel.messages.fetch(existingMessageId).catch(() => null);
        if (existing) {
            await existing.edit({ embeds: [embed], content: null, components: [] }).catch(() => null);
            return pinMessageAndVerify(channel, existing);
        }
    }

    const pins = await channel.messages.fetchPinned().catch(() => null);
    const botPinned = pins?.find((m) => m?.author?.id && m.author.id === channel.client.user.id) || null;
    if (botPinned) {
        await botPinned.edit({ embeds: [embed], content: null, components: [] }).catch(() => null);
        return { message: botPinned, pinned: true, pinError: null };
    }

    const sent = await channel.send({ embeds: [embed] }).catch(() => null);
    if (!sent) return { message: null, pinError: 'could not send the board message' };
    return pinMessageAndVerify(channel, sent);
}

async function ensurePinnedActionMessage(channel, { embed, components, existingMessageId = null, matchTitle }) {
    if (!channel || !channel.isTextBased()) return { message: null, pinError: 'channel not found' };

    if (existingMessageId) {
        const existing = await channel.messages.fetch(existingMessageId).catch(() => null);
        if (existing) {
            await existing.edit({ embeds: [embed], components, content: null }).catch(() => null);
            return pinMessageAndVerify(channel, existing);
        }
    }

    const pins = await channel.messages.fetchPinned().catch(() => null);
    const botPinned = pins?.find((message) =>
        message?.author?.id === channel.client.user.id &&
        (!matchTitle || (message.embeds || []).some((existingEmbed) => existingEmbed?.title === matchTitle))
    ) || null;
    if (botPinned) {
        await botPinned.edit({ embeds: [embed], components, content: null }).catch(() => null);
        return { message: botPinned, pinned: true, pinError: null };
    }

    const sent = await channel.send({ embeds: [embed], components }).catch(() => null);
    if (!sent) return { message: null, pinError: 'could not send the trade button' };
    return pinMessageAndVerify(channel, sent);
}

async function hasVerifiedPinnedBoardMessage(client, guildId, channelId, expectedMessageId = null) {
    if (!channelId) return false;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return false;

    if (expectedMessageId) {
        const existing = await channel.messages.fetch(expectedMessageId).catch(() => null);
        if (existing?.pinned) return true;
    }

    const pins = await channel.messages.fetchPinned().catch(() => null);
    return Boolean(pins?.some((message) => message?.author?.id === client.user?.id));
}

function boardTitleMatches(embedTitle, expectedTitles = []) {
    const actual = String(embedTitle || '').trim().toLowerCase();
    if (!actual) return false;
    return expectedTitles.some((title) => {
        const expected = String(title || '').trim().toLowerCase();
        return expected && (actual === expected || actual.includes(expected) || expected.includes(actual));
    });
}

async function repairPinnedBoardMessage(client, guildId, channelId, expectedTitles, key) {
    if (!channelId) return { message: null, pinError: 'channel not found' };
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return { message: null, pinError: 'channel not found' };

    const recent = await channel.messages.fetch({ limit: 25 }).catch(() => null);
    const match = recent?.find((message) =>
        message?.author?.id === client.user?.id &&
        (message.embeds || []).some((embed) => boardTitleMatches(embed?.title, expectedTitles))
    ) || null;

    if (!match) return { message: null, pinError: 'existing board message not found for repair' };

    const permissionIssue = getPinPermissionsIssue(channel);
    if (permissionIssue) {
        return { message: match, pinError: permissionIssue };
    }

    let pinError = null;
    try {
        if (!match.pinned) await match.pin();
    } catch (error) {
        pinError = formatPinningFailure(error);
    }

    const refreshed = await channel.messages.fetch(match.id).catch(() => match);
    if (refreshed?.pinned) {
        upsertGuildPin(guildId, key, refreshed.id);
        setPinId(key, refreshed.id, guildId);
        return { message: refreshed, pinError: null };
    }

    return { message: refreshed || match, pinError: pinError || 'pin request failed during repair' };
}

function buildEmbeds() {
    const logo = getLeagueBuddyLogoEmoji();
    const branded = (title) => `${logo ? `${logo} ` : ''}${title}`;
    const common = {
        color: 0x5865F2,
        footer: { text: 'LEAGUEbuddy • seeded by /setup-channels' },
    };

    return {
        available_teams: new EmbedBuilder()
            .setTitle(branded('Available Teams'))
            .setDescription('Available teams will appear here once coach roles and league data are synced.')
            .setColor(common.color)
            .setFooter(common.footer),

        standings: new EmbedBuilder()
            .setTitle(branded('Madden Standings'))
            .setDescription('Standings will appear here once the synced league snapshot is loaded.')
            .setColor(common.color)
            .setFooter(common.footer),

        stat_leaders: new EmbedBuilder()
            .setTitle(branded('Madden Stat Leaders'))
            .setDescription('Stat leaders will appear here once the synced league snapshot is loaded.')
            .setColor(common.color)
            .setFooter(common.footer),

        playoff_picture: new EmbedBuilder()
            .setTitle(branded('Madden Playoff Picture'))
            .setDescription('Playoff seeding will appear here once standings are available.')
            .setColor(common.color)
            .setFooter(common.footer),

        power_rankings: new EmbedBuilder()
            .setTitle(branded('Madden Power Rankings'))
            .setDescription('Power rankings will appear here once standings are available.')
            .setColor(common.color)
            .setFooter(common.footer),

        top100: new EmbedBuilder()
            .setTitle(branded('Madden Player Grades'))
            .setDescription('Top player grades will appear here once player data is available.')
            .setColor(common.color)
            .setFooter(common.footer),
    };
}

function buildTradeSubmitEmbed() {
    const logo = getLeagueBuddyLogoEmoji();
    return new EmbedBuilder()
        .setTitle(`${logo ? `${logo} ` : ''}Submit Trade`)
        .setDescription('Start a trade proposal here. Pick the two teams, add assets, then submit it for review.')
        .setColor(0x57F287)
        .setFooter({ text: 'LEAGUEbuddy • trade flow' });
}

function buildTradeSubmitComponents() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('trade_builder_start')
                .setLabel('Start Trade')
                .setStyle(ButtonStyle.Primary),
        ),
    ];
}

function buildAwardsButtonEmbed() {
    const logo = getLeagueBuddyLogoEmoji();
    return new EmbedBuilder()
        .setTitle(`${logo ? `${logo} ` : ''}Madden Yearly Awards (Staff)`)
        .setDescription(
            [
                'Staff: after the season ends and before the next season begins, click below to enter the yearly awards.',
                'MVP, Coach of the Year, OPOY, DPOY, OROY, DROY, Super Bowl Champion, and Super Bowl MVP.',
            ].join('\n'),
        )
        .setColor(0xFFD700)
        .setFooter({ text: 'LEAGUEbuddy • yearly awards' });
}

function buildAwardsButtonComponents() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('madden_awards_button')
                .setLabel('Enter Madden Yearly Awards')
                .setStyle(ButtonStyle.Primary),
        ),
    ];
}

async function hydrateSeededPins(interaction, guildId, channelMap, snapshot, options = {}) {
    const top100Included = options.top100Included !== false;
    const leagueId = getLeagueForGuild(guildId);
    if (!leagueId || !snapshot) {
        return { snapshotMissing: true, results: [] };
    }

    const results = {};

    try {
        await updateAvailableTeamsPin(interaction.client, guildId, { leagueId, snapshot });
        results.available_teams = { hydrated: true };
    } catch (error) {
        results.available_teams = { warning: formatPinError(error) };
    }

    try {
        await updateStandings(interaction.client, leagueId, guildId);
        results.standings = { hydrated: true };
    } catch (error) {
        results.standings = { warning: formatPinError(error) };
    }

    try {
        await updateStatLeaders(interaction.client, leagueId, guildId);
        results.stat_leaders = { hydrated: true };
    } catch (error) {
        results.stat_leaders = { warning: formatPinError(error) };
    }

    try {
        await updatePlayoffPicture(interaction.client, leagueId, guildId);
        results.playoff_picture = { hydrated: true };
    } catch (error) {
        results.playoff_picture = { warning: formatPinError(error) };
    }

    try {
        await updatePowerRankings(interaction.client, leagueId, guildId);
        results.power_rankings = { hydrated: true };
    } catch (error) {
        results.power_rankings = { warning: formatPinError(error) };
    }

    if (top100Included && channelMap['Top 100']) {
        try {
            const topPlayersWeekValue = Number(
                snapshot?.currentWeek
                ?? snapshot?.info?.careerHubInfo?.seasonInfo?.displayWeek
                ?? snapshot?.info?.careerHubInfo?.seasonInfo?.seasonWeek
                ?? 0,
            );
            await updateTopPlayers(
                interaction.client,
                leagueId,
                snapshot,
                topPlayersWeekValue,
                { postChannelId: channelMap['Top 100'] || null },
            );
            results.top100 = { hydrated: true };
        } catch (error) {
            results.top100 = { warning: formatPinError(error) };
        }
    } else {
        results.top100 = { info: 'not included in this tier' };
    }

    if (channelMap['Trade Counts']) {
        try {
            await updateTradeCountsEmbed(interaction.client, channelMap, loadTradeCounts(), { guildId });
            results.trade_counts = { hydrated: true };
        } catch (error) {
            results.trade_counts = { warning: formatPinError(error) };
        }
    } else {
        results.trade_counts = { info: 'not included in this tier' };
    }

    return { snapshotMissing: false, results };
}

export const data = new SlashCommandBuilder()
    .setName('setup-pins')
    .setDescription('Admin-only: seed and hydrate the LEAGUEbuddy pinned messages.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export const deferOnDispatch = { flags: 64 };

function buildPinsProgressEmbed({ step, details = [] }) {
    const logo = getLeagueBuddyLogoEmoji();
    return new EmbedBuilder()
        .setColor(0xffd700)
        .setTitle(`${logo ? `${logo} ` : ''}Setup Pins`)
        .setDescription(`Current step: **${step}**`)
        .addFields({
            name: 'Live Progress',
            value: details.filter(Boolean).map((detail) => `• ${detail}`).join('\n') || 'Working...',
        });
}

export async function seedAndHydratePins(client, guildId) {
    const cfg = loadGuildMaddenConfig(guildId);
    if (!cfg) {
        throw new Error('No setup config found. Run `/setup-channels` first.');
    }

    const channelMap = cfg?.compat?.maddenChannelMap || {};
    const pins = cfg?.pins || {};
    const embeds = buildEmbeds();
    const tier = String(cfg?.license?.tier || 'free').toLowerCase();
    const top100Included = tier === 'standard' || tier === 'premium';
    const awardsIncluded = tier === 'standard' || tier === 'premium';

    const jobs = [
        { key: 'available_teams', channelKey: 'Available Teams', title: 'Available Teams', repairTitles: ['Available Teams'] },
        { key: 'standings', channelKey: 'Standings', title: 'Standings', repairTitles: ['Standings', 'Madden Standings'] },
        { key: 'stat_leaders', channelKey: 'Stat Leaders', title: 'Stat Leaders', repairTitles: ['Stat Leaders', 'Madden Stat Leaders'] },
        { key: 'playoff_picture', channelKey: 'Playoff Picture', title: 'Playoff Picture', repairTitles: ['Playoff Picture', 'Madden Playoff Picture'] },
        { key: 'power_rankings', channelKey: 'Power Rankings', title: 'Power Rankings', repairTitles: ['Power Rankings', 'Madden Power Rankings'] },
        ...(top100Included
            ? [{ key: 'top100', channelKey: 'Top 100', title: 'Top 100', repairTitles: ['Top 100', 'Madden Player Grades'] }]
            : []),
    ];

    const boardStates = Object.fromEntries(jobs.map((job) => [job.key, createBoardState(job.title)]));

    for (const job of jobs) {
        const channelId = channelMap[job.channelKey];
        const channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;

        if (!channel || !channel.isTextBased()) {
            boardStates[job.key].warning = 'channel not found';
            continue;
        }

        const result = await ensurePinnedEmbedMessage(channel, embeds[job.key], pins[job.key]);
        if (!result?.message) {
            boardStates[job.key].warning = result?.pinError || 'could not update the pinned board message';
            continue;
        }

        upsertGuildPin(guildId, job.key, result.message.id);
        setPinId(job.key, result.message.id, guildId);
        boardStates[job.key].seeded = true;
        if (result.pinError) {
            boardStates[job.key].warning = `board content updated, but ${result.pinError}`;
        }
    }

    const extraResults = [];
    const tradeSubmitChannelId = channelMap['tradeSubmit'];
    const tradeSubmitChannel = tradeSubmitChannelId
        ? await client.channels.fetch(tradeSubmitChannelId).catch(() => null)
        : null;
    if (tradeSubmitChannel?.isTextBased()) {
        const tradeMessage = await ensurePinnedActionMessage(tradeSubmitChannel, {
            embed: buildTradeSubmitEmbed(),
            components: buildTradeSubmitComponents(),
            matchTitle: 'Submit Trade',
        });
        extraResults.push(tradeMessage?.message
            ? tradeMessage.pinError
                ? `⚠️ Submit Trade: button updated, but ${tradeMessage.pinError}`
                : '✅ Submit Trade: seeded button'
            : '⚠️ Submit Trade: could not update the trade button');
    } else {
        extraResults.push('ℹ️ Submit Trade: not included in this tier');
    }

    const awardsChannelId = channelMap['Yearly Awards'];
    const awardsChannel = awardsChannelId
        ? await client.channels.fetch(awardsChannelId).catch(() => null)
        : null;
    if (awardsIncluded && awardsChannel?.isTextBased()) {
        const awardsMessage = await ensurePinnedActionMessage(awardsChannel, {
            embed: buildAwardsButtonEmbed(),
            components: buildAwardsButtonComponents(),
            existingMessageId: pins.madden_awards_button,
            matchTitle: 'Madden Yearly Awards (Staff)',
        });
        if (awardsMessage?.message) {
            upsertGuildPin(guildId, 'madden_awards_button', awardsMessage.message.id);
            setPinId('madden_awards_button', awardsMessage.message.id, guildId);
        }
        extraResults.push(awardsMessage?.message
            ? awardsMessage.pinError
                ? `⚠️ Yearly Awards: button updated, but ${awardsMessage.pinError}`
                : '✅ Yearly Awards: seeded button'
            : '⚠️ Yearly Awards: could not update the awards button');
    } else {
        extraResults.push('ℹ️ Yearly Awards: not included in this tier');
    }

    let snapshot = null;
    const leagueId = getLeagueForGuild(guildId);
    if (leagueId) {
        try {
            snapshot = loadLeagueSnapshot(leagueId);
        } catch {
            snapshot = null;
        }
    }

    const hydration = await hydrateSeededPins({ client }, guildId, channelMap, snapshot, { top100Included });
    for (const [key, stateUpdate] of Object.entries(hydration.results || {})) {
        if (!boardStates[key]) continue;
        if (stateUpdate.hydrated) {
            boardStates[key].hydrated = true;
            boardStates[key].warning = null;
        } else if (stateUpdate.warning) {
            boardStates[key].warning = stateUpdate.warning;
        } else if (stateUpdate.info) {
            boardStates[key].info = stateUpdate.info;
        }
    }

    if (hydration.snapshotMissing) {
        for (const state of Object.values(boardStates)) {
            if (!state.hydrated) state.warning = 'waiting for the latest league snapshot';
        }
    }

    for (const job of jobs) {
        const pinId = loadGuildMaddenConfig(guildId)?.pins?.[job.key] || pins[job.key] || null;
        let hasPinnedMessage = await hasVerifiedPinnedBoardMessage(client, guildId, channelMap[job.channelKey], pinId);
        if (!hasPinnedMessage) {
            const repaired = await repairPinnedBoardMessage(client, guildId, channelMap[job.channelKey], job.repairTitles || [job.title], job.key);
            hasPinnedMessage = Boolean(repaired?.message?.pinned);
            if (repaired?.pinError) {
                boardStates[job.key].warning = `board content updated, but ${repaired.pinError}`;
            }
        }
        if (!hasPinnedMessage) {
            boardStates[job.key].hydrated = false;
            boardStates[job.key].warning = boardStates[job.key].warning || 'board content updated, but LEAGUEbuddy could not pin the board message';
        }
    }

    const results = [
        ...jobs.map((job) => renderBoardState(boardStates[job.key])),
        ...(!top100Included ? ['ℹ️ Top 100: not included in this tier'] : []),
        ...extraResults,
        hydration.results?.trade_counts?.hydrated
            ? '✅ Trade Counts: ready'
            : hydration.results?.trade_counts?.warning
                ? `⚠️ Trade Counts: ${hydration.results.trade_counts.warning}`
                : 'ℹ️ Trade Counts: not included in this tier',
    ];

    return { results, snapshotMissing: hydration.snapshotMissing };
}

export async function execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.editReply({ content: 'This command can only be used in a server.' });
        return;
    }

    const updateProgress = async (step, details = []) => {
        await interaction.editReply({
            content: '',
            embeds: [buildPinsProgressEmbed({ step, details })],
        });
    };

    await updateProgress('checking setup', [
        'Verifying the LEAGUEbuddy channel map for this server',
        'Preparing the league boards and pinned messages',
    ]);

    await updateProgress('seeding and hydrating pins', [
        'Refreshing the standings, stat, ranking, playoff, and team boards',
        'Updating the trade submit button if this plan includes it',
    ]);

    const out = await seedAndHydratePins(interaction.client, guildId);
    const hasFailures = out.results.some((line) => /⚠️|❌/.test(String(line)));

    // Auto-sync after pin setup changes
    try {
        const { syncGuild } = await import('../../shared/guild_auto_sync.js');
        await syncGuild(guildId);
    } catch (e) {
        console.error('[AUTO_SYNC] Failed to sync after setup-pins:', e);
    }

    await interaction.editReply({
        content: '',
        embeds: [
            new EmbedBuilder()
                .setColor(hasFailures ? 0xf39c12 : 0x57f287)
                .setTitle(`${getLeagueBuddyLogoEmoji() ? `${getLeagueBuddyLogoEmoji()} ` : ''}Setup Pins Complete`)
                .setDescription('This command refreshes the pinned league boards and trade submit button for the channels created by `/setup-channels`.')
                .addFields(
                    {
                        name: 'What this command did',
                        value: out.results.map((line) => `• ${line}`).join('\n').slice(0, 1024),
                    },
                    {
                        name: 'Next',
                        value: hasFailures
                            ? buildPinsNextStepText(out.results)
                            : 'Pins are ready. Rerun `/setup` for the next step.',
                    },
                ),
        ],
    });

    return out;
}

export default { data, execute };
