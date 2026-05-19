import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { coachCommandDescription, coachPanelIntro, coachVoiceFooter, coachVoiceTitle } from '../../shared/madden_coach_voice.js';
import { getLeagueBuddyLogoEmoji } from '../../shared/application_emojis.js';

const ROLE_MAP_PATH = path.join(process.cwd(), 'data', 'madden', 'madden_role_ids.json');

const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription(coachCommandDescription('help'));

function isStaff(member) {
  try {
    const map = JSON.parse(fs.readFileSync(ROLE_MAP_PATH, 'utf8'));
    const commishIds = Object.entries(map || {})
      .filter(([key]) => key.toLowerCase().includes('commish'))
      .map(([, id]) => id);
    if (commishIds.length && member?.roles?.cache) {
      return member.roles.cache.some(r => commishIds.includes(r.id));
    }
  } catch {
    // ignore and fall back to name check
  }
  const fallbackNames = ['LB Commish', 'LB Co-Commish'];
  return member?.roles?.cache?.some(r => fallbackNames.includes(r.name)) ?? false;
}

async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const staffView = isStaff(interaction.member);
  const logo = getLeagueBuddyLogoEmoji();

  const staffEmbed = new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle(`${logo ? `${logo} ` : ''}${coachVoiceTitle('staffCommands', 'Admin Commands')}`)
    .setDescription('Current staff command list for this server.')
    .addFields(
      {
        name: 'Setup',
        value: [
          '`/setup`',
          '`/sync`',
          '`/resetleague`',
          '`/disconnectleague`',
          '`/setup-reset`',
        ].join('\n'),
      },
      {
        name: 'Members',
        value: [
          '`/member onboard`',
          '`/member assign`',
          '`/member remove`',
          '`/promo`',
        ].join('\n'),
      },
      {
        name: 'Weekly Ops',
        value: [
          '`/create-threads`',
          '`/delete-threads`',
          '`/weeklyupdate`',
        ].join('\n'),
      },
      {
        name: 'Plans',
        value: [
          '`/plan`',
          '`/viewplan`',
          '`/setplan`',
          '`/activateplan`',
          '`/deactivateplan`',
        ].join('\n'),
      },
      {
        name: 'Coach Tools Staff May Use',
        value: [
          '`/schedule`, `/roster`, `/playersearch`',
          '`/tradeblock`, `/streamlink`',
          '`/draftclass`, `/scout`, `/myscouts`, `/bigboard`, `/draftprimer`, `/mockdraft`, `/recruiting`',
          '`/franchisehub`',
          '`/gamestrategy`',
        ].join('\n'),
      },
    )
    .setFooter({ text: coachVoiceFooter('staffOnly', 'Buying is disabled during private testing; use manual plan commands.') });

  const coachEmbed = new EmbedBuilder()
    .setColor(0x1e90ff)
    .setTitle(`${logo ? `${logo} ` : ''}${coachVoiceTitle('coachCommands', 'Coach Commands')}`)
    .setDescription('Common commands for league members.')
    .addFields(
      {
        name: 'Basics',
        value: [
          '`/help`',
          '`/plan`',
          '`/schedule`, `/roster`, `/playersearch`',
        ].join('\n'),
      },
      {
        name: 'League',
        value: [
          '`/tradeblock`',
          '`/streamlink`',
        ].join('\n'),
      },
      {
        name: 'Draft',
        value: [
          '`/draftclass`, `/scout`, `/myscouts`, `/bigboard`, `/draftprimer`, `/mockdraft`, `/recruiting`',
        ].join('\n'),
      },
      {
        name: 'Premium',
        value: [
          '`/franchisehub`',
          '`/gamestrategy`',
        ].join('\n'),
      },
    )
    .setFooter({ text: coachVoiceFooter('coachOnly', 'Admins use /setup for server setup.') });

  await interaction.editReply({ embeds: [staffView ? staffEmbed : coachEmbed] });
}

export default { data, execute };
