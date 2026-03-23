const emojiState = {
  byName: new Map(),
  lastFetchedAt: 0,
  ready: false,
};

const TEAM_EMOJI_ALIASES = {
  'arizona cardinals': ['ari', 'az', 'cardinals'],
  'atlanta falcons': ['atl', 'falcons'],
  'baltimore ravens': ['bal', 'ravens'],
  'buffalo bills': ['buf', 'bills'],
  'carolina panthers': ['car', 'panthers'],
  'chicago bears': ['chi', 'bears'],
  'cincinnati bengals': ['cin', 'bengals'],
  'cleveland browns': ['cle', 'browns'],
  'dallas cowboys': ['dal', 'cowboys'],
  'denver broncos': ['den', 'broncos'],
  'detroit lions': ['det', 'lions'],
  'green bay packers': ['gb', 'packers'],
  'houston texans': ['hou', 'texans'],
  'indianapolis colts': ['ind', 'colts'],
  'jacksonville jaguars': ['jax', 'jaguars', 'jags'],
  'kansas city chiefs': ['kc', 'chiefs'],
  'las vegas raiders': ['lv', 'raiders'],
  'los angeles chargers': ['lac', 'chargers', 'bolts'],
  'los angeles rams': ['lar', 'rams'],
  'miami dolphins': ['mia', 'dolphins', 'fins', 'phins'],
  'minnesota vikings': ['min', 'vikings', 'vikes'],
  'new england patriots': ['ne', 'patriots', 'pats'],
  'new orleans saints': ['no', 'saints'],
  'new york giants': ['nyg', 'giants', 'gmen'],
  'new york jets': ['nyj', 'jets'],
  'philadelphia eagles': ['phi', 'eagles'],
  'pittsburgh steelers': ['pit', 'steelers'],
  'san francisco 49ers': ['sf', '49ers', 'niners'],
  'seattle seahawks': ['sea', 'seahawks', 'hawks'],
  'tampa bay buccaneers': ['tb', 'bucs', 'buccaneers'],
  'tennessee titans': ['ten', 'titans'],
  'washington commanders': ['was', 'wsh', 'commanders'],
};

const DEV_TRAIT_NAMES = {
  hidden: ['hidden_dev'],
  0: ['normal_dev'],
  1: ['star_dev'],
  2: ['superstar_dev'],
  3: ['xfactor_dev'],
};

function normalizeEmojiKey(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

export async function refreshApplicationEmojiMap(client) {
  if (!client?.application) return emojiState;
  try {
    await client.application.fetch();
    const collection = await client.application.emojis.fetch();
    const next = new Map();
    for (const emoji of collection.values()) {
      if (!emoji?.name || !emoji?.id) continue;
      next.set(
        normalizeEmojiKey(emoji.name),
        `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`,
      );
    }
    emojiState.byName = next;
    emojiState.lastFetchedAt = Date.now();
    emojiState.ready = true;
    console.log('[app-emojis] loaded', { count: next.size });
  } catch (error) {
    emojiState.ready = false;
    console.warn('[app-emojis] fetch failed', error?.message || error);
  }
  return emojiState;
}

export function getApplicationEmoji(name, fallback = '') {
  if (!name) return fallback;
  return emojiState.byName.get(normalizeEmojiKey(name)) || fallback;
}

export function findApplicationEmoji(candidates = [], fallback = '') {
  for (const candidate of candidates) {
    const emoji = getApplicationEmoji(candidate);
    if (emoji) return emoji;
  }
  return fallback;
}

export function getRecognitionEmoji(tier) {
  return findApplicationEmoji([tier], '•');
}

export function getDevTraitEmoji(devTrait, { fallbackText = true } = {}) {
  const key = devTrait == null ? 'hidden' : String(Number(devTrait));
  const emoji = findApplicationEmoji(DEV_TRAIT_NAMES[key] || []);
  if (emoji) return emoji;
  if (!fallbackText) return '';
  if (key === 'hidden') return 'Hidden';
  return ({ 0: 'Normal', 1: 'Star', 2: 'Superstar', 3: 'X-Factor' })[key] || 'Normal';
}

export function getTeamEmojiCandidates(teamName = '') {
  const normalized = normalizeEmojiKey(teamName);
  if (!normalized) return [];
  const matches = new Set();
  for (const [canonical, aliases] of Object.entries(TEAM_EMOJI_ALIASES)) {
    const canonicalKey = normalizeEmojiKey(canonical);
    const aliasKeys = aliases.map(normalizeEmojiKey);
    if (
      normalized === canonicalKey ||
      canonicalKey.includes(normalized) ||
      normalized.includes(canonicalKey) ||
      aliasKeys.some((alias) => alias === normalized || normalized.includes(alias) || alias.includes(normalized))
    ) {
      aliases.forEach((alias) => matches.add(alias));
    }
  }
  if (!matches.size) matches.add(teamName);
  return [...matches];
}

export function getTeamApplicationEmoji(teamName = '', fallback = '') {
  const candidates = getTeamEmojiCandidates(teamName);
  return findApplicationEmoji(candidates, fallback);
}

export function getLeagueBuddyLogoEmoji(fallback = '') {
  return findApplicationEmoji(
    ['leaguebuddy_official_logo', 'lb_official_logo', 'leaguebuddy_logo', 'leaguebuddy', 'lb_logo', 'lb'],
    fallback,
  );
}

export function isApplicationEmojiReady() {
  return emojiState.ready;
}
