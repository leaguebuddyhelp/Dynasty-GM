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
    return status.blockedFeatures
        .filter((item) => item.reason === reason)
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

    const lines = [];
    lines.push('**LEAGUEbuddy Plan**');
    lines.push(`Plan: **${plan}**`);
    lines.push(`Subscription: **${status}**`);
    if (setupStatus.facts?.testingBypass) {
        lines.push('Testing bypass: **on for this server**');
    }
    lines.push(`Setup completed: **${setupCompleted ? 'yes' : 'no'}**`);
    lines.push(`Overlay status: **${setupStatus.overlayStatus.isComplete ? 'complete' : setupStatus.overlayStatus.exists ? 'incomplete' : 'missing'}**`);
    lines.push('');
    lines.push('**Packs enabled**');
    if (!packsEnabled.length) {
        lines.push('(none)');
    } else {
        lines.push(packsEnabled.map((p) => `• ${p}`).join('\n'));
    }

    lines.push('');
    lines.push('**Available now**');
    lines.push(setupStatus.unlockedFeatures.length
        ? setupStatus.unlockedFeatures.map((item) => `• ${item.label}${item.source === 'pack_enabled' ? ' (enabled by pack)' : ''}`).join('\n')
        : '(none)');

    const setupBlocked = summarizeBlocked(setupStatus, 'setup_incomplete');
    const planBlocked = setupStatus.blockedFeatures
        .filter((item) => item.reason === 'plan_too_low' || item.reason === 'subscription_inactive')
        .map((item) => `• ${item.label} (${item.reason === 'plan_too_low' ? 'upgrade required' : 'subscription inactive'})`)
        .join('\n');

    lines.push('');
    lines.push('**Blocked until setup is complete**');
    lines.push(setupBlocked || '(none)');

    lines.push('');
    lines.push('**Blocked by plan or subscription**');
    lines.push(planBlocked || '(none)');

    lines.push('');
    lines.push('**Next step**');
    lines.push(setupStatus.recommendedNextAction);
    if (status === SUBSCRIPTION_STATUSES.inactive && plan === PLANS.free) {
        lines.push('To unlock paid access: run `/pricing`, buy your plan, invite LEAGUEbuddy, then run `/claim-plan`.');
    } else if (status !== SUBSCRIPTION_STATUSES.active && status !== SUBSCRIPTION_STATUSES.trialing) {
        lines.push('If you already paid, run `/claim-plan` with the payment reference from your Stripe receipt.');
    } else {
        lines.push('Run `/pricing` for upgrade links or `/setup` for setup guidance.');
    }

    if (!canManage) {
        lines.push('');
        lines.push('Ask a server admin/commissioner to manage setup or billing changes.');
    }

    const components = buildPlanUpgradeButtons({ currentPlan: plan, canManage });

    await interaction.editReply({
        content: lines.join('\n'),
        components,
    });
}

export default { data, execute };
