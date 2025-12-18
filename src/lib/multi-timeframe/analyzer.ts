/**
 * Multi-Timeframe Analyzer
 * Calculates technical indicators on 4H timeframe and combines with daily analysis
 *
 * PIT Safety: All functions now accept asOfDate parameter for backtesting.
 * When asOfDate is provided, analysis is performed using only data available up to that date.
 */

import { get4HourData, is4HDataReliable } from './data-fetcher';
import {
  Hour4Analysis,
  MultiTimeframeAnalysis,
  TimeframeAlignment,
  MACDData,
  MACDStatus,
  OHLCVCandle,
} from './types';
import { cacheKey, getOrFetch, TTL } from '../data-services/cache';

// ============================================
// TECHNICAL INDICATOR CALCULATIONS
// ============================================

/**
 * Calculate EMA (Exponential Moving Average)
 */
function calculateEMA(data: number[], period: number): number {
  if (data.length < period) return 0;
  
  const k = 2 / (period + 1);
  let ema = data[data.length - 1]; // Start with oldest value
  
  // Process from oldest to newest
  for (let i = data.length - 2; i >= 0; i--) {
    ema = (data[i] * k) + (ema * (1 - k));
  }
  
  return ema;
}

/**
 * Calculate SMA (Simple Moving Average)
 */
function calculateSMA(data: number[], period: number): number {
  if (data.length < period) return 0;
  const slice = data.slice(0, period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/**
 * Calculate RSI (Relative Strength Index)
 */
function calculateRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  // prices are in reverse order (newest first)
  for (let i = 0; i < period; i++) {
    const change = prices[i] - prices[i + 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 * Standard settings: 12, 26, 9
 */
function calculateMACD(prices: number[]): MACDData {
  if (prices.length < 26) {
    return {
      macdLine: 0,
      signalLine: 0,
      histogram: 0,
      status: 'NEGATIVE',
      crossover: 'NONE',
      histogramRising: false,
    };
  }

  // Reverse for EMA calculation (oldest first)
  const reversed = [...prices].reverse();
  
  const ema12 = calculateEMA(reversed, 12);
  const ema26 = calculateEMA(reversed, 26);
  const macdLine = ema12 - ema26;

  // Calculate signal line (9-period EMA of MACD line)
  // For simplicity, we'll approximate it
  const macdValues: number[] = [];
  for (let i = 0; i < Math.min(20, prices.length - 26); i++) {
    const slice = reversed.slice(i);
    const e12 = calculateEMA(slice, 12);
    const e26 = calculateEMA(slice, 26);
    macdValues.push(e12 - e26);
  }
  
  const signalLine = macdValues.length >= 9 
    ? calculateEMA(macdValues.reverse(), 9)
    : macdLine;

  const histogram = macdLine - signalLine;

  // Calculate previous histogram for trend
  const prevHistogram = macdValues.length > 1 ? macdValues[1] - signalLine : histogram;

  // Determine MACD status
  let status: MACDStatus;
  if (histogram > 0 && macdLine > 0) {
    status = 'POSITIVE';
  } else if (histogram > prevHistogram && histogram > -0.1) {
    status = 'TURNING_POSITIVE';
  } else {
    status = 'NEGATIVE';
  }

  // Detect crossover
  let crossover: 'BULLISH' | 'BEARISH' | 'NONE' = 'NONE';
  if (histogram > 0 && prevHistogram <= 0) {
    crossover = 'BULLISH';
  } else if (histogram < 0 && prevHistogram >= 0) {
    crossover = 'BEARISH';
  }

  return {
    macdLine: Math.round(macdLine * 1000) / 1000,
    signalLine: Math.round(signalLine * 1000) / 1000,
    histogram: Math.round(histogram * 1000) / 1000,
    status,
    crossover,
    histogramRising: histogram > prevHistogram,
  };
}

/**
 * Find support level (lowest low in period)
 */
function findSupport(candles: OHLCVCandle[], period: number = 10): number {
  const lows = candles.slice(0, period).map(c => c.low);
  return Math.min(...lows);
}

/**
 * Find resistance level (highest high in period)
 */
function findResistance(candles: OHLCVCandle[], period: number = 10): number {
  const highs = candles.slice(0, period).map(c => c.high);
  return Math.max(...highs);
}

/**
 * Check for higher highs and higher lows pattern
 */
function checkTrendStructure(candles: OHLCVCandle[]): { higherHighs: boolean; higherLows: boolean } {
  if (candles.length < 6) return { higherHighs: false, higherLows: false };

  const recentHigh = candles[0].high;
  const prevHigh = Math.max(...candles.slice(1, 6).map(c => c.high));
  
  const recentLow = candles[0].low;
  const prevLow = Math.min(...candles.slice(1, 6).map(c => c.low));

  return {
    higherHighs: recentHigh > prevHigh,
    higherLows: recentLow > prevLow,
  };
}

/**
 * Determine trend based on structure and EMA
 */
function determineTrend(
  higherHighs: boolean,
  higherLows: boolean,
  priceAboveEMA20: boolean
): 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' {
  if (higherHighs && higherLows && priceAboveEMA20) return 'UPTREND';
  if (!higherHighs && !higherLows && !priceAboveEMA20) return 'DOWNTREND';
  return 'SIDEWAYS';
}

// ============================================
// 4H ANALYSIS
// ============================================

/**
 * Analyze 4-hour timeframe
 *
 * @param ticker - Stock ticker symbol
 * @param asOfDate - Optional date to filter data for PIT safety (backtesting)
 *                   When provided, all data is filtered to only include candles up to this date.
 */
async function analyze4Hour(ticker: string, asOfDate?: Date): Promise<Hour4Analysis> {
  const data = await get4HourData(ticker, asOfDate);

  if (!is4HDataReliable(data) || data.candles.length < 20) {
    // Return neutral analysis if data is unreliable
    const effectiveDate = asOfDate || new Date();
    return {
      score: 5,
      macd: {
        macdLine: 0,
        signalLine: 0,
        histogram: 0,
        status: 'NEGATIVE',
        crossover: 'NONE',
        histogramRising: false,
      },
      rsi: 50,
      ema20: 0,
      priceAboveEMA20: false,
      resistance: 0,
      support: 0,
      priceVsResistance: 0,
      priceVsSupport: 0,
      higherHighs: false,
      higherLows: false,
      trend: 'SIDEWAYS',
      timestamp: effectiveDate.toISOString(),
    };
  }

  const candles = data.candles;
  const prices = candles.map(c => c.close);
  const currentPrice = prices[0];

  // Calculate indicators
  const macd = calculateMACD(prices);
  const rsi = calculateRSI(prices, 14);
  const ema20 = calculateEMA([...prices].reverse(), 20);
  const priceAboveEMA20 = currentPrice > ema20;

  // Support and resistance
  const resistance = findResistance(candles, 10);
  const support = findSupport(candles, 10);
  const priceVsResistance = resistance > 0 ? ((currentPrice - resistance) / resistance) * 100 : 0;
  const priceVsSupport = support > 0 ? ((currentPrice - support) / support) * 100 : 0;

  // Trend structure
  const { higherHighs, higherLows } = checkTrendStructure(candles);
  const trend = determineTrend(higherHighs, higherLows, priceAboveEMA20);

  // Calculate 4H score (0-10)
  let score = 5; // Start neutral

  // MACD contribution (+4 max)
  if (macd.status === 'POSITIVE') {
    score += 4;
  } else if (macd.status === 'TURNING_POSITIVE') {
    score += 2;
  } else if (macd.crossover === 'BEARISH') {
    score -= 2;
  }

  // Price vs resistance (+3 max)
  if (currentPrice > resistance) {
    score += 3; // Breakout
  } else if (priceVsResistance > -2) {
    score += 1; // Near resistance
  }

  // RSI contribution (+2 max)
  if (rsi >= 40 && rsi <= 70) {
    score += 2;
  } else if (rsi > 70) {
    score -= 1; // Overbought on 4H
  } else if (rsi < 30) {
    score += 0; // Neutral - could be reversal
  }

  // EMA position (+1 max)
  if (priceAboveEMA20) {
    score += 1;
  }

  // Trend bonus
  if (trend === 'UPTREND') {
    score += 1;
  } else if (trend === 'DOWNTREND') {
    score -= 1;
  }

  // Clamp score
  score = Math.max(0, Math.min(10, score));

  // Use asOfDate for timestamp if provided (PIT safety)
  const effectiveDate = asOfDate || new Date();

  return {
    score: Math.round(score * 10) / 10,
    macd,
    rsi: Math.round(rsi),
    ema20: Math.round(ema20 * 100) / 100,
    priceAboveEMA20,
    resistance: Math.round(resistance * 100) / 100,
    support: Math.round(support * 100) / 100,
    priceVsResistance: Math.round(priceVsResistance * 100) / 100,
    priceVsSupport: Math.round(priceVsSupport * 100) / 100,
    higherHighs,
    higherLows,
    trend,
    timestamp: effectiveDate.toISOString(),
  };
}

// ============================================
// MULTI-TIMEFRAME ALIGNMENT
// ============================================

/**
 * Determine alignment level based on daily and 4H scores
 */
function determineAlignment(dailyScore: number, hour4Score: number): TimeframeAlignment {
  // STRONG_BUY: Daily ≥7.5 AND 4H ≥6.0
  if (dailyScore >= 7.5 && hour4Score >= 6.0) {
    return 'STRONG_BUY';
  }

  // BUY: Daily ≥7.0 AND 4H ≥5.0
  if (dailyScore >= 7.0 && hour4Score >= 5.0) {
    return 'BUY';
  }

  // CONSIDER: Daily ≥6.0 AND 4H ≥4.0
  if (dailyScore >= 6.0 && hour4Score >= 4.0) {
    return 'CONSIDER';
  }

  // SKIP: Anything else
  return 'SKIP';
}

/**
 * Generate recommendation based on alignment
 */
function getAlignmentRecommendation(alignment: TimeframeAlignment, regime?: string): string {
  switch (alignment) {
    case 'STRONG_BUY':
      return 'Strong multi-timeframe alignment - high probability setup';
    case 'BUY':
      return 'Good alignment across timeframes - valid entry opportunity';
    case 'CONSIDER':
      if (regime === 'CHOPPY' || regime === 'CRASH') {
        return 'Weak alignment - wait for better confirmation in current regime';
      }
      return 'Moderate alignment - consider with tight risk management';
    case 'SKIP':
      return 'Timeframes not aligned - skip this trade';
  }
}

/**
 * Main function: Get multi-timeframe alignment analysis
 *
 * @param ticker - Stock ticker symbol
 * @param dailyScore - Score from daily timeframe analysis
 * @param dailyTrend - Trend direction from daily analysis
 * @param regime - Optional market regime
 * @param asOfDate - Optional date for PIT safety (backtesting)
 *                   When provided, all analysis uses only data available up to this date.
 */
export async function getMultiTimeframeAlignment(
  ticker: string,
  dailyScore: number,
  dailyTrend: string,
  regime?: string,
  asOfDate?: Date
): Promise<MultiTimeframeAnalysis> {
  // Include asOfDate in cache key for PIT-safe caching
  const dateKey = asOfDate ? asOfDate.toISOString().split('T')[0] : 'live';
  const key = cacheKey('mtf', 'alignment', `${ticker}_${dateKey}`);
  const effectiveDate = asOfDate || new Date();

  // Optimization: Only fetch 4H if daily score is promising
  if (dailyScore < 5.5) {
    return {
      daily: {
        score: dailyScore,
        trend: dailyTrend,
      },
      hour4: {
        score: 0,
        macd: {
          macdLine: 0,
          signalLine: 0,
          histogram: 0,
          status: 'NEGATIVE',
          crossover: 'NONE',
          histogramRising: false,
        },
        rsi: 50,
        ema20: 0,
        priceAboveEMA20: false,
        resistance: 0,
        support: 0,
        priceVsResistance: 0,
        priceVsSupport: 0,
        higherHighs: false,
        higherLows: false,
        trend: 'SIDEWAYS',
        timestamp: effectiveDate.toISOString(),
      },
      combined_score: dailyScore,
      alignment: 'SKIP',
      recommendation: 'Daily score too low - skipping 4H analysis',
      timestamp: effectiveDate.toISOString(),
    };
  }

  const { data: hour4 } = await getOrFetch(
    key,
    TTL.MARKET_DATA * 2, // 10 minutes cache for 4H analysis
    () => analyze4Hour(ticker, asOfDate)
  );

  // Calculate combined score (60% daily, 40% 4H)
  const combinedScore = (dailyScore * 0.6) + (hour4.score * 0.4);
  const alignment = determineAlignment(dailyScore, hour4.score);
  const recommendation = getAlignmentRecommendation(alignment, regime);

  return {
    daily: {
      score: dailyScore,
      trend: dailyTrend,
    },
    hour4,
    combined_score: Math.round(combinedScore * 10) / 10,
    alignment,
    recommendation,
    timestamp: effectiveDate.toISOString(),
  };
}

/**
 * Check if 4H confirms daily setup
 */
export function has4HConfirmation(mtf: MultiTimeframeAnalysis): boolean {
  return mtf.alignment === 'STRONG_BUY' || mtf.alignment === 'BUY';
}

/**
 * Export the analyze4Hour function for direct use
 */
export { analyze4Hour };







