import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, EmbedBuilder } from 'discord.js';
import { inferRecognitionContext } from '../shared/league_recognition.js';
import { addSportsbookParlayLeg, clearSportsbookParlay, buyoutSportsbookBet, formatImpactValue, getLineForBet, getSportsbookLimits, getSportsbookParlaySlip, getSportsbookUserCard, linePrice, parlayPrice, payoutBreakdown, placeSportsbookBet, placeSportsbookParlay, sportsbookModal } from '../shared/madden_sportsbook.js';
import { appendMaddenStaffLog, postMaddenStaffDecision } from '../shared/madden_staff_ops.js';

export const customId = /^madden_sportsbook_(bet(?:\||_)|confirm\||cancel\||buyout\||parlay_)/;

function selectionLabel(market, selection) {
  if (market === 'prop') return selection === 'under' ? 'Under prop' : 'Over prop';
  if (market === 'superbowl') return 'Super Bowl winner';
  if (market === 'total') return selection === 'over' ? 'Over' : 'Under';
  if (market === 'moneyline') return selection === 'away' ? 'Away ML' : 'Home ML';
  return selection === 'away' ? 'Away spread' : 'Home spread';
}

function betDisplayLabel(line, market, selection) {
  if (market === 'prop') {
    return `${line.playerName || 'Player'} ${selection === 'under' ? 'Under' : 'Over'} ${line.line} ${line.propType || 'prop'}`;
  }
  if (market === 'superbowl') {
    return `${line.teamName || 'Team'} Super Bowl winner`;
  }
  if (market === 'moneyline') {
    return `${selection === 'away' ? line.awayTeam : line.homeTeam} moneyline`;
  }
  if (market === 'total') {
    return `${selection === 'over' ? 'Over' : 'Under'} ${line.total}`;
  }
  return selection === 'away' ? line.awaySpreadDisplay : line.homeSpreadDisplay;
}

function buildReceiptEmbed({ result, line, market, selection, wager }) {
  const matchupLabel = market === 'superbowl'
    ? 'Super Bowl Winner Futures'
    : market === 'prop'
      ? `${line.awayTeam} at ${line.homeTeam}`
    : `${line.awayTeam} at ${line.homeTeam}`;
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('Bet Slip Accepted')
    .setDescription([
      matchupLabel,
      `Pick: ${selectionLabel(market, selection)}`,
      market === 'prop' ? `Prop: ${betDisplayLabel(line, market, selection)}` : null,
      market === 'superbowl' ? `Team: ${line.teamName}` : null,
      `Bet: ${formatImpactValue(Number(wager))}`,
      `Odds: ${result.price > 0 ? '+' : ''}${result.price}`,
      `If it wins: +${formatImpactValue(result.payout?.profit || 0)}`,
      `You get back: ${formatImpactValue(result.payout?.totalReturn || 0)} total`,
      `Impact left to bet: ${formatImpactValue(result.balance)}`,
    ].filter(Boolean).join('\n'))
    .setTimestamp();
}

function buildConfirmEmbed({ line, market, selection, wager, odds, payout }) {
  const matchupLabel = market === 'superbowl'
    ? 'Super Bowl Winner Futures'
    : market === 'prop'
      ? `${line.awayTeam} at ${line.homeTeam}`
    : `${line.awayTeam} at ${line.homeTeam}`;
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('Confirm This Bet')
    .setDescription([
      matchupLabel,
      `Pick: ${selectionLabel(market, selection)}`,
      market === 'prop' ? `Prop: ${betDisplayLabel(line, market, selection)}` : null,
      market === 'superbowl' ? `Team: ${line.teamName}` : null,
      `Bet: ${formatImpactValue(Number(wager))}`,
      `Odds: ${odds > 0 ? '+' : ''}${odds}`,
      `If it wins: +${formatImpactValue(payout?.profit || 0)}`,
      `You get back: ${formatImpactValue(payout?.totalReturn || 0)} total`,
      '',
      'Are you sure you want to place this bet?',
    ].filter(Boolean).join('\n'))
    .setTimestamp();
}

function buildParlaySlipEmbed({ slip, bankroll = null }) {
  const legs = slip?.legs || [];
  const price = legs.length >= 2 ? parlayPrice(legs) : null;
  const payout = price ? payoutBreakdown(5, price) : null;
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Parlay Builder')
    .setDescription([
      legs.length
        ? legs.map((leg, idx) => `${idx + 1}. ${leg.matchupLabel} — ${leg.betLabel}`).join('\n')
        : 'No legs added yet.',
      '',
      price ? `Current parlay odds: ${price > 0 ? '+' : ''}${price}` : 'Add at least 2 legs to place this parlay.',
      payout ? `Example: bet ${formatImpactValue(5)} • win ${formatImpactValue(payout.profit)} • return ${formatImpactValue(payout.totalReturn)}` : null,
      bankroll ? `Impact available to bet: ${formatImpactValue(bankroll.balance || 0)}` : null,
    ].filter(Boolean).join('\n'))
    .setTimestamp();
}

function parlayStakeRow({ weekNumber, slip, bankroll }) {
  const legs = slip?.legs || [];
  const row = new ActionRowBuilder();
  if (legs.length >= 2) {
    const limits = getSportsbookLimits(bankroll?.balance || 0);
    const choices = [1, 3, 5, 10].filter((amount) => amount <= Number(limits.maxWager || 0) && amount <= Number(bankroll?.balance || 0));
    for (const amount of choices.slice(0, 3)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`madden_sportsbook_parlay_pick|${weekNumber}|${amount}`)
          .setLabel(`Bet ${amount}`)
          .setStyle(ButtonStyle.Primary),
      );
    }
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`madden_sportsbook_parlay_other|${weekNumber}`)
        .setLabel('Other')
        .setStyle(ButtonStyle.Secondary),
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`madden_sportsbook_parlay_clear|${weekNumber}`)
      .setLabel('Clear')
      .setStyle(ButtonStyle.Danger),
  );
  return row;
}

export async function execute(interaction) {
  if (!(interaction instanceof ButtonInteraction)) return;
  const raw = String(interaction.customId || '');
  if (raw.startsWith('madden_sportsbook_parlay_add|')) {
    const [, weekNumber, gameId, market, selection] = raw.split('|');
    const context = inferRecognitionContext('madden', interaction.guildId);
    const seasonKey = context?.seasonKey;
    if (!seasonKey) {
      await interaction.update({ content: 'Sportsbook season context is not ready yet.', embeds: [], components: [] });
      return;
    }
    const result = addSportsbookParlayLeg({
      guildId: interaction.guildId,
      member: interaction.member,
      userId: interaction.user.id,
      seasonKey,
      weekNumber: Number(weekNumber),
      gameId,
      market,
      selection,
    });
    if (!result.ok) {
      await interaction.update({ content: result.message, embeds: [], components: [] });
      return;
    }
    const card = getSportsbookUserCard({
      seasonKey,
      weekNumber: Number(weekNumber),
      userId: interaction.user.id,
      guildId: interaction.guildId,
    });
    const slip = getSportsbookParlaySlip({ seasonKey, userId: interaction.user.id });
    await interaction.update({
      content: null,
      embeds: [buildParlaySlipEmbed({ slip, bankroll: card.bankroll })],
      components: [parlayStakeRow({ weekNumber, slip, bankroll: card.bankroll })],
    });
    return;
  }

  if (raw.startsWith('madden_sportsbook_parlay_clear|')) {
    const [, weekNumber] = raw.split('|');
    const context = inferRecognitionContext('madden', interaction.guildId);
    const seasonKey = context?.seasonKey;
    if (seasonKey) clearSportsbookParlay({ seasonKey, userId: interaction.user.id });
    await interaction.update({ content: 'Parlay slip cleared.', embeds: [], components: [] });
    return;
  }

  if (raw.startsWith('madden_sportsbook_parlay_place|')) {
    const [, weekNumber] = raw.split('|');
    const context = inferRecognitionContext('madden', interaction.guildId);
    const seasonKey = context?.seasonKey;
    if (!seasonKey) {
      await interaction.update({ content: 'Sportsbook season context is not ready yet.', embeds: [], components: [] });
      return;
    }
    const card = getSportsbookUserCard({
      seasonKey,
      weekNumber: Number(weekNumber),
      userId: interaction.user.id,
      guildId: interaction.guildId,
    });
    const slip = getSportsbookParlaySlip({ seasonKey, userId: interaction.user.id });
    await interaction.update({
      content: null,
      embeds: [buildParlaySlipEmbed({ slip, bankroll: card.bankroll })],
      components: [parlayStakeRow({ weekNumber, slip, bankroll: card.bankroll })],
    });
    return;
  }

  if (raw.startsWith('madden_sportsbook_parlay_pick|')) {
    const [, weekNumber, wager] = raw.split('|');
    const context = inferRecognitionContext('madden', interaction.guildId);
    const seasonKey = context?.seasonKey;
    if (!seasonKey) {
      await interaction.update({ content: 'Sportsbook season context is not ready yet.', embeds: [], components: [] });
      return;
    }
    const result = placeSportsbookParlay({
      guildId: interaction.guildId,
      member: interaction.member,
      userId: interaction.user.id,
      seasonKey,
      weekNumber: Number(weekNumber),
      wager: Number(wager),
    });
    if (!result.ok) {
      await interaction.update({ content: result.message, embeds: [], components: [] });
      return;
    }
    await interaction.update({
      content: null,
      embeds: [
        new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle('Parlay Accepted')
          .setDescription([
            `${result.bet?.legs?.length || 0}-leg parlay`,
            `Bet: ${formatImpactValue(Number(wager))}`,
            `Odds: ${result.price > 0 ? '+' : ''}${result.price}`,
            `If it wins: +${formatImpactValue(result.payout?.profit || 0)}`,
            `You get back: ${formatImpactValue(result.payout?.totalReturn || 0)} total`,
            `Impact left to bet: ${formatImpactValue(result.balance)}`,
          ].join('\n'))
          .setTimestamp(),
      ],
      components: [],
    });
    appendMaddenStaffLog({
      type: 'sportsbook_parlay_placed',
      guildId: interaction.guildId,
      userId: interaction.user.id,
      username: interaction.user.tag,
      weekNumber: Number(weekNumber),
      seasonKey,
      legs: result.bet?.legs || [],
      wager: Number(wager),
      odds: result.price,
      payoutProfit: Number(result.payout?.profit || 0),
      payoutTotalReturn: Number(result.payout?.totalReturn || 0),
      balanceAfter: Number(result.balance || 0),
    });
    await postMaddenStaffDecision(
      interaction.client,
      interaction.guildId,
      'Sportsbook Parlay Placed',
      `<@${interaction.user.id}> placed a **${result.bet?.legs?.length || 0}-leg parlay**.`,
      [
        { name: 'Week', value: String(weekNumber), inline: true },
        { name: 'Wager', value: formatImpactValue(Number(wager)), inline: true },
        { name: 'Odds', value: `${result.price > 0 ? '+' : ''}${result.price}`, inline: true },
        { name: 'Win Profit', value: formatImpactValue(Number(result.payout?.profit || 0)), inline: true },
        { name: 'Balance After', value: formatImpactValue(Number(result.balance || 0)), inline: true },
      ],
    ).catch(() => null);
    return;
  }

  if (raw.startsWith('madden_sportsbook_parlay_other|')) {
    const [, weekNumber] = raw.split('|');
    const modal = sportsbookModal(`madden_sportsbook_parlay_wager|${weekNumber}`, { futureLabel: 'Parlay wager' });
    await interaction.showModal(modal);
    return;
  }

  if (raw.startsWith('madden_sportsbook_buyout|')) {
    const [, weekNumber, gameId, placedAt] = raw.split('|');
    const context = inferRecognitionContext('madden', interaction.guildId);
    const seasonKey = context?.seasonKey;
    if (!seasonKey) {
      await interaction.update({ content: 'Sportsbook season context is not ready yet.', embeds: [], components: [] });
      return;
    }
    const result = buyoutSportsbookBet({
      guildId: interaction.guildId,
      seasonKey,
      weekNumber: Number(weekNumber),
      userId: interaction.user.id,
      gameId: decodeURIComponent(String(gameId || '')),
      placedAt: Number(placedAt),
    });
    if (!result.ok) {
      await interaction.update({ content: result.message, embeds: [], components: [] });
      return;
    }
    appendMaddenStaffLog({
      type: 'sportsbook_bet_buyout',
      guildId: interaction.guildId,
      userId: interaction.user.id,
      username: interaction.user.tag,
      weekNumber: Number(weekNumber),
      seasonKey,
      gameId: result.bet?.gameId,
      matchup: result.bet?.matchupLabel,
      betLabel: result.bet?.betLabel,
      wager: Number(result.bet?.wager || 0),
      refund: Number(result.refund || 0),
      balanceAfter: Number(result.balance || 0),
    });
    await postMaddenStaffDecision(
      interaction.client,
      interaction.guildId,
      'Sportsbook Bet Buyout',
      `<@${interaction.user.id}> used **Bet Buyout** on **${result.bet?.matchupLabel || 'an open bet'}**.`,
      [
        { name: 'Week', value: String(weekNumber), inline: true },
        { name: 'Bet', value: String(result.bet?.betLabel || 'Unknown bet'), inline: true },
        { name: 'Stake', value: formatImpactValue(Number(result.bet?.wager || 0)), inline: true },
        { name: 'Refund', value: formatImpactValue(Number(result.refund || 0)), inline: true },
        { name: 'Balance After', value: formatImpactValue(Number(result.balance || 0)), inline: true },
      ],
    ).catch(() => null);
    await interaction.update({
      content: null,
      embeds: [
        new EmbedBuilder()
          .setColor(0xe67e22)
          .setTitle('Bet Bought Out')
          .setDescription([
            `${result.bet?.matchupLabel || 'Open bet'}`,
            `Bet: ${result.bet?.betLabel || 'Unknown bet'}`,
            `Refund returned: ${formatImpactValue(Number(result.refund || 0))}`,
            `Impact left to bet: ${formatImpactValue(Number(result.balance || 0))}`,
          ].join('\n'))
          .setTimestamp(),
      ],
      components: [],
    });
    return;
  }

  if (raw.startsWith('madden_sportsbook_confirm|')) {
    const [, weekNumber, gameId, market, selection, wager] = raw.split('|');
    const context = inferRecognitionContext('madden', interaction.guildId);
    const seasonKey = context?.seasonKey;
    const line = seasonKey ? getLineForBet(seasonKey, Number(weekNumber), gameId) : null;
    if (!seasonKey || !line) {
      await interaction.update({ content: 'This line is not available anymore.', embeds: [], components: [] });
      return;
    }
    const result = placeSportsbookBet({
      guildId: interaction.guildId,
      member: interaction.member,
      userId: interaction.user.id,
      seasonKey,
      weekNumber: Number(weekNumber),
      gameId,
      market,
      selection,
      wager: Number(wager),
    });
    if (!result.ok) {
      await interaction.update({ content: result.message, embeds: [], components: [] });
      return;
    }
    await interaction.update({
      content: null,
      embeds: [buildReceiptEmbed({ result, line, market, selection, wager: Number(wager) })],
      components: [],
    });
    appendMaddenStaffLog({
      type: 'sportsbook_bet_placed',
      guildId: interaction.guildId,
      userId: interaction.user.id,
      username: interaction.user.tag,
      weekNumber: Number(weekNumber),
      seasonKey,
      gameId,
      awayTeam: line.awayTeam || null,
      homeTeam: line.homeTeam || null,
      teamName: line.teamName || null,
      matchup: market === 'superbowl' ? 'Super Bowl Winner Futures' : `${line.awayTeam} at ${line.homeTeam}`,
      market,
      selection,
      selectionLabel: selectionLabel(market, selection),
      betLabel: betDisplayLabel(line, market, selection),
      wager: Number(wager),
      odds: result.price,
      payoutProfit: Number(result.payout?.profit || 0),
      payoutTotalReturn: Number(result.payout?.totalReturn || 0),
      balanceAfter: Number(result.balance || 0),
      awayMoneyline: Number(line.awayMoneyline || 0),
      homeMoneyline: Number(line.homeMoneyline || 0),
      spread: Number(line.spread || 0),
      total: Number(line.total || 0),
    });
    await postMaddenStaffDecision(
      interaction.client,
      interaction.guildId,
      'Sportsbook Bet Placed',
      `<@${interaction.user.id}> placed a sportsbook bet on **${market === 'superbowl' ? `${line.teamName} Super Bowl winner` : `${line.awayTeam} at ${line.homeTeam}`}**.`,
      [
        { name: 'Week', value: String(weekNumber), inline: true },
        { name: 'Market', value: market, inline: true },
        { name: 'Pick', value: betDisplayLabel(line, market, selection), inline: true },
        { name: 'Wager', value: formatImpactValue(Number(wager)), inline: true },
        { name: 'Odds', value: `${result.price > 0 ? '+' : ''}${result.price}`, inline: true },
        { name: 'Win Profit', value: formatImpactValue(Number(result.payout?.profit || 0)), inline: true },
        { name: 'Total Return', value: formatImpactValue(Number(result.payout?.totalReturn || 0)), inline: true },
        { name: 'Balance After', value: formatImpactValue(Number(result.balance || 0)), inline: true },
      ],
    ).catch(() => null);
    return;
  }

  if (raw.startsWith('madden_sportsbook_cancel|')) {
    await interaction.update({
      content: 'Bet canceled.',
      embeds: [],
      components: [],
    });
    return;
  }

  if (raw.startsWith('madden_sportsbook_bet_pick|')) {
    const [, weekNumber, gameId, market, selection, wager] = raw.split('|');
    const context = inferRecognitionContext('madden', interaction.guildId);
    const seasonKey = context?.seasonKey;
    const line = seasonKey ? getLineForBet(seasonKey, Number(weekNumber), gameId) : null;
    if (!seasonKey || !line) {
      await interaction.update({ content: 'This line is not available anymore.', embeds: [], components: [] });
      return;
    }
    const odds = linePrice(line, market, selection);
    const payout = payoutBreakdown(Number(wager), odds);
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
    await interaction.update({
      content: null,
      embeds: [buildConfirmEmbed({ line, market, selection, wager: Number(wager), odds, payout })],
      components: [controls],
    });
    return;
  }

  if (raw.startsWith('madden_sportsbook_bet_other|')) {
    const [, weekNumber, gameId, market, selection] = raw.split('|');
    const context = inferRecognitionContext('madden', interaction.guildId);
    const seasonKey = context?.seasonKey;
    const line = seasonKey ? getLineForBet(seasonKey, Number(weekNumber), gameId) : null;
    if (!line) {
      await interaction.reply({ content: 'This line is not available anymore.', flags: 64 });
      return;
    }
    const modal = sportsbookModal(
      `madden_sportsbook_wager|${weekNumber}|${gameId}|${market}|${selection}`,
      line,
    );
    await interaction.showModal(modal);
    return;
  }

  const [, weekNumber, gameId, market, selection] = raw.split('|');
  const context = inferRecognitionContext('madden', interaction.guildId);
  const seasonKey = context?.seasonKey;
  const line = seasonKey ? getLineForBet(seasonKey, Number(weekNumber), gameId) : null;
  if (!line) {
    await interaction.reply({ content: 'This line is not available anymore.', flags: 64 });
    return;
  }
  const card = getSportsbookUserCard({
    seasonKey,
    weekNumber: Number(weekNumber),
    userId: interaction.user.id,
    guildId: interaction.guildId,
  });
  const limits = getSportsbookLimits(card.bankroll?.balance || 0);
  const odds = linePrice(line, market, selection);
  const choices = [1, 3, 5, 10].filter((amount) => amount <= Number(limits.maxWager || 0) && amount <= Number(card.bankroll?.balance || 0));
  const row = new ActionRowBuilder();
  for (const amount of choices.slice(0, 4)) {
    const payout = payoutBreakdown(amount, odds);
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`madden_sportsbook_bet_pick|${weekNumber}|${gameId}|${market}|${selection}|${amount}`)
        .setLabel(`Bet ${amount} • Win ${Number.isInteger(payout.profit) ? payout.profit : payout.profit.toFixed(1)} Impact`)
        .setStyle(ButtonStyle.Primary),
    );
  }
  if (row.components.length < 5) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`madden_sportsbook_bet_other|${weekNumber}|${gameId}|${market}|${selection}`)
        .setLabel('Other')
        .setStyle(ButtonStyle.Secondary),
    );
  }
  const parlayRow = new ActionRowBuilder();
  if (market !== 'superbowl') {
    parlayRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`madden_sportsbook_parlay_add|${weekNumber}|${gameId}|${market}|${selection}`)
        .setLabel('Add to Parlay')
        .setStyle(ButtonStyle.Success),
    );
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Choose Your Bet Size')
    .setDescription([
      market === 'superbowl' ? 'Super Bowl Winner Futures' : `${line.awayTeam} at ${line.homeTeam}`,
      `Pick: ${selectionLabel(market, selection)}`,
      market === 'prop' ? `Prop: ${betDisplayLabel(line, market, selection)}` : null,
      market === 'superbowl' ? `Team: ${line.teamName}` : null,
      '',
      `Type later only if you need a custom amount.`,
      `Impact available to bet: ${formatImpactValue(card.bankroll?.balance || 0)}`,
      `Max on this bet: ${formatImpactValue(limits.maxWager || 0)}`,
      `Odds on this pick: ${odds > 0 ? '+' : ''}${odds}`,
      `Tap a quick amount below to see exactly how much Impact that bet can win, or choose Other.`,
    ].filter(Boolean).join('\n'));

  await interaction.update({
    content: null,
    embeds: [embed],
    components: parlayRow.components.length ? [row, parlayRow] : [row],
  });
}

export default { customId, execute };
