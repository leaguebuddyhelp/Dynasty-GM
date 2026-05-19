// Deploy Discord commands (root version for src/commands)
import { REST, Routes } from 'discord.js';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { readdirSync } from 'fs';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const commands = [];

const DEPLOY_SCOPE = String(process.env.DEPLOY_SCOPE || 'guild').toLowerCase();
const MADDEN_ONLY = String(process.env.MADDEN_ONLY ?? 'true').toLowerCase() !== 'false';
const APP_ENV = String(process.env.APP_ENV || process.env.NODE_ENV || '').toLowerCase();
const DEPLOY_PROFILE = String(process.env.LB_DEPLOY_PROFILE || 'beta').toLowerCase();
const BUYING_ENABLED = ['true', '1', 'yes', 'on'].includes(String(process.env.LB_BUYING_ENABLED || '').trim().toLowerCase());

const BETA_MADDEN_COMMANDS = new Set([
  'disconnectleague',
  'resetleague',
  'activateplan',
  'deactivateplan',
  'setplan',
  'viewplan',
  'setup-reset',
  'sync',
  'plan',
  'setup',
  'help',
  'franchisehub',
  'myscouts',
  'draftprimer',
  'mockdraft',
  'gamestrategy',
  'streamlink',
  'schedule',
  'roster',
  'playersearch',
  'bigboard',
  'scout',
  'tradeblock',
  'member',
  'promo',
  'create-threads',
  'delete-threads',
  'weeklyupdate',
  'recruiting',
  'draftclass',
]);

function parseGuildIds() {
  const raw = [
    process.env.GUILD_IDS,
    process.env.LB_DEPLOY_GUILD_IDS,
    process.env.GUILD_ID || process.env.SERVER_ID,
  ]
    .filter(Boolean)
    .join(',');

  return Array.from(
    new Set(
      raw
        .split(',')
        .map(value => value.trim())
        .filter(Boolean),
    ),
  );
}

async function loadCommandsForDeployment() {
  const commandFolders = MADDEN_ONLY
    ? [
      ['madden'],
      ['madden', 'coach'],
      ['madden', 'staff'],
    ]
    : [
      // 2K commands removed
      ['madden'],
      ['madden', 'coach'],
      ['madden', 'staff'],
    ];

  // Only scan the canonical command locations under src/
  const roots = [
    join(__dirname, 'src'),
  ];
  const loadedNames = new Set();

  for (const parts of commandFolders) {
    for (const root of roots) {
      const commandsPath = join(root, ...parts);
      let commandFiles;
      try {
        commandFiles = readdirSync(commandsPath).filter(file => file.endsWith('.js'));
      } catch {
        continue; // path may not exist in this layout
      }

      const label = parts.join('/');
      console.log(`📂 Loading ${label} commands from ${commandsPath}...`);

      for (const file of commandFiles) {
        const filePath = join(commandsPath, file);
        const fileURL = pathToFileURL(filePath).href;

        try {
          const commandModule = await import(fileURL);
          const command = commandModule.default || commandModule;
          const commandName = command?.data?.name;
          if (!commandName) continue; // ignore non-command helpers
          if (loadedNames.has(commandName)) {
            console.log(`⏭️  Skipping duplicate command ${commandName} from ${label}/${file}`);
            continue;
          }
          if (commandName === 'madden-game_stats' || file.toLowerCase().includes('game_stats')) {
            console.log(`⏭️  Skipping ${label}/${file} (game stats disabled)`);
            continue;
          }
          if (command?.skipDeploy) {
            console.log(`⏭️  Skipping ${label}/${file} (skipDeploy=true)`);
            continue;
          }
          if (commandName === 'pricing' && !BUYING_ENABLED) {
            console.log(`⏭️  Skipping ${label}/${file} (buying disabled)`);
            continue;
          }
          if (MADDEN_ONLY && DEPLOY_PROFILE !== 'full' && !BETA_MADDEN_COMMANDS.has(commandName)) {
            console.log(`⏭️  Skipping ${label}/${file} (not in beta command profile)`);
            continue;
          }
          commands.push(command.data.toJSON());
          loadedNames.add(commandName);
          console.log(`✅ Loaded ${commandName} (${label}/${file})`);
        } catch (error) {
          console.error(`❌ Error loading command ${label}/${file}:`, error);
        }
      }
    }
  }
}

async function deployCommands() {
  try {
    console.log('🔄 Loading LEAGUEbuddy commands for deployment...');
    console.log(`🧭 Command deploy profile: ${DEPLOY_PROFILE}`);
    await loadCommandsForDeployment();

    console.log(`📊 Loaded ${commands.length} commands total`);
    console.log('🚀 Deploying commands to Discord...');

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN || process.env.TOKEN);

    // Guardrail: prevent accidental global deploys from a dev environment.
    if (DEPLOY_SCOPE === 'global' && (APP_ENV === 'dev' || APP_ENV === 'development')) {
      throw new Error('Refusing to deploy GLOBAL commands from APP_ENV=dev. Use APP_ENV=prod (or omit APP_ENV) to proceed.');
    }

    let route;
    if (DEPLOY_SCOPE === 'global') {
      route = Routes.applicationCommands(process.env.CLIENT_ID);
      console.log('🌐 Deploy scope: GLOBAL (all servers)');
      const data = await rest.put(route, { body: commands });
      console.log(`✅ Successfully registered ${data.length} application commands!`);
      console.log('🏀 LEAGUEbuddy commands are ready to use!');
      return;
    }

    const guildIds = parseGuildIds();
    if (!guildIds.length) {
      throw new Error('DEPLOY_SCOPE=guild requires GUILD_ID, SERVER_ID, GUILD_IDS, or LB_DEPLOY_GUILD_IDS.');
    }

    console.log(`🏠 Deploy scope: GUILD (${guildIds.length} target server${guildIds.length === 1 ? '' : 's'})`);
    for (const guildId of guildIds) {
      route = Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId);
      const data = await rest.put(route, { body: commands });
      console.log(`✅ Registered ${data.length} commands for guild ${guildId}`);
    }
    console.log('🏀 LEAGUEbuddy commands are ready to use!');

  } catch (error) {
    console.error('❌ Error deploying commands:', error);
    process.exit(1);
  }
}

deployCommands();
