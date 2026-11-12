import { EmbedBuilder } from 'discord.js';

export function buildTeamReportIndex({ title, description, reports }) {
  const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor(0x5865f2);
  const links = reports.slice(0, 32).map(({ teamName, url }) => `[${String(teamName).replace(/[\[\]\\*_~`]/g, '').slice(0, 50)}](${url})`);
  for (let offset = 0; offset < links.length; offset += 6) {
    embed.addFields({ name: offset ? 'More teams' : 'Open your team’s report', value: links.slice(offset, offset + 6).join('\n') });
  }
  return embed;
}

export function appendProgressionResultFields(embed, progression) {
  if (!progression) return embed;
  const week = /_week_(\d+)$/.exec(progression.periodKey || '')?.[1];
  const fullSeason = progression.mode === 'full-season' && progression.status === 'complete';
  const value = fullSeason
    ? `**${progression.recommendationCount} players · 18 weekly evaluations**\nAttribute points: +${progression.seasonTotals.positivePoints} / −${progression.seasonTotals.negativePoints} · Net ${progression.seasonTotals.netPoints}\n${progression.awardsPosted} weekly awards posts\n[Open your team’s season changes](${progression.reportUrl})\nApply the final targets in your team thread once.`
    : progression.error ? `Failed: ${progression.error}`
    : progression.published
      ? `**${progression.recommendationCount} player changes** · ${progression.upgradeCount} upgrades · ${progression.downgradeCount} downgrades${progression.reportUrl ? `\n[Open weekly changes](${progression.reportUrl})` : ''}`
      : progression.reason || 'No rating changes were issued.';
  embed.addFields({ name: fullSeason ? 'Full-season attribute totals' : week ? `Player changes · Week ${week}` : 'Player changes', value: value.slice(0, 1024) });
  if (progression.seasonChangesError) {
    embed.addFields({ name: 'Top 10 growers / fallers', value: `Failed: ${progression.seasonChangesError}`.slice(0, 1024) });
  } else if (progression.seasonChanges) {
    embed.addFields({ name: 'Top 10 growers / fallers', value: `Updated for **${progression.seasonChanges.teamCount} teams**${progression.seasonChanges.indexUrl ? `\n[Open all team lists](${progression.seasonChanges.indexUrl})` : ''}` });
  }
  return embed;
}
