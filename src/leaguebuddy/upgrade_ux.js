import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionsBitField,
} from 'discord.js';

import { PLANS } from './guild_store.js';
import { getLeagueBuddyLogoEmoji } from '../shared/application_emojis.js';

const PLAN_COPY = {
  [PLANS.free]: {
    title: 'Free',
    audience: 'Best for getting a league connected and running fast.',
    summary: 'Start here if you want the core LEAGUEbuddy setup and weekly workflow.',
    unlocks: [
      'Core league utilities',
      'Game threads and schedule helpers',
      'Light stats and pinned content',
    ],
  },
  [PLANS.standard]: {
    title: 'Standard',
    audience: 'Best for leagues that want trade, scouting, and draft tools.',
    summary: 'Adds the full draft, scouting, trade, and light staff-ops layer.',
    unlocks: [
      'Everything in Free',
      'Trade center + committee workflow',
      'Scouting and draft tools',
      'Weekly Awards channel + Yearly Awards channel',
      'Light staff ops features',
    ],
  },
  [PLANS.premium]: {
    title: 'Premium',
    audience: 'Best for leagues that want the full LEAGUEbuddy stack.',
    summary: 'Unlocks recognition, sportsbook, and the full Madden v2 staff stack.',
    unlocks: [
      'Everything in Standard',
      'Recognition system',
      'Sportsbook',
      'Weekly Awards channel + Yearly Awards channel',
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

function planAmountEnvKey(plan) {
  return plan === PLANS.premium ? 'LB_STRIPE_PREMIUM_AMOUNT_CENTS' : 'LB_STRIPE_STANDARD_AMOUNT_CENTS';
}

function maybeUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  if (/^(YOUR_|OFFICIAL_|REPLACE_ME|PASTE_)/i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function maybeClientId(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  if (/^(YOUR_|OFFICIAL_|REPLACE_ME|PASTE_)/i.test(trimmed)) return null;
  return trimmed;
}

function clientIdFromInviteUrl(value) {
  const direct = maybeUrl(value);
  if (!direct) return null;
  try {
    const parsed = new URL(direct);
    if (!/discord\.com$/i.test(parsed.hostname)) return null;
    return maybeClientId(parsed.searchParams.get('client_id'));
  } catch {
    return null;
  }
}

export function inviteLinkFor(clientIdOverride = null) {
  const clientId = maybeClientId(clientIdOverride)
    || maybeClientId(process.env.CLIENT_ID)
    || clientIdFromInviteUrl(process.env.LB_BOT_INVITE_URL);
  if (!clientId) return null;
  const permissions = new PermissionsBitField([
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.EmbedLinks,
    PermissionsBitField.Flags.AttachFiles,
    PermissionsBitField.Flags.ReadMessageHistory,
    PermissionsBitField.Flags.UseApplicationCommands,
    PermissionsBitField.Flags.ManageChannels,
    PermissionsBitField.Flags.ManageRoles,
    PermissionsBitField.Flags.ManageMessages,
    PermissionsBitField.Flags.PinMessages,
    PermissionsBitField.Flags.ManageThreads,
    PermissionsBitField.Flags.SendMessagesInThreads,
    PermissionsBitField.Flags.CreatePublicThreads,
    PermissionsBitField.Flags.CreatePrivateThreads,
    PermissionsBitField.Flags.AddReactions,
    PermissionsBitField.Flags.UseExternalEmojis,
    PermissionsBitField.Flags.MentionEveryone,
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

function formatUsd(cents) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

function planPriceLabel(plan) {
  if (plan === PLANS.free) return '$0';
  const amount = Number(process.env?.[planAmountEnvKey(plan)] || 0);
  return Number.isFinite(amount) && amount > 0 ? formatUsd(amount) : null;
}

function planHeading(plan, activePlan) {
  const title = PLAN_COPY[plan].title;
  const price = planPriceLabel(plan);
  const current = activePlan === plan ? ' • current' : '';
  return `${title}${price ? ` • ${price}/month` : ''}${current}`;
}

export function buildPricingEmbeds({ currentPlan = null } = {}) {
  const activePlan = currentPlan ? asPlan(currentPlan) : null;
  const logo = getLeagueBuddyLogoEmoji();
  const pricing = new EmbedBuilder()
    .setTitle(`${logo ? `${logo} ` : ''}LEAGUEbuddy Madden Pricing`)
    .setColor(0x5865f2)
    .setDescription([
      'Pick a monthly plan, then use the buy buttons below.',
      'After checkout: save the claim code, invite LEAGUEbuddy, then run `/setup code:<claim-code>`.',
    ].join('\n'))
    .addFields(
      ...[PLANS.free, PLANS.standard, PLANS.premium].map((plan) => {
        const entry = PLAN_COPY[plan];
        return {
          name: planHeading(plan, activePlan),
          value: [
            entry.audience,
            '',
            ...entry.unlocks.map((line) => `• ${line}`),
            '',
            pricingLinkFor(plan) && plan !== PLANS.free
              ? 'Payment link available below.'
              : plan === PLANS.free
                ? 'No payment needed.'
                : 'Checkout link not configured yet.',
          ].join('\n'),
          inline: false,
        };
      }),
    );

  const nextStep = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`${logo ? `${logo} ` : ''}After You Buy`)
    .setDescription([
      '1. Finish checkout.',
      '2. Save the claim code.',
      '3. Invite LEAGUEbuddy to the server you want to activate.',
      '4. Run `/setup code:<claim-code>` there.',
      '5. Press the button `/setup` shows.',
    ].join('\n'));

  return [pricing, nextStep];
}

export function buildPostPaymentEmbed() {
  const logo = getLeagueBuddyLogoEmoji();
  return new EmbedBuilder()
    .setTitle(`${logo ? `${logo} ` : ''}After You Buy`)
    .setColor(0x57f287)
    .setDescription([
      '1. Save the claim code from the success page.',
      '2. Invite LEAGUEbuddy to the server you want to activate.',
      '3. Run `/setup code:<claim-code>` there.',
      '4. Press the button `/setup` shows.',
      '5. Use `/pricing` there if you want to confirm the package or upgrade later.',
    ].join('\n'));
}

export function buildPricingLinkRows({ currentPlan = null, clientId = null } = {}) {
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

  const inviteUrl = inviteLinkFor(clientId);
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

export function buildUpgradeReply({ targetPlan, guildId = null, clientId = null } = {}) {
  const plan = asPlan(targetPlan);
  const targetUrl = pricingLinkFor(plan);
  const inviteUrl = inviteLinkFor(clientId);
  const linkRows = targetUrl
    ? [
        new ActionRowBuilder().addComponents(
          ...[
            new ButtonBuilder()
              .setStyle(ButtonStyle.Link)
              .setLabel(plan === PLANS.standard ? 'Open Standard Checkout' : 'Open Premium Checkout')
              .setURL(targetUrl),
            inviteUrl
              ? new ButtonBuilder()
                  .setStyle(ButtonStyle.Link)
                  .setLabel('Invite LEAGUEbuddy')
                  .setURL(inviteUrl)
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
    'Next:',
    '• Run `/setup`.',
    '• Press the button it shows.',
    '• Use `/pricing` if you want to confirm the current package.',
  ].join('\n');
}

export function buildClaimInstructions() {
  return [
    'How to activate paid access:',
    '1. Buy from `/pricing` if you need a paid plan.',
    '2. Save the claim code from the success page.',
    '3. Go to the server you want to upgrade and run `/setup code:<claim-code>`.',
    '4. If you lose the code, use the Stripe payment reference from your receipt email instead.',
    '5. Press the button `/setup` shows.',
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
