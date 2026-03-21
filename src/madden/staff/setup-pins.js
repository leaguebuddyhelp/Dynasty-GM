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
        return ['⚠️ Snapshot hydration skipped: run `/sync` first'];
    }

    const results = [];

    try {
        await updateAvailableTeamsPin(interaction.client, guildId, { leagueId, snapshot });
        results.push('✅ Available Teams: hydrated');
    } catch (error) {
        results.push(`⚠️ Available Teams: ${error?.message || 'hydrate failed'}`);
    }

    try {
        await updateStandings(interaction.client, leagueId, guildId);
        results.push('✅ Standings: hydrated');
    } catch (error) {
        results.push(`⚠️ Standings: ${error?.message || 'hydrate failed'}`);
    }

    try {
        await updateStatLeaders(interaction.client, leagueId, guildId);
        results.push('✅ Stat Leaders: hydrated');
    } catch (error) {
        results.push(`⚠️ Stat Leaders: ${error?.message || 'hydrate failed'}`);
    }

    try {
        await updatePlayoffPicture(interaction.client, leagueId, guildId);
        results.push('✅ Playoff Picture: hydrated');
    } catch (error) {
        results.push(`⚠️ Playoff Picture: ${error?.message || 'hydrate failed'}`);
    }

    try {
        await updatePowerRankings(interaction.client, leagueId, guildId);
        results.push('✅ Power Rankings: hydrated');
    } catch (error) {
        results.push(`⚠️ Power Rankings: ${error?.message || 'hydrate failed'}`);
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
        results.push('✅ Top 100: hydrated');
    } catch (error) {
        results.push(`⚠️ Top 100: ${error?.message || 'hydrate failed'}`);
    }

    if (channelMap['Trade Counts']) {
        try {
            await updateTradeCountsEmbed(interaction.client, channelMap, loadTradeCounts(), { guildId });
            results.push('✅ Trade Counts: hydrated');
        } catch (error) {
            results.push(`⚠️ Trade Counts: ${error?.message || 'hydrate failed'}`);
        }
    } else {
        results.push('ℹ️ Trade Counts: not included in this tier');
    }

    return results;
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

    const results = [];
    for (const job of jobs) {
        const channelId = channelMap[job.channelKey];
        const channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;

        if (!channel || !channel.isTextBased()) {
            results.push(`${fmtBool(false)} ${job.title}: channel not found (${job.channelKey})`);
            continue;
        }

        const msg = await ensurePinnedEmbedMessage(channel, embeds[job.key], pins[job.key]);
        if (!msg) {
            results.push(`${fmtBool(false)} ${job.title}: failed to send/edit`);
            continue;
        }

        upsertGuildPin(guildId, job.key, msg.id);
        results.push(`${fmtBool(true)} ${job.title}: seeded`);
    }

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
        results.push(tradeMessage
            ? '✅ Submit Trade: seeded button'
            : '❌ Submit Trade: failed to seed button');
    } else {
        results.push('ℹ️ Submit Trade: not included in this tier');
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

    const hydrationResults = await hydrateSeededPins({ client }, guildId, channelMap, snapshot);
    results.push(...hydrationResults);

    return { results };
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
    const hasFailures = out.results.some((line) => /❌|⚠️/.test(String(line)));

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
                            ? 'Some league boards still need a clean snapshot. Run `/sync` if needed, rerun `/setup-pins`, then continue with `/setup-roles`.'
                            : 'Pins are ready. Next run `/setup-roles`, then `/syncsetupstatus`.',
                    },
                ),
        ],
    });

    return out;
}

export default { data, execute };
