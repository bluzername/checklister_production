#!/usr/bin/env npx ts-node
/**
 * Offline Training Data Generation v2 - IMPROVED FEATURES
 *
 * Improvements over v1:
 * 1. Clips momentum outliers to ±3 standard deviations
 * 2. Adds temporal features (momentum acceleration, volatility regime)
 * 3. Adds interaction features (condition combinations)
 * 4. Adds market regime features (SPY trend as context)
 *
 * Usage:
 *   npx ts-node scripts/generate-from-cache-v2.ts --target 50000 --output data/training-50k-v2.json
 *
 * Created: 2025-12-16 (Data Quality Improvements)
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  getCachedPrices,
  getCachedTickers,
  getTickerDateRange,
  getCacheStats,
  closeDatabase,
} from '../src/lib/data-services/sqlite-cache';
import { getTrainTickers, getValidationTickers } from '../src/lib/ml/ticker-splits';

// ============================================
// TYPES
// ============================================

interface CachedOHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface GeneratedSample {
  ticker: string;
  signalDate: string;
  entryPrice: number;
  stopLoss: number;
  features: Record<string, number>;
  label: 0 | 1;
  realizedR: number;
  exitDate: string;
  exitReason: string;
  mfeR: number;
  maeR: number;
  holdingDays: number;
}

interface GenerationConfig {
  targetSamples: number;
  outputFile: string;
  sampleInterval: number;
  minHistoryDays: number;
  maxForwardDays: number;
  stopLossATRMultiple: number;
  targetRForLabel: number;
  split: 'train' | 'validation' | 'all';
  resumeFrom?: string;
  verbose: boolean;
}

// ============================================
// OUTLIER CLIPPING CONSTANTS
// ============================================

// Pre-computed from 50K dataset analysis
const FEATURE_STATS: Record<string, { mean: number; std: number }> = {
  momentum5: { mean: 3.54, std: 108.99 },
  momentum10: { mean: 5.99, std: 157.61 },
  momentum20: { mean: 9.38, std: 232.14 },
  momentum60: { mean: 15.86, std: 484.87 },
};

const CLIP_STDDEVS = 3; // Clip at ±3 standard deviations

/**
 * Clip outliers to ±N standard deviations
 */
function clipOutlier(value: number, featureName: string): number {
  const stats = FEATURE_STATS[featureName];
  if (!stats) return value;

  const lowerBound = stats.mean - CLIP_STDDEVS * stats.std;
  const upperBound = stats.mean + CLIP_STDDEVS * stats.std;

  return Math.max(lowerBound, Math.min(upperBound, value));
}

// ============================================
// FEATURE COMPUTATION (From OHLCV Only)
// ============================================

function computeATR(data: CachedOHLCV[], period: number = 14): number {
  if (data.length < period + 1) return 0;

  const trueRanges: number[] = [];
  for (let i = 1; i < data.length && i <= period; i++) {
    const high = data[i].high;
    const low = data[i].low;
    const prevClose = data[i - 1].close;
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }

  return trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
}

function computeRSI(data: CachedOHLCV[], period: number = 14): number {
  if (data.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = data[i].close - data[i - 1].close;
    if (change > 0) gains += change;
    else losses -= change;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function computeSMA(data: CachedOHLCV[], period: number): number {
  if (data.length < period) return 0;
  const sum = data.slice(0, period).reduce((acc, d) => acc + d.close, 0);
  return sum / period;
}

function computeEMA(data: CachedOHLCV[], period: number): number {
  if (data.length < period) return 0;

  const k = 2 / (period + 1);
  let ema = computeSMA(data.slice(data.length - period), period);

  for (let i = data.length - period - 1; i >= 0; i--) {
    ema = data[i].close * k + ema * (1 - k);
  }

  return ema;
}

function computeBBPosition(data: CachedOHLCV[], period: number = 20): number {
  if (data.length < period) return 0;

  const closes = data.slice(0, period).map(d => d.close);
  const sma = closes.reduce((a, b) => a + b, 0) / period;
  const variance = closes.reduce((acc, c) => acc + Math.pow(c - sma, 2), 0) / period;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;

  const currentPrice = data[0].close;
  const position = (currentPrice - sma) / (2 * stdDev);
  return Math.max(-1, Math.min(1, position));
}

function computeVolumeRatio(data: CachedOHLCV[], period: number = 20): number {
  if (data.length < period) return 1;

  const avgVolume = data.slice(1, period + 1).reduce((acc, d) => acc + d.volume, 0) / period;
  if (avgVolume === 0) return 1;

  return data[0].volume / avgVolume;
}

function computeMomentum(data: CachedOHLCV[], period: number): number {
  if (data.length < period + 1) return 0;
  const oldPrice = data[period].close;
  if (oldPrice === 0) return 0;
  return ((data[0].close - oldPrice) / oldPrice) * 100;
}

function isConsolidationBreakout(data: CachedOHLCV[], period: number = 10): boolean {
  if (data.length < period + 1) return false;

  const recentData = data.slice(1, period + 1);
  const rangeHigh = Math.max(...recentData.map(d => d.high));
  const rangeLow = Math.min(...recentData.map(d => d.low));

  return data[0].close > rangeHigh && data[0].close > data[0].open;
}

function isBullishCandle(data: CachedOHLCV[]): boolean {
  if (data.length < 1) return false;
  const candle = data[0];

  const range = candle.high - candle.low;
  const body = candle.close - candle.open;

  return body > 0 && (range > 0 ? body / range > 0.5 : true);
}

/**
 * Compute ATR percentile over historical period
 * Returns 0-100 where 100 = highest volatility historically
 */
function computeVolatilityRegime(data: CachedOHLCV[], lookbackPeriod: number = 60): number {
  if (data.length < lookbackPeriod + 14) return 50;

  const currentATR = computeATR(data, 14);

  // Compute ATR at each point in the lookback
  const historicalATRs: number[] = [];
  for (let i = 0; i < lookbackPeriod; i += 5) {
    const historicalATR = computeATR(data.slice(i), 14);
    if (historicalATR > 0) historicalATRs.push(historicalATR);
  }

  if (historicalATRs.length === 0) return 50;

  // Calculate percentile
  const sorted = [...historicalATRs].sort((a, b) => a - b);
  const rank = sorted.filter(atr => atr <= currentATR).length;
  return (rank / sorted.length) * 100;
}

/**
 * Compute momentum acceleration (rate of change of momentum)
 * Positive = accelerating up, Negative = decelerating
 */
function computeMomentumAcceleration(data: CachedOHLCV[], shortPeriod: number = 5, longPeriod: number = 10): number {
  if (data.length < longPeriod + 5) return 0;

  // Current momentum
  const currentMom = computeMomentum(data, shortPeriod);

  // Momentum 5 days ago
  const pastMom = computeMomentum(data.slice(5), shortPeriod);

  return currentMom - pastMom;
}

/**
 * Compute mean reversion score
 * High positive = oversold (potential bounce)
 * High negative = overbought (potential pullback)
 */
function computeMeanReversionScore(data: CachedOHLCV[]): number {
  if (data.length < 20) return 0;

  const rsi = computeRSI(data, 14);
  const bbPos = computeBBPosition(data, 20);

  // Normalize RSI to -1 to 1 range (50 = 0)
  const rsiNorm = (50 - rsi) / 50;

  // Combine: positive = oversold, negative = overbought
  return (rsiNorm + (-bbPos)) / 2 * 100;
}

/**
 * Compute all features from OHLCV data with improvements
 */
function computeFeatures(data: CachedOHLCV[], spyData?: CachedOHLCV[]): Record<string, number> {
  if (data.length < 60) return {};

  const current = data[0];
  const atr14 = computeATR(data, 14);
  const rsi14 = computeRSI(data, 14);
  const sma20 = computeSMA(data, 20);
  const sma50 = computeSMA(data, 50);
  const ema9 = computeEMA(data, 9);
  const ema21 = computeEMA(data, 21);

  // === ORIGINAL FEATURES (21) ===

  // Price relative to moving averages
  const priceVsSma20 = sma20 > 0 ? ((current.close - sma20) / sma20) * 100 : 0;
  const priceVsSma50 = sma50 > 0 ? ((current.close - sma50) / sma50) * 100 : 0;
  const priceVsEma9 = ema9 > 0 ? ((current.close - ema9) / ema9) * 100 : 0;

  // MA relationships
  const sma20VsSma50 = sma50 > 0 ? ((sma20 - sma50) / sma50) * 100 : 0;
  const ema9VsEma21 = ema21 > 0 ? ((ema9 - ema21) / ema21) * 100 : 0;

  // Volatility
  const atrPercent = current.close > 0 ? (atr14 / current.close) * 100 : 0;
  const bbPosition = computeBBPosition(data, 20);

  // Volume
  const volumeRatio = computeVolumeRatio(data, 20);

  // Momentum (with outlier clipping)
  const momentum5_raw = computeMomentum(data, 5);
  const momentum10_raw = computeMomentum(data, 10);
  const momentum20_raw = computeMomentum(data, 20);
  const momentum60_raw = data.length >= 61 ? computeMomentum(data, 60) : 0;

  // CLIPPED momentum values
  const momentum5 = clipOutlier(momentum5_raw, 'momentum5');
  const momentum10 = clipOutlier(momentum10_raw, 'momentum10');
  const momentum20 = clipOutlier(momentum20_raw, 'momentum20');
  const momentum60 = clipOutlier(momentum60_raw, 'momentum60');

  // Candle characteristics
  const candleRange = current.high - current.low;
  const candleBody = Math.abs(current.close - current.open);
  const candleBodyRatio = candleRange > 0 ? candleBody / candleRange : 0;
  const isBullish = isBullishCandle(data) ? 1 : 0;

  // Recent high/low position
  const high20 = Math.max(...data.slice(0, 20).map(d => d.high));
  const low20 = Math.min(...data.slice(0, 20).map(d => d.low));
  const range20 = high20 - low20;
  const positionInRange = range20 > 0 ? (current.close - low20) / range20 : 0.5;

  // Breakout signals
  const isBreakout = isConsolidationBreakout(data, 10) ? 1 : 0;
  const aboveSma20 = current.close > sma20 ? 1 : 0;
  const aboveSma50 = current.close > sma50 ? 1 : 0;

  // Distance from recent high (pullback depth)
  const pullbackFromHigh = high20 > 0 ? ((high20 - current.close) / high20) * 100 : 0;

  // Trend strength approximation
  const smaSlope = data.length >= 25 ?
    ((computeSMA(data, 20) - computeSMA(data.slice(5), 20)) / computeSMA(data.slice(5), 20)) * 100 : 0;

  // === NEW TEMPORAL FEATURES ===

  // Momentum acceleration (rate of change of momentum)
  const momAccel5 = computeMomentumAcceleration(data, 5, 10);
  const momAccel10 = computeMomentumAcceleration(data, 10, 20);

  // Volatility regime (percentile of current vol vs historical)
  const volRegime = computeVolatilityRegime(data, 60);

  // Mean reversion score
  const meanRevScore = computeMeanReversionScore(data);

  // Trend consistency (how many of last N days closed up)
  const trendConsistency5 = data.slice(0, 5).filter((d, i) =>
    i < 4 && d.close > data[i + 1].close
  ).length / 4;

  const trendConsistency10 = data.slice(0, 10).filter((d, i) =>
    i < 9 && d.close > data[i + 1].close
  ).length / 9;

  // === NEW INTERACTION FEATURES ===

  // Oversold bounce potential: RSI < 40 AND above 50 SMA (strong support)
  const oversoldBounce = (rsi14 < 40 && aboveSma50 === 1) ? 1 : 0;

  // Overbought warning: RSI > 70 AND far above SMA20
  const overboughtWarning = (rsi14 > 70 && priceVsSma20 > 5) ? 1 : 0;

  // Trend with momentum: above both SMAs AND positive short momentum
  const trendWithMom = (aboveSma20 === 1 && aboveSma50 === 1 && momentum5 > 0) ? 1 : 0;

  // Pullback in uptrend: above SMA50 AND below SMA20 (buying dip)
  const pullbackInUptrend = (aboveSma50 === 1 && aboveSma20 === 0) ? 1 : 0;

  // Breakout with volume: breakout AND above average volume
  const breakoutWithVol = (isBreakout === 1 && volumeRatio > 1.2) ? 1 : 0;

  // Low vol breakout: breakout in low volatility (more significant)
  const lowVolBreakout = (isBreakout === 1 && volRegime < 30) ? 1 : 0;

  // High vol consolidation: NOT breakout in high vol (potential explosion)
  const highVolConsolidation = (isBreakout === 0 && volRegime > 70 && Math.abs(momentum5) < 2) ? 1 : 0;

  // Accelerating uptrend: positive momentum AND accelerating
  const acceleratingUp = (momentum5 > 0 && momAccel5 > 0) ? 1 : 0;

  // Decelerating downtrend: negative momentum but decelerating (potential reversal)
  const deceleratingDown = (momentum5 < 0 && momAccel5 > 0) ? 1 : 0;

  // === MARKET REGIME FEATURES (from SPY if available) ===

  let spyTrend = 0;      // SPY above/below its SMA50
  let spyMomentum = 0;   // SPY 20-day momentum
  let spyVolRegime = 50; // SPY volatility regime
  let relativeStrength = 0; // Stock vs SPY momentum

  if (spyData && spyData.length >= 60) {
    const spySma50 = computeSMA(spyData, 50);
    spyTrend = spyData[0].close > spySma50 ? 1 : 0;
    spyMomentum = computeMomentum(spyData, 20);
    spyVolRegime = computeVolatilityRegime(spyData, 60);

    // Relative strength: how this stock performs vs SPY
    relativeStrength = momentum20 - spyMomentum;
  }

  return {
    // Original features (21)
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

    // Temporal features (6)
    momAccel5,
    momAccel10,
    volRegime,
    meanRevScore,
    trendConsistency5,
    trendConsistency10,

    // Interaction features (9)
    oversoldBounce,
    overboughtWarning,
    trendWithMom,
    pullbackInUptrend,
    breakoutWithVol,
    lowVolBreakout,
    highVolConsolidation,
    acceleratingUp,
    deceleratingDown,

    // Market regime features (4)
    spyTrend,
    spyMomentum: clipOutlier(spyMomentum, 'momentum20'),
    spyVolRegime,
    relativeStrength,
  };
}

function isValidSetup(features: Record<string, number>): boolean {
  if (Object.keys(features).length < 15) return false;

  // Not extremely overbought
  if (features.rsi14 > 80) return false;

  // Not in freefall
  if (features.momentum20 < -15) return false;

  // Reasonable volatility
  if (features.atrPercent < 0.5 || features.atrPercent > 10) return false;

  // Positive setup criteria (at least one)
  const hasPositiveSignal =
    features.isBreakout === 1 ||
    (features.aboveSma20 === 1 && features.pullbackFromHigh < 5) ||
    features.oversoldBounce === 1 ||
    features.pullbackInUptrend === 1 ||
    (features.momentum5 > 2 && features.volumeRatio > 1.2);

  if (!hasPositiveSignal) return false;

  return true;
}

// ============================================
// LABELING
// ============================================

function labelFromCache(
  entryDate: string,
  entryPrice: number,
  stopLoss: number,
  forwardData: CachedOHLCV[],
  maxDays: number = 45,
  tpMultiples: number[] = [1.5, 2.5, 4.0],
  targetR: number = 1.0
): {
  label: 0 | 1;
  realizedR: number;
  exitDate: string;
  exitReason: string;
  mfeR: number;
  maeR: number;
  holdingDays: number;
} | null {
  const risk = entryPrice - stopLoss;
  if (risk <= 0) return null;

  const tp1 = entryPrice + risk * tpMultiples[0];
  const tp2 = entryPrice + risk * tpMultiples[1];
  const tp3 = entryPrice + risk * tpMultiples[2];

  let mfe = 0;
  let mae = 0;
  let exitPrice = 0;
  let exitDate = '';
  let exitReason = 'TIME_EXIT';

  const daysToSimulate = Math.min(maxDays, forwardData.length);

  for (let i = 0; i < daysToSimulate; i++) {
    const day = forwardData[i];

    mfe = Math.max(mfe, day.high);
    mae = Math.min(mae === 0 ? day.low : mae, day.low);

    if (day.low <= stopLoss) {
      exitPrice = Math.max(day.low, stopLoss - risk);
      exitDate = day.date;
      exitReason = 'STOP_LOSS';
      break;
    }

    if (day.high >= tp3) {
      exitPrice = tp3;
      exitDate = day.date;
      exitReason = 'TP3';
      break;
    }

    if (day.high >= tp2) {
      exitPrice = tp2;
      exitDate = day.date;
      exitReason = 'TP2';
      break;
    }

    if (day.high >= tp1) {
      exitPrice = tp1;
      exitDate = day.date;
      exitReason = 'TP1';
      break;
    }
  }

  if (exitPrice === 0 && forwardData.length > 0) {
    const lastDay = forwardData[Math.min(daysToSimulate - 1, forwardData.length - 1)];
    exitPrice = lastDay.close;
    exitDate = lastDay.date;
    exitReason = 'TIME_EXIT';
  }

  if (exitPrice === 0) return null;

  const realizedR = (exitPrice - entryPrice) / risk;
  const mfeR = (mfe - entryPrice) / risk;
  const maeR = (mae - entryPrice) / risk;

  const entryTime = new Date(entryDate).getTime();
  const exitTime = new Date(exitDate).getTime();
  const holdingDays = Math.ceil((exitTime - entryTime) / (1000 * 60 * 60 * 24));

  return {
    label: realizedR >= targetR ? 1 : 0,
    realizedR,
    exitDate,
    exitReason,
    mfeR,
    maeR,
    holdingDays,
  };
}

// ============================================
// MAIN GENERATION LOGIC
// ============================================

async function generateSamples(config: GenerationConfig): Promise<GeneratedSample[]> {
  console.log('\n' + '='.repeat(60));
  console.log('OFFLINE TRAINING DATA GENERATION v2 (IMPROVED FEATURES)');
  console.log('='.repeat(60));

  // Get tickers based on split
  let tickers: string[];
  if (config.split === 'train') {
    tickers = getTrainTickers();
  } else if (config.split === 'validation') {
    tickers = getValidationTickers();
  } else {
    tickers = [...getTrainTickers(), ...getValidationTickers()];
  }

  const cachedTickers = getCachedTickers();
  const availableTickers = tickers.filter(t => cachedTickers.includes(t));

  console.log(`\nConfiguration:`);
  console.log(`  Target samples: ${config.targetSamples.toLocaleString()}`);
  console.log(`  Split: ${config.split}`);
  console.log(`  Total tickers in split: ${tickers.length}`);
  console.log(`  Tickers with cached data: ${availableTickers.length}`);
  console.log(`  Sample interval: every ${config.sampleInterval} days`);
  console.log(`  Min history: ${config.minHistoryDays} days`);
  console.log(`  Max forward: ${config.maxForwardDays} days`);
  console.log(`  Stop loss: ${config.stopLossATRMultiple}x ATR`);
  console.log(`  Target R for label=1: ${config.targetRForLabel}`);

  console.log(`\nFeature improvements:`);
  console.log(`  - Momentum outliers clipped to ±3 std`);
  console.log(`  - Added 6 temporal features`);
  console.log(`  - Added 9 interaction features`);
  console.log(`  - Added 4 market regime features (SPY)`);
  console.log(`  - Total features: 40`);

  if (availableTickers.length === 0) {
    console.log('\n[ERROR] No tickers with cached data. Run warm-price-cache.ts first.');
    return [];
  }

  // Load SPY data for market regime features
  let spyDataMap: Map<string, CachedOHLCV[]> = new Map();
  const spyDateRange = getTickerDateRange('SPY');
  if (spyDateRange && spyDateRange.oldest && spyDateRange.newest) {
    const allSpyData = getCachedPrices('SPY', spyDateRange.oldest, spyDateRange.newest);
    if (allSpyData && allSpyData.length > 0) {
      // Sort by date descending
      allSpyData.sort((a, b) => b.date.localeCompare(a.date));
      // Build a map of date -> data starting from that date
      for (let i = 0; i < allSpyData.length - 60; i++) {
        spyDataMap.set(allSpyData[i].date, allSpyData.slice(i, i + 100));
      }
      console.log(`\nLoaded SPY data: ${allSpyData.length} records for market regime`);
    }
  } else {
    console.log(`\n[WARN] SPY data not found. Market regime features will be 0.`);
  }

  let samples: GeneratedSample[] = [];
  const existingDates = new Set<string>();

  if (config.resumeFrom && fs.existsSync(config.resumeFrom)) {
    const existing = JSON.parse(fs.readFileSync(config.resumeFrom, 'utf-8'));
    samples = existing.samples || [];
    samples.forEach(s => existingDates.add(`${s.ticker}:${s.signalDate}`));
    console.log(`\nResuming from ${config.resumeFrom}: ${samples.length} existing samples`);
  }

  const stats = getCacheStats();
  console.log(`\nCache stats:`);
  console.log(`  Total records: ${stats.totalRecords.toLocaleString()}`);
  console.log(`  Date range: ${stats.oldestDate} to ${stats.newestDate}`);

  let processed = 0;
  let skipped = 0;
  let invalidSetup = 0;
  let insufficientData = 0;
  let labelingFailed = 0;

  const startTime = Date.now();
  const samplesPerTicker = Math.ceil((config.targetSamples - samples.length) / availableTickers.length * 1.5);

  console.log(`\nGenerating ~${samplesPerTicker} samples per ticker...`);
  console.log('');

  for (let ti = 0; ti < availableTickers.length; ti++) {
    const ticker = availableTickers[ti];

    const dateRange = getTickerDateRange(ticker);
    if (!dateRange || !dateRange.oldest || !dateRange.newest ||
        dateRange.count < config.minHistoryDays + config.maxForwardDays) {
      if (config.verbose) console.log(`[${ticker}] Insufficient data (${dateRange?.count || 0} days)`);
      continue;
    }

    const allData = getCachedPrices(ticker, dateRange.oldest, dateRange.newest);
    if (!allData || allData.length < config.minHistoryDays + config.maxForwardDays) {
      continue;
    }

    allData.sort((a, b) => b.date.localeCompare(a.date));

    const tickerSamples: GeneratedSample[] = [];

    for (let dayOffset = config.maxForwardDays;
         dayOffset < allData.length - config.minHistoryDays;
         dayOffset += config.sampleInterval) {

      const signalIndex = dayOffset;
      const signalDate = allData[signalIndex].date;

      const key = `${ticker}:${signalDate}`;
      if (existingDates.has(key)) {
        skipped++;
        continue;
      }

      processed++;

      const historyData = allData.slice(signalIndex, signalIndex + config.minHistoryDays + 10);

      // Get SPY data for this date
      const spyData = spyDataMap.get(signalDate);

      const features = computeFeatures(historyData, spyData);
      if (Object.keys(features).length < 15) {
        insufficientData++;
        continue;
      }

      if (!isValidSetup(features)) {
        invalidSetup++;
        continue;
      }

      const entryPrice = allData[signalIndex].close;
      const atr = computeATR(historyData, 14);
      const stopLoss = entryPrice - (atr * config.stopLossATRMultiple);

      if (stopLoss <= 0 || stopLoss >= entryPrice) {
        labelingFailed++;
        continue;
      }

      const forwardData = allData.slice(0, signalIndex).reverse();
      if (forwardData.length < 10) {
        insufficientData++;
        continue;
      }

      const labelResult = labelFromCache(
        signalDate,
        entryPrice,
        stopLoss,
        forwardData,
        config.maxForwardDays,
        [1.5, 2.5, 4.0],
        config.targetRForLabel
      );

      if (!labelResult) {
        labelingFailed++;
        continue;
      }

      tickerSamples.push({
        ticker,
        signalDate,
        entryPrice,
        stopLoss,
        features,
        label: labelResult.label,
        realizedR: labelResult.realizedR,
        exitDate: labelResult.exitDate,
        exitReason: labelResult.exitReason,
        mfeR: labelResult.mfeR,
        maeR: labelResult.maeR,
        holdingDays: labelResult.holdingDays,
      });

      existingDates.add(key);

      if (tickerSamples.length >= samplesPerTicker) break;
    }

    samples.push(...tickerSamples);

    const progress = ((ti + 1) / availableTickers.length * 100).toFixed(1);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const winRate = samples.length > 0 ?
      (samples.filter(s => s.label === 1).length / samples.length * 100).toFixed(1) : '0.0';

    console.log(
      `[${(ti + 1).toString().padStart(3)}/${availableTickers.length}] ${ticker.padEnd(6)} ` +
      `+${tickerSamples.length.toString().padStart(3)} samples | ` +
      `Total: ${samples.length.toLocaleString().padStart(6)} | ` +
      `WR: ${winRate}% | ` +
      `${progress}% | ${elapsed}s`
    );

    if (samples.length >= config.targetSamples) {
      console.log(`\nReached target of ${config.targetSamples.toLocaleString()} samples`);
      break;
    }

    if ((ti + 1) % 10 === 0) {
      saveResults(samples, config.outputFile);
    }
  }

  const duration = (Date.now() - startTime) / 1000;
  const wins = samples.filter(s => s.label === 1).length;
  const losses = samples.filter(s => s.label === 0).length;

  console.log('\n' + '='.repeat(60));
  console.log('GENERATION COMPLETE (v2 - IMPROVED FEATURES)');
  console.log('='.repeat(60));
  console.log(`\nResults:`);
  console.log(`  Total samples: ${samples.length.toLocaleString()}`);
  console.log(`  Label=1 (wins): ${wins.toLocaleString()} (${(wins/samples.length*100).toFixed(1)}%)`);
  console.log(`  Label=0 (losses): ${losses.toLocaleString()} (${(losses/samples.length*100).toFixed(1)}%)`);
  console.log(`  Features per sample: ${Object.keys(samples[0]?.features || {}).length}`);
  console.log(`\nProcessing:`);
  console.log(`  Dates processed: ${processed.toLocaleString()}`);
  console.log(`  Skipped (duplicate): ${skipped.toLocaleString()}`);
  console.log(`  Invalid setup: ${invalidSetup.toLocaleString()}`);
  console.log(`  Insufficient data: ${insufficientData.toLocaleString()}`);
  console.log(`  Labeling failed: ${labelingFailed.toLocaleString()}`);
  console.log(`\nDuration: ${duration.toFixed(1)}s`);

  // Exit reason distribution
  const exitReasons: Record<string, number> = {};
  samples.forEach(s => {
    exitReasons[s.exitReason] = (exitReasons[s.exitReason] || 0) + 1;
  });
  console.log(`\nExit reason distribution:`);
  Object.entries(exitReasons)
    .sort((a, b) => b[1] - a[1])
    .forEach(([reason, count]) => {
      console.log(`  ${reason.padEnd(12)} ${count.toLocaleString().padStart(6)} (${(count/samples.length*100).toFixed(1)}%)`);
    });

  return samples;
}

function saveResults(samples: GeneratedSample[], outputFile: string): void {
  const outputDir = path.dirname(outputFile);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Compute feature stats for the new features
  const featureStats: Record<string, { mean: number; std: number; min: number; max: number }> = {};
  const featureNames = Object.keys(samples[0]?.features || {});

  for (const feat of featureNames) {
    const values = samples.map(s => s.features[feat] || 0);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
    const std = Math.sqrt(variance);
    featureStats[feat] = {
      mean,
      std,
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }

  const output = {
    metadata: {
      version: '2.0-improved-features',
      generatedAt: new Date().toISOString(),
      totalSamples: samples.length,
      winRate: samples.filter(s => s.label === 1).length / samples.length,
      featureCount: featureNames.length,
      features: featureNames,
      featureStats,
      improvements: [
        'Momentum outliers clipped to ±3 std',
        'Added temporal features (momentum acceleration, volatility regime)',
        'Added interaction features (condition combinations)',
        'Added market regime features (SPY trend)',
      ],
    },
    samples,
  };

  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  console.log(`  [checkpoint] Saved ${samples.length.toLocaleString()} samples to ${outputFile}`);
}

// ============================================
// CLI
// ============================================

function parseArgs(): GenerationConfig {
  const args = process.argv.slice(2);
  const config: GenerationConfig = {
    targetSamples: 50000,
    outputFile: 'data/training-50k-v2.json',
    sampleInterval: 5,
    minHistoryDays: 60,
    maxForwardDays: 45,
    stopLossATRMultiple: 2.0,
    targetRForLabel: 1.0,
    split: 'train',
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--target':
        if (next) config.targetSamples = parseInt(next, 10);
        i++;
        break;
      case '--output':
        if (next) config.outputFile = next;
        i++;
        break;
      case '--interval':
        if (next) config.sampleInterval = parseInt(next, 10);
        i++;
        break;
      case '--history':
        if (next) config.minHistoryDays = parseInt(next, 10);
        i++;
        break;
      case '--forward':
        if (next) config.maxForwardDays = parseInt(next, 10);
        i++;
        break;
      case '--stop-atr':
        if (next) config.stopLossATRMultiple = parseFloat(next);
        i++;
        break;
      case '--target-r':
        if (next) config.targetRForLabel = parseFloat(next);
        i++;
        break;
      case '--split':
        if (next && ['train', 'validation', 'all'].includes(next)) {
          config.split = next as 'train' | 'validation' | 'all';
        }
        i++;
        break;
      case '--resume':
        if (next) config.resumeFrom = next;
        i++;
        break;
      case '--verbose':
        config.verbose = true;
        break;
      case '--help':
        printHelp();
        process.exit(0);
    }
  }

  return config;
}

function printHelp(): void {
  console.log(`
Offline Training Data Generation v2 (IMPROVED FEATURES)

Improvements:
  - Momentum outliers clipped to ±3 standard deviations
  - Added temporal features (momentum acceleration, volatility regime)
  - Added interaction features (condition combinations)
  - Added market regime features (SPY trend, relative strength)

Usage:
  npx ts-node scripts/generate-from-cache-v2.ts [options]

Options:
  --target <n>      Target number of samples (default: 50000)
  --output <file>   Output JSON file (default: data/training-50k-v2.json)
  --interval <n>    Days between samples (default: 5)
  --history <n>     Days of history for features (default: 60)
  --forward <n>     Max days for labeling (default: 45)
  --stop-atr <n>    ATR multiple for stop loss (default: 2.0)
  --target-r <n>    R-multiple threshold for label=1 (default: 1.0)
  --split <type>    Ticker split: train, validation, all (default: train)
  --resume <file>   Resume from existing output file
  --verbose         Show detailed progress
  --help            Show this help

Examples:
  # Generate 50K training samples with improved features
  npx ts-node scripts/generate-from-cache-v2.ts --target 50000 --split train

  # Generate validation set
  npx ts-node scripts/generate-from-cache-v2.ts --target 10000 --split validation --output data/validation-10k-v2.json
`);
}

async function main(): Promise<void> {
  const config = parseArgs();

  try {
    const samples = await generateSamples(config);

    if (samples.length > 0) {
      saveResults(samples, config.outputFile);
      console.log(`\nSaved ${samples.length.toLocaleString()} samples to ${config.outputFile}`);
    }
  } catch (error) {
    console.error('\nError:', error);
    process.exit(1);
  } finally {
    closeDatabase();
  }
}

main();
