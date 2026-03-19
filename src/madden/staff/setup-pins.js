import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
} from 'discord.js';

import {
    loadGuildMaddenConfigIfComplete,
    upsertGuildPin,
} from '../../shared/madden_guild_config.js';

function fmtBool(v) {
    return v ? '✅' : '❌';
}

async function ensurePinnedEmbedMessage(channel, embed, existingMessageId = null) {
    if (!channel || !channel.isTextBased()) return null;

    // If we have an ID, try editing that message (best path).
    if (existingMessageId) {
        const existing = await channel.messages.fetch(existingMessageId).catch(() => null);
        if (existing) {
            await existing.edit({ embeds: [embed], content: null }).catch(() => null);
            try { await existing.pin(); } catch { }
            return existing;
        }
    }

    // Else try finding a pinned message authored by the bot.
    const pins = await channel.messages.fetchPinned().catch(() => null);
    const botPinned = pins?.find(m => m?.author?.id && m.author.id === channel.client.user.id) || null;
    if (botPinned) {
        await botPinned.edit({ embeds: [embed], content: null }).catch(() => null);
        return botPinned;
    }

    // Else send a new message & pin.
    const sent = await channel.send({ embeds: [embed] }).catch(() => null);
    if (!sent) return null;
    try { await sent.pin(); } catch { }
    return sent;
}

function buildEmbeds() {
    const common = {
        color: 0x5865F2,
        footer: { text: 'LEAGUEbuddy • seeded by /setup' },
    };

    return {
        available_teams: new EmbedBuilder()
            .setTitle('Available Teams')
            .setDescription('This message will update automatically when staff assigns/removes teams.')
            .setColor(common.color)
            .setFooter(common.footer),

        standings: new EmbedBuilder()
            .setTitle('Standings')
            .setDescription('Standings will appear once game data is available.')
            .setColor(common.color)
            .setFooter(common.footer),

        stat_leaders: new EmbedBuilder()
            .setTitle('Stat Leaders')
            .setDescription('Stat leaders will appear once game data is available.')
            .setColor(common.color)
            .setFooter(common.footer),

        playoff_picture: new EmbedBuilder()
            .setTitle('Playoff Picture')
            .setDescription('Playoff picture will appear once standings are available.')
            .setColor(common.color)
            .setFooter(common.footer),

        power_rankings: new EmbedBuilder()
            .setTitle('Power Rankings')
            .setDescription('Power rankings will appear once standings are available.')
            .setColor(common.color)
            .setFooter(common.footer),

        top100: new EmbedBuilder()
            .setTitle('Top 100')
            .setDescription('Top 100 will appear once player data is available.')
            .setColor(common.color)
            .setFooter(common.footer),
    };
}

export const data = new SlashCommandBuilder()
    .setName('setup-pins')
    .setDescription('Admin-only: create/repair the pinned LEAGUEbuddy messages (recommended).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export const deferOnDispatch = { flags: 64 };

export async function execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.editReply({ content: 'This command can only be used in a server.' });
        return;
    }

    const cfg = loadGuildMaddenConfigIfComplete(guildId);
    if (!cfg) {
        await interaction.editReply({ content: 'No completed overlay config found. Run `/setup` first.' });
        return;
    }

    const channelMap = cfg?.compat?.maddenChannelMap || {};
    const pins = cfg?.pins || {};

    const embeds = buildEmbeds();

    const jobs = [
        { key: 'available_teams', channelKey: 'Standings', title: 'Available Teams' },
        { key: 'standings', channelKey: 'Standings', title: 'Standings' },
        { key: 'stat_leaders', channelKey: 'Stat Leaders', title: 'Stat Leaders' },
        { key: 'playoff_picture', channelKey: 'Playoff Picture', title: 'Playoff Picture' },
        { key: 'power_rankings', channelKey: 'Power Rankings', title: 'Power Rankings' },
        { key: 'top100', channelKey: 'Top 100', title: 'Top 100' },
    ];

    const results = [];
    for (const job of jobs) {
        const channelId = channelMap[job.channelKey];
        const channel = channelId ? await interaction.client.channels.fetch(channelId).catch(() => null) : null;

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
        results.push(`${fmtBool(true)} ${job.title}: pinned (message ${msg.id})`);
    }

    return { results };
}

export default { data, execute };
