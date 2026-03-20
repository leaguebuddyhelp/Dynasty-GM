import { PLANS, SUBSCRIPTION_STATUSES } from './guild_store.js';
import { normalizePlan } from './plans.js';

function parseGuildIds(value) {
  return String(value || '')
    .split(',')
    .map((part) => String(part || '').trim())
    .filter(Boolean);
}

export function getTestingBypassGuildIds() {
  return parseGuildIds(process.env.LB_TEST_BYPASS_GUILD_IDS);
}

export function isTestingBypassGuild(guildId) {
  if (!guildId) return false;
  return getTestingBypassGuildIds().includes(String(guildId));
}

export function getTestingBypassPlan() {
  const plan = normalizePlan(process.env.LB_TEST_BYPASS_PLAN || PLANS.premium);
  return plan || PLANS.premium;
}

export function getTestingBypassBilling(guildId) {
  if (!isTestingBypassGuild(guildId)) return null;
  return {
    guildId: String(guildId),
    plan: getTestingBypassPlan(),
    subscriptionStatus: SUBSCRIPTION_STATUSES.active,
    activatedAt: null,
    billing: {
      provider: 'testing_bypass',
      customerId: null,
      subscriptionId: null,
      currentPeriodEnd: null,
      interval: 'month',
      paymentReference: null,
      billingNote: 'Testing bypass enabled for this guild.',
      activatedBy: null,
      activatedAt: null,
      lastPlanChangeAt: null,
      paymentSource: 'testing_bypass',
      internalNote: null,
    },
    testingBypass: true,
  };
}

