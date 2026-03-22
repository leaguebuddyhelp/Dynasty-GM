import {
    PermissionFlagsBits,
    SlashCommandBuilder,
} from 'discord.js';

import { PLANS, SUBSCRIPTION_STATUSES } from '../../leaguebuddy/guild_store.js';
import { getSetupStatus } from '../../leaguebuddy/setup_status_service.js';
import { buildPlanUpgradeButtons } from '../../leaguebuddy/upgrade_ux.js';

function isGuildManager(member) {
    if (!member) return false;
    if (member.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
    if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
    return false;
}

function prettyStatus(status) {
    const s = String(status || '').toLowerCase();
    if (!s) return 'inactive';
    return s;
}

function summarizeBlocked(status, reason) {
    // Only show features as setup-blocked if they are not also blocked by plan
    return status.blockedFeatures
        .filter((item) => item.reason === reason && item.planEligible)
        .map((item) => `• ${item.label}`)
        .join('\n');
}

export const data = new SlashCommandBuilder()
    .setName('plan')
    .setDescription('View this server\'s LEAGUEbuddy plan, subscription status, and enabled packs.');

export const deferOnDispatch = { flags: 64 };

export async function execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.editReply({ content: 'This command can only be used in a server.' });
        return;
    }

    const member = interaction.member;
    const canManage = isGuildManager(member);

    const setupStatus = getSetupStatus(guildId);
    const packsEnabled = setupStatus.packsEnabled;
    const plan = setupStatus.plan || PLANS.free;
    const status = prettyStatus(setupStatus.subscriptionStatus || SUBSCRIPTION_STATUSES.inactive);
    const setupCompleted = setupStatus.setupCompleted === true;

    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.editReply({ content: 'This command can only be used in a server.' });
        return;
    }

    const member = interaction.member;
    const canManage = isGuildManager(member);
    const setupStatus = getSetupStatus(guildId);
    const plan = setupStatus.plan || PLANS.free;
    const status = prettyStatus(setupStatus.subscriptionStatus || SUBSCRIPTION_STATUSES.inactive);

    // Only show features available in the current plan (unlockedFeatures)
    const availableFeatures = setupStatus.unlockedFeatures.length
        ? setupStatus.unlockedFeatures.map((item) => `• ${item.label}${item.source === 'pack_enabled' ? ' (enabled by pack)' : ''}`).join('\n')
        : '(none)';

    let lines = [];
    lines.push('**Your LEAGUEbuddy Plan**');
    lines.push(`Plan: **${plan}**`);
    lines.push(`Subscription: **${status}**`);
    lines.push('');
    lines.push('**Features included in your plan:**');
    lines.push(availableFeatures);

    // Show upgrade button if not on premium
    if (plan !== PLANS.premium) {
        lines.push('');
        lines.push('Want more features? Upgrade to Premium for full access.');
    }

    const components = buildPlanUpgradeButtons({ currentPlan: plan, canManage });

    await interaction.editReply({
        content: lines.join('\n'),
        components,
    });
    lines.push('**Blocked until setup is complete**');
