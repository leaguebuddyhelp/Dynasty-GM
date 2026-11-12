import { getMaddenDataFilePath } from '../leaguebuddy/paths.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import { resolveLeagueIdWithConfig, loadLeagueSnapshot } from '../madden/madden_data.js';
import { getMaddenSeasonKey, loadMaddenChannelMap } from '../shared/madden_metadata.js';
import { getFullTeamName } from '../shared/madden_team_names.js';
import { getTeamEmojiByName } from '../shared/madden_visuals.js';
import { stablePlayerKey } from '../madden/player_identity.js';
import { isSoloModeEnabled } from '../leaguebuddy/solo_mode.js';

function loadJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}


function normalize(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findPlayer(snapshot, name) {
  if (!name) return null;
  const target = normalize(name);
  const rosters = snapshot?.rosters?.teams || {};
  for (const roster of Object.values(rosters)) {
    const list = roster?.rosterInfoList || [];
    for (const p of list) {
      const full = `${p.firstName || ''} ${p.lastName || ''}`.trim();
      const norm = normalize(full);
      if (norm === target || norm.includes(target) || target.includes(norm)) {
        return p;
      }
    }
  }
  return null;
}

function findVerifiedPlayer(snapshot, name) {
  const target = normalize(name);
  if (!target) return null;
  const matches = [];
  for (const roster of Object.values(snapshot?.rosters?.teams || {})) {
    for (const player of roster?.rosterInfoList || []) {
      if (normalize(`${player.firstName || ''} ${player.lastName || ''}`) === target) matches.push(player);
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function findTeam(snapshot, input) {
  if (!input) return null;
  const target = normalize(input);
  const teams = snapshot?.teams?.leagueTeamInfoList || [];
  return teams.find(t => {
    const names = [
      t.displayName, t.nickName, t.cityName,
      getFullTeamName(t, '')
    ];
    return names.some(n => {
      const norm = normalize(n);
      return norm === target || norm.includes(target) || target.includes(norm);
    });
  }) || null;
}

function teamEmoji(team) {
  if (!team) return '';
  return getTeamEmojiByName(getFullTeamName(team, ''));
}


function titleCase(str) {
  return (str || '')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export const customId = /^madden_awards_button$/;
export const customId_modal = /^madden_awards_modal$/;

export async function execute(interaction) {
  if (interaction.customId !== 'madden_awards_button') return;
  const leagueId = resolveLeagueIdWithConfig(interaction.guildId);
  if (!leagueId) {
    await interaction.reply({ content: 'No league is connected yet. Run `/setup` and press Open Setup Dashboard.', ephemeral: true });
    return;
  }
  const modal = new ModalBuilder()
    .setCustomId('madden_awards_modal')
    .setTitle('Enter Madden Yearly Awards')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('mvp').setLabel('MVP (player)').setStyle(TextInputStyle.Short).setRequired(true),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('coy').setLabel('Coach of the Year (team)').setStyle(TextInputStyle.Short).setRequired(true),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('opdpoy').setLabel('OPOY / DPOY (offense | defense)').setStyle(TextInputStyle.Short).setRequired(true),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('rookies').setLabel('OROY / DROY (offense | defense)').setStyle(TextInputStyle.Short).setRequired(true),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('sbcombo').setLabel('Super Bowl (champ team | MVP player)').setStyle(TextInputStyle.Short).setRequired(true),
      ),
    );
  await interaction.showModal(modal);
}

export async function execute_modal(interaction) {
  if (!interaction.isModalSubmit() || interaction.customId !== 'madden_awards_modal') return;
  await interaction.deferReply({ ephemeral: true });
  const leagueId = resolveLeagueIdWithConfig(interaction.guildId);
  if (!leagueId) {
    await interaction.editReply({ content: 'No league is connected yet. Run `/setup` and press Open Setup Dashboard.' });
    return;
  }
  const snapshot = loadLeagueSnapshot(leagueId);
  const channelMap = loadMaddenChannelMap(interaction.guildId);
  const awardsChannelId = channelMap.Awards;
  // Fallback season year: use config.json if snapshot lacks seasonYear
  let seasonYear =
    snapshot?.info?.careerHubInfo?.seasonInfo?.seasonYear ||
    snapshot?.info?.seasonInfo?.seasonYear ||
    snapshot?.seasonYear ||
    null;
  if (!seasonYear) {
    try {
      const config = JSON.parse(fs.readFileSync(getMaddenDataFilePath('config.json'), 'utf8'));
      seasonYear = config?.seasonYear || config?.season || null;
    } catch { /* ignore */ }
  }
  if (!seasonYear || Number(seasonYear) === 0) {
    const current = new Date().getFullYear();
    seasonYear = current;
  }

  const fields = {
    mvp: 'MVP',
    coy: 'Coach of the Year',
    opdpoy: 'OPOY / DPOY (offense | defense)',
    rookies: 'OROY / DROY (offense | defense)',
    sbcombo: 'Super Bowl (champ team | MVP player)',
  };
  const inputs = {};
  Object.keys(fields).forEach(k => inputs[k] = interaction.fields.getTextInputValue(k));

  const splitPair = (text) => {
    const parts = (text || '').split(/[,|/]+/).map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) return [parts[0], parts[1]];
    if (parts.length === 1) return [parts[0], parts[0]];
    return ['', ''];
  };

  const posts = [];
  const progressionAwards = [];
  const seasonKey = getMaddenSeasonKey(snapshot);
  const addPlayerAward = (key, label, type = 'major') => {
    const player = findPlayer(snapshot, inputs[key]);
    const verifiedPlayer = findVerifiedPlayer(snapshot, inputs[key]);
    const playerKey = verifiedPlayer ? stablePlayerKey(verifiedPlayer) : null;
    if (playerKey) {
      progressionAwards.push({
        awardId: `${seasonKey}:${key}`,
        name: label,
        type,
        playerKey,
      });
    }
    const teamId = player?.teamId;
    const team = (snapshot?.teams?.leagueTeamInfoList || []).find(t => t.teamId === teamId);
    const emoji = teamEmoji(team);
    const teamName = team ? getFullTeamName(team, 'Unknown Team') : 'Unknown Team';
    const playerName = player ? `${player.firstName || ''} ${player.lastName || ''}`.trim() : titleCase(inputs[key]);
    const title = `🏆 ${label} — Season ${seasonYear}`;
    const desc = `${emoji ? emoji + ' ' : ''}${playerName} — ${teamName}`;
    const embed = new EmbedBuilder().setTitle(title).setDescription(desc).setColor(0xFFD700);
    posts.push({ embed, content: null });
  };
  const addTeamAward = (key, label) => {
    const team = findTeam(snapshot, inputs[key]);
    const teamName = team ? getFullTeamName(team, titleCase(inputs[key])) : titleCase(inputs[key]);
    const emoji = teamEmoji(team);
    const title = `🏆 ${label} — Season ${seasonYear}`;
    const desc = `${emoji ? emoji + ' ' : ''}${teamName}`;
    const embed = new EmbedBuilder().setTitle(title).setDescription(desc).setColor(0xFFD700);
    posts.push({ embed, content: null });
  };

  try {
    addPlayerAward('mvp', fields.mvp, 'mvp');
    addTeamAward('coy', fields.coy);
    const [opoyVal, dpoyVal] = splitPair(inputs.opdpoy);
    const [oroyVal, droyVal] = splitPair(inputs.rookies);
    const [sbChampVal, sbMvpVal] = splitPair(inputs.sbcombo);

    inputs.opoy = opoyVal;
    inputs.dpoy = dpoyVal;
    inputs.oroy = oroyVal;
    inputs.droy = droyVal;
    inputs.sbchamp = sbChampVal;
    inputs.sbmvp = sbMvpVal;

    addPlayerAward('opoy', 'Offensive Player of the Year');
    addPlayerAward('dpoy', 'Defensive Player of the Year');
    addPlayerAward('oroy', 'Offensive Rookie of the Year');
    addPlayerAward('droy', 'Defensive Rookie of the Year');
    addTeamAward('sbchamp', 'Super Bowl Champion');
    addPlayerAward('sbmvp', 'Super Bowl MVP');
  } catch (e) {
    console.error('[madden_awards_modal] compose failed:', e);
  }

  try {
    const channel = await interaction.client.channels.fetch(awardsChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      await interaction.editReply({ content: 'Awards channel not found.' });
      return;
    }
    for (const p of posts) {
      await channel.send({ content: p.content ?? null, embeds: [p.embed] });
    }
    if (progressionAwards.length) {
      try {
        const { recordSeasonAwards, refreshProgressionForSeasonAwardChange } = await import('../madden/progression.js');
        await recordSeasonAwards({ leagueId, seasonKey, awards: progressionAwards });
        if (isSoloModeEnabled()) {
          try {
            await refreshProgressionForSeasonAwardChange({
              client: interaction.client,
              guildId: interaction.guildId,
              snapshot,
            });
          } catch (error) {
            console.error('[madden_awards] saved annual awards but failed to refresh offseason progression:', error);
            await interaction.editReply({ content: 'Yearly awards were posted and saved, but offseason recommendations could not be refreshed. Check the server logs.' });
            return;
          }
        }
      } catch (error) {
        console.error('[madden_awards] posted annual awards but failed to save progression records:', error);
        await interaction.editReply({ content: 'Yearly awards were posted, but progression award history could not be saved. Check the server logs.' });
        return;
      }
    }
    await interaction.editReply({ content: 'Yearly awards posted.' });
  } catch (err) {
    console.error('[madden_awards] Failed:', err);
    await interaction.editReply({ content: 'Failed to post awards. Check logs.' });
  }
}

export default { customId, execute, customId_modal, execute_modal };
