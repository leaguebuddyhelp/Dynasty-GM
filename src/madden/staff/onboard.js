import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { resolveLeagueIdWithConfig, loadLeagueSnapshot } from '../../../madden/madden_data.js';
import { getFullTeamName } from '../../shared/madden_team_names.js';
import { hasStaffRole, loadRoleMapForGuild } from './staffUtils.js';
import { updateAvailableTeamsPin } from '../../../madden/available_teams.js';
import { updateFairSimBoard } from '../../shared/fairsim_board.js';
import { setCoachAssignment } from '../../shared/madden_coach_assignments.js';
import { getMaddenSeasonKey } from '../../shared/madden_metadata.js';
import { listThreadStates, hydrateThreadStateFromLiveThread } from '../../shared/madden_thread_notifier.js';
import { loadMaddenChannelMap } from '../../shared/madden_metadata.js';
import { loadGuildMaddenConfig, saveGuildMaddenConfig } from '../../shared/madden_guild_config.js';
import { getBillingSummary } from '../../leaguebuddy/manual_billing_service.js';
import connectionRepository from '../../leaguebuddy/repositories/madden_connection_repository.js';
import { applyTeamEmojiRoleIcon } from '../../shared/role_icon_utils.js';

export const featureKey = 'scouting_draft';

const ONBOARD_TIMEOUTS_MS = {
    threadAdd: 4500,
    pins: 4500,
    fairsim: 4500,
    dm: 6500,
};

const ONBOARD_THREAD_DEBUG = String(process.env.MADDEN_ONBOARD_THREAD_DEBUG || '').toLowerCase() === 'true';

function debugLog(...args) {
    if (!ONBOARD_THREAD_DEBUG) return;
    // eslint-disable-next-line no-console
    console.log('[madden-onboard][thread-debug]', ...args);
}

function withTimeout(promise, ms, fallback) {
    if (!promise || typeof promise.then !== 'function') return Promise.resolve(fallback);
    const timeout = new Promise((resolve) => setTimeout(() => resolve(fallback), ms));
    return Promise.race([promise, timeout]);
}

function safeReadJSON(file, fallback = {}) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return fallback;
    }
}

function loadChannelMap(guildId = null) {
    return loadMaddenChannelMap(guildId);
}

function normalizeKey(value = '') {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveTeamRoleIdFromRoleMap(teamName, roleMap) {
    const normalizedTeam = normalizeKey(teamName);
    const entries = Object.entries(roleMap || {})
        .filter(([name]) => / coach$/i.test(name))
        .map(([name, id]) => ({
            name,
            id,
            normalized: normalizeKey(name.replace(/ coach$/i, '').trim()),
        }));

    // Strong match
    const exact = entries.find((entry) => entry.normalized === normalizedTeam);
    if (exact) return exact.id;

    // Loose match
    const loose = entries.find((entry) => entry.normalized.includes(normalizedTeam) || normalizedTeam.includes(entry.normalized));
    if (loose) return loose.id;

    return null;
}

async function ensureCoachRole(interaction, roleName) {
    let role = interaction.guild.roles.cache.find((item) => item.name === roleName) || null;
    if (!role) {
        role = await interaction.guild.roles.create({
            name: roleName,
            mentionable: false,
            reason: 'Coach role created on onboarding',
        });
    }

    const baseName = roleName.replace(/ coach$/i, '').trim();
    await applyTeamEmojiRoleIcon(role, baseName).catch(() => null);

    const cfg = loadGuildMaddenConfig(interaction.guildId) || {};
    cfg.compat = cfg.compat || {};
    cfg.compat.maddenRoleMap = cfg.compat.maddenRoleMap || {};
    cfg.compat.maddenRoleMap[roleName] = role.id;
    cfg.compat.maddenRoleMap[baseName] = cfg.compat.maddenRoleMap[baseName] || role.id;
    saveGuildMaddenConfig(interaction.guildId, cfg);
    return role;
}

function persistCoachRoleMapping(guildId, role) {
    if (!guildId || !role?.id || !/ coach$/i.test(role.name || '')) return;
    const cfg = loadGuildMaddenConfig(guildId) || {};
    cfg.compat = cfg.compat || {};
    cfg.compat.maddenRoleMap = cfg.compat.maddenRoleMap || {};
    const roleName = role.name;
    const baseName = roleName.replace(/ coach$/i, '').trim();
    cfg.compat.maddenRoleMap[roleName] = role.id;
    cfg.compat.maddenRoleMap[baseName] = cfg.compat.maddenRoleMap[baseName] || role.id;
    saveGuildMaddenConfig(guildId, cfg);
}

function getLeaguebuddyCoachesRole(guild, roleMap) {
    const roleId = roleMap['LEAGUEbuddy Coaches'] || roleMap['LB Coaches'] || roleMap['Ghost Legacy'] || null;
    return roleId ? guild.roles.cache.get(roleId) || null : null;
}

function resolveSnapshotTeamByName(snapshot, teamName) {
    const teams = snapshot?.teams?.leagueTeamInfoList || [];
    const target = normalizeKey(teamName);
    if (!target) return null;

    const byAlias = (team) => {
        const aliases = [
            getFullTeamName(team, ''),
            team?.displayName,
            team?.nickName,
            team?.cityName,
            team?.abbrName,
        ].filter(Boolean);
        return aliases.some((alias) => normalizeKey(alias) === target);
    };

    let match = teams.find(byAlias);
    if (match) return match;

    // loose contains
    match = teams.find((team) => {
        const aliases = [
            getFullTeamName(team, ''),
            team?.displayName,
            team?.nickName,
            team?.cityName,
            team?.abbrName,
        ].filter(Boolean);
        return aliases.some((alias) => {
            const norm = normalizeKey(alias);
            return norm && (norm.includes(target) || target.includes(norm));
        });
    });

    return match || null;
}

function getSnapshotTeamOwnerInfo(snapshotTeam) {
    if (!snapshotTeam) return { isOwned: false, ownerUserId: null, ownerDisplay: null };

    const candidates = [
        { id: snapshotTeam?.userId, label: 'userId' },
        { id: snapshotTeam?.ownerId, label: 'ownerId' },
        { id: snapshotTeam?.coachUserId, label: 'coachUserId' },
        { id: snapshotTeam?.coachId, label: 'coachId' },
        { id: snapshotTeam?.userID, label: 'userID' },
    ];
    const raw = candidates.map((c) => c.id).find((id) => id != null && String(id).trim() !== '' && String(id) !== '0');
    const ownerUserId = raw ? String(raw) : null;
    const ownerDisplay = snapshotTeam?.userName
        || snapshotTeam?.ownerName
        || snapshotTeam?.coachName
        || null;
    // NOTE: Some exports include a display label even when the team is effectively open.
    // For onboarding/autocomplete we only treat snapshot as authoritative when there's a non-zero owner id.
    return { isOwned: Boolean(ownerUserId), ownerUserId, ownerDisplay };
}

function roleHasAnyMembers(role) {
    const count = role?.members?.size;
    return typeof count === 'number' ? count > 0 : false;
}

function getCoachRoleEntries(roleMap) {
    return Object.entries(roleMap || {})
        .filter(([name]) => / coach$/i.test(name))
        .map(([name, id]) => ({ roleName: name, roleId: String(id) }));
}

async function buildCoachRoleMemberCountMap(guild, roleMap) {
    // Autocomplete correctness > speed: use the same strategy as /madden-availableteams.
    // 1) Best effort: one members.fetch() and build roleId -> count map.
    // 2) Fallback: role.members.size (can be incomplete if cache/intents are limited).
    // If we can't verify, callers should fail closed (hide teams).
    const out = new Map();
    if (!guild) return out;

    try {
        const members = await guild.members.fetch();
        members.forEach((m) => {
            m.roles.cache.forEach((r) => {
                out.set(String(r.id), (out.get(String(r.id)) || 0) + 1);
            });
        });
        return out;
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[madden-onboard] member fetch skipped (autocomplete):', e?.message || e);
    }

    const coachRoles = getCoachRoleEntries(roleMap);
    const capped = coachRoles.slice(0, 200);
    for (const { roleId } of capped) {
        const role = guild.roles.cache.get(String(roleId)) || await guild.roles.fetch(String(roleId)).catch(() => null);
        if (!role) continue;
        const size = typeof role?.members?.size === 'number' ? role.members.size : 0;
        out.set(String(roleId), size);
    }
    return out;
}

async function sendOnboardingDM({ client, guild, user, teamDisplay, snapshot, channelMap, threadLinks = [] }) {
    const seasonInfo = snapshot?.info?.careerHubInfo?.seasonInfo || {};
    const seasonNumber = seasonInfo.seasonNumber ?? seasonInfo.seasonIndex ?? seasonInfo.calendarYear ?? 'Current';
    const weekNumber = seasonInfo.displayWeek ?? seasonInfo.seasonWeek ?? (Number.isFinite(Number(seasonInfo.weekIndex)) ? Number(seasonInfo.weekIndex) + 1 : null);
    const billing = getBillingSummary(guild?.id);
    const connection = connectionRepository.getLeagueConnectionByGuildId(guild?.id);
    const savedPassword = String(connection?.leaguePassword || connection?.summary?.leaguePassword || '').trim();
    const showJoinInfo = ['standard', 'premium'].includes(String(billing?.plan || '').toLowerCase()) && savedPassword;

    const channelIdFor = (names = []) => {
        for (const name of names) {
            const raw = channelMap?.[name]
                ?? channelMap?.[String(name || '').toLowerCase()]
                ?? null;
            if (raw) return String(raw);
        }
        return null;
    };

    const channelLink = (id) => (id ? `<#${id}>` : null);

    const rulesOpsId = channelIdFor(['rulesOps', 'Rules', 'rules', 'Rules & Operations', 'rules-ops']);
    const breakdownId = channelIdFor(['breakdown', 'LEAGUEbuddy Breakdown', 'leaguebuddy-breakdown', 'Sportsbook', 'sportsbook']);
    const scoutingHubId = channelIdFor(['scoutingHub', 'Scouting Hub', 'scouting-hub', 'Scouting', 'madden-scouting', 'Front Office', 'front-office']);
    const tradeSubmitId = channelIdFor(['tradeSubmit', 'Submit a Trade', 'submit-a-trade', 'Trades', 'trades', 'trade-block', 'Trade Block', 'madden-tradeblock']);

    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('Welcome to LEAGUEbuddy Madden')
        .setDescription(
            [
                `You’ve been assigned to **${teamDisplay}** in **${guild?.name || 'the league'}**.`,
                `Season: **${seasonNumber}**${weekNumber ? ` • Week: **${weekNumber}**` : ''}`,
            ].filter(Boolean).join('\n'),
        )
        .addFields(
            {
                name: 'Start Here',
                value: [
                    '• `/help`',
                    '• `/schedule`',
                    '• `/roster`',
                    '• Check your game thread',
                ].join('\n'),
            },
            {
                name: 'League Join Info',
                value: showJoinInfo
                    ? [
                        `League: **${connection?.leagueName || guild?.name || 'This server league'}**`,
                        `Password: **${savedPassword}**`,
                        'Your commissioner or server admin still controls rules and league settings.',
                    ].join('\n')
                    : 'Your commissioner or server admin handles the league name, password, and rules for this server.',
            },
            ...((channelLink(rulesOpsId) || channelLink(breakdownId) || channelLink(scoutingHubId) || channelLink(tradeSubmitId))
                ? [{
                    name: 'Useful Channels',
                    value: [
                        channelLink(rulesOpsId),
                        channelLink(breakdownId),
                        channelLink(scoutingHubId),
                        channelLink(tradeSubmitId),
                    ].filter(Boolean).join('\n'),
                }]
                : []),
            ...(Array.isArray(threadLinks) && threadLinks.length
                ? [{
                    name: 'Your Game Thread',
                    value: threadLinks.join('\n'),
                }]
                : []),
        )
        .setFooter({ text: 'LEAGUEbuddy • ask your server admin for league-specific rules and join details' })
        .setTimestamp();

    await user.send({ embeds: [embed] });
}

function normalizeLooseTeamKey(value = '') {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function threadMatchesTeam(info, teamName) {
    const target = normalizeLooseTeamKey(teamName);
    if (!target) return false;
    const away = normalizeLooseTeamKey(info?.awayTeam || '');
    const home = normalizeLooseTeamKey(info?.homeTeam || '');
    return Boolean(away && (away === target || away.includes(target) || target.includes(away)))
        || Boolean(home && (home === target || home.includes(target) || target.includes(home)));
}

function memberIsInThread(thread, memberId) {
    const raw = thread?.members?.cache?.has?.(memberId);
    if (typeof raw === 'boolean') return raw;
    // If members aren't cached/available, we assume not present and attempt add.
    return false;
}

function resolveThreadIdFromState(info) {
    return String(
        info?.threadId
        ?? info?.id
        ?? info?.channelId
        ?? info?.threadID
        ?? ''
    ).trim() || null;
}

function isLikelyThreadChannel(ch) {
    if (!ch) return false;
    if (typeof ch.isThread === 'function') return ch.isThread();
    // Some discord.js versions / partials don't expose isThread().
    // Use channel flags as a fallback.
    const type = ch.type;
    return type === 11 || type === 12 || type === 10 || Boolean(ch.parentId && ch.ownerId);
}

function parseIdsFromMention(raw = '') {
    return [...new Set(String(raw || '').match(/\d{6,}/g) || [])].filter(Boolean);
}

function parseWeekNumberFromThreadName(name = '') {
    const match = String(name || '').match(/\b(?:week|w)\s*\.?\s*(\d+)\b/i);
    if (!match) return null;
    const week = Number(match[1]);
    return Number.isFinite(week) && week > 0 ? week : null;
}

function parseMatchupTeamsFromThreadName(name = '') {
    const matchupLabel = String(name || '').split(/\s+-\s+/)[0] || '';
    const parts = matchupLabel.split(/\s+vs\s+/i);
    if (parts.length < 2) return { awayTeam: null, homeTeam: null };
    const awayTeam = (parts[0] || '').trim() || null;
    const homeTeam = (parts.slice(1).join(' vs ') || '').trim() || null;
    return { awayTeam, homeTeam };
}

const GAME_THREADS_PARENT_CHANNEL_ID = '1460288550305005801';

async function discoverCoachThreadsLive({ guild, teamNameForAssignment, currentWeekNumber, channelMap }) {
    const resolvedMap = channelMap && typeof channelMap === 'object' ? channelMap : loadChannelMap(guild?.id);
    const parentId = resolvedMap?.['Game threads']
        || resolvedMap?.['Game Threads']
        || resolvedMap?.['game threads']
        || GAME_THREADS_PARENT_CHANNEL_ID
        || null;
    if (!parentId) return [];

    const parent = await guild.channels.fetch(String(parentId)).catch(() => null);
    if (!parent) {
        debugLog('live-scan parent fetch failed', { parentId });
        return [];
    }

    // Pull active threads from the parent (safe + bounded). We only use threads the bot can see.
    const listing = await parent.threads.fetchActive().catch(() => null);
    const threads = listing?.threads ? [...listing.threads.values()] : [];
    debugLog('live-scan active threads', { parentId, count: threads.length, team: teamNameForAssignment, week: currentWeekNumber });
    if (!threads.length) return [];

    const teamKey = normalizeLooseTeamKey(teamNameForAssignment);
    const scored = [];
    for (const thread of threads) {
        const name = String(thread?.name || '');
        const norm = normalizeLooseTeamKey(name);

        // Primary: parse matchup "A vs B - W7" and match either team.
        const teams = parseMatchupTeamsFromThreadName(name);
        const awayKey = normalizeLooseTeamKey(teams.awayTeam || '');
        const homeKey = normalizeLooseTeamKey(teams.homeTeam || '');
        const parsedMatch = (awayKey && (awayKey === teamKey || awayKey.includes(teamKey) || teamKey.includes(awayKey)))
            || (homeKey && (homeKey === teamKey || homeKey.includes(teamKey) || teamKey.includes(homeKey)));

        // Fallback: substring contains (covers odd thread names).
        const containsMatch = norm.includes(teamKey);

        if (!parsedMatch && !containsMatch) continue;
        const week = parseWeekNumberFromThreadName(name);
        const weekScore = currentWeekNumber && week === currentWeekNumber ? 100 : 0;
        const created = Number(thread?.createdTimestamp || 0);
        scored.push({ id: thread.id, weekScore, created });
    }

    scored.sort((a, b) => (b.weekScore - a.weekScore) || (b.created - a.created));
    const out = scored.slice(0, 3).map((entry) => `<#${entry.id}>`);
    if (out.length) debugLog('live-scan matched', { matched: out.length, ids: out });
    return out;
}

async function getLiveThreadDebug({ guild, teamNameForAssignment, currentWeekNumber, channelMap }) {
    const resolvedMap = channelMap && typeof channelMap === 'object' ? channelMap : loadChannelMap(guild?.id);
    const parentId = resolvedMap?.['Game threads']
        || resolvedMap?.['Game Threads']
        || resolvedMap?.['game threads']
        || GAME_THREADS_PARENT_CHANNEL_ID
        || null;
    if (!parentId) {
        return { ok: false, reason: 'no_parent_id' };
    }
    const parent = await guild.channels.fetch(String(parentId)).catch(() => null);
    if (!parent) {
        return { ok: false, reason: 'parent_not_fetchable', parentId: String(parentId) };
    }
    const listing = await parent.threads.fetchActive().catch(() => null);
    const threads = listing?.threads ? [...listing.threads.values()] : [];
    const teamKey = normalizeLooseTeamKey(teamNameForAssignment);
    const matches = [];
    const samples = [];
    for (const thread of threads) {
        const name = String(thread?.name || '');
        const norm = normalizeLooseTeamKey(name);
        const teams = parseMatchupTeamsFromThreadName(name);
        const awayKey = normalizeLooseTeamKey(teams.awayTeam || '');
        const homeKey = normalizeLooseTeamKey(teams.homeTeam || '');
        const parsedMatch = (awayKey && (awayKey === teamKey || awayKey.includes(teamKey) || teamKey.includes(awayKey)))
            || (homeKey && (homeKey === teamKey || homeKey.includes(teamKey) || teamKey.includes(homeKey)));
        const containsMatch = norm.includes(teamKey);
        if (samples.length < 8) samples.push(name);
        if (!parsedMatch && !containsMatch) continue;
        const week = parseWeekNumberFromThreadName(name);
        const weekOk = !currentWeekNumber || week == null || week === currentWeekNumber;
        if (!weekOk) continue;
        matches.push(name);
        if (matches.length >= 6) break;
    }

    return {
        ok: true,
        parentId: String(parentId),
        activeCount: threads.length,
        teamKey,
        currentWeekNumber,
        matchCount: matches.length,
        matchSamples: matches,
        threadNameSamples: samples,
    };
}

async function addCoachToExistingGameThreads({ client, guild, member, teamNameForAssignment }) {
    if (!client || !guild || !member?.id || !teamNameForAssignment) return { added: 0, skipped: 0 };

    // Consider ANY tracked thread state, not just pending.
    const threadStates = listThreadStates().filter((info) => info);
    const candidates = threadStates.filter((info) => threadMatchesTeam(info, teamNameForAssignment));
    debugLog('tracked-state candidates for add', { team: teamNameForAssignment, totalStates: threadStates.length, candidates: candidates.length });
    if (!candidates.length) return { added: 0, skipped: 0 };

    let added = 0;
    let skipped = 0;

    for (const info of candidates) {
        const threadId = resolveThreadIdFromState(info);
        if (!threadId) {
            debugLog('tracked-state missing thread id', { infoKeys: Object.keys(info || {}) });
            skipped += 1;
            continue;
        }
        const thread = await client.channels.fetch(threadId).catch(() => null);
        if (!isLikelyThreadChannel(thread) || (thread.guildId && thread.guildId !== guild.id)) {
            debugLog('tracked-state fetch failed/invalid thread', { threadId: info.threadId });
            skipped += 1;
            continue;
        }

        const hydrated = (await hydrateThreadStateFromLiveThread(thread, info).catch(() => null)) || info;
        if (!threadMatchesTeam(hydrated, teamNameForAssignment)) {
            skipped += 1;
            continue;
        }

        if (memberIsInThread(thread, member.id)) {
            skipped += 1;
            continue;
        }

        const ok = await thread.members.add(member.id).then(() => true).catch(() => false);
        if (ok) added += 1;
        else skipped += 1;
    }

    debugLog('thread add result', { team: teamNameForAssignment, added, skipped });

    return { added, skipped };
}

async function getCoachThreadLinks({ client, guild, teamNameForAssignment, snapshot, channelMap }) {
    if (!client || !guild || !teamNameForAssignment) return [];

    // Consider ANY tracked thread state, not just pending.
    // Filter out clearly bad entries (ignored/inaccessible) so we don't DM dead links.
    const threadStates = listThreadStates()
        .filter((info) => info)
        .filter((info) => {
            const status = String(info?.status || '').toLowerCase();
            return status !== 'ignored';
        });

    // Prefer threads from the current week when we can infer it.
    const currentWeekIndex = snapshot?.info?.careerHubInfo?.seasonInfo?.weekIndex;
    const currentWeekNumber = Number.isFinite(Number(currentWeekIndex)) ? Number(currentWeekIndex) + 1 : null;

    debugLog('getCoachThreadLinks start', { team: teamNameForAssignment, currentWeekNumber, trackedCount: threadStates.length });

    // Primary match: thread metadata about teams.
    let candidates = threadStates.filter((info) => threadMatchesTeam(info, teamNameForAssignment));
    debugLog('tracked-state team match candidates', { count: candidates.length });

    // Fallback: if thread state doesn't have away/home team, try parsing the mention field
    // (it often includes the coach role ids).
    if (!candidates.length) {
        const normalizedTeam = normalizeLooseTeamKey(teamNameForAssignment);
        const roleMap = loadRoleMapForGuild(guild?.id);
        const roleId = resolveTeamRoleIdFromRoleMap(normalizedTeam, roleMap)
            || resolveTeamRoleIdFromRoleMap(teamNameForAssignment, roleMap);
        if (roleId) {
            candidates = threadStates.filter((info) => parseIdsFromMention(info?.mention || '').includes(String(roleId)));
            debugLog('tracked-state mention candidates', { roleId: String(roleId), count: candidates.length });
        }
    }

    if (!candidates.length) {
        // Live fallback: scan active threads under the Game Threads parent channel.
        // This catches cases where the notifier store isn't hydrated/registered yet.
        debugLog('falling back to live-scan (no tracked candidates)');
        const live = await discoverCoachThreadsLive({
            guild,
            teamNameForAssignment,
            currentWeekNumber,
            channelMap,
        }).catch(() => []);
        debugLog('live-scan returned', { count: Array.isArray(live) ? live.length : 0, live });
        return Array.isArray(live) ? live : [];
    }
    // Sort candidates to prefer current-week threads, then newest created.
    const scored = candidates.map((info) => {
        const created = Number(info?.created || 0);
        const weekIndex = info?.weekIndex;
        const weekNumber = Number.isFinite(Number(weekIndex)) ? Number(weekIndex) + 1 : null;
        const weekScore = currentWeekNumber && weekNumber === currentWeekNumber ? 100 : 0;
        return { info, score: weekScore, created };
    }).sort((a, b) => (b.score - a.score) || (b.created - a.created));

    const links = [];
    for (const { info } of scored) {
        const threadId = resolveThreadIdFromState(info);
        if (!threadId) continue;
        const thread = await client.channels.fetch(threadId).catch(() => null);
        if (!isLikelyThreadChannel(thread) || (thread.guildId && thread.guildId !== guild.id)) continue;
        const hydrated = (await hydrateThreadStateFromLiveThread(thread, info).catch(() => null)) || info;

        // If we matched by mention fallback, we may not be able to match teams. That's okay.
        if (hydrated?.awayTeam || hydrated?.homeTeam) {
            if (!threadMatchesTeam(hydrated, teamNameForAssignment)) continue;
        }
        // Only include if we can still read it.
        links.push(`<#${thread.id}>`);
        if (links.length >= 3) break;
    }
    if (links.length) return links;

    // If we couldn't fetch/validate any tracked threads, try live scan.
    debugLog('tracked candidates existed but no readable links; falling back to live-scan');
    const live = await discoverCoachThreadsLive({
        guild,
        teamNameForAssignment,
        currentWeekNumber,
        channelMap,
    }).catch(() => []);
    debugLog('live-scan returned', { count: Array.isArray(live) ? live.length : 0, live });
    return Array.isArray(live) ? live : [];
}

export const data = new SlashCommandBuilder()
    .setName('onboard')
    .setDescription('Staff: Assign a coach to a team and DM them an onboarding pack.')
    .addUserOption((o) => o.setName('user').setDescription('Coach to onboard').setRequired(true))
    .addStringOption((o) => o.setName('team').setDescription('Team name (e.g., "Rams")').setRequired(true).setAutocomplete(true))
    .setDefaultMemberPermissions(null);

export async function execute(interaction) {
    const roleMap = loadRoleMapForGuild(interaction.guildId);
    // Defer immediately to avoid the command "thinking" while we fetch roles/snapshot.
    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply({ content: 'Onboarding… (assigning roles + sending DM)' }).catch(() => null);

    const staffMember = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!staffMember || !hasStaffRole(staffMember, roleMap)) {
        await interaction.editReply({ content: 'Only server admins, LB Commish, or LB Co-Commish can use this command.' });
        return;
    }

    const leagueId = resolveLeagueIdWithConfig(interaction.guildId);
    if (!leagueId) {
        await interaction.editReply({ content: 'No league is connected yet. Run `/setup` and press Open Setup Dashboard.' });
        return;
    }

    const targetUser = interaction.options.getUser('user');
    const teamInput = interaction.options.getString('team');
    const guildMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!guildMember) {
        await interaction.editReply({ content: 'User not found in this server.' });
        return;
    }

    const snapshot = loadLeagueSnapshot(leagueId);
    const team = resolveSnapshotTeamByName(snapshot, teamInput);
    const teamDisplay = team ? getFullTeamName(team, teamInput) : String(teamInput);

    const coachRoleId = resolveTeamRoleIdFromRoleMap(teamDisplay, roleMap)
        || resolveTeamRoleIdFromRoleMap(teamInput, roleMap)
        || (team ? resolveTeamRoleIdFromRoleMap(getFullTeamName(team, ''), roleMap) : null);
    let coachRole = coachRoleId ? await interaction.guild.roles.fetch(String(coachRoleId)).catch(() => null) : null;
    if (!coachRole) {
        try {
            coachRole = await ensureCoachRole(interaction, `${teamDisplay} Coach`);
        } catch (error) {
            await interaction.editReply({ content: `Could not create a coach role for "${teamDisplay}". ${error?.message || error}` });
            return;
        }
    }

    // Hard-block: don't allow onboarding onto an already-claimed team.
    // (Autocomplete hides assigned teams, but execute must still enforce it.)
    const ownedInDiscord = roleHasAnyMembers(coachRole);
    if (ownedInDiscord) {
        const snapshotOwner = getSnapshotTeamOwnerInfo(team);
        const ownerNote = snapshotOwner.ownerDisplay ? ` (snapshot owner: **${snapshotOwner.ownerDisplay}**)` : '';
        await interaction.editReply({ content: `Hard block: **${coachRole.name}** already has a coach assigned.${ownerNote} Remove the role from the current coach first.` });
        return;
    }

    const teamNameForAssignment = coachRole.name.replace(/ coach$/i, '').trim();

    try {
        await guildMember.roles.add(coachRole);
        persistCoachRoleMapping(interaction.guildId, coachRole);
        const coachGroupRole = getLeaguebuddyCoachesRole(interaction.guild, roleMap);
        if (coachGroupRole) {
            await guildMember.roles.add(coachGroupRole).catch(() => null);
        }
    } catch (err) {
        await interaction.editReply({ content: `Failed to assign role "${coachRole.name}": ${err?.message || err}` });
        return;
    }

    // Add to existing game thread(s) if they already exist (best-effort, but don't stall the command).
    const threadAddResult = await withTimeout(
        addCoachToExistingGameThreads({
            client: interaction.client,
            guild: interaction.guild,
            member: guildMember,
            teamNameForAssignment,
        }).catch(() => ({ added: 0, skipped: 0 })),
        ONBOARD_TIMEOUTS_MS.threadAdd,
        { added: 0, skipped: 0 },
    );

    const channelMap = loadChannelMap(interaction.guildId);

    const threadLinks = await withTimeout(
        getCoachThreadLinks({
            client: interaction.client,
            guild: interaction.guild,
            teamNameForAssignment,
            snapshot,
            channelMap,
        }).catch(() => []),
        2200,
        [],
    );

    // Staff-only debug help if threads aren't showing.
    let threadDebugLine = '';
    if (!threadLinks?.length) {
        const currentWeekIndex = snapshot?.info?.careerHubInfo?.seasonInfo?.weekIndex;
        const currentWeekNumber = Number.isFinite(Number(currentWeekIndex)) ? Number(currentWeekIndex) + 1 : null;
        const debug = await withTimeout(
            getLiveThreadDebug({
                guild: interaction.guild,
                teamNameForAssignment,
                currentWeekNumber,
                channelMap,
            }).catch(() => null),
            1500,
            null,
        );
        if (debug?.ok) {
            threadDebugLine = `\n\nThread debug: parent <#${debug.parentId}> active=${debug.activeCount} matched=${debug.matchCount} teamKey=${debug.teamKey}`;
        } else if (debug) {
            threadDebugLine = `\n\nThread debug: ${debug.reason || 'unknown'}${debug.parentId ? ` parent=${debug.parentId}` : ''}`;
        }
    }

    setCoachAssignment({
        guildId: interaction.guildId,
        userId: targetUser.id,
        teamName: teamNameForAssignment,
        roleId: coachRole.id,
        assignedByUserId: interaction.user.id,
        assignedByTag: interaction.user.tag,
    });

    // Refresh availability + boards (best-effort, timeboxed).
    await withTimeout(
        updateAvailableTeamsPin(interaction.client, interaction.guildId, {
            allowCreate: true,
            delayMs: 0,
            retries: 3,
            retryDelayMs: 800,
            guild: interaction.guild,
            skipMemberFetch: false,
        }).catch((e) => {
            console.warn('[madden-onboard] available teams pin update skipped:', e?.message || e);
            return null;
        }),
        ONBOARD_TIMEOUTS_MS.pins,
        null,
    );
    await withTimeout(
        updateFairSimBoard(interaction.client, interaction.guildId).catch((e) => {
            console.warn('[madden-onboard] fair sim board update skipped:', e?.message || e);
            return null;
        }),
        ONBOARD_TIMEOUTS_MS.fairsim,
        null,
    );

    // DM onboarding pack (timeboxed). If it times out, we still complete the command.
    const dmOk = await withTimeout(
        sendOnboardingDM({
            client: interaction.client,
            guild: interaction.guild,
            user: targetUser,
            teamDisplay: teamNameForAssignment,
            snapshot,
            channelMap,
            threadLinks,
        }).then(() => true).catch(() => false),
        ONBOARD_TIMEOUTS_MS.dm,
        false,
    );

    const threadLine = threadAddResult?.added
        ? ` Added to **${threadAddResult.added}** existing game thread(s).`
        : '';
    const dmLine = dmOk
        ? ' Sent onboarding DM.'
        : ' DM not confirmed (they may have DMs closed, or it timed out).';
    await interaction.editReply({ content: `Onboarded ${targetUser.tag} as **${teamNameForAssignment}**.${dmLine}${threadLine}${threadDebugLine}` });
}

export async function autocomplete(interaction) {
    if (!interaction.isAutocomplete()) return;

    const roleMap = loadRoleMapForGuild(interaction.guildId);
    const focused = String(interaction.options.getFocused() || '').toLowerCase();

    const leagueId = resolveLeagueIdWithConfig(interaction.guildId);
    if (!leagueId) {
        await interaction.respond([]);
        return;
    }

    const snapshot = loadLeagueSnapshot(leagueId);
    const teams = snapshot?.teams?.leagueTeamInfoList || [];

    // Autocomplete must be correct: do the same best-effort role occupancy check as /madden-availableteams.
    // If we can't verify counts, fail closed (return no suggestions) rather than showing owned teams.
    const coachRoleCounts = await withTimeout(
        buildCoachRoleMemberCountMap(interaction.guild, roleMap),
        2200,
        null,
    );

    const options = [];
    for (const t of teams) {
        const fullName = getFullTeamName(t, `Team ${t?.teamId}`);
        const displayName = fullName;

        // Find roleId for coach
        const roleId = resolveTeamRoleIdFromRoleMap(fullName, roleMap)
            || resolveTeamRoleIdFromRoleMap(t?.displayName, roleMap)
            || resolveTeamRoleIdFromRoleMap(t?.nickName, roleMap);

        const assignedCount = roleId ? coachRoleCounts?.get?.(String(roleId)) : 0;
        const assigned = typeof assignedCount === 'number' ? assignedCount > 0 : false;
        if (assigned) continue;

        if (focused && !displayName.toLowerCase().includes(focused)) continue;

        // Discord will truncate/limit option values; keep value stable as fullName
        options.push({ name: displayName.slice(0, 100), value: displayName.slice(0, 100) });
        if (options.length >= 25) break;
    }

    await interaction.respond(options);
}

export default { data, execute, autocomplete };
