import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from 'discord.js';

import {
    loadGuildMaddenConfigIfComplete,
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
import { loadTradeCounts, updateTradeCountsEmbed } from '../../../shared/madden_trade_utils.js';

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

function createBoardState(title) {
    return { title, seeded: false, hydrated: false, warning: null, info: null };
}

function renderBoardState(state) {
    if (state.hydrated) return `✅ ${state.title}: ready`;
    if (state.seeded && !state.warning) return `✅ ${state.title}: seeded`;
    if (state.warning) return `⚠️ ${state.title}: ${state.warning}`;
    return `❌ ${state.title}: refresh failed`;
}

async function ensurePinnedEmbedMessage(channel, embed, existingMessageId = null) {
    if (!channel || !channel.isTextBased()) return null;

    if (existingMessageId) {
        const existing = await channel.messages.fetch(existingMessageId).catch(() => null);
        if (existing) {
            await existing.edit({ embeds: [embed], content: null, components: [] }).catch(() => null);
            try { await existing.pin(); } catch { }
            return existing;
        }
    }

    const pins = await channel.messages.fetchPinned().catch(() => null);
    const botPinned = pins?.find((m) => m?.author?.id && m.author.id === channel.client.user.id) || null;
    if (botPinned) {
        await botPinned.edit({ embeds: [embed], content: null, components: [] }).catch(() => null);
        return botPinned;
    }

    const sent = await channel.send({ embeds: [embed] }).catch(() => null);
    if (!sent) return null;
    try { await sent.pin(); } catch { }
    return sent;
}

async function ensurePinnedActionMessage(channel, { embed, components, existingMessageId = null, matchTitle }) {
    if (!channel || !channel.isTextBased()) return null;

    if (existingMessageId) {
        const existing = await channel.messages.fetch(existingMessageId).catch(() => null);
        if (existing) {
            await existing.edit({ embeds: [embed], components, content: null }).catch(() => null);
            try { await existing.pin(); } catch { }
            return existing;
        }
    }

    const pins = await channel.messages.fetchPinned().catch(() => null);
    const botPinned = pins?.find((message) =>
        message?.author?.id === channel.client.user.id &&
        (!matchTitle || (message.embeds || []).some((existingEmbed) => existingEmbed?.title === matchTitle))
    ) || null;
    if (botPinned) {
        await botPinned.edit({ embeds: [embed], components, content: null }).catch(() => null);
        return botPinned;
    }

    const sent = await channel.send({ embeds: [embed], components }).catch(() => null);
    if (!sent) return null;
    try { await sent.pin(); } catch { }
    return sent;
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

function buildEmbeds() {
    const common = {
        color: 0x5865F2,
        footer: { text: 'LEAGUEbuddy • seeded by /setup-channels' },
    };

    return {
        available_teams: new EmbedBuilder()
            .setTitle('Available Teams')
            .setDescription('Available teams will appear here once coach roles and league data are synced.')
            .setColor(common.color)
            .setFooter(common.footer),

        standings: new EmbedBuilder()
            .setTitle('Standings')
            .setDescription('Standings will appear here once the synced league snapshot is loaded.')
            .setColor(common.color)
            .setFooter(common.footer),

        stat_leaders: new EmbedBuilder()
            .setTitle('Stat Leaders')
            .setDescription('Stat leaders will appear here once the synced league snapshot is loaded.')
            .setColor(common.color)
            .setFooter(common.footer),

        playoff_picture: new EmbedBuilder()
            .setTitle('Playoff Picture')
            .setDescription('Playoff seeding will appear here once standings are available.')
            .setColor(common.color)
            .setFooter(common.footer),

        power_rankings: new EmbedBuilder()
            .setTitle('Power Rankings')
            .setDescription('Power rankings will appear here once standings are available.')
            .setColor(common.color)
            .setFooter(common.footer),

        top100: new EmbedBuilder()
            .setTitle('Top 100')
            .setDescription('Top player grades will appear here once player data is available.')
            .setColor(common.color)
            .setFooter(common.footer),
    };
}

function buildTradeSubmitEmbed() {
    return new EmbedBuilder()
        .setTitle('Submit Trade')
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

async function hydrateSeededPins(interaction, guildId, channelMap, snapshot) {
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
    return new EmbedBuilder()
        .setColor(0xffd700)
        .setTitle('Setup Pins')
        .setDescription(`Current step: **${step}**`)
        .addFields({
            name: 'Live Progress',
            value: details.filter(Boolean).map((detail) => `• ${detail}`).join('\n') || 'Working...',
        });
}

export async function seedAndHydratePins(client, guildId) {
    const cfg = loadGuildMaddenConfigIfComplete(guildId);
    if (!cfg) {
        throw new Error('No completed overlay config found. Run `/setup-channels` first.');
    }

    const channelMap = cfg?.compat?.maddenChannelMap || {};
    const pins = cfg?.pins || {};
    const embeds = buildEmbeds();

    const jobs = [
        { key: 'available_teams', channelKey: 'Available Teams', title: 'Available Teams' },
        { key: 'standings', channelKey: 'Standings', title: 'Standings' },
        { key: 'stat_leaders', channelKey: 'Stat Leaders', title: 'Stat Leaders' },
        { key: 'playoff_picture', channelKey: 'Playoff Picture', title: 'Playoff Picture' },
        { key: 'power_rankings', channelKey: 'Power Rankings', title: 'Power Rankings' },
        { key: 'top100', channelKey: 'Top 100', title: 'Top 100' },
    ];

    const boardStates = Object.fromEntries(jobs.map((job) => [job.key, createBoardState(job.title)]));

    for (const job of jobs) {
        const channelId = channelMap[job.channelKey];
        const channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;

        if (!channel || !channel.isTextBased()) {
            boardStates[job.key].warning = 'channel not found';
            continue;
        }

        const msg = await ensurePinnedEmbedMessage(channel, embeds[job.key], pins[job.key]);
        if (!msg) {
            boardStates[job.key].warning = 'could not update the pinned board message';
            continue;
        }

        upsertGuildPin(guildId, job.key, msg.id);
        boardStates[job.key].seeded = true;
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
        extraResults.push(tradeMessage
            ? '✅ Submit Trade: seeded button'
            : '⚠️ Submit Trade: could not update the trade button');
    } else {
        extraResults.push('ℹ️ Submit Trade: not included in this tier');
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

    const hydration = await hydrateSeededPins({ client }, guildId, channelMap, snapshot);
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
        const pinId = loadGuildMaddenConfigIfComplete(guildId)?.pins?.[job.key] || pins[job.key] || null;
        const hasPinnedMessage = await hasVerifiedPinnedBoardMessage(client, guildId, channelMap[job.channelKey], pinId);
        if (!hasPinnedMessage) {
            boardStates[job.key].hydrated = false;
            boardStates[job.key].warning = 'board content updated, but no pinned message exists in the channel yet';
        }
    }

    const results = [
        ...jobs.map((job) => renderBoardState(boardStates[job.key])),
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

    await interaction.editReply({
        content: '',
        embeds: [
            new EmbedBuilder()
                .setColor(hasFailures ? 0xf39c12 : 0x57f287)
                .setTitle('Setup Pins Complete')
                .setDescription('This command refreshes the pinned league boards and trade submit button for the channels created by `/setup-channels`.')
                .addFields(
                    {
                        name: 'What this command did',
                        value: out.results.map((line) => `• ${line}`).join('\n').slice(0, 1024),
                    },
                    {
                        name: 'Next',
                        value: hasFailures
                            ? 'Some league boards still need data. Run `/sync` if the league was just connected, rerun `/setup-pins`, then continue with `/setup-roles`.'
                            : 'Pins are ready. Next run `/setup-roles`, then `/syncsetupstatus`.',
                    },
                ),
        ],
    });

    return out;
}

export default { data, execute };
