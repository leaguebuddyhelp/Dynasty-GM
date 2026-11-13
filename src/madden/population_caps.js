import fs from 'node:fs/promises';
import path from 'node:path';
import { getMaddenDataFilePath } from '../leaguebuddy/paths.js';
import { getMaddenSeasonKey, getMaddenChannelId } from '../shared/madden_metadata.js';
import { ensurePositionThreads, buildPositionChangeEmbeds, publishPositionPages } from './position_reports.js';
import { buildTeamReportIndex } from './report_navigation.js';

export function countRatingBands(players, ratings = new Map(players.map((p) => [p.playerKey, p.currentOvr]))) {
  const at = (minimum, qb = false) => players.filter((p) => (!qb || p.position === 'QB') && ratings.get(p.playerKey) >= minimum).length;
  return { overall80Plus: at(80), overall90Plus: at(90), quarterbacks70Plus: at(70, true), quarterbacks80Plus: at(80, true), quarterbacks90Plus: at(90, true) };
}
export function buildPopulationCapPlan(evidence, policy, teamIds = [...new Set(evidence.map((p) => String(p.teamId)))]) {
  const players = evidence.filter((p) => Number.isFinite(p.currentOvr) && p.currentOvr >= 0 && p.currentOvr <= 99);
  const targets = new Map(players.map((p) => [p.playerKey, p.currentOvr]));
  const reasons = new Map();
  const change = (p, target, reason) => {
    targets.set(p.playerKey, target);
    const list = reasons.get(p.playerKey) || []; list.push(reason); reasons.set(p.playerKey, list);
  };
  const rank = (a, b) => b.rankScore - a.rankScore || b.currentOvr - a.currentOvr || a.player.localeCompare(b.player) || a.playerKey.localeCompare(b.playerKey);
  const qbs = players.filter((p) => p.position === 'QB');
  const candidates = qbs.filter((p) => p.currentOvr >= 90 || (p.currentOvr >= Number(policy.minimumChallengerOvr)
    && p.sufficientSample !== false && p.games >= Number(policy.minimumQbGames) && p.attempts >= Number(policy.minimumQbAttempts) && p.rawScore >= Number(policy.minimumEliteQbScore)));
  const elite = [...candidates].sort(rank).slice(0, Number(policy.quarterbacks90PlusMaximum));
  const eliteKeys = new Set(elite.map((p) => p.playerKey));
  for (const p of qbs) {
    if (p.currentOvr >= 90 && !eliteKeys.has(p.playerKey)) change(p, 89, `90+ QB limit: at most ${policy.quarterbacks90PlusMaximum}. This is roster balancing, not a poor-game penalty.`);
    else if (eliteKeys.has(p.playerKey) && p.currentOvr < 90) change(p, 90, 'Earned an elite QB slot through sustained season production and efficiency. Apply demotions before promotions.');
  }
  const cap = (pool, threshold, maximum, label, preserve = new Set(), allowChallenger = () => true) => {
    const eligible = pool.filter((p) => targets.get(p.playerKey) >= threshold ||
      (p.eligibleForGrowth && targets.get(p.playerKey) === threshold - 1 && allowChallenger(p))).sort((a, b) =>
      Number(preserve.has(b.playerKey)) - Number(preserve.has(a.playerKey)) || (threshold < 90 ? Number(targets.get(b.playerKey) >= 90) - Number(targets.get(a.playerKey) >= 90) : 0) || rank(a, b));
    const kept = new Set(eligible.slice(0, maximum).map((p) => p.playerKey));
    for (const p of eligible.slice(maximum)) if (targets.get(p.playerKey) >= threshold) change(p, threshold - 1, `${label}: maximum ${maximum} at ${threshold}+. Roster-cap adjustment.`);
    return kept;
  };
  const qb80Slots = cap(qbs, 80, Number(policy.quarterbacks80PlusMaximum), 'QB 80+ limit', eliteKeys);
  // Reserve space for viable starters before stacking all 70+ slots on backups.
  const bestByTeam = [...new Set(qbs.map((p) => p.teamId))].map((teamId) => qbs.filter((p) => p.teamId === teamId && targets.get(p.playerKey) >= 70)
    .sort((a, b) => targets.get(b.playerKey) - targets.get(a.playerKey) || rank(a, b))[0]).filter(Boolean).sort(rank);
  const protectedStarters = new Set([...eliteKeys, ...bestByTeam.slice(0, Math.max(0, teamIds.length - Number(policy.draftNeedTarget?.[1] || 4))).map((p) => p.playerKey)]);
  const qb70Slots = cap(qbs, 70, Number(policy.quarterbacks70PlusMaximum), 'QB 70+ limit', protectedStarters);
  const protectedElite = new Set(elite.slice(0, Math.min(5, Number(policy.overall90PlusMaximum))).map((p) => p.playerKey));
  const global90Slots = cap(players, 90, Number(policy.overall90PlusMaximum), 'League 90+ limit', protectedElite, (p) => p.position !== 'QB' || eliteKeys.has(p.playerKey));
  const global80Slots = cap(players, 80, Number(policy.overall80PlusMaximum), 'League 80+ limit', protectedElite, (p) => p.position !== 'QB' || qb80Slots.has(p.playerKey));
  const projected = countRatingBands(players, targets);
  const ceilings = {};
  for (const p of players) {
    let ceiling = 99;
    const target = targets.get(p.playerKey);
    if (p.position === 'QB' && !eliteKeys.has(p.playerKey)) ceiling = Math.min(ceiling, 89);
    if (global90Slots.size >= policy.overall90PlusMaximum && !global90Slots.has(p.playerKey)) ceiling = Math.min(ceiling, 89);
    if (global80Slots.size >= policy.overall80PlusMaximum && !global80Slots.has(p.playerKey)) ceiling = Math.min(ceiling, 79);
    if (p.position === 'QB' && qb80Slots.size >= policy.quarterbacks80PlusMaximum && !qb80Slots.has(p.playerKey)) ceiling = Math.min(ceiling, 79);
    if (p.position === 'QB' && qb70Slots.size >= policy.quarterbacks70PlusMaximum && !qb70Slots.has(p.playerKey)) ceiling = Math.min(ceiling, 69);
    if (target < p.currentOvr) ceiling = Math.min(ceiling, target);
    ceilings[p.playerKey] = ceiling;
  }
  const qbNeeds = [];
  for (const teamId of teamIds) {
    const roster = qbs.filter((p) => String(p.teamId) === String(teamId)).sort((a, b) => targets.get(b.playerKey) - targets.get(a.playerKey) || rank(a, b));
    const starter = roster[0];
    const developing = starter && starter.yearsPro !== null && starter.yearsPro <= Number(policy.maximumDevelopingYearsPro)
      && (!starter.sufficientSample || starter.rawScore >= 75);
    const alternative = roster.slice(1).some((p) => targets.get(p.playerKey) >= Number(policy.viableStarterOvr) && (!p.sufficientSample || p.rawScore > Number(policy.poorStarterScore)));
    const reason = !starter ? 'No rated QB available in the active-roster import' : !developing && !alternative && targets.get(starter.playerKey) < Number(policy.viableStarterOvr)
      ? 'No viable-rated starter or protected developing QB' : !developing && !alternative && starter.sufficientSample && starter.rawScore <= Number(policy.poorStarterScore)
        ? 'Sustained poor starter performance with no viable alternative' : null;
    if (reason) qbNeeds.push({ teamId: String(teamId), team: starter?.team || `Team ${teamId}`, starter: starter?.player || null, ovr: starter ? targets.get(starter.playerKey) : null, score: starter?.rankScore ?? 0, reason });
  }
  qbNeeds.sort((a, b) => (a.ovr ?? 0) - (b.ovr ?? 0) || a.score - b.score || a.team.localeCompare(b.team));
  return { version: 1, qbOutlook: { target: policy.draftNeedTarget, actualNeeds: qbNeeds.length, teams: qbNeeds, note: 'A planning target, not a quota: healthy viable starters and promising young QBs are not downgraded to manufacture draft demand.' }, currentCounts: countRatingBands(players), projectedCounts: projected, limits: policy,
    ceilings, eliteQbs: elite.filter((p) => targets.get(p.playerKey) >= 90).map((p) => ({ playerKey: p.playerKey, player: p.player, currentOvr: p.currentOvr, rankScore: p.rankScore, games: p.games, attempts: p.attempts, protectedSmallSample: p.games < policy.minimumQbGames || p.attempts < policy.minimumQbAttempts })),
    adjustments: players.filter((p) => targets.get(p.playerKey) !== p.currentOvr).map((p) => ({ ...p, targetOvr: targets.get(p.playerKey), reasons: reasons.get(p.playerKey) || [], direction: targets.get(p.playerKey) > p.currentOvr ? 'upgrade' : 'downgrade' })).sort((a, b) => a.position.localeCompare(b.position) || a.player.localeCompare(b.player) || a.playerKey.localeCompare(b.playerKey)) };
}
const queues = new Map();
export async function publishPopulationCaps(options) {
  const key = `${options.guildId}:${options.snapshot.leagueId}`;
  const prior = queues.get(key) || Promise.resolve();
  const pending = prior.catch(() => {}).then(() => publishInternal(options));
  queues.set(key, pending);
  try { return await pending; } finally { if (queues.get(key) === pending) queues.delete(key); }
}
async function publishInternal({ client, guildId, snapshot }) {
  const { getRatingPopulationPlan, readProgressionRules } = await import('./progression.js');
  const rules = readProgressionRules();
  if (!rules.populationCaps?.enabled) return { posted: false, reason: 'Population caps are disabled.' };
  if (![guildId, snapshot.leagueId].every((id) => /^[a-zA-Z0-9_-]+$/.test(String(id)))) throw new Error('Invalid population-cap storage ID.');
  const plan = getRatingPopulationPlan(snapshot, rules);
  const root = getMaddenDataFilePath(`population_caps/${guildId}/${snapshot.leagueId}`);
  await fs.mkdir(root, { recursive: true });
  const file = path.join(root, 'latest.json');
  let record;
  try { record = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; record = {}; }
  record = { ...record, leagueId: String(snapshot.leagueId), seasonKey: getMaddenSeasonKey(snapshot), latestSyncId: snapshot.syncId, ...plan };
  const save = async () => {
    const temp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(record, null, 2)); await fs.rename(temp, file);
  };
  const channelId = getMaddenChannelId(rules.discord.playerUpgradesChannelKey, guildId);
  const registry = await ensurePositionThreads({ client, guildId, channelId, archiveDuration: rules.discord.threadAutoArchiveDuration });
  const groups = buildPositionChangeEmbeds(snapshot, { seasonKey: record.seasonKey, weekNumber: 'Roster Limits', recommendations: plan.adjustments.map((p) => ({ ...p,
    attributes: [{ attribute: 'Manual OVR target', currentValue: p.currentOvr, targetValue: p.targetOvr, points: p.targetOvr - p.currentOvr }],
    populationReason: p.reasons.join(' '),
  })) }, { reportLabel: 'Roster Caps', reportFooter: 'Manual OVR targets · Apply demotions first, then promotions · Apply caps AFTER gameplay edits · Sync to verify' });
  const reports = await publishPositionPages({ client, guildId, registry, record, groups, save });
  const before = plan.currentCounts, after = plan.projectedCounts;
  const policy = rules.populationCaps;
  const pending = plan.adjustments.length;
  const embed = buildTeamReportIndex({ title: '📊 Roster Rating Limits', navigationLabel: 'Open required OVR targets', moreLabel: 'More positions',
    description: `${pending ? `**${pending} manual OVR adjustments required**` : '**Imported roster is within the hard limits**'}\n\n**Imported → after applying targets / maximum**\nQBs 90+: ${before.quarterbacks90Plus} → ${after.quarterbacks90Plus} / ${policy.quarterbacks90PlusMaximum}\nQBs 80+: ${before.quarterbacks80Plus} → ${after.quarterbacks80Plus} / ${policy.quarterbacks80PlusMaximum}\nQBs 70+: ${before.quarterbacks70Plus} → ${after.quarterbacks70Plus} / ${policy.quarterbacks70PlusMaximum}\nAll players 90+: ${before.overall90Plus} → ${after.overall90Plus} / ${policy.overall90PlusMaximum}\nAll players 80+: ${before.overall80Plus} → ${after.overall80Plus} / ${policy.overall80PlusMaximum}\n\nCounts cover active team rosters; tiers overlap. Targets are instructions, not confirmed Madden ratings. Adjust Madden attributes until each target OVR is reached. Apply demotions first, then earned promotions, and apply caps after gameplay changes. Sync again to verify. Empty slots are not filled artificially.`, reports });
  const outlook = plan.qbOutlook;
  embed.addFields({ name: 'QB draft / offseason needs', value: `Planning target: ${outlook.target.join('–')} teams · Identified needs: ${outlook.actualNeeds}\n${outlook.teams.slice(0, 10).map((team) => `${team.team}: ${team.reason}`).join('\n') || 'No clear need identified from current evidence.'}\nPromising young QBs with limited samples are protected; no needs are manufactured.`.slice(0, 1024) });
  embed.addFields({ name: '90+ QB slots', value: plan.eliteQbs.map((p) => `${p.player}: ${p.currentOvr} OVR · ${p.games} games${p.protectedSmallSample ? ' · limited-sample protection' : ` · season index ${p.rankScore.toFixed(1)}`}`).join('\n') || 'No qualified elite QB slots; the target is 5–7, with no forced minimum.' });
  const parent = await client.channels.fetch(channelId);
  const id = record.capIndexMessageId;
  const prior = id ? await parent.messages.fetch(id).catch((error) => { if (error.code === 10008) return null; throw error; }) : null;
  const csv = [['Player','Position','Team','Current OVR','Target OVR','Games','Attempts','Season score','Reason'], ...plan.adjustments.map((p) => [p.player,p.position,p.team,p.currentOvr,p.targetOvr,p.games,p.attempts,p.rankScore,p.reasons.join(' ')])]
    .map((row) => row.map((value) => `"${(typeof value === 'string' && /^[=+@\-\t\r]/.test(value) ? "'" + value : String(value ?? '')).replaceAll('"','""')}"`).join(',')).join('\r\n');
  const payload = { embeds: [embed], files: [{ attachment: Buffer.from(csv), name: 'roster-ovr-targets.csv' }], attachments: [], allowedMentions: { parse: [] } };
  const posted = prior ? await prior.edit(payload) : await parent.send(payload);
  record.capIndexMessageId = posted.id;
  await save();
  await fs.writeFile(path.join(root, `${String(snapshot.syncId).replace(/[^a-zA-Z0-9_-]/g,'_')}.json`), JSON.stringify(plan, null, 2));
  return { posted: true, adjustments: pending, currentCounts: before, projectedCounts: after, reportUrl: `https://discord.com/channels/${guildId}/${channelId}/${posted.id}` };
}
