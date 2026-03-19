import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';

import { PLANS } from './guild_store.js';

const PLAN_COPY = {
  [PLANS.free]: {
    title: 'Free',
    summary: 'Good for getting a league connected and running the base Madden workflow.',
    unlocks: [
      'Core league utilities',
      'Game threads and schedule helpers',
      'Basic trade workflows',
      'Light stats and pinned content',
    ],
  },
  [PLANS.standard]: {
    title: 'Standard',
    summary: 'Adds the draft and scouting layer once the league setup is complete.',
    unlocks: [
      'Everything in Free',
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
    .setDescription('Choose the tier that matches the league tools you want to unlock. Final activation is still handled manually after payment is confirmed.')
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

export function buildPostPaymentEmbed({ guildId = null } = {}) {
  return new EmbedBuilder()
    .setTitle('After You Pay')
    .setColor(0x57f287)
    .setDescription([
      '1. Pay using the Stripe payment link.',
      `2. Send your server id to the admin handling activation${guildId ? `: \`${guildId}\`` : '.'}`,
      '3. Wait for the plan to be activated manually.',
      '4. Run `/plan` to confirm access.',
      '5. Run `/madden-setup-check` if setup still needs work.',
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
          new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel(plan === PLANS.standard ? 'Open Standard Checkout' : 'Open Premium Checkout')
            .setURL(targetUrl),
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
    buildPostPaymentEmbed({ guildId }),
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
    '• Run `/plan` to confirm access.',
    '• Run `/madden-setup-check` to verify setup state.',
    '• If setup is incomplete, finish the missing channel/role mapping before using paid features.',
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
};
