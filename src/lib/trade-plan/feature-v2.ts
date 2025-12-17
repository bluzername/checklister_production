/**
 * V2 Feature Computation Module
 *
 * Computes the 40 features used by the v2 veto model from OHLCV data.
 * This module is shared between the web app (analysis.ts) and CLI tools.
 */

// ============================================
// TYPES
// ============================================

export interface PriceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface V2Features {
  priceVsSma20: number;
  priceVsSma50: number;
  priceVsEma9: number;
  sma20VsSma50: number;
  ema9VsEma21: number;
  positionInRange: number;
  pullbackFromHigh: number;
  atrPercent: number;
  bbPosition: number;
  volumeRatio: number;
  rsi14: number;
  momentum5: number;
  momentum10: number;
  momentum20: number;
  momentum60: number;
  candleBodyRatio: number;
  isBullish: number;
  isBreakout: number;
  aboveSma20: number;
  aboveSma50: number;
  smaSlope: number;
  momAccel5: number;
  momAccel10: number;
  volRegime: number;
  meanRevScore: number;
  trendConsistency5: number;
  trendConsistency10: number;
  oversoldBounce: number;
  overboughtWarning: number;
  trendWithMom: number;
  pullbackInUptrend: number;
  breakoutWithVol: number;
  lowVolBreakout: number;
  highVolConsolidation: number;
  acceleratingUp: number;
  deceleratingDown: number;
  spyTrend: number;
  spyMomentum: number;
  spyVolRegime: number;
  relativeStrength: number;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function computeSMA(data: PriceBar[], period: number): number {
  if (data.length < period) return data[data.length - 1]?.close ?? 0;
  const slice = data.slice(-period);
  return slice.reduce((sum, d) => sum + d.close, 0) / period;
}

function computeEMA(data: PriceBar[], period: number): number {
  if (data.length < period) return data[data.length - 1]?.close ?? 0;
  const multiplier = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((sum, d) => sum + d.close, 0) / period;

  for (let i = period; i < data.length; i++) {
    ema = (data[i].close - ema) * multiplier + ema;
  }
  return ema;
}

function computeRSI(data: PriceBar[], period: number = 14): number {
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

function computeATR(data: PriceBar[], period: number = 14): number {
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

function computeMomentum(data: PriceBar[], period: number): number {
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

// ============================================
// MAIN FEATURE COMPUTATION
// ============================================

/**
 * Compute v2 features from OHLCV data
 * @param data - Price bars (oldest to newest)
 * @param spyData - SPY price bars for market context (oldest to newest)
 */
export function computeV2Features(
  data: PriceBar[],
  spyData?: PriceBar[]
): V2Features {
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

  // Momentum (clipped to prevent outliers)
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
  const atrHistory: number[] = [];
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

    const spyATRHistory: number[] = [];
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

/**
 * Convert analysis.ts arrays (newest-first) to PriceBar[] (oldest-first)
 * for use with computeV2Features
 */
export function convertToPriceBars(
  dates: string[],
  opens: number[],
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[]
): PriceBar[] {
  const bars: PriceBar[] = [];

  // analysis.ts arrays are newest-first, so we reverse
  for (let i = dates.length - 1; i >= 0; i--) {
    bars.push({
      date: dates[i],
      open: opens[i],
      high: highs[i],
      low: lows[i],
      close: closes[i],
      volume: volumes[i],
    });
  }

  return bars;
}
