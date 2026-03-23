// Handle all big board select menus (paged by 15)
export const customId = /^bigboard_select_/;
import { EmbedBuilder } from "discord.js";
import { requireLeagueIdForGuild, loadLeagueSnapshot } from '../madden/madden_data.js';
import { loadDraftClass } from '../madden/helpers/bigboard_helpers.js';
import { loadScoutStore, getScoutSeasonKey, getSeasonScoutUser } from '../madden/coach/scout_store.js';
import { getMaddenDraftClassId } from '../shared/madden_draft_class.js';

function normalize(str = '') {
    return String(str)
        .replace(/^[\d]+\.\s*/, '')
        .trim()
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '');
}

function currentClassIdForSnapshot(snapshot = {}) {
    const seasonInfo = snapshot?.info?.careerHubInfo?.seasonInfo || {};
    const calendarYear = seasonInfo?.calendarYear || snapshot?.info?.calendarYear || snapshot?.calendarYear;
    return getMaddenDraftClassId({ calendarYear });
}

function normalizeDraftPlayers(draftData) {
    return Object.values(draftData || {}).filter((player) => player && player.name && (player.position_1 || player.position));
}

function getUnlockedScoutInfo({ guildId, userId, playerName, snapshot }) {
    try {
        const classId = currentClassIdForSnapshot(snapshot);
        const seasonKey = getScoutSeasonKey(snapshot);
        const scoutData = loadScoutStore();
        const userData = getSeasonScoutUser(scoutData, userId, seasonKey, { create: false });
        const normClass = String(classId || '').toLowerCase();
        const playersByClass =
            userData?.players?.[classId]
            || userData?.players?.[normClass]
            || null;
        return Array.isArray(playersByClass?.[playerName]) ? playersByClass[playerName] : [];
    } catch {
        return [];
    }
}

export async function execute(interaction) {
    await interaction.deferReply({ flags: 64 });
    const leagueId = requireLeagueIdForGuild(interaction.guildId);
    const snapshot = loadLeagueSnapshot(leagueId);
    const classId = currentClassIdForSnapshot(snapshot);
    const draftData = loadDraftClass(classId);
    const allPlayers = normalizeDraftPlayers(draftData);
    const normalizedSelected = normalize(interaction.values[0]);
    let selected = allPlayers.find(p => p.name && normalize(p.name) === normalizedSelected);
    if (!selected) {
        selected = allPlayers.find(p => p.name && normalize(p.name).startsWith(normalizedSelected));
    }
    if (!selected) {
        selected = allPlayers.find(p =>
            (p.id_number != null && normalize(String(p.id_number)) === normalizedSelected) ||
            (p.name && normalize(p.name).includes(normalizedSelected))
        );
    }
    if (!selected) {
        console.warn('[bigboard_select] Player not found.', {
            guildId: interaction.guildId,
            classId,
            normalizedSelected,
            sample: allPlayers.slice(0, 5).map((p) => p.name),
        });
    }
    if (!selected) {
        try {
            await interaction.editReply({ content: "Player not found." });
        } catch (err) {
            console.error('bigboard_select: Failed to editReply for not found:', err);
        }
        return;
    }

    const strengths = [selected.strength_1, selected.strength_2, selected.strength_3].filter(Boolean).join(", ") || "N/A";
    const weaknesses = [selected.weakness_1, selected.weakness_2, selected.weakness_3].filter(Boolean).join(", ") || "N/A";
    const unlocked = getUnlockedScoutInfo({
        guildId: interaction.guildId,
        userId: interaction.user.id,
        playerName: selected.name,
        snapshot,
    });

    const embed = new EmbedBuilder()
        .setTitle(`${selected.position_1 || selected.position || ''} - ${selected.name}`)
        .setThumbnail(selected.image || selected.imgUrl || selected.imgURL || null)
        .addFields(
            { name: "Team", value: selected.team || "N/A", inline: true },
            { name: "Class", value: selected.class || "N/A", inline: true },
            { name: "Age", value: selected.age?.toString() || "N/A", inline: true },
            { name: "Nationality", value: selected.nationality || "N/A", inline: true },
            { name: "Physicals", value: `**Ht:** ${selected.height || 'N/A'}  **Wt:** ${selected.weight?.toString() || 'N/A'}  **Wingspan:** ${selected.wingspan || 'N/A'}`, inline: false },
            { name: "About", value: selected.about || "N/A", inline: false },
            { name: "Strengths", value: strengths, inline: true },
            { name: "Weaknesses", value: weaknesses, inline: true },
            { name: "Pro Comp", value: selected.pro_comp || "N/A", inline: true }
        )
        .setColor("Green");

    // Add scouted info if unlocked from the current Madden scout store.
    let info = [];
    if (unlocked.includes('arch')) info.push(`**Archetype:** ${selected.archetype_1 || selected.archetype_2 || 'N/A'}`);
    if (unlocked.includes('ovr')) info.push(`**Overall:** ${selected.overall ?? 'N/A'}`);
    if (unlocked.includes('dev')) {
        const devMap = { 0: 'Normal', 1: 'Star', 2: 'Superstar', 3: 'X-Factor' };
        info.push(`**Dev Trait:** ${devMap[Number(selected.dev_trait)] || 'Normal'}`);
    }
    if (info.length > 0) {
        embed.addFields({ name: 'Scouted Info', value: info.join(' | '), inline: false });
    }

    await interaction.editReply({ embeds: [embed] });
}
