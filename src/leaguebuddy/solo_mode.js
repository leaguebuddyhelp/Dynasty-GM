// Solo operation is permanent; the old mode switch cannot restore other features.
export function isSoloModeEnabled() { return true; }

export const SOLO_COMMAND_MODULES = Object.freeze([
  ['setup', '../madden/staff/setup_dashboard.js'],
  ['disconnectleague', '../madden/staff/disconnectleague.js'],
  ['league-status', '../madden/staff/league-status.js'],
  ['sync', '../madden/sync.js'],
  ['ping', '../madden/ping.js'],
  ['help', '../madden/coach/mycommands.js'],
  ['roster', '../madden/coach/roster.js'],
  ['playersearch', '../madden/coach/playersearch.js'],
  ['schedule', '../madden/coach/schedule.js'],
  ['bigboard', '../madden/coach/bigboard.js'],
  ['mockdraft', '../madden/coach/mockdraft.js'],
  ['draftexport', '../madden/staff/draftexport.js'],
  ['awards', '../madden/staff/awards.js'],
]);

export const SOLO_INTERACTION_MODULES = Object.freeze([
  '../interactions/madden_setup_dashboard.js',
  '../interactions/madden_solo_rankings.js',
  '../interactions/madden_top100_board.js',
  '../interactions/madden_progression.js',
  '../interactions/madden_roster_page.js',
  '../interactions/madden_roster_select.js',
  '../interactions/madden_schedule_page.js',
  '../interactions/madden_schedule_game.js',
  '../interactions/madden_schedule_back.js',
  '../interactions/madden_bigboard_page.js',
  '../interactions/madden_awards_button.js',
]);

export function getSoloModeConfig() {
  return {
    enabled: true,
    userId: String(process.env.MADDEN_SOLO_USER_ID || '').trim(),
    guildId: String(process.env.MADDEN_SOLO_GUILD_ID || '').trim(),
  };
}

export function validateSoloModeConfig() {
  const config = getSoloModeConfig();
  const missing = [];
  if (!config.userId) missing.push('MADDEN_SOLO_USER_ID');
  if (!config.guildId) missing.push('MADDEN_SOLO_GUILD_ID');
  if (missing.length) throw new Error(`Solo app requires ${missing.join(' and ')}.`);
  return config;
}

export function isSoloCommandEnabled(commandName) {
  return SOLO_COMMAND_MODULES.some(([name]) => name === String(commandName || '').trim().toLowerCase());
}

export function getSoloInteractionDenial({ userId, guildId, commandName } = {}) {
  const config = getSoloModeConfig();
  if (!config.userId || !config.guildId) return 'Set MADDEN_SOLO_USER_ID and MADDEN_SOLO_GUILD_ID to configure your franchise.';
  if (String(guildId || '') !== config.guildId) return 'This app is configured for a different Madden franchise server.';
  if (String(userId || '') !== config.userId) return 'This Madden Franchise HQ is restricted to its authorized operator.';
  if (commandName && !isSoloCommandEnabled(commandName)) return 'That command is no longer available in this solo app.';
  return null;
}

export async function loadSoloCommands() {
  const commands = new Map();
  for (const [name, modulePath] of SOLO_COMMAND_MODULES) {
    const module = await import(new URL(modulePath, import.meta.url));
    const command = { ...module, ...module.default };
    if (command.data?.name !== name || typeof command.execute !== 'function') throw new Error(`Invalid solo command module: ${modulePath}`);
    command.data.setDefaultMemberPermissions(null).setDMPermission(false);
    commands.set(name, command);
  }
  return commands;
}

export async function loadSoloInteractionHandlers() {
  const handlers = [];
  for (const modulePath of SOLO_INTERACTION_MODULES) {
    const module = await import(new URL(modulePath, import.meta.url));
    const handler = { ...module, ...module.default };
    if (handler.customId && typeof handler.execute === 'function') handlers.push(handler);
    for (const key of Object.keys(handler).filter((key) => key.startsWith('customId_'))) {
      const execute = handler[`execute_${key.slice('customId_'.length)}`] || handler.execute;
      if (typeof execute === 'function') handlers.push({ customId: handler[key], execute });
    }
  }
  return handlers;
}

export default { getSoloModeConfig, getSoloInteractionDenial, isSoloCommandEnabled, isSoloModeEnabled, validateSoloModeConfig };
