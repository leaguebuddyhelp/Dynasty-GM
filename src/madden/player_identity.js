function cleanPart(value) {
  const text = String(value ?? '').trim();
  return text && text !== 'null' && text !== 'undefined' ? text : '';
}

export function stablePlayerKey(player = {}) {
  const presentationId = cleanPart(player.presentationId ?? player.presentationID ?? player.assetName);
  const birthYear = cleanPart(player.birthYear);
  const birthMonth = cleanPart(player.birthMonth);
  const birthDay = cleanPart(player.birthDay);
  if (presentationId && birthYear && birthMonth && birthDay) {
    return `bio:${presentationId}:${birthYear}:${birthMonth}:${birthDay}`;
  }

  const firstName = cleanPart(player.firstName);
  const lastName = cleanPart(player.lastName);
  const fullName = cleanPart(player.fullName) || [firstName, lastName].filter(Boolean).join(' ');
  const position = cleanPart(player.position);
  if (fullName && position && birthYear) {
    return `name:${fullName.toLowerCase()}:${position}:${birthYear}`;
  }

  const rosterId = cleanPart(player.rosterId);
  if (rosterId) return `roster:${rosterId}`;

  const teamId = cleanPart(player.teamId);
  if (fullName || teamId || position) {
    return `fallback:${fullName.toLowerCase()}:${position}:${teamId}`;
  }

  return '';
}

export default { stablePlayerKey };
