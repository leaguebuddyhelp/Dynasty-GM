import fs from 'fs';
import path from 'path';
import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
} from 'discord.js';

import { guildConfigPath, loadGuildMaddenConfig } from '../../shared/madden_guild_config.js';

function fmtBool(v) {
    return v ? '✅' : '❌';
}

function isDeletableTextChannel(ch) {
    if (!ch) return false;
    if (ch.type !== ChannelType.GuildText) return false;
    return typeof ch.name === 'string' && ch.name.startsWith('lb-');
}

function isDeletableRole(role) {
    if (!role) return false;
    return role.name === 'LB Commish' || role.name === 'LB Co-Commish';
}

export const data = new SlashCommandBuilder()
    .setName('setup-reset')
    .setDescription('Admin-only: reset Madden v2 setup for this server (testing helper).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption(o =>
        o.setName('delete_channels')
            .setDescription('Delete LEAGUEbuddy channels created by /setup (lb-*)')
            .setRequired(false))
    .addBooleanOption(o =>
        o.setName('delete_roles')
            .setDescription('Delete LEAGUEbuddy roles created by /setup (LB Commish/Co-Commish)')
            .setRequired(false))
    .addBooleanOption(o =>
        o.setName('delete_category')
            .setDescription('Delete the LEAGUEbuddy Madden category if empty')
            .setRequired(false));

export async function execute(interaction) {
    const guild = interaction.guild;
    if (!guild) {
        await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
        return;
    }

    const deleteChannels = !!interaction.options.getBoolean('delete_channels');
    const deleteRoles = !!interaction.options.getBoolean('delete_roles');
    const deleteCategory = !!interaction.options.getBoolean('delete_category');

    await interaction.reply({ content: 'Resetting Madden v2 setup…', ephemeral: true });

    const guildId = guild.id;
    const cfg = loadGuildMaddenConfig(guildId);

    const deleted = {
        overlay: false,
        channels: 0,
        roles: 0,
        category: false,
    };
    const errors = [];

    // Delete overlay config file
    try {
        const p = guildConfigPath(guildId);
        if (p && fs.existsSync(p)) {
            fs.unlinkSync(p);
            deleted.overlay = true;
        }
    } catch (e) {
        errors.push(`overlay: ${e?.message || String(e)}`);
    }

    // Delete channels (only lb-* text channels referenced by overlay)
    if (deleteChannels && cfg?.compat?.maddenChannelMap) {
        const seen = new Set();
        for (const channelId of Object.values(cfg.compat.maddenChannelMap)) {
            if (!channelId || seen.has(channelId)) continue;
            seen.add(channelId);
            const ch = guild.channels.cache.get(channelId);
            if (!isDeletableTextChannel(ch)) continue;
            try {
                await ch.delete('Madden v2 setup reset');
                deleted.channels += 1;
            } catch (e) {
                errors.push(`channel ${ch?.name || channelId}: ${e?.message || String(e)}`);
            }
        }
    }

    // Delete roles
    if (deleteRoles && cfg?.compat?.maddenRoleMap) {
        const seen = new Set();
        for (const roleId of Object.values(cfg.compat.maddenRoleMap)) {
            if (!roleId || seen.has(roleId)) continue;
            seen.add(roleId);
            const role = guild.roles.cache.get(roleId);
            if (!isDeletableRole(role)) continue;
            try {
                await role.delete('Madden v2 setup reset');
                deleted.roles += 1;
            } catch (e) {
                errors.push(`role ${role?.name || roleId}: ${e?.message || String(e)}`);
            }
        }
    }

    // Delete category (only if empty)
    if (deleteCategory) {
        try {
            const categoryId = cfg?.compat?.maddenChannelMap?.['LB Madden'];
            if (categoryId) {
                const cat = guild.channels.cache.get(categoryId);
                if (cat && cat.type === ChannelType.GuildCategory) {
                    const children = guild.channels.cache.filter(c => c.parentId === cat.id);
                    if (children.size === 0) {
                        await cat.delete('Madden v2 setup reset');
                        deleted.category = true;
                    }
                }
            }
        } catch (e) {
            errors.push(`category: ${e?.message || String(e)}`);
        }
    }

    const lines = [];
    lines.push('**Madden v2 setup reset**');
    lines.push(`Overlay config deleted: ${fmtBool(deleted.overlay)}`);
    lines.push(`Channels deleted: ${deleted.channels}`);
    lines.push(`Roles deleted: ${deleted.roles}`);
    lines.push(`Category deleted: ${fmtBool(deleted.category)}`);

    if (cfg && !deleteChannels && !deleteRoles) {
        lines.push('');
        lines.push('Tip: re-run `/setup` right after this to test tiers quickly.');
        lines.push('Optional: run `/setup-reset delete_channels:true delete_roles:true` to cleanup Discord artifacts too.');
    }

    if (errors.length) {
        lines.push('');
        lines.push('**Warnings**');
        for (const e of errors.slice(0, 12)) lines.push(`• ${e}`);
        if (errors.length > 12) lines.push(`• …and ${errors.length - 12} more`);
    }

    await interaction.editReply({ content: lines.join('\n') });
}

export default { data, execute };
