// Minimal constants extracted from Snallabot (Madden 26)
export const AUTH_SOURCE = 317239;
export const CLIENT_SECRET = "teJpJ9cSXFqZAuKNW8IuHpy8D4dwWPoVrPoek38iCnrGbrUSfjqnHMBAv8iCVjeSm_20250910175618";
export const CLIENT_ID = "MCA_26_COMP_APP";
export const MACHINE_KEY = "444d362e8e067fe2";

function looksLikePlaceholder(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return true;
  if (trimmed === 'EA_OAUTH_REDIRECT_URL' || trimmed === 'EA_REDIRECT_URL') return true;
  return /^(YOUR_|OFFICIAL_|REPLACE_ME|PASTE_)/i.test(trimmed);
}

function resolveRedirectUrl(envKey, fallback, { requireLoopback = false } = {}) {
  const raw = process.env[envKey];
  const candidate = looksLikePlaceholder(raw) ? fallback : String(raw || '').trim();
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`[ea-auth] ${envKey} is not a valid URL: ${candidate || '<empty>'}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`[ea-auth] ${envKey} must use http or https: ${parsed.toString()}`);
  }
  if (requireLoopback && !(parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1')) {
    throw new Error(`[ea-auth] ${envKey} must be an http://127.0.0.1 loopback URL. Received: ${parsed.toString()}`);
  }
  return parsed.toString();
}

// Public callback route served by the app/healthcheck server when available.
export const APP_REDIRECT_URL = resolveRedirectUrl('EA_REDIRECT_URL', 'http://localhost:4001/madden/callback');
// EA's OAuth client may only accept a fixed allowlisted redirect URI. Keep this separate
// from the app callback so hosted production can still finish the flow manually in Discord.
export const REDIRECT_URL = resolveRedirectUrl('EA_OAUTH_REDIRECT_URL', 'http://127.0.0.1/success', { requireLoopback: true });

export function buildEaAuthUrl({ state, accessToken, personaId, personaNamespace } = {}) {
  const authUrl = new URL('/connect/auth', 'https://accounts.ea.com');
  authUrl.searchParams.set('hide_create', 'true');
  authUrl.searchParams.set('release_type', 'prod');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', REDIRECT_URL);
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('machineProfileKey', MACHINE_KEY);
  authUrl.searchParams.set('authentication_source', String(AUTH_SOURCE));
  if (state) authUrl.searchParams.set('state', state);
  if (accessToken) authUrl.searchParams.set('access_token', accessToken);
  if (personaId) authUrl.searchParams.set('persona_id', String(personaId));
  if (personaNamespace) authUrl.searchParams.set('persona_namespace', String(personaNamespace));
  return authUrl.toString();
}

export const EA_LOGIN_URL = buildEaAuthUrl();

// Madden 26 (release year 2026) EA service identifiers
export const TWO_DIGIT_YEAR = "26";
export const YEAR = "2026";

// Entitlement helpers (mirrored from Snallabot dashboard)
export const VALID_ENTITLEMENTS = ((a) => ({
  xone: `MADDEN_${a}XONE`,
  ps4: `MADDEN_${a}PS4`,
  pc: `MADDEN_${a}PC`,
  ps5: `MADDEN_${a}PS5`,
  xbsx: `MADDEN_${a}XBSX`,
  stadia: `MADDEN_${a}SDA`,
}))(TWO_DIGIT_YEAR);

export const ENTITLEMENT_TO_SYSTEM = ((a) => ({
  [`MADDEN_${a}XONE`]: "xone",
  [`MADDEN_${a}PS4`]: "ps4",
  [`MADDEN_${a}PC`]: "pc",
  [`MADDEN_${a}PS5`]: "ps5",
  [`MADDEN_${a}XBSX`]: "xbsx",
  [`MADDEN_${a}SDA`]: "stadia",
}))(TWO_DIGIT_YEAR);

export const ENTITLEMENT_TO_VALID_NAMESPACE = ((a) => ({
  [`MADDEN_${a}XONE`]: ["xbox"],
  [`MADDEN_${a}PS4`]: ["ps3", "psn"],
  [`MADDEN_${a}PC`]: ["cem_ea_id"],
  [`MADDEN_${a}PS5`]: ["ps3", "psn"],
  [`MADDEN_${a}XBSX`]: ["xbox"],
  [`MADDEN_${a}SDA`]: ["stadia"],
}))(TWO_DIGIT_YEAR);

export const ConsoleOverride = {
  NONE: "Default",
  XBOX_ONE: "Xbox One",
  PS4: "PS4",
  PC: "PC",
  PS5: "PS5",
  XBOX_X: "XBOX Series X",
  STADIA: "Stadia",
};

export const CONSOLE_OVERRIDE_TO_ENTITLEMENT = ((a) => ({
  [ConsoleOverride.XBOX_ONE]: `MADDEN_${a}XONE`,
  [ConsoleOverride.PS4]: `MADDEN_${a}PS4`,
  [ConsoleOverride.PC]: `MADDEN_${a}PC`,
  [ConsoleOverride.PS5]: `MADDEN_${a}PS5`,
  [ConsoleOverride.XBOX_X]: `MADDEN_${a}XBSX`,
  [ConsoleOverride.STADIA]: `MADDEN_${a}SDA`,
}))(TWO_DIGIT_YEAR);

export const CONSOLE_OVERRIDE_TO_VALID_NAMESPACE = {
  [ConsoleOverride.XBOX_ONE]: ["xbox"],
  [ConsoleOverride.PS4]: ["ps3", "psn"],
  [ConsoleOverride.PC]: ["cem_ea_id"],
  [ConsoleOverride.PS5]: ["ps3", "psn"],
  [ConsoleOverride.XBOX_X]: ["xbox"],
  [ConsoleOverride.STADIA]: ["stadia"],
};

export const SystemConsole = {
  XBOX_ONE: "xone",
  PS4: "ps4",
  PC: "pc",
  PS5: "ps5",
  XBOX_X: "xbsx",
  STADIA: "stadia",
};

// Gen-specific naming (Snallabot pattern: add -gen5 for ps5/xbsx)
export const BLAZE_SERVICE = ((a) => ({
  xone: `madden-${a}-xone`,
  ps4: `madden-${a}-ps4`,
  pc: `madden-${a}-pc`,
  ps5: `madden-${a}-ps5`,
  xbsx: `madden-${a}-xbsx`,
  stadia: `madden-${a}-stadia`,
}))(YEAR);

export const BLAZE_PRODUCT_NAME = ((a) => ({
  xone: `madden-${a}-xone-mca`,
  ps4: `madden-${a}-ps4-mca`,
  pc: `madden-${a}-pc-mca`,
  ps5: `madden-${a}-ps5-mca`,
  xbsx: `madden-${a}-xbsx-mca`,
  stadia: `madden-${a}-stadia-mca`,
}))(YEAR);

// Some EA deployments still use non-gen suffixes; provide both to retry on 404.
export function getServiceVariantsForConsole(consoleKey) {
  const service = BLAZE_SERVICE[consoleKey];
  const product = BLAZE_PRODUCT_NAME[consoleKey];
  if (!service || !product) return [];
  return [{ service, product }];
}

export const LeagueData = {
  TEAMS: "CareerMode_GetLeagueTeamsExport",
  STANDINGS: "CareerMode_GetStandingsExport",
  WEEKLY_SCHEDULE: "CareerMode_GetWeeklySchedulesExport",
  TEAM_ROSTER: "CareerMode_GetTeamRostersExport",
  RUSHING_STATS: "CareerMode_GetWeeklyRushingStatsExport",
  TEAM_STATS: "CareerMode_GetWeeklyTeamStatsExport",
  PUNTING_STATS: "CareerMode_GetWeeklyPuntingStatsExport",
  RECEIVING_STATS: "CareerMode_GetWeeklyReceivingStatsExport",
  DEFENSIVE_STATS: "CareerMode_GetWeeklyDefensiveStatsExport",
  KICKING_STATS: "CareerMode_GetWeeklyKickingStatsExport",
  PASSING_STATS: "CareerMode_GetWeeklyPassingStatsExport",
};

export const Stage = {
  PRESEASON: 0,
  SEASON: 1,
};
