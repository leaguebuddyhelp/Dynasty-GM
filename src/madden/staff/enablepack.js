import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { buildActorFromInteraction } from '../../leaguebuddy/audit.js';
import { FEATURES } from '../../leaguebuddy/plans.js';
import { loadGuildMaddenConfig, saveGuildMaddenConfig } from '../../shared/madden_guild_config.js';
import { appendAuditEvent } from '../../leaguebuddy/audit.js';

function normalizePackKey(key) {
    return String(key || '').trim();
}

export const data = new SlashCommandBuilder()
    .setName('enablepack')
    .setDescription('Admin-only: enable a pack/feature flag in this server\'s Madden overlay config.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
        o.setName('pack')
            .setDescription('Pack key to enable (must match a known feature key)')
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

    const q = String(focused.value || '').toLowerCase();
    const opts = Object.entries(FEATURES)
        .map(([key, f]) => ({ key, label: f?.label || key }))
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

    const beforeCfg = loadGuildMaddenConfig(guildId) || {
        version: 2,
        status: 'incomplete',
        updatedAt: new Date().toISOString(),
        license: { tier: 'free' },
        packsEnabled: [],
        compat: { maddenChannelMap: {}, maddenRoleMap: {} },
        pins: {},
    };

    const before = Array.isArray(beforeCfg.packsEnabled) ? beforeCfg.packsEnabled : [];
    const next = [...new Set([...before, pack])];

    const cfg = {
        ...beforeCfg,
        packsEnabled: next,
        updatedAt: new Date().toISOString(),
    };

    saveGuildMaddenConfig(guildId, cfg);

    appendAuditEvent({
        kind: 'pack.enabled',
        source: 'command:/enablepack',
        guildId: String(guildId),
        actor,
        pack,
        before: { packsEnabled: before },
        after: { packsEnabled: next },
    });

    await interaction.editReply({
        content: [`✅ Enabled pack **${pack}**.`, '', `packsEnabled now: ${next.join(', ') || '(none)'}`].join('\n'),
    });
}

export default { data, autocomplete, execute };
