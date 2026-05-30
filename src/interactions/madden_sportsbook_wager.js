import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { inferRecognitionContext } from '../shared/league_recognition.js';
import { formatImpactValue, getLineForBet, getSportsbookParlaySlip, parlayPrice, linePrice, payoutBreakdown } from '../shared/madden_sportsbook.js';

export const customId_wager = /^madden_sportsbook_(wager|parlay_wager)\|/;

function selectionLabel(market, selection) {
  if (market === 'prop') return selection === 'under' ? 'Under prop' : 'Over prop';
  if (market === 'superbowl') return 'Super Bowl winner';
  if (market === 'total') return selection === 'over' ? 'Over' : 'Under';
  if (market === 'moneyline') return selection === 'away' ? 'Away ML' : 'Home ML';
  return selection === 'away' ? 'Away spread' : 'Home spread';
}

export async function execute_wager(interaction) {
  if (String(interaction.customId || '').startsWith('madden_sportsbook_parlay_wager|')) {
    const [, weekNumber] = interaction.customId.split('|');
    const wagerRaw = String(interaction.fields.getTextInputValue('wager') || '').trim();
    if (!/^\d+$/.test(wagerRaw)) {
      await interaction.reply({ content: 'Bet amount must be a whole number only.', flags: 64 });
      return;
    }
    const wager = Number(wagerRaw);
    const context = inferRecognitionContext('madden', interaction.guildId);
    const seasonKey = context?.seasonKey;
    if (!seasonKey) {
      await interaction.reply({ content: 'Recognition season context is not ready yet.', flags: 64 });
      return;
    }
    const slip = getSportsbookParlaySlip({ seasonKey, userId: interaction.user.id });
    if (!slip.legs?.length || slip.legs.length < 2) {
      await interaction.reply({ content: 'Add at least 2 legs before placing a parlay.', flags: 64 });
      return;
    }
    const odds = parlayPrice(slip.legs);
    const payout = payoutBreakdown(wager, odds);
    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle('Confirm This Parlay')
      .setDescription([
        `${slip.legs.length}-leg parlay`,
        slip.legs.map((leg, idx) => `${idx + 1}. ${leg.betLabel}`).join('\n'),
        '',
        `Bet: ${formatImpactValue(wager)}`,
        `Odds: ${odds > 0 ? '+' : ''}${odds}`,
        `If it wins: +${formatImpactValue(payout?.profit || 0)}`,
        `You get back: ${formatImpactValue(payout?.totalReturn || 0)} total`,
        '',
        'Are you sure you want to place this parlay?',
      ].join('\n'))
      .setTimestamp();
    const controls = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`madden_sportsbook_parlay_pick|${weekNumber}|${wager}`)
        .setLabel('Confirm Parlay')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`madden_sportsbook_cancel|${weekNumber}|parlay|parlay|all`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );
    await interaction.reply({ embeds: [embed], components: [controls], flags: 64 });
    return;
  }

  const [, weekNumber, gameId, market, selection] = interaction.customId.split('|');
  const wagerRaw = String(interaction.fields.getTextInputValue('wager') || '').trim();
  if (!/^\d+$/.test(wagerRaw)) {
    await interaction.reply({ content: 'Bet amount must be a whole number only.', flags: 64 });
    return;
  }
  const wager = Number(wagerRaw);
  if (!Number.isInteger(wager) || wager < 1) {
    await interaction.reply({ content: 'Bet amount must be at least 1 Impact.', flags: 64 });
    return;
  }
  const context = inferRecognitionContext('madden', interaction.guildId);
  const seasonKey = context?.seasonKey;
  if (!seasonKey) {
    await interaction.reply({ content: 'Recognition season context is not ready yet.', flags: 64 });
    return;
  }

  const line = getLineForBet(seasonKey, Number(weekNumber), gameId);
  if (!line) {
    await interaction.reply({ content: 'This line is not available anymore.', flags: 64 });
    return;
  }
  const odds = linePrice(line, market, selection);
  const payout = payoutBreakdown(Number(wager), odds);

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('Confirm This Bet')
    .setDescription([
      market === 'superbowl' ? 'Super Bowl Winner Futures' : `${line.awayTeam} at ${line.homeTeam}`,
      `Pick: ${selectionLabel(market, selection)}`,
      market === 'prop' ? `Prop: ${line.playerName} ${selection === 'under' ? 'Under' : 'Over'} ${line.line} ${line.propType || 'prop'}` : null,
      market === 'superbowl' ? `Team: ${line.teamName}` : null,
      `Bet: ${formatImpactValue(wager)}`,
      `Odds: ${odds > 0 ? '+' : ''}${odds}`,
      `If it wins: +${formatImpactValue(payout?.profit || 0)}`,
      `You get back: ${formatImpactValue(payout?.totalReturn || 0)} total`,
      '',
      'Are you sure you want to place this bet?',
    ].filter(Boolean).join('\n'))
    .setTimestamp();
  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`madden_sportsbook_confirm|${weekNumber}|${gameId}|${market}|${selection}|${wager}`)
      .setLabel('Confirm Bet')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`madden_sportsbook_cancel|${weekNumber}|${gameId}|${market}|${selection}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({ embeds: [embed], components: [controls], flags: 64 });
}

export default { customId_wager, execute_wager };
