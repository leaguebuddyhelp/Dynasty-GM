export function isDraftRookie(player) {
  const yearsPro = player?.yearsPro;
  if (yearsPro !== undefined && yearsPro !== null && yearsPro !== '') {
    return Number(yearsPro) === 0;
  }
  return player?.isRookie === true;
}
