import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { buildActorFromInteraction } from '../../leaguebuddy/audit.js';
import { setSetupCompleted } from '../../leaguebuddy/guild_access_service.js';
import { FEATURES } from '../../leaguebuddy/plans.js';
import { syncGuild } from '../../shared/guild_auto_sync.js';
import { loadGuildMaddenConfig, saveGuildMaddenConfig } from '../../shared/madden_guild_config.js';
import { appendAuditEvent } from '../../leaguebuddy/audit.js';

function normalizePackKey(key) {
    return String(key || '').trim();
}

export const data = new SlashCommandBuilder()
    .setName('disablepack')
    .setDescription('Admin-only: disable a pack/feature flag in this server\'s Madden overlay config.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
        o.setName('pack')
            .setDescription('Pack key to disable (known feature key)')
            .setRequired(true)
            .setAutocomplete(true)
    );

export const deferOnDispatch = { flags: 64 };

export async function autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (!focused || focused.name !== 'pack') {
        await interaction.respond([]);
        return;
    }

    const guildId = interaction.guildId;
    const cfg = guildId ? loadGuildMaddenConfig(guildId) : null;
    const enabled = new Set(Array.isArray(cfg?.packsEnabled) ? cfg.packsEnabled : []);

    const q = String(focused.value || '').toLowerCase();
    const opts = Object.entries(FEATURES)
        .map(([key, f]) => ({ key, label: f?.label || key }))
        .filter((x) => enabled.has(x.key))
        .filter((x) => x.key.toLowerCase().includes(q) || x.label.toLowerCase().includes(q))
        .slice(0, 25)
        .map((x) => ({ name: `${x.label} (${x.key})`, value: x.key }));

    await interaction.respond(opts);
}

export async function execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.editReply({ content: 'This command can only be used in a server.' });
        return;
    }

    const pack = normalizePackKey(interaction.options.getString('pack', true));
    if (!FEATURES[pack]) {
        await interaction.editReply({ content: `Unknown pack key: \`${pack}\`.` });
        return;
    }

    const actor = buildActorFromInteraction(interaction);

    const beforeCfg = loadGuildMaddenConfig(guildId);
    if (!beforeCfg) {
        await interaction.editReply({ content: 'No Madden overlay config found. Run `/setup-channels` first.' });
        return;
    }

    const before = Array.isArray(beforeCfg.packsEnabled) ? beforeCfg.packsEnabled : [];
    const next = before.filter((p) => p !== pack);

    const cfg = {
        ...beforeCfg,
        packsEnabled: next,
        updatedAt: new Date().toISOString(),
    };

    saveGuildMaddenConfig(guildId, cfg);
    setSetupCompleted(guildId, false, { actor, source: 'command:/disablepack' });

    appendAuditEvent({
        kind: 'pack.disabled',
        source: 'command:/disablepack',
        guildId: String(guildId),
        actor,
        pack,
        before: { packsEnabled: before },
        after: { packsEnabled: next },
    });

    try {
        await syncGuild(guildId);
    } catch (e) {
        console.error('[AUTO_SYNC] Failed to sync after disablepack:', e);
    }

    await interaction.editReply({
        content: [`✅ Disabled pack **${pack}**.`, '', `packsEnabled now: ${next.join(', ') || '(none)'}`].join('\n'),
    });
}

export default { data, autocomplete, execute };
