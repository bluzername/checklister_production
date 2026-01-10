#!/usr/bin/env npx tsx
/**
 * Evaluate Trade CLI
 *
 * Evaluates a trade signal and provides:
 * 1. Veto decision (PROCEED / CAUTION / VETO)
 * 2. Trade plan with stop loss and take profit levels
 * 3. Position sizing recommendations
 *
 * Usage:
 *   npx tsx scripts/evaluate-trade.ts --ticker AAPL
 *   npx tsx scripts/evaluate-trade.ts --ticker AAPL --signal insider_buy
 *   npx tsx scripts/evaluate-trade.ts --ticker AAPL --account 100000 --risk 0.01
 *   npx tsx scripts/evaluate-trade.ts --ticker AAPL --cache  (use SQLite cache)
 *
 * Created: 2025-12-16
 */

import * as fs from 'fs';
import Database from 'better-sqlite3';
import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
import {
  evaluateVeto,
  loadVetoModel,
  formatVetoResult,
  type VetoResult,
} from '../src/lib/trade-plan/veto-system';
import {
  calculateExitLevels,
  calculatePositionSize,
  calculateATR,
  formatTradePlan,
  type TradePlan,
  type PositionSize,
  type OHLCBar,
} from '../src/lib/trade-plan/exit-calculator';

// ============================================
// FEATURE COMPUTATION
// ============================================

interface PriceData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function computeSMA(data: PriceData[], period: number): number {
  if (data.length < period) return data[data.length - 1]?.close ?? 0;
  const slice = data.slice(-period);
  return slice.reduce((sum, d) => sum + d.close, 0) / period;
}

function computeEMA(data: PriceData[], period: number): number {
  if (data.length < period) return data[data.length - 1]?.close ?? 0;
  const multiplier = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((sum, d) => sum + d.close, 0) / period;

  for (let i = period; i < data.length; i++) {
    ema = (data[i].close - ema) * multiplier + ema;
  }
  return ema;
}

function computeRSI(data: PriceData[], period: number = 14): number {
  if (data.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = data.length - period; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close;
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function computeATR(data: PriceData[], period: number = 14): number {
  if (data.length < period + 1) {
    const avgRange = data.reduce((sum, bar) => sum + (bar.high - bar.low), 0) / data.length;
    return avgRange;
  }

  const trueRanges: number[] = [];
  for (let i = 1; i < data.length; i++) {
    const high = data[i].high;
    const low = data[i].low;
    const prevClose = data[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trueRanges.push(tr);
  }

  const recentTRs = trueRanges.slice(-period);
  return recentTRs.reduce((sum, tr) => sum + tr, 0) / recentTRs.length;
}

function computeMomentum(data: PriceData[], period: number): number {
  if (data.length < period + 1) return 0;
  const current = data[data.length - 1].close;
  const past = data[data.length - 1 - period].close;
  return ((current - past) / past) * 100;
}

function clipOutlier(value: number, mean: number, std: number, numStd: number = 3): number {
  const lowerBound = mean - numStd * std;
  const upperBound = mean + numStd * std;
  return Math.max(lowerBound, Math.min(upperBound, value));
}

async function computeFeatures(
  data: PriceData[],
  spyData?: PriceData[]
): Promise<Record<string, number>> {
  const current = data[data.length - 1];
  const price = current.close;

  // Basic price-based features
  const sma20 = computeSMA(data, 20);
  const sma50 = computeSMA(data, 50);
  const ema9 = computeEMA(data, 9);
  const ema21 = computeEMA(data, 21);

  // Price vs MAs
  const priceVsSma20 = ((price - sma20) / sma20) * 100;
  const priceVsSma50 = ((price - sma50) / sma50) * 100;
  const priceVsEma9 = ((price - ema9) / ema9) * 100;
  const sma20VsSma50 = ((sma20 - sma50) / sma50) * 100;
  const ema9VsEma21 = ((ema9 - ema21) / ema21) * 100;

  // Range position
  const lookback52w = data.slice(-252);
  const high52w = Math.max(...lookback52w.map(d => d.high));
  const low52w = Math.min(...lookback52w.map(d => d.low));
  const positionInRange = high52w !== low52w ? (price - low52w) / (high52w - low52w) : 0.5;
  const pullbackFromHigh = ((high52w - price) / high52w) * 100;

  // Volatility
  const atr = computeATR(data, 14);
  const atrPercent = (atr / price) * 100;

  // Bollinger Bands position
  const sma20ForBB = sma20;
  const prices20 = data.slice(-20).map(d => d.close);
  const variance = prices20.reduce((sum, p) => sum + Math.pow(p - sma20ForBB, 2), 0) / 20;
  const bbStd = Math.sqrt(variance);
  const bbUpper = sma20ForBB + 2 * bbStd;
  const bbLower = sma20ForBB - 2 * bbStd;
  const bbPosition = bbUpper !== bbLower ? (price - bbLower) / (bbUpper - bbLower) : 0.5;

  // Volume
  const avgVolume20 = data.slice(-20).reduce((sum, d) => sum + d.volume, 0) / 20;
  const volumeRatio = avgVolume20 > 0 ? current.volume / avgVolume20 : 1;

  // RSI
  const rsi14 = computeRSI(data, 14);

  // Momentum (clipped)
  const MOMENTUM_STATS = {
    momentum5: { mean: 3.54, std: 108.99 },
    momentum10: { mean: 5.99, std: 157.61 },
    momentum20: { mean: 9.38, std: 232.14 },
    momentum60: { mean: 15.86, std: 484.87 },
  };

  let momentum5 = computeMomentum(data, 5);
  let momentum10 = computeMomentum(data, 10);
  let momentum20 = computeMomentum(data, 20);
  let momentum60 = computeMomentum(data, 60);

  momentum5 = clipOutlier(momentum5, MOMENTUM_STATS.momentum5.mean, MOMENTUM_STATS.momentum5.std);
  momentum10 = clipOutlier(momentum10, MOMENTUM_STATS.momentum10.mean, MOMENTUM_STATS.momentum10.std);
  momentum20 = clipOutlier(momentum20, MOMENTUM_STATS.momentum20.mean, MOMENTUM_STATS.momentum20.std);
  momentum60 = clipOutlier(momentum60, MOMENTUM_STATS.momentum60.mean, MOMENTUM_STATS.momentum60.std);

  // Candle features
  const candleBodyRatio = current.open !== 0
    ? Math.abs(current.close - current.open) / (current.high - current.low || 1)
    : 0.5;
  const isBullish = current.close > current.open ? 1 : 0;
  const isBreakout = price > high52w * 0.98 ? 1 : 0;

  // Binary indicators
  const aboveSma20 = price > sma20 ? 1 : 0;
  const aboveSma50 = price > sma50 ? 1 : 0;

  // SMA slope
  const sma20_5daysAgo = data.length > 25
    ? data.slice(-25, -5).reduce((sum, d) => sum + d.close, 0) / 20
    : sma20;
  const smaSlope = ((sma20 - sma20_5daysAgo) / sma20_5daysAgo) * 100;

  // Momentum acceleration
  const momAccel5 = momentum10 !== 0 ? (momentum5 / momentum10) * 100 : 100;
  const momAccel10 = momentum20 !== 0 ? (momentum10 / momentum20) * 100 : 100;

  // Volatility regime (percentile)
  const atrHistory = [];
  for (let i = 60; i < data.length; i++) {
    const slice = data.slice(i - 14, i);
    if (slice.length >= 14) {
      const histATR = computeATR(slice, 14);
      atrHistory.push(histATR);
    }
  }
  const volRegime = atrHistory.length > 0
    ? (atrHistory.filter(a => a < atr).length / atrHistory.length) * 100
    : 50;

  // Mean reversion score
  const meanRevScore = priceVsSma20 - priceVsSma50;

  // Trend consistency
  const last5Days = data.slice(-5);
  const trendConsistency5 = last5Days.filter(d => d.close > d.open).length / 5;
  const last10Days = data.slice(-10);
  const trendConsistency10 = last10Days.filter(d => d.close > d.open).length / 10;

  // Interaction features
  const oversoldBounce = (rsi14 < 40 && aboveSma50 === 1) ? 1 : 0;
  const overboughtWarning = (rsi14 > 70 && aboveSma20 === 0) ? 1 : 0;
  const trendWithMom = (aboveSma50 === 1 && momentum20 > 0) ? 1 : 0;
  const pullbackInUptrend = (aboveSma50 === 1 && aboveSma20 === 0) ? 1 : 0;
  const breakoutWithVol = (isBreakout === 1 && volumeRatio > 1.2) ? 1 : 0;
  const lowVolBreakout = (isBreakout === 1 && volumeRatio < 0.8) ? 1 : 0;
  const highVolConsolidation = (isBreakout === 0 && volumeRatio > 1.5) ? 1 : 0;
  const acceleratingUp = (momentum5 > momentum10 && momentum10 > 0) ? 1 : 0;
  const deceleratingDown = (momentum5 > momentum10 && momentum10 < 0) ? 1 : 0;

  // SPY-relative features
  let spyTrend = 0;
  let spyMomentum = 0;
  let spyVolRegime = 50;
  let relativeStrength = 0;

  if (spyData && spyData.length > 50) {
    const spySma50 = computeSMA(spyData, 50);
    const spyPrice = spyData[spyData.length - 1].close;
    spyTrend = spyPrice > spySma50 ? 1 : 0;
    spyMomentum = computeMomentum(spyData, 20);
    relativeStrength = momentum20 - spyMomentum;

    const spyATRHistory = [];
    for (let i = 60; i < spyData.length; i++) {
      const slice = spyData.slice(i - 14, i);
      if (slice.length >= 14) {
        spyATRHistory.push(computeATR(slice, 14));
      }
    }
    const spyATR = computeATR(spyData, 14);
    spyVolRegime = spyATRHistory.length > 0
      ? (spyATRHistory.filter(a => a < spyATR).length / spyATRHistory.length) * 100
      : 50;
  }

  return {
    priceVsSma20,
    priceVsSma50,
    priceVsEma9,
    sma20VsSma50,
    ema9VsEma21,
    positionInRange,
    pullbackFromHigh,
    atrPercent,
    bbPosition,
    volumeRatio,
    rsi14,
    momentum5,
    momentum10,
    momentum20,
    momentum60,
    candleBodyRatio,
    isBullish,
    isBreakout,
    aboveSma20,
    aboveSma50,
    smaSlope,
    momAccel5,
    momAccel10,
    volRegime,
    meanRevScore,
    trendConsistency5,
    trendConsistency10,
    oversoldBounce,
    overboughtWarning,
    trendWithMom,
    pullbackInUptrend,
    breakoutWithVol,
    lowVolBreakout,
    highVolConsolidation,
    acceleratingUp,
    deceleratingDown,
    spyTrend,
    spyMomentum,
    spyVolRegime,
    relativeStrength,
  };
}

// ============================================
// PRICE DATA FETCHING
// ============================================

// SQLite cache access
let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    const dbPath = 'data/price-cache.sqlite';
    if (!fs.existsSync(dbPath)) {
      throw new Error(`Price cache not found: ${dbPath}. Run warm-price-cache.ts first.`);
    }
    db = new Database(dbPath, { readonly: true });
  }
  return db;
}

function fetchPriceDataFromCache(ticker: string, days: number = 365): PriceData[] {
  const database = getDb();

  // Get latest date for ticker
  const latestStmt = database.prepare(`
    SELECT MAX(date) as maxDate FROM price_data WHERE ticker = ?
  `);
  const latestRow = latestStmt.get(ticker) as { maxDate: string | null };

  if (!latestRow?.maxDate) {
    throw new Error(`No cached data for ${ticker}. Run warm-price-cache.ts first.`);
  }

  const endDate = new Date(latestRow.maxDate);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split('T')[0];

  const stmt = database.prepare(`
    SELECT date, open, high, low, close, volume
    FROM price_data
    WHERE ticker = ? AND date >= ? AND date <= ?
    ORDER BY date ASC
  `);

  const rows = stmt.all(ticker, startDateStr, latestRow.maxDate) as any[];

  if (rows.length < 50) {
    throw new Error(`Insufficient cached data for ${ticker}: ${rows.length} days (need 50+)`);
  }

  return rows.map(r => ({
    date: r.date,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
  }));
}

async function fetchPriceData(ticker: string, days: number = 365): Promise<PriceData[]> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  try {
    const result = await yahooFinance.chart(ticker, {
      period1: startDate.toISOString().split('T')[0],
      period2: endDate.toISOString().split('T')[0],
      interval: '1d',
    }) as { quotes: Array<{ date: Date; open: number | null; high: number | null; low: number | null; close: number | null; volume?: number }> };

    if (!result.quotes || result.quotes.length === 0) {
      throw new Error(`No price data returned for ${ticker}`);
    }

    return result.quotes
      .filter((q: { open: number | null; high: number | null; low: number | null; close: number | null }) =>
        q.open !== null && q.high !== null && q.low !== null && q.close !== null)
      .map((q: { date: Date; open: number | null; high: number | null; low: number | null; close: number | null; volume?: number }) => ({
        date: q.date.toISOString().split('T')[0],
        open: q.open!,
        high: q.high!,
        low: q.low!,
        close: q.close!,
        volume: q.volume ?? 0,
      }));
  } catch (error) {
    throw new Error(`Failed to fetch price data for ${ticker}: ${error}`);
  }
}

// ============================================
// MAIN
// ============================================

async function main(): Promise<void> {
  // Parse arguments
  const args = process.argv.slice(2);
  let ticker = '';
  let signal = 'user_signal';
  let accountSize = 100000;
  let riskPercent = 0.01;
  let useCache = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ticker' && args[i + 1]) {
      ticker = args[++i].toUpperCase();
    } else if (args[i] === '--signal' && args[i + 1]) {
      signal = args[++i];
    } else if (args[i] === '--account' && args[i + 1]) {
      accountSize = parseFloat(args[++i]);
    } else if (args[i] === '--risk' && args[i + 1]) {
      riskPercent = parseFloat(args[++i]);
    } else if (args[i] === '--cache') {
      useCache = true;
    }
  }

  if (!ticker) {
    console.log(`
Usage: npx tsx scripts/evaluate-trade.ts --ticker SYMBOL [options]

Options:
  --ticker SYMBOL     Stock ticker symbol (required)
  --signal TYPE       Signal type (e.g., insider_buy, politician_trade)
  --account SIZE      Account size in dollars (default: 100000)
  --risk PERCENT      Risk per trade as decimal (default: 0.01 = 1%)
  --cache             Use SQLite price cache instead of Yahoo Finance

Examples:
  npx tsx scripts/evaluate-trade.ts --ticker AAPL
  npx tsx scripts/evaluate-trade.ts --ticker AAPL --signal insider_buy
  npx tsx scripts/evaluate-trade.ts --ticker AAPL --account 50000 --risk 0.02
  npx tsx scripts/evaluate-trade.ts --ticker AAPL --cache
`);
    process.exit(1);
  }

  console.log('\n' + '='.repeat(70));
  console.log(`TRADE EVALUATION: ${ticker}`);
  console.log('='.repeat(70));

  // Fetch price data
  const dataSource = useCache ? 'SQLite cache' : 'Yahoo Finance';
  console.log(`\nFetching price data from ${dataSource}...`);
  let tickerData: PriceData[];
  let spyData: PriceData[];

  try {
    if (useCache) {
      tickerData = fetchPriceDataFromCache(ticker);
      spyData = fetchPriceDataFromCache('SPY');
    } else {
      [tickerData, spyData] = await Promise.all([
        fetchPriceData(ticker),
        fetchPriceData('SPY'),
      ]);
    }
  } catch (error) {
    console.error(`\n[ERROR] ${error}`);
    process.exit(1);
  }

  const currentPrice = tickerData[tickerData.length - 1].close;
  const currentDate = tickerData[tickerData.length - 1].date;

  console.log(`\nSignal: ${signal}`);
  console.log(`Date: ${currentDate}`);
  console.log(`Current Price: $${currentPrice.toFixed(2)}`);

  // Compute features
  console.log('\nComputing technical features...');
  const features = await computeFeatures(tickerData, spyData);

  // Run veto analysis
  console.log('\n' + '-'.repeat(70));
  console.log('TIMING ANALYSIS');
  console.log('-'.repeat(70));

  try {
    loadVetoModel();  // Pre-load to check if model exists
  } catch (error) {
    console.error(`\n[ERROR] ${error}`);
    console.error('Run: npm run train:model:v2');
    process.exit(1);
  }

  const vetoResult = evaluateVeto(features, ticker, currentDate);

  const statusIcon = vetoResult.vetoed ? '🚫' : vetoResult.verdict === 'CAUTION' ? '⚠️' : '✅';
  console.log(`\n  ${statusIcon} Verdict: ${vetoResult.verdict}`);
  console.log(`  P(loss): ${(vetoResult.pLoss * 100).toFixed(1)}%`);
  console.log(`  P(win): ${(vetoResult.pWin * 100).toFixed(1)}%`);
  console.log(`  Confidence: ${vetoResult.confidence}`);

  if (vetoResult.reasons.length > 0) {
    console.log('\n  Analysis:');
    for (const reason of vetoResult.reasons) {
      console.log(`    - ${reason}`);
    }
  }

  // If vetoed, still show the trade plan for reference
  if (vetoResult.vetoed) {
    console.log('\n' + '-'.repeat(70));
    console.log('RECOMMENDATION: VETO - NOT A GOOD TIME TO BUY');
    console.log('-'.repeat(70));
    console.log('\n  The model has high confidence this is poor timing.');
    console.log('  Consider waiting for better conditions.');
    console.log('\n  (Trade plan shown below for reference only)');
  }

  // Calculate trade plan
  console.log('\n' + '-'.repeat(70));
  console.log('TRADE PLAN');
  console.log('-'.repeat(70));

  const atr = computeATR(tickerData, 14);
  const tradePlan = calculateExitLevels(ticker, currentPrice, atr);
  const positionSize = calculatePositionSize(tradePlan, accountSize, riskPercent);

  console.log(`\n  Entry: $${tradePlan.entry.toFixed(2)}`);
  console.log(`  Stop Loss: $${tradePlan.stopLoss.toFixed(2)} (-${tradePlan.stopPercent.toFixed(1)}%)`);
  console.log(`  TP1 (2R): $${tradePlan.tp1.toFixed(2)} (+${tradePlan.tp1Percent.toFixed(1)}%)`);
  console.log(`  TP2 (3R): $${tradePlan.tp2.toFixed(2)} (+${tradePlan.tp2Percent.toFixed(1)}%)`);
  console.log(`  TP3 (4R): $${tradePlan.tp3.toFixed(2)} (+${tradePlan.tp3Percent.toFixed(1)}%)`);

  // Position sizing
  console.log('\n' + '-'.repeat(70));
  console.log(`POSITION SIZING ($${accountSize.toLocaleString()} account, ${(riskPercent * 100).toFixed(0)}% risk)`);
  console.log('-'.repeat(70));

  console.log(`\n  Risk per share: $${tradePlan.riskPerShare.toFixed(2)}`);
  console.log(`  Suggested shares: ${positionSize.shares}`);
  console.log(`  Position value: $${positionSize.positionValue.toLocaleString()}`);
  console.log(`  Max loss: $${positionSize.maxLoss.toFixed(0)}`);

  console.log('\n  Profit potential (partial exits):');
  console.log(`    TP1 (33%): +$${positionSize.tp1Profit.toFixed(0)}`);
  console.log(`    TP2 (33%): +$${positionSize.tp2Profit.toFixed(0)}`);
  console.log(`    TP3 (34%): +$${positionSize.tp3Profit.toFixed(0)}`);
  console.log(`    Total if all TPs hit: +$${(positionSize.tp1Profit + positionSize.tp2Profit + positionSize.tp3Profit).toFixed(0)}`);

  // Technical context
  console.log('\n' + '-'.repeat(70));
  console.log('TECHNICAL CONTEXT');
  console.log('-'.repeat(70));

  console.log(`\n  RSI(14): ${features.rsi14.toFixed(1)} ${features.rsi14 > 70 ? '(overbought)' : features.rsi14 < 30 ? '(oversold)' : '(neutral)'}`);
  console.log(`  Price vs SMA20: ${features.priceVsSma20 >= 0 ? '+' : ''}${features.priceVsSma20.toFixed(1)}%`);
  console.log(`  Price vs SMA50: ${features.priceVsSma50 >= 0 ? '+' : ''}${features.priceVsSma50.toFixed(1)}%`);
  console.log(`  ATR%: ${features.atrPercent.toFixed(1)}%`);
  console.log(`  Volume ratio: ${features.volumeRatio.toFixed(2)}x`);
  console.log(`  52-week range position: ${(features.positionInRange * 100).toFixed(0)}%`);
  console.log(`  SPY momentum: ${features.spyMomentum >= 0 ? '+' : ''}${features.spyMomentum.toFixed(1)}%`);
  console.log(`  Relative strength vs SPY: ${features.relativeStrength >= 0 ? '+' : ''}${features.relativeStrength.toFixed(1)}%`);

  console.log('\n' + '='.repeat(70));
  console.log('EVALUATION COMPLETE');
  console.log('='.repeat(70) + '\n');

  // Cleanup
  if (db) {
    db.close();
  }
}

main().catch(console.error);
