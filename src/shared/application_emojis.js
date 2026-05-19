const emojiState = {
  byName: new Map(),
  dataByName: new Map(),
  lastFetchedAt: 0,
  ready: false,
};

const TEAM_EMOJI_ALIASES = {
  'arizona cardinals': ['ari', 'az', 'cardinals', 'arizona'],
  'atlanta falcons': ['atl', 'falcons', 'atlanta'],
  'baltimore ravens': ['bal', 'ravens', 'baltimore'],
  'buffalo bills': ['buf', 'bills', 'buffalo'],
  'carolina panthers': ['car', 'panthers', 'carolina'],
  'chicago bears': ['chi', 'bears', 'chicago'],
  'cincinnati bengals': ['cin', 'bengals', 'cincinnati'],
  'cleveland browns': ['cle', 'browns', 'cleveland'],
  'dallas cowboys': ['dal', 'cowboys', 'dallas'],
  'denver broncos': ['den', 'broncos', 'denver'],
  'detroit lions': ['det', 'lions', 'detroit'],
  'green bay packers': ['gb', 'packers', 'greenbay', 'green', 'bay'],
  'houston texans': ['hou', 'texans', 'houston'],
  'indianapolis colts': ['ind', 'colts', 'indy', 'indianapolis'],
  'jacksonville jaguars': ['jax', 'jac', 'jaguars', 'jags', 'jacksonville'],
  'kansas city chiefs': ['kc', 'chiefs', 'kansascity'],
  'las vegas raiders': ['lv', 'raiders', 'lasvegas', 'vegas', 'oak', 'oakland'],
  'los angeles chargers': ['lac', 'chargers', 'bolts', 'la', 'losangeles', 'sd', 'sandiego'],
  'los angeles rams': ['lar', 'rams', 'la', 'losangeles', 'stl', 'stlouis'],
  'miami dolphins': ['mia', 'dolphins', 'fins', 'phins', 'miami'],
  'minnesota vikings': ['min', 'vikings', 'vikes', 'minnesota'],
  'new england patriots': ['ne', 'patriots', 'pats', 'newengland'],
  'new orleans saints': ['no', 'saints', 'nola', 'neworleans'],
  'new york giants': ['nyg', 'giants', 'gmen', 'newyorkgiants'],
  'new york jets': ['nyj', 'jets', 'newyorkjets'],
  'philadelphia eagles': ['phi', 'eagles', 'philadelphia', 'philly'],
  'pittsburgh steelers': ['pit', 'steelers', 'pittsburgh'],
  'san francisco 49ers': ['sf', '49ers', 'niners', 'sanfrancisco'],
  'seattle seahawks': ['sea', 'seahawks', 'hawks', 'seattle'],
  'tampa bay buccaneers': ['tb', 'bucs', 'buccaneers', 'tampa', 'tampabay'],
  'tennessee titans': ['ten', 'titans', 'tennessee'],
  'washington commanders': ['was', 'wsh', 'wsn', 'commanders', 'washington', 'washingtonfootballteam', 'footballteam'],
};

const DEV_TRAIT_NAMES = {
  hidden: ['hidden_dev'],
  0: ['normal_dev'],
  1: ['star_dev'],
  2: ['superstar_dev'],
  3: ['xfactor_dev'],
};

const RECOGNITION_EMOJI_IDS = {
  prod: {
    activity: '1506342706862096536',
    legacy: '1506342070149976226',
    impact: '1506342069222903978',
  },
  dev: {
    activity: '1506342672057630791',
    legacy: '1506335999939186789',
    impact: '1506337456998322228',
  },
};

function normalizeEmojiKey(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isExactAliasMatch(normalized, canonicalKey, aliasKeys) {
  return normalized === canonicalKey || aliasKeys.some((alias) => alias === normalized);
}

function isStrongFuzzyAliasMatch(normalized, canonicalKey, aliasKeys) {
  const strongCanonical = canonicalKey.length >= 5 && (canonicalKey.includes(normalized) || normalized.includes(canonicalKey));
  if (strongCanonical) return true;
  return aliasKeys.some((alias) => alias.length >= 4 && (alias.includes(normalized) || normalized.includes(alias)));
}

export async function refreshApplicationEmojiMap(client) {
  if (!client?.application) return emojiState;
  try {
    await client.application.fetch();
    const collection = await client.application.emojis.fetch();
    const next = new Map();
    const nextData = new Map();
    for (const emoji of collection.values()) {
      if (!emoji?.name || !emoji?.id) continue;
      const key = normalizeEmojiKey(emoji.name);
      next.set(
        key,
        `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`,
      );
      nextData.set(key, {
        id: String(emoji.id),
        name: String(emoji.name),
        animated: emoji.animated === true,
      });
    }
    emojiState.byName = next;
    emojiState.dataByName = nextData;
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

export function getApplicationEmojiData(name) {
  if (!name) return null;
  return emojiState.dataByName.get(normalizeEmojiKey(name)) || null;
}

export function findApplicationEmoji(candidates = [], fallback = '') {
  for (const candidate of candidates) {
    const emoji = getApplicationEmoji(candidate);
    if (emoji) return emoji;
  }
  return fallback;
}

export function findApplicationEmojiData(candidates = []) {
  for (const candidate of candidates) {
    const emoji = getApplicationEmojiData(candidate);
    if (emoji) return emoji;
  }
  return null;
}

function getRecognitionEmojiFallback(tier) {
  const key = normalizeEmojiKey(tier);
  const env = String(process.env.APP_ENV || process.env.NODE_ENV || '').toLowerCase();
  const scope = env === 'prod' || env === 'production' ? 'prod' : 'dev';
  const id = RECOGNITION_EMOJI_IDS[scope]?.[key];
  return id ? `<:${key}:${id}>` : '•';
}

export function getRecognitionEmoji(tier) {
  return findApplicationEmoji([tier], getRecognitionEmojiFallback(tier));
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
  const exactMatches = [];
  const fuzzyMatches = [];
  for (const [canonical, aliases] of Object.entries(TEAM_EMOJI_ALIASES)) {
    const canonicalKey = normalizeEmojiKey(canonical);
    const aliasKeys = aliases.map(normalizeEmojiKey);
    if (isExactAliasMatch(normalized, canonicalKey, aliasKeys)) {
      exactMatches.push(...aliases);
      continue;
    }
    if (isStrongFuzzyAliasMatch(normalized, canonicalKey, aliasKeys)) {
      fuzzyMatches.push(...aliases);
    }
  }
  const matches = new Set(exactMatches.length ? exactMatches : fuzzyMatches);
  if (!matches.size) {
    matches.add(normalized);
    matches.add(teamName);
    const raw = String(teamName || '').trim().toLowerCase();
    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length) {
      matches.add(parts[parts.length - 1]);
      matches.add(parts.join(''));
      if (parts.length >= 2) matches.add(parts.slice(-2).join(''));
    }
  }
  return [...matches];
}

export function getTeamApplicationEmoji(teamName = '', fallback = '') {
  const candidates = getTeamEmojiCandidates(teamName);
  return findApplicationEmoji(candidates, fallback);
}

export function getTeamApplicationEmojiData(teamName = '') {
  const candidates = getTeamEmojiCandidates(teamName);
  return findApplicationEmojiData(candidates);
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
