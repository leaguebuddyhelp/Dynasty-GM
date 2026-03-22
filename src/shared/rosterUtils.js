
export function deriveAge(player) {
  // If birthdate exists, compute as of Oct 20 of current season year (season 1 -> 2025)
  try {
    if (player.birthdate) {
      let seasonNo = 1;
      try {
        const seasonPath = path.join(process.cwd(), 'data', 'season.json');
        if (fs.existsSync(seasonPath)) {
          const s = JSON.parse(fs.readFileSync(seasonPath, 'utf8'));
          if (s.seasonNo) seasonNo = Number(s.seasonNo);
        }
      } catch { /* ignore */ }
      // Base start date is Oct 20, 2025 for season 1; seasonNo advances the year
      const seasonYear = 2024 + seasonNo; // season 1 -> 2025, season 2 -> 2026, etc.
      const ref = new Date(`${seasonYear}-10-20`);
      const birth = new Date(player.birthdate);
      let age = ref.getFullYear() - birth.getFullYear();
      if (ref < new Date(ref.getFullYear(), birth.getMonth(), birth.getDate())) age--;
      return age;
    }
  } catch { /* ignore */ }
  const ageField = player.age ?? player.Age;
  return Number(ageField) || (Number(player.yearsInNBA ?? player.YearsInNBA) + 19) || 24;
}

export function deriveContract(player) {
  const years = Array.isArray(player.contractYears) ? player.contractYears : [];
  const salaryStr = years[0]?.salary || player.salary || player.Salary || '';
  // If salary is missing, use a neutral ~$10M so values don't spike from "free" contracts
  let salary = Number(String(salaryStr).replace(/[^0-9.]/g, '')) || 0;
  if (salary === 0) salary = 10_000_000;
  const yearsLeft = years.length || Number(player.contractYearsLeft || player.ContractYearsLeft || 0) || 1;
  return { salary, yearsLeft };
}

// Resolve fuzzy team labels (nicknames, coach role names) to roster file names
export function resolveTeamNameForRoster(name) {
  const input = (name || '').replace(/coach$/i, '').trim();
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  let teams = [];
  try {
    teams = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'teams.json'), 'utf8'));
  } catch { /* ignore */ }

  // direct nickname map
  const aliases = {
    'cavs': 'Cleveland Cavaliers',
    'cavaliers': 'Cleveland Cavaliers',
    'lac': 'Los Angeles Clippers',
    'laclippers': 'Los Angeles Clippers',
    'laclips': 'Los Angeles Clippers',
    'losangelesclippers': 'Los Angeles Clippers',
    'sixers': 'Philadelphia 76ers',
    '76ers': 'Philadelphia 76ers',
    'dubs': 'Golden State Warriors',
    'warriors': 'Golden State Warriors',
    'pels': 'New Orleans Pelicans',
    'peli': 'New Orleans Pelicans',
    'blazers': 'Portland Trail Blazers',
    'clips': 'Los Angeles Clippers',
    'lakers': 'Los Angeles Lakers',
    'knicks': 'New York Knicks',
    'nets': 'Brooklyn Nets',
    'mavs': 'Dallas Mavericks',
    'wolves': 'Minnesota Timberwolves',
    'twolves': 'Minnesota Timberwolves',
    'spurs': 'San Antonio Spurs',
    'suns': 'Phoenix Suns',
    'thunder': 'Oklahoma City Thunder',
    'wiz': 'Washington Wizards',
    'bucks': 'Milwaukee Bucks',
    'bulls': 'Chicago Bulls',
    'heat': 'Miami Heat',
    'magic': 'Orlando Magic',
    'pistons': 'Detroit Pistons',
    'hornets': 'Charlotte Hornets',
    'hawks': 'Atlanta Hawks',
    'jazz': 'Utah Jazz',
    'kings': 'Sacramento Kings',
    'raptors': 'Toronto Raptors',
    'rockets': 'Houston Rockets',
    'pacers': 'Indiana Pacers',
    'grizzlies': 'Memphis Grizzlies',
    'nuggets': 'Denver Nuggets',
    'pelicans': 'New Orleans Pelicans',
    'celtics': 'Boston Celtics',
  };
  const nick = aliases[norm(input)];
  if (nick) return nick;

  const candidates = teams.length ? teams : [];
  const match = candidates.find(t => {
    const names = [
      t.name,
      t.abbreviation,
      t.nickname,
      t.city,
    ].filter(Boolean).map(norm);
    const n = norm(input);
    return names.some(v => {
      if (!v) return false;
      // Abbreviations (<=3 chars) must match exactly to avoid substring collisions (e.g., "MB" in "Timberwolves")
      if (v.length <= 3) return v === n;
      return v === n || v.includes(n) || n.includes(v);
    });
  });
  return match?.name || input;
}

// Convert a human team string ("Milwaukee Bucks") into plausible file name variants.
function rosterFileCandidates(team) {
  const cleaned = normalizeName(team);
  const variants = new Set();
  const add = (s) => variants.add(s.replace(/_+/g, '_').replace(/^_+|_+$/g, ''));
  add(cleaned);
  add(cleaned.replace(/\s+/g, '_'));
  add(cleaned.replace(/[^A-Za-z0-9]+/g, '_'));
  add(cleaned.replace(/&/g, 'and').replace(/[^A-Za-z0-9]+/g, '_'));
  add(cleaned + '.json'); // allow bare name or with extension
  return [...variants].filter(Boolean);
}

export function readRoster(team, opts = {}) {
  const aliasMap = {
    heat: 'Miami Heat',
    suns: 'Phoenix Suns',
    celtics: 'Boston Celtics',
    knicks: 'New York Knicks',
    nets: 'Brooklyn Nets',
    lakers: 'Los Angeles Lakers',
    clippers: 'Los Angeles Clippers',
    warriors: 'Golden State Warriors',
    sixers: 'Philadelphia 76ers',
    '76ers': 'Philadelphia 76ers',
    pels: 'New Orleans Pelicans',
    pelicans: 'New Orleans Pelicans',
    wolves: 'Minnesota Timberwolves',
    twolves: 'Minnesota Timberwolves',
    blazers: 'Portland Trail Blazers',
    mavs: 'Dallas Mavericks',
    spurs: 'San Antonio Spurs',
    jazz: 'Utah Jazz',
    bucks: 'Milwaukee Bucks',
  };
  const force2k = !!opts.force2k;
  const alias = aliasMap[String(team || '').toLowerCase()] || team;
  const rostersDirs = force2k
    ? [path.join(process.cwd(), 'data', '2k', 'teams_rosters')]
    : [
      path.join(process.cwd(), 'data', '2k', 'teams_rosters'),
      path.join(process.cwd(), 'teams_rosters'),
      path.join(process.cwd(), 'data', 'teams_rosters'),
    ];

  const candidates = rosterFileCandidates(alias).map(name => `${name}.json`);

  for (const dir of rostersDirs) {
    if (!fs.existsSync(dir)) continue;

    for (const candidate of candidates) {
      const full = path.join(dir, candidate);
      if (fs.existsSync(full)) {
        try {
          const raw = JSON.parse(fs.readFileSync(full, 'utf-8'));
          const roster = normalizeRosterShape(raw);
          return { rosterPath: full, roster };
        } catch {
          return null;
        }
      }
    }

    // Fallback: case-insensitive scan within this dir
    try {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      const lower = candidates.map(c => c.toLowerCase());
      const match = files.find(f => lower.includes(f.toLowerCase()));
      if (match) {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, match), 'utf-8'));
        const roster = normalizeRosterShape(raw);
        return { rosterPath: path.join(dir, match), roster };
      }
    } catch {
      // ignore and try next dir
    }
  }

  return null;
}

function normalizeRosterShape(raw) {
  if (!raw) return { players: [], picks: [] };
  if (Array.isArray(raw)) return { players: raw, picks: [] };
  if (Array.isArray(raw.players)) {
    return { ...raw, players: raw.players, picks: Array.isArray(raw.picks) ? raw.picks : [] };
  }
  if (Array.isArray(raw.roster?.players)) {
    return { ...raw.roster, players: raw.roster.players, picks: Array.isArray(raw.roster.picks) ? raw.roster.picks : [] };
  }
  if (Array.isArray(raw.players)) {
    return { players: raw.players, picks: Array.isArray(raw.picks) ? raw.picks : [] };
  }
  return { players: [], picks: [] };
}

// Ensure pick entries have a fixed value; convert strings to {pick, value}
export function ensurePickValues(roster) {
  if (!roster || typeof roster !== 'object') return roster;
  const seasonYear = (() => {
    try {
      const seasonPath = path.join(process.cwd(), 'data', 'season.json');
      if (fs.existsSync(seasonPath)) {
        const s = JSON.parse(fs.readFileSync(seasonPath, 'utf8'));
        if (s.seasonYear) return Number(s.seasonYear);
        if (s.seasonNo) return 2025 + Number(s.seasonNo); // season 1 => 2026
      }
    } catch { /* ignore */ }
    return new Date().getFullYear();
  })();

  const picksArr = Array.isArray(roster.picks) ? roster.picks : [];
  const normalizePickObj = (p) => {
    if (typeof p === 'object' && p.pick && p.value != null) return p;
    const pickStr = typeof p === 'string' ? p : p?.pick || '';
    if (!pickStr) return p;
    const lower = pickStr.toLowerCase();
    const year = Number((lower.match(/(20\d{2})/) || [])[1]);
    const round = /1st|round 1/.test(lower) ? 1 : /2nd|round 2/.test(lower) ? 2 : null;
    const prot = (() => {
      if (/lottery/.test(lower)) return 'lottery';
      if (/top\s*10/.test(lower)) return 'top 10';
      if (/top\s*5/.test(lower)) return 'top 5';
      if (/top\s*3/.test(lower)) return 'top 3';
      return null;
    })();
    const val = round ? computePickValue2k(year || seasonYear, round, null, seasonYear, prot) : 0;
    return { pick: pickStr, value: val };
  };
  roster.picks = picksArr.map(normalizePickObj);
  return roster;
}

export function saveRoster(teamOrPath, roster) {
  // If a path is provided, write directly
  if (typeof teamOrPath === 'string' && /\.json$/i.test(teamOrPath)) {
    try {
      fs.mkdirSync(path.dirname(teamOrPath), { recursive: true });
      fs.writeFileSync(teamOrPath, JSON.stringify(roster, null, 2));
      return true;
    } catch (err) {
      console.error('[saveRoster] failed to write path', teamOrPath, err);
      return false;
    }
  }

  const team = teamOrPath;
  const candidates = rosterFileCandidates(team).map(name => `${name}.json`);
  const targets = [];

  // Prefer existing files in 2k rosters to avoid creating new variants
  const dir2k = path.join(process.cwd(), 'data', '2k', 'teams_rosters');
  if (fs.existsSync(dir2k)) {
    const files = fs.readdirSync(dir2k).filter(f => f.endsWith('.json'));
    const lowerFiles = files.map(f => f.toLowerCase());
    for (const c of candidates) {
      const idx = lowerFiles.indexOf(c.toLowerCase());
      if (idx !== -1) {
        targets.push(path.join(dir2k, files[idx]));
        break; // first existing match is enough
      }
    }
    // If no existing match, still add first candidate in 2k dir
    targets.push(path.join(dir2k, candidates[0]));
  }

  // Fallback legacy dir
  targets.push(path.join(process.cwd(), 'data', 'teams_rosters', `${candidates[0]}`));
  // Save to first available directory (preferring 2k path) and ensure dir exists
  for (const file of targets) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(roster, null, 2));
      return true;
    } catch {
      // try next target
    }
  }
  console.error('[saveRoster] failed for team', team);
  return false;
}

export function upsertPlayer(roster, player) {
  const arr = Array.isArray(roster) ? roster : Array.isArray(roster?.players) ? roster.players : null;
  if (!Array.isArray(arr)) {
    throw new TypeError('upsertPlayer expected roster array');
  }
  const ovrNum = (p = {}) => Number(p.ovr ?? p.OVR ?? p.rating ?? p.Rating ?? p.overall ?? p.Overall ?? 0);
  // Match strictly by id if provided, else by exact name (no fuzzy/substring) to avoid removing similar names.
  let existingIndex = -1;
  if (player.id) {
    existingIndex = arr.findIndex(p => p.id === player.id);
  }
  if (existingIndex === -1) {
    existingIndex = arr.findIndex(p => p.name === player.name);
  }
  if (existingIndex >= 0) {
    arr[existingIndex] = { ...arr[existingIndex], ...player };
  } else {
    arr.push(player);
  }
  // keep roster sorted by OVR descending for display/exports
  arr.sort((a, b) => ovrNum(b) - ovrNum(a));
  // keep wrapper in sync
  if (Array.isArray(roster?.players)) roster.players = arr;
  return arr;
}

// Remove a player from all other rosters (fuzzy by name); returns true if removed
export function removePlayerFromOtherRostersFuzzy(playerName) {
  const rosterDirs = [
    path.join(process.cwd(), 'data', '2k', 'teams_rosters'),
    path.join(process.cwd(), 'data', 'teams_rosters'),
  ];

  let removed = false;

  for (const dir of rosterDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const full = path.join(dir, file);
      try {
        const roster = JSON.parse(fs.readFileSync(full, 'utf-8'));
        const arr = Array.isArray(roster) ? roster : Array.isArray(roster?.players) ? roster.players : null;
        if (!Array.isArray(arr)) continue;

        const idx = arr.findIndex(p => normalizeName(p.name) === normalizeName(playerName));
        if (idx >= 0) {
          arr.splice(idx, 1);
          if (Array.isArray(roster?.players)) {
            roster.players = arr;
            fs.writeFileSync(full, JSON.stringify(roster, null, 2));
          } else {
            fs.writeFileSync(full, JSON.stringify(arr, null, 2));
          }
          removed = true;
        }
      } catch (e) {
        console.error(`[rosterUtils] Failed to update ${file}:`, e);
      }
    }
  }

  return removed;
}
