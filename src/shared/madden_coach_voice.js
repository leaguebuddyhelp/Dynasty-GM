const COMMAND_DESCRIPTIONS = {
  franchisehub: 'Your private franchise desk: roster pulse, league leverage, and next moves.',
  fantasy: 'Open the Madden fantasy league hub and draft board.',
  gamestrategy: 'A matchup report with tendencies, weak spots, and weekly game-plan angles.',
  draftprimer: 'A draft-room brief with team needs, board pressure, and target lanes.',
  draftclass: 'Check which Madden draft class is locked for the current season.',
  help: 'Show the Madden command board for your role.',
  tradeblock: 'Post your market list and keep trade interest easy to find.',
  roster: 'Pull a roster card with contract, dev, and value context.',
  playersearch: 'Find any synced Madden player and open the quick card.',
  recruiting: 'Scan the current recruiting board and top incoming names.',
  streamlink: 'Post your stream with a matchup hook for the league.',
  mockdraft: 'Open the live mock draft built from the current board and order.',
  myscouts: 'Review your private scout board and reorder your targets.',
  schedule: 'Browse the live schedule and current week slate.',
  pickvalue: 'Check the pick value board before trade talks start.',
  scout: 'Spend scout points on current-class prospects.',
  bigboard: 'Browse the current draft class board in a clean league view.',
};

const TITLES = {
  coachCommands: 'Madden Coach Command Center',
  staffCommands: 'Madden Staff Command Center',
  lightHub: 'LEAGUEbuddy League Desk',
};

const FOOTERS = {
  coachOnly: 'Coach command board',
  staffOnly: 'Staff command board',
  privateLeagueHub: 'Private league desk',
  privateFranchiseHub: 'Private franchise briefing',
  strategy: 'Live weekly stats, roster state, injuries, standings, and matchup data.',
  roster: 'Live roster card',
  mockdraft: 'Live board, live order, live class',
};

const BLURBS = {
  noLeague: [
    'No Madden league is connected yet. Staff needs to run `/setup` and open the setup dashboard.',
    'No league feed on this server yet. Run `/setup`, connect Madden, then try this again.',
    'The league wire is empty right now. Connect it through `/setup` first.',
  ],
  noSnapshot: [
    'The latest Madden export is not on the board yet. Run `/sync` and try again.',
    'No fresh league snapshot is available. Sync the league feed, then reload this command.',
    'The data room is missing the current export. Refresh the league data first.',
  ],
  noTeam: [
    'You are not mapped to a Madden team yet. Staff can fix that with `/member assign` or `/member onboard`.',
    'No team assignment found for you. Have staff assign your squad, then run it back.',
    'Your coach profile is missing a team. Staff needs to attach you to one before this opens.',
  ],
  noRecruiting: [
    'No recruiting board is loaded for the current class yet.',
    'Recruiting board is empty for this class. Add the class file, then refresh the view.',
    'No recruiting names are on the sheet right now.',
  ],
  draftClassMissing: [
    'That draft class is not loaded. Add the current Big Board JSON under `bundled_data/draft_classes/madden`.',
    'The current class file is missing from the backend. Drop in the Big Board JSON and run it again.',
    'No Big Board file found for this class lock. Add the bundled class file first.',
  ],
  draftBoardMissing: [
    'The draft board is not loaded yet for this class.',
    'No board data is available for the current class lock.',
    'The mock room has the order, but not the class file yet.',
  ],
  scoutingClosed: [
    'Scouting opens after the Week 1 regular-season update and stays live through playoffs and offseason.',
    'The scout room is not open yet. Week 1 needs to hit first, then the board stays active.',
    'Hold the scout cards for now. Scouting unlocks after the Week 1 update.',
  ],
  noPlayers: [
    'No prospects matched that filter. Widen the search and take another swing.',
    'That search came up empty. Try a cleaner position or shorter name filter.',
    'No names on the board match that look right now.',
  ],
  alreadyScouted: [
    'That player is already fully scouted. Nothing left to uncover.',
    'You have the full report on that prospect already.',
    'That file is complete. Move to the next name on your board.',
  ],
  noScoutPoints: [
    'Not enough scout points for that pull.',
    'You are short on scout points for this reveal.',
    'The report costs more points than you have left in this window.',
  ],
  noScouts: [
    'No scouted players for the current class yet. Use `/scout` to start building your board.',
    'Your board is empty for this class. Scout a player first, then come back here.',
    'No private scout work is logged on this class yet.',
  ],
  bigBoardFailed: [
    'Could not load the big board right now. Refresh the class data and try again.',
    'The board did not come through cleanly. Check the class file and rerun it.',
    'Big board load missed. The current class data needs another look.',
  ],
  helpCoachIntro: [
    'Your league toolkit, sorted by what you are trying to do next.',
    'Everything a coach needs from week prep to draft work, in one board.',
    'The coach desk: schedule, roster, trades, scouting, and matchup prep.',
  ],
  helpStaffIntro: [
    'League control room: setup, coach movement, ops, and weekly maintenance.',
    'Staff tools for keeping the server clean and the season moving.',
    'The commish desk: assignments, syncs, threads, promos, and league ops.',
  ],
};

function hashText(value = '') {
  let hash = 0;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function coachCommandDescription(key, fallback = 'Coach-facing command.') {
  return COMMAND_DESCRIPTIONS[key] || fallback;
}

export function coachVoiceTitle(key, fallback = '') {
  return TITLES[key] || fallback;
}

export function coachVoiceFooter(key, fallback = '') {
  return FOOTERS[key] || fallback;
}

export function coachBlurb(key, options = {}, fallback = '') {
  const variants = BLURBS[key] || [];
  if (!variants.length) return fallback || '';
  const seed = options.seed || options.userId || options.guildId || options.teamName || key;
  return variants[hashText(`${key}:${seed}`) % variants.length];
}

export function coachPanelIntro(panel, options = {}) {
  if (panel === 'lightHub') {
    return 'You are outside the coach lane right now, but you can still track the league board and play the sportsbook angle.';
  }
  if (panel === 'franchiseHub') return '';
  if (panel === 'coachCommands') return coachBlurb('helpCoachIntro', options, 'Everything in your coach lane, cleaned up into one board.');
  if (panel === 'staffCommands') return coachBlurb('helpStaffIntro', options, 'Staff controls, league ops, and maintenance tools in one place.');
  return '';
}

export function coachErrorBlurb(key, fallback = 'The board could not be built right now.', options = {}) {
  return coachBlurb(key, options, fallback) || fallback;
}

export function coachSentenceVariants(key) {
  return [...(BLURBS[key] || [])];
}
