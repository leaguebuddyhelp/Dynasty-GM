const descriptions = {
  roster: 'View a franchise team roster with ratings, contracts, and development traits.',
  playersearch: 'Find a player in your imported franchise.',
  schedule: 'Browse your franchise schedule and game results.',
  mockdraft: 'Generate a first-round mock draft from the current class and franchise data.',
  bigboard: 'Browse the current franchise draft class.',
};
export function commandDescription(key) { return descriptions[key] || 'Open your franchise tools.'; }
export function voiceFooter(key, fallback = '') { return key === 'roster' ? 'Franchise roster' : fallback; }
export function errorBlurb(key, fallback = '') {
  if (key === 'noLeague') return 'Connect your franchise using `/setup` first.';
  if (key === 'noSnapshot') return 'Run `/sync` to import your franchise data first.';
  return fallback || 'The franchise report could not be built.';
}
