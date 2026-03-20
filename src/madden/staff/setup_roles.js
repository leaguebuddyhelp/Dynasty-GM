import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { loadGuildMaddenConfig, saveGuildMaddenConfig } from '../../shared/madden_guild_config.js';
import { getLeagueForGuild } from '../madden_config.js';
import { loadLeagueSnapshot } from '../madden_data.js';
import { buildCoachRoleSpecs, DEFAULT_ROLE_SPECS, TRADE_ROLE_SPECS, syncRoleSpecs } from './setup_role_utils.js';
import { applyOverwrites, buildSetupOverwrites } from './madden-setup.js';

export const data = new SlashCommandBuilder()
  .setName('setup-roles')
  .setDescription('Admin-only: create or retry only the missing setup roles for this server.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export const deferOnDispatch = { flags: 64 };

export async function execute(interaction) {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const updateProgress = async (lines) => {
    await interaction.editReply({ content: lines.join('\n') });
  };

  const cfg = loadGuildMaddenConfig(guild.id);
  if (!cfg) {
    await interaction.editReply({ content: 'No setup config found yet. Run `/setup-channels` first.' });
    return;
  }

  const tradeEnabled = Array.isArray(cfg.packsEnabled) && cfg.packsEnabled.includes('trades_basic');
  const tier = String(cfg?.license?.tier || 'free');
  await updateProgress([
    '**Setup Roles**',
    'Trying the role-only pass for this server.',
    `Current package: ${tier}`,
    tradeEnabled ? 'Trade roles are included in this package.' : 'Trade roles are not included in this package.',
  ]);
  const staffSpecs = [...DEFAULT_ROLE_SPECS, ...(tradeEnabled ? TRADE_ROLE_SPECS : [])];
  const staffSummary = await syncRoleSpecs(guild, staffSpecs, { logger: console, retries: 0 });

  for (const spec of staffSpecs) {
    const role = guild.roles.cache.find((item) => item.name === spec.name) || null;
    if (!role) continue;
    cfg.compat = cfg.compat || {};
    cfg.compat.maddenRoleMap = cfg.compat.maddenRoleMap || {};
    cfg.compat.maddenRoleMap[spec.key] = role.id;
    if (spec.key === 'Trade Committee') {
      cfg.compat.maddenRoleMap['Ghost Legacy Trade Committee'] = role.id;
      cfg.compat.maddenRoleMap['Madden Trade Committee'] = role.id;
      cfg.compat.maddenRoleMap['Madden Trade Committe'] = role.id;
      cfg.compat.maddenRoleMap['LB Trade Committee'] = role.id;
      cfg.compat.maddenRoleMap['LEAGUEbuddy Trade Committee'] = role.id;
    }
  }

  const leagueId = getLeagueForGuild(guild.id);
  let coachSummaryText = 'Coach roles skipped (no synced league snapshot).';
  const canContinueToCoachRoles = staffSummary.failed.length === 0;
  if (leagueId && canContinueToCoachRoles) {
    await updateProgress([
      '**Setup Roles**',
      'Staff role pass finished.',
      'Trying coach roles from the synced league snapshot.',
    ]);
    try {
      const snapshot = loadLeagueSnapshot(leagueId);
      const coachSpecs = buildCoachRoleSpecs(snapshot);
      const coachRoleSpecs = coachSpecs.map((spec) => ({
        key: spec.roleName,
        name: spec.roleName,
        color: 0x99AAB5,
        hoist: false,
      }));
      const coachSummary = await syncRoleSpecs(guild, coachRoleSpecs, { logger: console, retries: 0 });
      for (const spec of coachSpecs) {
        const role = guild.roles.cache.find((item) => item.name === spec.roleName) || null;
        if (!role) continue;
        for (const alias of spec.aliases) {
          cfg.compat.maddenRoleMap[alias] = role.id;
        }
      }
      coachSummaryText = `Coach roles: created ${coachSummary.created.length}, existing ${coachSummary.existing.length}, verified ${coachSummary.verified.length}, failed ${coachSummary.failed.length}`;
      if (coachSummary.failed.length) {
        coachSummaryText += `\nFailures: ${coachSummary.failed.map((item) => item.name).join(', ')}`;
      }
    } catch {
      coachSummaryText = 'Coach roles skipped (snapshot missing or unreadable).';
    }
  } else if (!canContinueToCoachRoles) {
    coachSummaryText = 'Coach roles skipped because the staff role pass still has failures.';
  }

  saveGuildMaddenConfig(guild.id, cfg);

  const overwritePlan = buildSetupOverwrites(guild, cfg.compat?.maddenRoleMap || {});
  const channelMap = cfg.compat?.maddenChannelMap || {};
  const categoryId = channelMap['LB Madden'];
  if (categoryId) {
    const category = guild.channels.cache.get(categoryId) || await guild.channels.fetch(categoryId).catch(() => null);
    await applyOverwrites(category, overwritePlan.category);
  }
  for (const [key, channelId] of Object.entries(channelMap)) {
    const channel = channelId ? guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null) : null;
    if (!channel) continue;
    await applyOverwrites(channel, overwritePlan.channels[key] || []);
  }

  await interaction.editReply({
    content: [
      '**Setup Roles Complete**',
      `Package: **${tier}**`,
      '',
      '**What this command did**',
      '- Created or verified staff roles',
      tradeEnabled ? '- Created or verified trade roles' : '- Skipped trade roles because they are not included in this plan',
      '- Refreshed channel permissions after the role pass',
      '',
      `Staff roles: created ${staffSummary.created.length}, existing ${staffSummary.existing.length}, verified ${staffSummary.verified.length}, failed ${staffSummary.failed.length}`,
      ...(staffSummary.failed.length ? [`Failures: ${staffSummary.failed.map((item) => item.name).join(', ')}`] : []),
      '',
      coachSummaryText,
      '',
      'Channel permissions were refreshed after the role pass.',
      staffSummary.failed.length
        ? 'Next: fix the Discord role-create issue in this server, then rerun `/setup-roles`.'
        : 'Next: run `/syncsetupstatus`, then `/server-check`.',
    ].join('\n'),
  });
}

export default { data, execute, deferOnDispatch };
