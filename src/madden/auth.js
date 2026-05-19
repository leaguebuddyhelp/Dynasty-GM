import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { APP_REDIRECT_URL, REDIRECT_URL, YEAR, ConsoleOverride } from './ea_constants.js';
import {
  exchangeLoginCode,
  exchangePersonaToken,
  extractValidPersonas,
  fetchEntitlements,
  fetchPersonas,
  fetchTokenInfo,
} from './ea_personas.js';
import {
  deleteGuildEATokens,
  getGuildAuthStartUrl,
  saveGuildEATokens,
} from './ea_guild_auth.js';

const data = new SlashCommandBuilder()
  .setName('auth')
  .setDescription('Legacy fallback: finish the redirect-link account flow manually for this server.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption((option) =>
    option
      .setName('redirect_url')
      .setDescription('Paste the full callback URL to finish the same redirect flow manually')
      .setRequired(false),
  )
  .addBooleanOption((option) =>
    option
      .setName('reset')
      .setDescription('Clear the saved league connection for this server before relinking')
      .setRequired(false),
  );

function pickBestPersona(personas = []) {
  const score = (persona) => {
    let value = 0;
    const ent = `${persona.entitlement || ''}`.toUpperCase();
    const ns = `${persona.namespaceName || ''}`.toUpperCase();
    if (persona.systemConsole?.toLowerCase() === 'ps5') value += 5;
    if (persona.systemConsole?.toLowerCase() === 'xbsx') value += 4;
    if (ent.includes('MADDEN_26')) value += 3;
    if (ns.includes('MADDEN')) value += 1;
    return value;
  };
  return [...personas].sort((a, b) => score(b) - score(a))[0] || null;
}

async function execute(interaction) {
  await interaction.deferReply();

  if (!interaction.guildId) {
    await interaction.editReply({ content: 'This command can only be used in a server.' });
    return;
  }

  const redirectUrl = interaction.options.getString('redirect_url');
  const doReset = interaction.options.getBoolean('reset');
  const loginUrl = getGuildAuthStartUrl(interaction.guildId);
  const manualFinishLikely = APP_REDIRECT_URL !== REDIRECT_URL;

  if (doReset) {
    deleteGuildEATokens(interaction.guildId);
    if (!redirectUrl) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('EA Auth Reset')
            .setDescription('The saved EA connection for this server was cleared. Use `/setup` to reconnect.')
            .setColor(0xffcc00),
        ],
      });
      return;
    }
  }

  if (!redirectUrl) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Open Connection Link')
        .setURL(loginUrl),
    );

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Connect League Account')
          .setDescription('This is the legacy manual fallback. The recommended connection path is `/setup`.')
          .addFields(
            { name: 'Step 1', value: 'Tap **Open Connection Link** below.' },
            { name: 'Step 2', value: manualFinishLikely ? `Finish the browser sign-in. EA should redirect to \`${REDIRECT_URL}\`.` : 'Finish the browser sign-in and redirect flow.' },
            { name: 'Step 3', value: manualFinishLikely ? 'Copy the full redirected URL from the browser address bar.' : 'If the callback page says the connection was saved for this server, run `/install-league`.' },
            { name: 'Manual Finish', value: manualFinishLikely ? 'Go back to Discord and rerun the auth command with that full redirected URL so LEAGUEbuddy can finish the connection for this server.' : 'If the browser lands on the callback URL but the save does not finish automatically, copy the full callback URL from the browser address bar.' },
            { name: 'Run This In Discord', value: '`/auth redirect_url:<paste-full-callback-url>`' },
            { name: 'Next', value: 'After the redirect flow is saved, return to `/setup` or run `/install-league` only if you are using the legacy flow.' },
          )
          .setColor(0x5865f2),
      ],
      components: [row],
    });
    return;
  }

  try {
    const loginTokens = await exchangeLoginCode(redirectUrl);
    const tokenInfo = await fetchTokenInfo(loginTokens.access_token);
    const pid = tokenInfo?.pid_id;
    if (!pid) throw new Error('No pid_id returned from tokeninfo.');

    const entRes = await fetchEntitlements(pid, loginTokens.access_token);
    const entitlements = entRes?.entitlements?.entitlement || [];
    const personaResponses = await Promise.all(
      entitlements.map(async (ent) => ({
        ent,
        personas: await fetchPersonas(ent.pidUri, loginTokens.access_token),
      })),
    );
    const personas = extractValidPersonas(entRes, personaResponses, ConsoleOverride.NONE);
    if (!personas.length) {
      throw new Error('No Madden personas found for this EA account.');
    }

    const chosen = pickBestPersona(personas);
    if (!chosen) {
      throw new Error('Could not resolve a usable Madden persona.');
    }

    const personaToken = await exchangePersonaToken(
      loginTokens.access_token,
      chosen.personaId,
      chosen.namespaceName,
    );

    const tokens = saveGuildEATokens(interaction.guildId, {
      accessToken: personaToken.access_token,
      refreshToken: personaToken.refresh_token,
      expiry: Date.now() + (personaToken.expires_in || 0) * 1000,
      console: chosen.systemConsole || process.env.EA_CONSOLE || 'ps5',
      blazeId: `${chosen.personaId}`,
      gameYear: YEAR,
      personaName: chosen.displayName,
      entitlement: chosen.entitlement,
      namespace: chosen.namespaceName,
    });

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('League Account Connected')
          .setDescription('The EA connection was saved for this server. Run `/setup` to finish.')
          .addFields(
            { name: 'Console', value: tokens.console || 'unknown', inline: true },
            { name: 'Game Year', value: `${tokens.gameYear || YEAR}`, inline: true },
            { name: 'Persona', value: `${chosen.displayName} (${chosen.personaId})`, inline: false },
            { name: 'Next', value: 'Run `/setup`.', inline: false },
          )
          .setColor(0x57f287),
      ],
    });
  } catch (err) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('EA Auth Failed')
          .setDescription([
            err?.message || 'Unknown error',
            '',
            'This command is only the manual fallback path.',
            'Recommended: go back to `/setup` and use the dashboard flow.',
            manualFinishLikely
              ? `When EA redirects to \`${REDIRECT_URL}\`, copy the full URL and rerun \`/auth redirect_url:<paste-full-callback-url>\` in Discord.`
              : 'If the browser reaches the callback URL but the save does not finish automatically, copy the full callback URL and run `/auth redirect_url:<paste-full-callback-url>` to finish that same redirect flow manually.',
          ].join('\n'))
          .setColor(0xed4245),
      ],
    });
  }
}

export default { data, execute };
