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
    .setDescription('Use this as the quick-start board for a LEAGUEbuddy server.')
    .addFields(
      {
        name: 'Setup Flow',
        value: [
          '1. `/connectleague`',
          '2. `/setup`',
          '3. Do the one next step it shows',
          '4. Rerun `/setup` until complete',
        ].join('\n'),
      },
      {
        name: 'Weekly Flow',
        value: [
          '`/member assign`',
          '`/member remove`',
          '`/create-threads`',
          '`/delete-threads`',
          '`/weeklyupdate`',
        ].join('\n'),
      },
      {
        name: 'Tier Adds',
        value: [
          'Standard: `/member onboard`, `/bigboard`, `/scout`, `/myscouts`, `/draftprimer`, `/mockdraft`, `/recruiting`, `/tradeblock`, `/streamlink`, Weekly Awards channel, Yearly Awards channel',
          'Premium: `/gamestrategy`, `/franchisehub`, Weekly Awards channel, Yearly Awards channel',
        ].join('\n'),
      },
      {
        name: 'Core Commands',
        value: [
          '`/pricing`',
          '`/setup`, `/connectleague`, `/disconnectleague`, `/league-status`, `/sync`',
          '`/setup-channels`, `/setup-pins`, `/setup-roles`, `/setup-reset`',
        ].join('\n'),
      },
    )
    .setFooter({ text: coachVoiceFooter('staffOnly', 'Advanced maintenance and test commands are intentionally hidden in beta.') });

  const coachEmbed = new EmbedBuilder()
    .setColor(0x1e90ff)
    .setTitle(`${logo ? `${logo} ` : ''}${coachVoiceTitle('coachCommands', 'Coach Commands')}`)
    .setDescription('This menu shows the commands coaches and commissioners should actually use.')
    .addFields(
      {
        name: 'Start Here',
        value: [
          '`/help`',
          '`/pricing`, `/claim-plan`',
          '`/schedule`, `/roster`, `/playersearch`',
        ].join('\n'),
      },
      {
        name: 'Free Commands',
        value: [
          '`/pricing`, `/claim-plan`, `/setup`, `/connectleague`, `/disconnectleague`, `/league-status`, `/sync`',
          '`/setup-channels`, `/setup-pins`, `/setup-roles`, `/setup-reset`',
          '`/member assign`, `/member remove`, `/create-threads`, `/delete-threads`, `/weeklyupdate`',
          '`/schedule`, `/roster`, `/playersearch`',
        ].join('\n'),
      },
      {
        name: 'Standard Adds',
        value: [
          '`/member onboard`',
          '`/tradeblock`',
          '`/streamlink`',
          '`/draftclass`, `/scout`, `/myscouts`, `/bigboard`, `/draftprimer`, `/mockdraft`, `/recruiting`',
          'Weekly Awards channel + Yearly Awards channel',
        ].join('\n'),
      },
      {
        name: 'Premium Adds',
        value: [
          '`/franchisehub`',
          '`/gamestrategy`',
          'Weekly Awards channel + Yearly Awards channel',
        ].join('\n'),
      },
    )
    .setFooter({ text: coachVoiceFooter('coachOnly', 'Only the customer-facing beta commands are shown here.') });

  await interaction.editReply({ embeds: [staffView ? staffEmbed : coachEmbed] });
}

export default { data, execute };
