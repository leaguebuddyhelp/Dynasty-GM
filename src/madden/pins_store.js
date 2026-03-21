import fs from 'fs';
import { getGuildPinsMap } from '../shared/madden_guild_config.js';
import { getMaddenDataFilePath } from '../leaguebuddy/paths.js';

const PINS_FILE = getMaddenDataFilePath('pins.json');
const STATIC_PINS = {
  available_teams: '1479545575903858791',
  stat_leaders: '1479314025002045676',
  standings: '1479314692999479326',
  playoff_picture: '1479314696728346654',
  power_rankings: '1479314701732282480',
  top100: '1478035474609209515',
};

export function loadPins() {
  try {
    return JSON.parse(fs.readFileSync(PINS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function savePins(pins) {
  fs.mkdirSync(path.dirname(PINS_FILE), { recursive: true });
  fs.writeFileSync(PINS_FILE, JSON.stringify(pins ?? {}, null, 2));
}

export function getPinId(key, guildId = null) {
  const overlay = guildId ? getGuildPinsMap(guildId) : null;
  if (overlay?.[key]) return overlay[key];
  const pins = loadPins();
  if (guildId && pins?.guilds?.[String(guildId)]?.[key]) return pins.guilds[String(guildId)][key];
  if (pins?.global?.[key]) return pins.global[key];
  if (pins[key]) return pins[key];
  return STATIC_PINS[key] || null;
}

export function setPinId(key, id, guildId = null) {
  const pins = loadPins();
  if (!pins.global || typeof pins.global !== 'object') pins.global = {};
  if (guildId) {
    if (!pins.guilds || typeof pins.guilds !== 'object') pins.guilds = {};
    if (!pins.guilds[String(guildId)] || typeof pins.guilds[String(guildId)] !== 'object') {
      pins.guilds[String(guildId)] = {};
    }
    pins.guilds[String(guildId)][key] = id;
  } else {
    pins.global[key] = id;
  }
  savePins(pins);
}

export function clearPins() {
  try { fs.unlinkSync(PINS_FILE); } catch { }
}

export default { loadPins, savePins, getPinId, setPinId, clearPins };
