import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
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

function buildRolesProgressEmbed({ step, details = [], tier = null, tradeEnabled = null }) {
  return new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle('Setup Roles')
    .setDescription(`Current step: **${step}**`)
    .addFields(
      ...(tier ? [{ name: 'Package', value: String(tier), inline: true }] : []),
      ...(tradeEnabled === null ? [] : [{ name: 'Trade Roles', value: tradeEnabled ? 'included' : 'not included', inline: true }]),
      {
        name: 'Live Progress',
        value: details.filter(Boolean).map((detail) => `• ${detail}`).join('\n') || 'Working...',
      },
    );
}

export async function execute(interaction) {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const updateProgress = async (step, details = [], meta = {}) => {
    await interaction.editReply({
      content: '',
      embeds: [buildRolesProgressEmbed({ step, details, ...meta })],
    });
  };

  const cfg = loadGuildMaddenConfig(guild.id);
  if (!cfg) {
    await interaction.editReply({ content: 'No setup config found yet. Run `/setup-channels` first.' });
    return;
  }

  const tradeEnabled = Array.isArray(cfg.packsEnabled) && cfg.packsEnabled.includes('trades_basic');
  const tier = String(cfg?.license?.tier || 'free');
  await updateProgress('checking server role setup', [
    'Starting the role-only pass for this server',
    'Creating or verifying staff roles first',
    tradeEnabled ? 'Trade roles are included in this package.' : 'Trade roles are not included in this package.',
  ], { tier, tradeEnabled });
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
    if (spec.key === 'Ghost Legacy') {
      cfg.compat.maddenRoleMap['LEAGUEbuddy Coaches'] = role.id;
      cfg.compat.maddenRoleMap['LB Coaches'] = role.id;
    }
  }

  const leagueId = getLeagueForGuild(guild.id);
  let coachSummaryText = 'Coach roles skipped (no synced league snapshot).';
  const canContinueToCoachRoles = staffSummary.failed.length === 0;
  if (leagueId && canContinueToCoachRoles) {
    await updateProgress('creating coach roles', [
      `Staff roles ready: created ${staffSummary.created.length}, existing ${staffSummary.existing.length}, verified ${staffSummary.verified.length}`,
      'Loading the synced league snapshot',
      'Creating the coach role set for all teams',
    ], { tier, tradeEnabled });
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

  await updateProgress('refreshing channel permissions', [
    'Updating channel permissions with the new role map',
    'Applying the LEAGUEbuddy visibility rules across all setup channels',
  ], { tier, tradeEnabled });

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
    content: '',
    embeds: [
      new EmbedBuilder()
        .setColor(staffSummary.failed.length ? 0xf39c12 : 0x57f287)
        .setTitle('Setup Roles Complete')
        .setDescription(`Package: **${tier}**`)
        .addFields(
          {
            name: 'What this command did',
            value: [
              '• Created or verified staff roles',
              tradeEnabled ? '• Created or verified trade roles' : '• Skipped trade roles because they are not included in this plan',
              '• Refreshed channel permissions after the role pass',
            ].join('\n'),
          },
          {
            name: 'Staff roles',
            value: [
              `Created: ${staffSummary.created.length}`,
              `Existing: ${staffSummary.existing.length}`,
              `Verified: ${staffSummary.verified.length}`,
              `Failed: ${staffSummary.failed.length}`,
              ...(staffSummary.failed.length ? [`Failures: ${staffSummary.failed.map((item) => item.name).join(', ')}`] : []),
            ].join('\n').slice(0, 1024),
            inline: false,
          },
          {
            name: 'Coach roles',
            value: coachSummaryText.slice(0, 1024),
            inline: false,
          },
          {
            name: 'Next',
            value: staffSummary.failed.length
              ? 'Some Discord roles still failed to create. Fix the server role issue, then rerun `/setup-roles`.'
              : 'Roles are ready. Next run `/syncsetupstatus`, then `/server-check`.',
          },
        ),
    ],
  });
}

export default { data, execute, deferOnDispatch };
