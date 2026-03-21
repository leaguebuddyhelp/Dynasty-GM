import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { coachCommandDescription, coachPanelIntro, coachVoiceFooter, coachVoiceTitle } from '../../shared/madden_coach_voice.js';

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
  const fallbackNames = ['Ghost Legacy Commish', 'Ghost Legacy Co-Commish'];
  return member?.roles?.cache?.some(r => fallbackNames.includes(r.name)) ?? false;
}

async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const staffView = isStaff(interaction.member);

  const staffEmbed = new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle(coachVoiceTitle('staffCommands', 'Admin Commands'))
    .setDescription('Use this as the quick-start board for a new LEAGUEbuddy server.')
    .addFields(
      {
        name: 'Free Quick Start',
        value: [
          '1. Invite LEAGUEbuddy',
          '2. `/connectleague`',
          '3. Finish the dashboard flow',
          '4. `/setup`',
          '5. Do the one next step it shows',
          '6. Run `/setup` again until it says complete',
          '7. `/create-threads`',
          '8. `/weeklyupdate`',
        ].join('\n'),
      },
      {
        name: 'Staffing',
        value: [
          '`/member assign`',
          '`/member remove`',
          '`/member onboard` for Standard/Premium',
        ].join('\n'),
      },
      {
        name: 'After Setup',
        value: [
          '1. Assign coaches to team roles',
          '2. Tell coaches to run `/help`',
          '3. Run `/create-threads`',
          '4. After games finish, run `/weeklyupdate`',
          '5. Repeat that thread/update loop every week',
        ].join('\n'),
      },
      {
        name: 'Billing Support',
        value: [
          '`/pricing`',
          '`/claim-plan`',
          '`/viewbilling`',
          '`/deactivateplan`',
          '`/attachpaymentref`',
        ].join('\n'),
      },
    )
    .setFooter({ text: coachVoiceFooter('staffOnly', 'Advanced maintenance and test commands are intentionally hidden in beta.') });

  const coachEmbed = new EmbedBuilder()
    .setColor(0x1e90ff)
    .setTitle(coachVoiceTitle('coachCommands', 'Coach Commands'))
    .setDescription('This menu shows the customer commands that matter for the current league tier.')
    .addFields(
      {
        name: 'Start Here',
        value: [
          '`/help`, `/plan`, `/pricing`',
          '`/setup` for the next server step',
        ].join('\n'),
      },
      {
        name: 'Free Commands',
        value: [
          '`/schedule`, `/roster`, `/playersearch`, `/tradevalue`, `/pickvalue`, `/streamlink`',
        ].join('\n'),
      },
      {
        name: 'Standard Adds',
        value: [
          '`/tradeblock`',
          '`/scout`, `/myscouts`, `/bigboard`, `/draftprimer`, `/mockdraft`',
        ].join('\n'),
      },
      {
        name: 'Premium Adds',
        value: [
          '`/franchisehub`',
          '`/gamestrategy`',
        ].join('\n'),
      },
    )
    .setFooter({ text: coachVoiceFooter('coachOnly', 'Only the customer-facing beta commands are shown here.') });

  await interaction.editReply({ embeds: [staffView ? staffEmbed : coachEmbed] });
}

export default { data, execute };
