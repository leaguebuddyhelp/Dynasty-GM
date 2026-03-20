import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionsBitField,
} from 'discord.js';

import { PLANS } from './guild_store.js';

const PLAN_COPY = {
  [PLANS.free]: {
    title: 'Free',
    summary: 'Good for getting a league connected and running the base Madden workflow.',
    unlocks: [
      'Core league utilities',
      'Game threads and schedule helpers',
      'Light stats and pinned content',
    ],
  },
  [PLANS.standard]: {
    title: 'Standard',
    summary: 'Adds the draft and scouting layer once the league setup is complete.',
    unlocks: [
      'Everything in Free',
      'Trade center + committee workflow',
      'Scouting and draft tools',
      'Light staff ops features',
    ],
  },
  [PLANS.premium]: {
    title: 'Premium',
    summary: 'Unlocks the full Madden v2 product surface for leagues that want the complete stack.',
    unlocks: [
      'Everything in Standard',
      'Recognition system',
      'Sportsbook',
      'Full staff ops features',
    ],
  },
};

function asPlan(plan) {
  return plan === PLANS.premium || plan === PLANS.standard ? plan : PLANS.free;
}

function planEnvKey(plan) {
  return plan === PLANS.premium ? 'LB_UPGRADE_URL_PREMIUM' : 'LB_UPGRADE_URL_STANDARD';
}

function maybeUrl(value) {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed : null;
}

export function inviteLinkFor() {
  const direct = maybeUrl(process.env.LB_BOT_INVITE_URL);
  if (direct) return direct;
  const clientId = maybeUrl(process.env.CLIENT_ID);
  if (!clientId) return null;
  const permissions = new PermissionsBitField([
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.ManageChannels,
    PermissionsBitField.Flags.ManageRoles,
    PermissionsBitField.Flags.ManageThreads,
    PermissionsBitField.Flags.MentionEveryone,
    PermissionsBitField.Flags.EmbedLinks,
    PermissionsBitField.Flags.AttachFiles,
    PermissionsBitField.Flags.ReadMessageHistory,
    PermissionsBitField.Flags.UseExternalEmojis,
    PermissionsBitField.Flags.AddReactions,
  ]).bitfield.toString();
  const scopes = encodeURIComponent('bot applications.commands');
  return `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&scope=${scopes}&permissions=${permissions}`;
}

function upgradePlansFor(currentPlan = PLANS.free) {
  const plan = asPlan(currentPlan);
  if (plan === PLANS.free) return [PLANS.standard, PLANS.premium];
  if (plan === PLANS.standard) return [PLANS.premium];
  return [];
}

export function pricingLinkFor(plan) {
  const direct = maybeUrl(process.env?.[planEnvKey(plan)]);
  if (direct) return direct;
  return maybeUrl(process.env?.LB_UPGRADE_URL);
}

export function buildPricingEmbeds({ currentPlan = null } = {}) {
  const activePlan = currentPlan ? asPlan(currentPlan) : null;
  const pricing = new EmbedBuilder()
    .setTitle('LEAGUEbuddy Madden Pricing')
    .setColor(0x5865f2)
    .setDescription('Use `/start-here` first in your server for the full setup path. Use this screen for plan details and checkout links.')
    .addFields(
      ...[PLANS.free, PLANS.standard, PLANS.premium].map((plan) => {
        const entry = PLAN_COPY[plan];
        const header = activePlan === plan ? `${entry.title} (current)` : entry.title;
        return {
          name: header,
          value: [
            entry.summary,
            '',
            ...entry.unlocks.map((line) => `• ${line}`),
            '',
            pricingLinkFor(plan) && plan !== PLANS.free
              ? 'Payment link available below.'
              : plan === PLANS.free
                ? 'No payment needed.'
                : 'Payment link not configured yet.',
          ].join('\n'),
          inline: false,
        };
      }),
    );

  return [pricing];
}

export function buildPostPaymentEmbed() {
  return new EmbedBuilder()
    .setTitle('After You Buy')
    .setColor(0x57f287)
    .setDescription([
      '1. Invite LEAGUEbuddy to the server you want to activate.',
      '2. Run `/start-here` in that server.',
      '3. If you are using the manual claim flow, run `/claim-plan` and paste the payment reference from your Stripe receipt email.',
      '4. Run `/plan` to confirm access.',
      '5. Continue the setup flow from `/start-here`.',
    ].join('\n'));
}

export function buildPricingLinkRows({ currentPlan = null } = {}) {
  const targets = currentPlan ? upgradePlansFor(currentPlan) : [PLANS.standard, PLANS.premium];
  const buttons = targets
    .map((plan) => {
      const url = pricingLinkFor(plan);
      if (!url) return null;
      return new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(plan === PLANS.standard ? 'Buy Standard' : 'Buy Premium')
        .setURL(url);
    })
    .filter(Boolean);

  const inviteUrl = inviteLinkFor();
  if (inviteUrl) {
    buttons.push(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Invite LEAGUEbuddy')
        .setURL(inviteUrl),
    );
  }

  if (!buttons.length) return [];
  return [new ActionRowBuilder().addComponents(buttons.slice(0, 5))];
}

export function buildPlanUpgradeButtons({ currentPlan = null, canManage = false } = {}) {
  if (!canManage) return [];
  const targets = upgradePlansFor(currentPlan || PLANS.free);
  const buttons = targets.map((plan) =>
    new ButtonBuilder()
      .setCustomId(`lb_plan_upgrade|${plan}`)
      .setLabel(plan === PLANS.standard ? 'Upgrade to Standard' : 'Upgrade to Premium')
      .setStyle(plan === PLANS.standard ? ButtonStyle.Primary : ButtonStyle.Success),
  );
  if (!buttons.length) return [];
  return [new ActionRowBuilder().addComponents(buttons.slice(0, 5))];
}

export function buildUpgradeReply({ targetPlan, guildId = null } = {}) {
  const plan = asPlan(targetPlan);
  const targetUrl = pricingLinkFor(plan);
  const linkRows = targetUrl
    ? [
        new ActionRowBuilder().addComponents(
          ...[
            new ButtonBuilder()
              .setStyle(ButtonStyle.Link)
              .setLabel(plan === PLANS.standard ? 'Open Standard Checkout' : 'Open Premium Checkout')
              .setURL(targetUrl),
            inviteLinkFor()
              ? new ButtonBuilder()
                  .setStyle(ButtonStyle.Link)
                  .setLabel('Invite LEAGUEbuddy')
                  .setURL(inviteLinkFor())
              : null,
          ].filter(Boolean),
        ),
      ]
    : [];
  const embeds = [
    new EmbedBuilder()
      .setTitle(`Upgrade to ${PLAN_COPY[plan].title}`)
      .setColor(plan === PLANS.premium ? 0xf1c40f : 0x5865f2)
      .setDescription([
        PLAN_COPY[plan].summary,
        '',
        ...PLAN_COPY[plan].unlocks.map((line) => `• ${line}`),
      ].join('\n')),
    buildPostPaymentEmbed(),
  ];

  const missingLink = !targetUrl;
  const content = missingLink
    ? [
        `No payment link is configured for **${plan}** yet.`,
        'Set one of these env vars to enable one-click upgrades:',
        `- \`${planEnvKey(plan)}\``,
        '- `LB_UPGRADE_URL`',
      ].join('\n')
    : null;

  return {
    content,
    embeds,
    components: missingLink ? [] : linkRows,
  };
}

export function buildActivationFollowup({ guildId, plan }) {
  return [
    '**Customer follow-up**',
    `Plan **${plan}** is now active for guild **${guildId}**.`,
    'Next steps for the commissioner:',
    '• Run `/start-here`.',
    '• Run `/plan` to confirm access.',
    '• Finish the setup flow before using paid features.',
  ].join('\n');
}

export function buildClaimInstructions() {
  return [
    'How to claim access:',
    '1. Buy from `/pricing` if you need a paid plan.',
    '2. Invite LEAGUEbuddy to your server.',
    '3. Run `/claim-plan`.',
    '4. Paste either your one-time claim code or the Stripe payment reference from your receipt email.',
    '5. Run `/start-here`.',
  ].join('\n');
}

export default {
  pricingLinkFor,
  buildPricingEmbeds,
  buildPostPaymentEmbed,
  buildPricingLinkRows,
  buildPlanUpgradeButtons,
  buildUpgradeReply,
  buildActivationFollowup,
  buildClaimInstructions,
};
