import { getFullTeamName } from './madden_team_names.js';
import { getTeamApplicationEmoji } from './application_emojis.js';

export function getTeamEmojiByName(teamName = '') {
  return getTeamApplicationEmoji(teamName, '');
}

export function getTeamEmoji(team = null) {
  if (!team) return '';
  return getTeamEmojiByName(
    getFullTeamName(team, '') ||
    team?.displayName ||
    team?.nickName ||
    team?.cityName ||
    '',
  );
}

export function formatTeamLabelWithEmoji(teamName = '') {
  const emoji = getTeamEmojiByName(teamName);
  return emoji ? `${emoji} ${teamName}` : teamName;
}
