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
    // Expanded to match 'LEAGUEbuddy Coaches', 'LB Coach Standard', etc.
    return role.name === 'LB Commish' ||
        role.name === 'LB Co-Commish' ||
        role.name === 'LB Trade Committee' ||
        role.name === 'LEAGUEbuddy Trade Committee' ||
        / Coach$/i.test(role.name) ||
        /Coaches$/i.test(role.name) ||
        /Coach Standard/i.test(role.name) ||
        /LEAGUEbuddy Coaches/i.test(role.name);
}

function findFallbackCategory(guild) {
    return guild.channels.cache.find((channel) =>
        channel?.type === ChannelType.GuildCategory &&
        String(channel.name || '').toLowerCase() === 'leaguebuddy madden'
    ) || null;
}

export const data = new SlashCommandBuilder()
    .setName('setup-reset')
    .setDescription('Admin-only: reset Madden v2 setup for this server (testing helper).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption(o =>
        o.setName('delete_channels')
            .setDescription('Delete LEAGUEbuddy channels created by /setup-channels (lb-*)')
            .setRequired(false))
    .addBooleanOption(o =>
        o.setName('delete_roles')
            .setDescription('Delete LEAGUEbuddy roles created by /setup-roles (LB roles + coach roles)')
            .setRequired(false))
    .addBooleanOption(o =>
        o.setName('delete_category')
            .setDescription('Delete the LEAGUEbuddy Madden category if empty')
            .setRequired(false));

export async function execute(interaction) {

    // Recursively delete all files in the guild's data directory (except config if not requested)
    try {
        const guildDataDir = path.join(path.dirname(guildConfigPath(guildId)));
        if (fs.existsSync(guildDataDir)) {
            for (const entry of fs.readdirSync(guildDataDir)) {
                const entryPath = path.join(guildDataDir, entry);
                // Don't delete the config file itself
                if (entryPath === guildConfigPath(guildId)) continue;
                // Recursively delete directories, unlink files
                if (fs.lstatSync(entryPath).isDirectory()) {
                    fs.rmSync(entryPath, { recursive: true, force: true });
                } else {
                    fs.unlinkSync(entryPath);
                }
            }
        }
    } catch (e) {
        errors.push(`guild data dir: ${e?.message || String(e)}`);
    }
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
    const notes = [];
    const activeChannelId = interaction.channelId || null;

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

    // Delete channels (prefer overlay map, otherwise fall back to scanning lb-* channels)
    if (deleteChannels) {
        const channelsToDelete = [];
        const seen = new Set();

        if (cfg?.compat?.maddenChannelMap) {
            for (const channelId of Object.values(cfg.compat.maddenChannelMap)) {
                if (!channelId || seen.has(channelId)) continue;
                seen.add(channelId);
                const channel = guild.channels.cache.get(channelId);
                if (isDeletableTextChannel(channel)) channelsToDelete.push(channel);
            }
        }
        for (const channel of guild.channels.cache.values()) {
            if (!isDeletableTextChannel(channel)) continue;
            if (seen.has(channel.id)) continue;
            seen.add(channel.id);
            channelsToDelete.push(channel);
        }

        for (const ch of channelsToDelete) {
            if (activeChannelId && ch.id === activeChannelId) {
                notes.push(`Skipped deleting the current channel (${ch?.name || ch.id}) so the command reply could finish. Run this command from a non-LEAGUEbuddy channel if you want that channel deleted too.`);
                continue;
            }
            try {
                await ch.delete('Madden v2 setup reset');
                deleted.channels += 1;
            } catch (e) {
                errors.push(`channel ${ch?.name || ch.id}: ${e?.message || String(e)}`);
            }
        }
    }

    // Delete roles (prefer overlay map, otherwise fall back to scanning matching roles)
    if (deleteRoles) {
        const rolesToDelete = [];
        const seen = new Set();

        if (cfg?.compat?.maddenRoleMap) {
            for (const roleId of Object.values(cfg.compat.maddenRoleMap)) {
                if (!roleId || seen.has(roleId)) continue;
                seen.add(roleId);
                const role = guild.roles.cache.get(roleId);
                if (isDeletableRole(role)) rolesToDelete.push(role);
            }
        }
        for (const role of guild.roles.cache.values()) {
            if (!isDeletableRole(role)) continue;
            if (seen.has(role.id)) continue;
            seen.add(role.id);
            rolesToDelete.push(role);
        }

        for (const role of rolesToDelete) {
            try {
                await role.delete('Madden v2 setup reset');
                deleted.roles += 1;
            } catch (e) {
                errors.push(`role ${role?.name || role?.id}: ${e?.message || String(e)}`);
            }
        }
    }

    // Delete category (only if empty)
    if (deleteCategory) {
        try {
            const categoryId = cfg?.compat?.maddenChannelMap?.['LB Madden'];
            const cat = categoryId
                ? guild.channels.cache.get(categoryId)
                : findFallbackCategory(guild);
            if (cat && cat.type === ChannelType.GuildCategory) {
                const children = guild.channels.cache.filter(c => c.parentId === cat.id && (!activeChannelId || c.id !== activeChannelId));
                if (children.size === 0) {
                    await cat.delete('Madden v2 setup reset');
                    deleted.category = true;
                } else {
                    notes.push(`Category not deleted because ${children.size} LEAGUEbuddy channel(s) still remain inside it.`);
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

    if (notes.length) {
        lines.push('');
        lines.push('**Notes**');
        for (const note of notes) lines.push(`• ${note}`);
    }

    if (cfg && !deleteChannels && !deleteRoles) {
        lines.push('');
        lines.push('Tip: re-run `/setup`, do the one next step it shows, then rerun `/setup` until setup is complete.');
        lines.push('Optional: run `/setup-reset delete_channels:true delete_roles:true` to cleanup Discord artifacts too.');
    }

    if (errors.length) {
        lines.push('');
        lines.push('**Warnings**');
        for (const e of errors.slice(0, 12)) lines.push(`• ${e}`);
        if (errors.length > 12) lines.push(`• …and ${errors.length - 12} more`);
    }

    try {
        await interaction.editReply({ content: lines.join('\n') });
    } catch (error) {
        console.warn('[setup-reset] final editReply failed:', error?.message || error);
        try {
            await interaction.followUp({ content: lines.join('\n'), ephemeral: true });
        } catch {
            // ignore
        }
    }
}

export default { data, execute };
