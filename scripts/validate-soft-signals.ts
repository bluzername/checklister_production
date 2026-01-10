#!/usr/bin/env npx ts-node
/**
 * Soft Signal Validation Script
 *
 * Compares outcomes of user's soft signals (insider buying, politician trades,
 * analyst upgrades) vs general population to validate the hypothesis that
 * stocks with soft signals behave differently.
 *
 * Usage:
 *   npx ts-node scripts/validate-soft-signals.ts
 */

import * as fs from 'fs';
import Database from 'better-sqlite3';

// ============================================
// SIGNAL DATA (from user's Telegram analysis)
// ============================================

interface Signal {
  date: string;
  ticker: string;
  reason: string;
  category: 'insider' | 'politician' | 'analyst' | 'institutional' | 'portfolio' | 'technical' | 'other';
  isSoftSignal: boolean;
}

const RAW_SIGNALS: { date: string; ticker: string; reason: string }[] = [
  { date: '2025-10-10', ticker: 'SN', reason: 'Buy order placed at market opening' },
  { date: '2025-10-10', ticker: 'DECK', reason: 'Buy order filled, 3% position size established' },
  { date: '2025-10-10', ticker: 'TOST', reason: 'New buy order execution' },
  { date: '2025-10-10', ticker: 'EFC', reason: 'Insider purchase by Rep. Virginia Fox' },
  { date: '2025-10-10', ticker: 'CRBG', reason: 'Analyst upgrades and buy ratings' },
  { date: '2025-10-11', ticker: 'ZOOZ', reason: 'Bitcoin holdings exceed market capitalization' },
  { date: '2025-10-13', ticker: 'TSLA', reason: 'Portfolio accumulation; subsequent +120% return' },
  { date: '2025-10-13', ticker: 'AAPL', reason: 'Portfolio accumulation; subsequent +50% return' },
  { date: '2025-10-13', ticker: 'UBER', reason: 'Portfolio accumulation; subsequent +67% return' },
  { date: '2025-10-13', ticker: 'ORCL', reason: 'Portfolio accumulation; subsequent +192% return' },
  { date: '2025-10-13', ticker: 'AMZN', reason: 'Portfolio accumulation; subsequent +47% return' },
  { date: '2025-10-13', ticker: 'GOOG', reason: 'Portfolio accumulation; subsequent +80% return' },
  { date: '2025-10-13', ticker: 'META', reason: 'Portfolio accumulation; subsequent +65% return' },
  { date: '2025-10-13', ticker: 'PLTR', reason: 'Portfolio accumulation; subsequent +183% return' },
  { date: '2025-10-15', ticker: 'HEI', reason: '6 directors + 2 co-CEOs insider purchases >$160k each' },
  { date: '2025-10-15', ticker: 'DECK', reason: 'Congressman Ro Khanna insider purchase' },
  { date: '2025-10-14', ticker: 'AVGO', reason: '5 analyst upgrades with +313% upside potential' },
  { date: '2025-10-16', ticker: 'ZBIO', reason: '3 directors insider purchases totaling ~$12.4M' },
  { date: '2025-10-16', ticker: 'AMD', reason: 'Technical breakout with +9.21% intraday move' },
  { date: '2025-10-16', ticker: 'INTU', reason: 'San Francisco politician insider purchase' },
  { date: '2025-10-16', ticker: 'ROKU', reason: 'Technical analysis showing bullish setup pattern' },
  { date: '2025-10-16', ticker: 'CRM', reason: 'Technical consolidation breakout, +7% move' },
  { date: '2025-10-16', ticker: 'BAC', reason: '7 analyst upgrades with 12-32% upside targets' },
  { date: '2025-10-20', ticker: 'TMDX', reason: 'Technical entry point with 41% profit potential' },
  { date: '2025-10-20', ticker: 'NVDA', reason: 'Dominant 82% GPU market share positioning' },
  { date: '2025-10-20', ticker: 'FFIV', reason: 'AI infrastructure play with 16% dividend yield' },
  { date: '2025-10-20', ticker: 'ADIS', reason: 'RSI/MACD technical confirmation with 8 targets' },
  { date: '2025-10-20', ticker: 'CRDO', reason: 'Hyperlume AI technology +274% upside potential' },
  { date: '2025-10-22', ticker: 'DAL', reason: 'Delta Air Lines with 16.67% dividend yield' },
  { date: '2025-10-22', ticker: 'BYND', reason: 'Short squeeze potential with 70-600% upside range' },
  { date: '2025-10-23', ticker: 'LULU', reason: 'Large options blocks with put selling strategy' },
  { date: '2025-10-27', ticker: 'SMMT', reason: 'Insider purchases with $10M share buyback authorization' },
  { date: '2025-10-28', ticker: 'FCN', reason: 'FTI Consulting insider purchase, government contracts' },
  { date: '2025-10-30', ticker: 'BKNG', reason: '6 analyst upgrades covering travel platform' },
  { date: '2025-10-31', ticker: 'MRVL', reason: 'Marvell Technology 5-star rating, 15% dividend' },
  { date: '2025-11-13', ticker: 'MSFT', reason: '$20M options block positioning, cloud computing strength' },
  { date: '2025-11-19', ticker: 'META', reason: '$200M+ put selling blocks indicating confidence' },
  { date: '2025-11-25', ticker: 'LLY', reason: '5 analyst upgrades with 217% long-term potential' },
  { date: '2025-12-03', ticker: 'CRDO', reason: '12% upside with 34% probability of achievement' },
  { date: '2025-12-17', ticker: 'GRAB', reason: 'Southeast Asia growth: 34M users, 5M vehicles' },
  { date: '2025-12-23', ticker: 'UNH', reason: 'Healthcare sector put selling blocks' },
  { date: '2025-12-31', ticker: 'C3AI', reason: '2026 AI opportunity with 70% upside potential' },
  { date: '2026-01-01', ticker: 'PLTR', reason: '85% poll confidence for 2026, call buying + puts' },
  { date: '2026-01-06', ticker: 'CPAYS', reason: 'Fintech/payments opportunity analysis' },
  { date: '2026-01-07', ticker: 'NAVI', reason: 'Trading platform with 60M valuation discussion' },
  { date: '2026-01-07', ticker: 'NVTS', reason: 'AI-powered cybersecurity platform opportunity' },
];

function categorizeSignal(reason: string): Signal['category'] {
  const lowerReason = reason.toLowerCase();

  // Insider buying
  if (lowerReason.includes('insider purchase') ||
      lowerReason.includes('insider buying') ||
      lowerReason.includes('directors insider') ||
      lowerReason.includes('ceo') && lowerReason.includes('purchase')) {
    return 'insider';
  }

  // Politician trades
  if (lowerReason.includes('politician') ||
      lowerReason.includes('congressman') ||
      lowerReason.includes('rep.') ||
      lowerReason.includes('senator')) {
    return 'politician';
  }

  // Analyst upgrades
  if (lowerReason.includes('analyst upgrade') ||
      lowerReason.includes('analyst upgrades') ||
      lowerReason.includes('buy rating') ||
      lowerReason.includes('star rating')) {
    return 'analyst';
  }

  // Institutional options activity
  if (lowerReason.includes('options block') ||
      lowerReason.includes('put selling') ||
      lowerReason.includes('$') && lowerReason.includes('block')) {
    return 'institutional';
  }

  // Portfolio accumulation (by known investors)
  if (lowerReason.includes('portfolio accumulation')) {
    return 'portfolio';
  }

  // Technical signals (to exclude)
  if (lowerReason.includes('technical') ||
      lowerReason.includes('breakout') ||
      lowerReason.includes('rsi') ||
      lowerReason.includes('macd') ||
      lowerReason.includes('consolidation')) {
    return 'technical';
  }

  return 'other';
}

function isSoftSignal(category: Signal['category']): boolean {
  return ['insider', 'politician', 'analyst', 'institutional', 'portfolio'].includes(category);
}

// ============================================
// TRADE SIMULATION
// ============================================

interface TradeResult {
  ticker: string;
  signalDate: string;
  category: Signal['category'];
  reason: string;
  entryPrice: number;
  exitPrice: number;
  exitDate: string;
  exitReason: string;
  realizedR: number;
  percentReturn: number;
  holdingDays: number;
  isWin: boolean;
}

interface CachedOHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function computeATR(data: CachedOHLCV[], period: number = 14): number {
  if (data.length < period + 1) return 0;

  let atrSum = 0;
  for (let i = data.length - period; i < data.length; i++) {
    const high = data[i].high;
    const low = data[i].low;
    const prevClose = data[i - 1]?.close || data[i].close;
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    atrSum += tr;
  }
  return atrSum / period;
}

// Database connection (singleton)
let db: Database.Database | null = null;
function getDb(): Database.Database {
  if (!db) {
    db = new Database('data/price-cache.sqlite', { readonly: true });
  }
  return db;
}

function getDirectPrices(ticker: string, startDate: string, endDate: string): CachedOHLCV[] {
  const stmt = getDb().prepare(`
    SELECT date, open, high, low, close, volume
    FROM price_data
    WHERE ticker = ? AND date >= ? AND date <= ?
    ORDER BY date ASC
  `);
  const rows = stmt.all(ticker, startDate, endDate) as any[];
  return rows.map(r => ({
    date: r.date,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
  }));
}

async function simulateTrade(
  ticker: string,
  signalDate: string,
  maxHoldingDays: number = 45,
  stopMultiple: number = 2.0,
  tp1Multiple: number = 2.0,
  tp2Multiple: number = 3.0,
  tp3Multiple: number = 4.0
): Promise<TradeResult | null> {
  try {
    // Get historical data
    const endDate = new Date();
    const startDate = new Date(signalDate);
    startDate.setDate(startDate.getDate() - 60); // Need 60 days before for ATR

    const prices = getDirectPrices(
      ticker,
      startDate.toISOString().split('T')[0],
      endDate.toISOString().split('T')[0]
    );

    if (!prices || prices.length < 20) {
      return null;
    }

    // Find signal date index
    const signalIdx = prices.findIndex(p => p.date >= signalDate);
    if (signalIdx < 14 || signalIdx >= prices.length - 1) {
      return null;
    }

    // Calculate ATR at signal date
    const priorData = prices.slice(0, signalIdx + 1);
    const atr = computeATR(priorData);
    if (atr <= 0) return null;

    // Entry on next day's open
    const entryIdx = signalIdx + 1;
    if (entryIdx >= prices.length) return null;

    const entryPrice = prices[entryIdx].open;
    const stopDistance = atr * stopMultiple;
    const stopLoss = entryPrice - stopDistance;
    const tp1 = entryPrice + stopDistance * tp1Multiple;
    const tp2 = entryPrice + stopDistance * tp2Multiple;
    const tp3 = entryPrice + stopDistance * tp3Multiple;

    // Simulate trade
    let exitPrice = entryPrice;
    let exitDate = prices[entryIdx].date;
    let exitReason = 'TIME_EXIT';
    let holdingDays = 0;

    // Track partial exits (33/33/34 split)
    let remainingShares = 1.0;
    let totalR = 0;
    let tp1Hit = false;
    let tp2Hit = false;

    for (let i = entryIdx + 1; i < prices.length && holdingDays < maxHoldingDays; i++) {
      holdingDays++;
      const bar = prices[i];

      // Check stop loss first (priority)
      if (bar.low <= stopLoss) {
        exitPrice = Math.min(bar.open, stopLoss);
        exitDate = bar.date;
        exitReason = 'STOP_LOSS';
        totalR += remainingShares * ((exitPrice - entryPrice) / stopDistance);
        break;
      }

      // Check TP1
      if (!tp1Hit && bar.high >= tp1) {
        tp1Hit = true;
        const tp1Shares = 0.33;
        totalR += tp1Shares * tp1Multiple;
        remainingShares -= tp1Shares;
      }

      // Check TP2
      if (!tp2Hit && bar.high >= tp2) {
        tp2Hit = true;
        const tp2Shares = 0.33;
        totalR += tp2Shares * tp2Multiple;
        remainingShares -= tp2Shares;
      }

      // Check TP3
      if (bar.high >= tp3) {
        totalR += remainingShares * tp3Multiple;
        exitPrice = tp3;
        exitDate = bar.date;
        exitReason = 'TP3';
        remainingShares = 0;
        break;
      }

      // Time exit
      if (holdingDays >= maxHoldingDays) {
        exitPrice = bar.close;
        exitDate = bar.date;
        exitReason = 'TIME_EXIT';
        totalR += remainingShares * ((exitPrice - entryPrice) / stopDistance);
        break;
      }
    }

    // Handle case where we didn't exit in loop
    if (remainingShares > 0 && exitReason !== 'STOP_LOSS') {
      const lastBar = prices[Math.min(entryIdx + maxHoldingDays, prices.length - 1)];
      totalR += remainingShares * ((lastBar.close - entryPrice) / stopDistance);
      exitPrice = lastBar.close;
      exitDate = lastBar.date;
    }

    const percentReturn = ((exitPrice - entryPrice) / entryPrice) * 100;
    const isWin = totalR >= 1.0; // Win if realized R >= 1

    return {
      ticker,
      signalDate,
      category: 'other', // Will be set by caller
      reason: '',
      entryPrice,
      exitPrice,
      exitDate,
      exitReason,
      realizedR: totalR,
      percentReturn,
      holdingDays,
      isWin,
    };
  } catch (error) {
    return null;
  }
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('='.repeat(70));
  console.log('SOFT SIGNAL VALIDATION STUDY');
  console.log('='.repeat(70));
  console.log('\nHypothesis: Stocks with soft signals (insider buying, politician trades,');
  console.log('analyst upgrades) have statistically different outcomes than general population.\n');

  // Categorize signals
  const signals: Signal[] = RAW_SIGNALS.map(s => {
    const category = categorizeSignal(s.reason);
    return {
      ...s,
      category,
      isSoftSignal: isSoftSignal(category),
    };
  });

  console.log('-'.repeat(70));
  console.log('SIGNAL CATEGORIZATION');
  console.log('-'.repeat(70));

  const categoryCounts: Record<string, number> = {};
  for (const s of signals) {
    categoryCounts[s.category] = (categoryCounts[s.category] || 0) + 1;
  }

  console.log('\nCategory breakdown:');
  for (const [cat, count] of Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])) {
    const isSoft = isSoftSignal(cat as Signal['category']) ? '✓ SOFT' : '  (excluded)';
    console.log(`  ${cat.padEnd(15)} ${count.toString().padStart(3)} signals ${isSoft}`);
  }

  const softSignals = signals.filter(s => s.isSoftSignal);
  const technicalSignals = signals.filter(s => !s.isSoftSignal);

  console.log(`\nTotal signals: ${signals.length}`);
  console.log(`Soft signals (to analyze): ${softSignals.length}`);
  console.log(`Technical/other (excluded): ${technicalSignals.length}`);

  // List soft signals
  console.log('\n' + '-'.repeat(70));
  console.log('SOFT SIGNALS TO ANALYZE');
  console.log('-'.repeat(70));
  console.log('\n| Date       | Ticker | Category      | Reason |');
  console.log('|------------|--------|---------------|--------|');
  for (const s of softSignals) {
    const shortReason = s.reason.length > 40 ? s.reason.slice(0, 37) + '...' : s.reason;
    console.log(`| ${s.date} | ${s.ticker.padEnd(6)} | ${s.category.padEnd(13)} | ${shortReason} |`);
  }

  // Simulate trades for soft signals
  console.log('\n' + '-'.repeat(70));
  console.log('TRADE SIMULATION');
  console.log('-'.repeat(70));
  console.log('\nSimulating trades for soft signals...\n');

  const results: TradeResult[] = [];
  const errors: string[] = [];

  for (const signal of softSignals) {
    process.stdout.write(`  ${signal.ticker.padEnd(6)} ${signal.date}... `);

    const result = await simulateTrade(signal.ticker, signal.date);
    if (result) {
      result.category = signal.category;
      result.reason = signal.reason;
      results.push(result);
      const status = result.isWin ? '✓ WIN' : '✗ LOSS';
      console.log(`${status} (R: ${result.realizedR.toFixed(2)}, ${result.exitReason})`);
    } else {
      errors.push(`${signal.ticker} - No price data available`);
      console.log('⚠ No data');
    }
  }

  if (errors.length > 0) {
    console.log(`\n  Skipped ${errors.length} signals (no price data)`);
  }

  // Calculate statistics
  console.log('\n' + '='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));

  if (results.length === 0) {
    console.log('\n⚠️  No trades could be simulated. Need more price data.');
    return;
  }

  const wins = results.filter(r => r.isWin);
  const losses = results.filter(r => !r.isWin);
  const winRate = (wins.length / results.length) * 100;
  const avgR = results.reduce((sum, r) => sum + r.realizedR, 0) / results.length;
  const avgPercent = results.reduce((sum, r) => sum + r.percentReturn, 0) / results.length;
  const avgHoldingDays = results.reduce((sum, r) => sum + r.holdingDays, 0) / results.length;

  console.log('\n📊 SOFT SIGNAL PERFORMANCE:');
  console.log(`  Total trades:      ${results.length}`);
  console.log(`  Wins:              ${wins.length} (${winRate.toFixed(1)}%)`);
  console.log(`  Losses:            ${losses.length}`);
  console.log(`  Average R:         ${avgR.toFixed(2)}R`);
  console.log(`  Average Return:    ${avgPercent.toFixed(1)}%`);
  console.log(`  Avg Holding Days:  ${avgHoldingDays.toFixed(1)}`);

  // Exit reason breakdown
  console.log('\n  Exit Reasons:');
  const exitCounts: Record<string, number> = {};
  for (const r of results) {
    exitCounts[r.exitReason] = (exitCounts[r.exitReason] || 0) + 1;
  }
  for (const [reason, count] of Object.entries(exitCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${reason.padEnd(12)} ${count} (${(count / results.length * 100).toFixed(1)}%)`);
  }

  // By category
  console.log('\n📊 BY SIGNAL CATEGORY:');
  const categories = [...new Set(results.map(r => r.category))];
  for (const cat of categories) {
    const catResults = results.filter(r => r.category === cat);
    const catWins = catResults.filter(r => r.isWin);
    const catWinRate = (catWins.length / catResults.length) * 100;
    const catAvgR = catResults.reduce((sum, r) => sum + r.realizedR, 0) / catResults.length;
    console.log(`  ${cat.padEnd(15)} n=${catResults.length.toString().padStart(2)}, WR=${catWinRate.toFixed(0)}%, avgR=${catAvgR.toFixed(2)}`);
  }

  // Comparison with baseline
  console.log('\n' + '-'.repeat(70));
  console.log('COMPARISON WITH GENERAL POPULATION (from training data)');
  console.log('-'.repeat(70));

  const baselineWinRate = 40.7; // From our training data
  const baselineAvgR = -0.025; // From our training data

  console.log(`\n  | Metric           | Soft Signals | General Pop | Delta       |`);
  console.log(`  |------------------|--------------|-------------|-------------|`);
  console.log(`  | Win Rate         | ${winRate.toFixed(1)}%`.padEnd(18) + ` | ${baselineWinRate}%`.padEnd(14) + ` | ${(winRate - baselineWinRate) >= 0 ? '+' : ''}${(winRate - baselineWinRate).toFixed(1)}%`.padEnd(14) + `|`);
  console.log(`  | Average R        | ${avgR.toFixed(2)}R`.padEnd(18) + ` | ${baselineAvgR.toFixed(2)}R`.padEnd(14) + ` | ${(avgR - baselineAvgR) >= 0 ? '+' : ''}${(avgR - baselineAvgR).toFixed(2)}R`.padEnd(14) + `|`);

  // Statistical significance note
  console.log('\n📈 INTERPRETATION:');
  if (winRate > baselineWinRate + 5) {
    console.log(`  ✅ Soft signals show HIGHER win rate (+${(winRate - baselineWinRate).toFixed(1)} pp)`);
    console.log(`     This supports the hypothesis that soft signals provide edge.`);
  } else if (winRate < baselineWinRate - 5) {
    console.log(`  ❌ Soft signals show LOWER win rate (${(winRate - baselineWinRate).toFixed(1)} pp)`);
    console.log(`     This contradicts the hypothesis.`);
  } else {
    console.log(`  ⚠️  Soft signals show SIMILAR win rate (${(winRate - baselineWinRate).toFixed(1)} pp)`);
    console.log(`     Need more data to draw conclusions.`);
  }

  if (avgR > baselineAvgR + 0.1) {
    console.log(`  ✅ Soft signals show BETTER average R (+${(avgR - baselineAvgR).toFixed(2)}R)`);
  } else if (avgR < baselineAvgR - 0.1) {
    console.log(`  ❌ Soft signals show WORSE average R (${(avgR - baselineAvgR).toFixed(2)}R)`);
  } else {
    console.log(`  ⚠️  Soft signals show SIMILAR average R`);
  }

  console.log(`\n  Sample size: ${results.length} trades`);
  console.log(`  Note: Small sample size limits statistical confidence.`);
  console.log(`        Minimum ~50 trades recommended for reliable conclusions.`);

  // Individual trade details
  console.log('\n' + '-'.repeat(70));
  console.log('INDIVIDUAL TRADE DETAILS');
  console.log('-'.repeat(70));
  console.log('\n| Ticker | Signal Date | Entry   | Exit    | R      | Return | Exit Reason |');
  console.log('|--------|-------------|---------|---------|--------|--------|-------------|');
  for (const r of results.sort((a, b) => b.realizedR - a.realizedR)) {
    const rStr = r.realizedR >= 0 ? `+${r.realizedR.toFixed(2)}` : r.realizedR.toFixed(2);
    const retStr = r.percentReturn >= 0 ? `+${r.percentReturn.toFixed(1)}%` : `${r.percentReturn.toFixed(1)}%`;
    console.log(`| ${r.ticker.padEnd(6)} | ${r.signalDate} | $${r.entryPrice.toFixed(2).padStart(6)} | $${r.exitPrice.toFixed(2).padStart(6)} | ${rStr.padStart(6)} | ${retStr.padStart(6)} | ${r.exitReason.padEnd(11)} |`);
  }

  console.log('\n' + '='.repeat(70));
}

main().catch(console.error);
