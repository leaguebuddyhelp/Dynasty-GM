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
    .setDescription('Start with `/setup`. It shows the only next step.')
    .addFields(
      {
        name: 'Setup',
        value: [
          '`/setup`',
          '`/sync` if setup says league data is not ready',
          '`/disconnectleague` only when you need to start over',
        ].join('\n'),
      },
      {
        name: 'Weekly',
        value: [
          '`/member assign`',
          '`/member remove`',
          '`/create-threads`',
          '`/delete-threads`',
          '`/weeklyupdate`',
        ].join('\n'),
      },
      {
        name: 'Plans',
        value: [
          '`/pricing`',
          '`/plan`',
          '`/setup code:<claim-code>`',
        ].join('\n'),
      },
      {
        name: 'Premium Tools',
        value: [
          '`/franchisehub`',
          '`/gamestrategy`',
          '`/streamlink`',
        ].join('\n'),
      },
    )
    .setFooter({ text: coachVoiceFooter('staffOnly', 'Setup subcommands are handled by the /setup buttons.') });

  const coachEmbed = new EmbedBuilder()
    .setColor(0x1e90ff)
    .setTitle(`${logo ? `${logo} ` : ''}${coachVoiceTitle('coachCommands', 'Coach Commands')}`)
    .setDescription('Common commands for league members.')
    .addFields(
      {
        name: 'Start Here',
        value: [
          '`/help`',
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
