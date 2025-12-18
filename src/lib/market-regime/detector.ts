/**
 * Market Regime Detector
 * Detects current market conditions (BULL/CHOPPY/CRASH) and provides
 * dynamic entry thresholds for swing trading.
 * 
 * @module market-regime/detector
 */

import YahooFinance from 'yahoo-finance2';
import { cacheKey, getOrFetch, TTL } from '../data-services/cache';
import { logApiCall } from '../data-services/logger';
import {
  getCachedPrices,
  cachePrices,
} from '../data-services/sqlite-cache';
import {
  MarketRegime,
  RegimeAnalysis,
  RegimeThresholds,
  SPYData,
  VIXData,
  VolatilityEnvironment,
  MarketContext,
} from './types';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

// ============================================
// HELPER FUNCTIONS
// ============================================

function calculateSMA(data: number[], period: number): number {
  if (data.length < period) return 0;
  const slice = data.slice(0, period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

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

function calculateATR(highs: number[], lows: number[], closes: number[], period: number = 14): number {
  if (highs.length < period + 1) return 0;
  
  let atrSum = 0;
  for (let i = 0; i < period; i++) {
    const high = highs[i];
    const low = lows[i];
    const prevClose = closes[i + 1];
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    atrSum += tr;
  }
  return atrSum / period;
}

/**
 * Classify volatility environment based on VIX level
 */
function classifyVolatility(vixLevel: number): VolatilityEnvironment {
  if (vixLevel < 15) return 'LOW';
  if (vixLevel < 20) return 'NORMAL';
  if (vixLevel < 30) return 'HIGH';
  return 'EXTREME';
}

/**
 * Calculate trend strength (0-10) based on price position relative to MAs
 */
function calculateTrendStrength(
  price: number,
  sma50: number,
  sma200: number,
  rsi: number
): number {
  let strength = 5; // Start neutral

  // Price above 50 SMA
  if (price > sma50) {
    const pctAbove = ((price - sma50) / sma50) * 100;
    strength += Math.min(2, pctAbove / 2); // +2 max for being well above
  } else {
    const pctBelow = ((sma50 - price) / sma50) * 100;
    strength -= Math.min(2, pctBelow / 2); // -2 max for being well below
  }

  // Price above 200 SMA (more important)
  if (price > sma200) {
    strength += 1.5;
  } else {
    strength -= 2; // Being below 200 SMA is very bearish
  }

  // Golden cross bonus
  if (sma50 > sma200) {
    strength += 1;
  } else {
    strength -= 1;
  }

  // RSI momentum
  if (rsi > 50 && rsi < 70) {
    strength += 0.5; // Healthy uptrend
  } else if (rsi > 70) {
    strength -= 0.5; // Overextended
  } else if (rsi < 40) {
    strength -= 1; // Weak momentum
  }

  return Math.max(0, Math.min(10, strength));
}

// ============================================
// DATA FETCHING
// ============================================

/**
 * Fetch SPY market data with SQLite caching
 * @param asOfDate - Optional: For backtesting, use data up to this date
 */
async function fetchSPYData(asOfDate?: Date): Promise<SPYData> {
  const startTime = Date.now();
  const endDate = asOfDate || new Date();
  // 365 calendar days = ~250 trading days (needed for SMA200)
  const startDate = new Date(endDate.getTime() - 365 * 24 * 60 * 60 * 1000);

  const fromDateStr = startDate.toISOString().split('T')[0];
  const toDateStr = endDate.toISOString().split('T')[0];

  try {
    // Check SQLite cache first
    const cached = getCachedPrices('SPY', fromDateStr, toDateStr);

    if (cached && cached.length >= 50) {
      // Cache hit - use cached data
      // Data is returned in DESC order (newest first)
      const asOfTime = asOfDate ? asOfDate.getTime() : Date.now();
      const filteredCache = cached.filter(c => new Date(c.date).getTime() <= asOfTime);

      if (filteredCache.length >= 50) {
        const prices = filteredCache.map(c => c.close);
        const highs = filteredCache.map(c => c.high);
        const lows = filteredCache.map(c => c.low);

        const price = prices[0];
        const sma50 = calculateSMA(prices, 50);
        const sma200 = calculateSMA(prices, 200);
        const rsi = calculateRSI(prices, 14);
        const atr = calculateATR(highs, lows, prices, 14);
        const atrPercent = (atr / price) * 100;

        const latency = Date.now() - startTime;
        logApiCall({
          service: 'cache',
          operation: 'spy_data',
          ticker: 'SPY',
          latency_ms: latency,
          success: true,
        });

        return {
          price,
          sma50,
          sma200,
          goldenCross: sma50 > sma200,
          rsi,
          atr,
          atrPercent,
          recentHighs: highs.slice(0, 20),
          recentLows: lows.slice(0, 20),
          recentCloses: prices.slice(0, 20),
          timestamp: (asOfDate || new Date()).toISOString(),
        };
      }
    }

    // Cache miss - fetch from Yahoo Finance
    const historical = await yahooFinance.chart('SPY', {
      period1: startDate,
      period2: endDate,
      interval: '1d'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

    // Filter to only include data up to asOfDate
    const asOfTime = asOfDate ? asOfDate.getTime() : Date.now();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quotes = historical.quotes.filter((q: any) =>
      q.close != null && new Date(q.date).getTime() <= asOfTime
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prices = quotes.map((q: any) => q.close as number).reverse();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const highs = quotes.map((q: any) => q.high as number).reverse();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lows = quotes.map((q: any) => q.low as number).reverse();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opens = quotes.map((q: any) => q.open as number).reverse();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const volumes = quotes.map((q: any) => q.volume as number).reverse();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dates = quotes.map((q: any) => new Date(q.date).toISOString().split('T')[0]).reverse();

    // Cache the data for future use
    if (dates.length > 0) {
      try {
        cachePrices('SPY', {
          dates,
          opens,
          highs,
          lows,
          closes: prices,
          volumes,
        }, 'yahoo');
      } catch (cacheErr) {
        // Ignore cache write errors
      }
    }

    const price = prices[0];
    const sma50 = calculateSMA(prices, 50);
    const sma200 = calculateSMA(prices, 200);
    const rsi = calculateRSI(prices, 14);
    const atr = calculateATR(highs, lows, prices, 14);
    const atrPercent = (atr / price) * 100;

    const latency = Date.now() - startTime;
    logApiCall({
      service: 'yahoo',
      operation: 'spy_data',
      ticker: 'SPY',
      latency_ms: latency,
      success: true,
    });

    return {
      price,
      sma50,
      sma200,
      goldenCross: sma50 > sma200,
      rsi,
      atr,
      atrPercent,
      recentHighs: highs.slice(0, 20),
      recentLows: lows.slice(0, 20),
      recentCloses: prices.slice(0, 20),
      timestamp: (asOfDate || new Date()).toISOString(),
    };
  } catch (error) {
    const latency = Date.now() - startTime;
    logApiCall({
      service: 'yahoo',
      operation: 'spy_data',
      ticker: 'SPY',
      latency_ms: latency,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    // Return safe defaults on error
    return {
      price: 0,
      sma50: 0,
      sma200: 0,
      goldenCross: false,
      rsi: 50,
      atr: 0,
      atrPercent: 0,
      recentHighs: [],
      recentLows: [],
      recentCloses: [],
      timestamp: (asOfDate || new Date()).toISOString(),
    };
  }
}

/**
 * Fetch VIX data with SQLite caching
 * @param asOfDate - Optional: For backtesting, use data up to this date
 */
async function fetchVIXData(asOfDate?: Date): Promise<VIXData> {
  const startTime = Date.now();
  const endDate = asOfDate || new Date();
  // Get 30 days of VIX data for percentile calculation
  const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

  const fromDateStr = startDate.toISOString().split('T')[0];
  const toDateStr = endDate.toISOString().split('T')[0];

  try {
    // Check SQLite cache first
    const cached = getCachedPrices('VIX', fromDateStr, toDateStr);

    if (cached && cached.length >= 5) {
      // Cache hit - use cached data (returned in DESC order)
      const asOfTime = asOfDate ? asOfDate.getTime() : Date.now();
      const filteredCache = cached.filter(c => new Date(c.date).getTime() <= asOfTime);

      if (filteredCache.length > 0) {
        const level = filteredCache[0].close; // Most recent

        const latency = Date.now() - startTime;
        logApiCall({
          service: 'cache',
          operation: 'vix_quote',
          ticker: 'VIX',
          latency_ms: latency,
          success: true,
        });

        const environment = classifyVolatility(level);

        return {
          level,
          percentile20d: 50, // Simplified
          environment,
          isSafe: level < 20,
          isElevated: level >= 20 && level < 25,
          isExtreme: level >= 25,
          timestamp: (asOfDate || new Date()).toISOString(),
        };
      }
    }

    // Cache miss - fetch from Yahoo Finance
    let level: number;

    if (asOfDate) {
      // For backtesting, get historical VIX data
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const historical = await yahooFinance.chart('^VIX', {
        period1: startDate,
        period2: asOfDate,
        interval: '1d'
      }) as any;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const quotes = historical.quotes.filter((q: any) =>
        q.close != null && new Date(q.date).getTime() <= asOfDate.getTime()
      );

      if (quotes.length > 0) {
        level = quotes[quotes.length - 1].close;

        // Cache all VIX data we fetched
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dates = quotes.map((q: any) => new Date(q.date).toISOString().split('T')[0]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const closes = quotes.map((q: any) => q.close as number);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const opens = quotes.map((q: any) => q.open as number || q.close);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const highs = quotes.map((q: any) => q.high as number || q.close);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lows = quotes.map((q: any) => q.low as number || q.close);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const volumes = quotes.map((q: any) => q.volume as number || 0);

        try {
          cachePrices('VIX', {
            dates,
            opens,
            highs,
            lows,
            closes,
            volumes,
          }, 'yahoo');
        } catch (cacheErr) {
          // Ignore cache write errors
        }
      } else {
        level = 20;
      }
    } else {
      // For live analysis, use current quote
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const quote = await yahooFinance.quote('^VIX') as any;
      level = quote?.regularMarketPrice || 20;
    }

    const latency = Date.now() - startTime;
    logApiCall({
      service: 'yahoo',
      operation: 'vix_quote',
      ticker: 'VIX',
      latency_ms: latency,
      success: true,
    });

    const environment = classifyVolatility(level);

    return {
      level,
      percentile20d: 50, // Simplified - would need historical VIX for accurate percentile
      environment,
      isSafe: level < 20,
      isElevated: level >= 20 && level < 25,
      isExtreme: level >= 25,
      timestamp: (asOfDate || new Date()).toISOString(),
    };
  } catch (error) {
    const latency = Date.now() - startTime;
    logApiCall({
      service: 'yahoo',
      operation: 'vix_quote',
      ticker: 'VIX',
      latency_ms: latency,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    // Return moderate defaults on error
    return {
      level: 20,
      percentile20d: 50,
      environment: 'NORMAL',
      isSafe: false,
      isElevated: true,
      isExtreme: false,
      timestamp: (asOfDate || new Date()).toISOString(),
    };
  }
}

// ============================================
// REGIME DETECTION
// ============================================

/**
 * Determine market regime based on SPY and VIX data
 * 
 * BULL: SPY > 50 SMA AND VIX < 20 (strong uptrend, low fear)
 * CHOPPY: VIX 20-25 OR SPY between 50/200 SMA (uncertain conditions)
 * CRASH: VIX > 25 OR SPY < 200 SMA (high fear, breakdown)
 */
function determineRegime(spy: SPYData, vix: VIXData): MarketRegime {
  const { price, sma50, sma200, goldenCross } = spy;
  const { level: vixLevel, isExtreme } = vix;

  // CRASH conditions (highest priority - protect capital)
  if (isExtreme || vixLevel >= 30) {
    return 'CRASH';
  }
  
  if (price < sma200 && sma200 > 0) {
    return 'CRASH'; // Below long-term trend
  }

  // BULL conditions (ideal trading environment)
  if (
    price > sma50 &&
    price > sma200 &&
    goldenCross &&
    vixLevel < 20
  ) {
    return 'BULL';
  }

  // Everything else is CHOPPY
  return 'CHOPPY';
}

/**
 * Calculate confidence in regime classification (0-100%)
 */
function calculateConfidence(spy: SPYData, vix: VIXData, regime: MarketRegime): number {
  let confidence = 50; // Start at 50%

  const { price, sma50, sma200, goldenCross, rsi } = spy;
  const { level: vixLevel } = vix;

  switch (regime) {
    case 'BULL':
      // Strong alignment increases confidence
      if (price > sma50 * 1.02) confidence += 10; // 2%+ above 50 SMA
      if (price > sma200 * 1.05) confidence += 10; // 5%+ above 200 SMA
      if (goldenCross) confidence += 10;
      if (vixLevel < 15) confidence += 10; // Very low VIX
      if (rsi > 50 && rsi < 70) confidence += 10; // Healthy momentum
      break;

    case 'CRASH':
      if (vixLevel > 30) confidence += 15; // Very high VIX
      if (price < sma200 * 0.95) confidence += 15; // 5%+ below 200 SMA
      if (!goldenCross) confidence += 10; // Death cross
      if (rsi < 30) confidence += 10; // Oversold/panic
      break;

    case 'CHOPPY':
      // Choppy is the "uncertain" state, so confidence reflects how unclear things are
      const spyVsMA = Math.abs((price - sma50) / sma50);
      if (spyVsMA < 0.02) confidence += 15; // Very close to 50 SMA
      if (vixLevel >= 18 && vixLevel <= 22) confidence += 15; // VIX in neutral zone
      if (rsi >= 45 && rsi <= 55) confidence += 10; // RSI neutral
      break;
  }

  return Math.min(100, Math.max(0, confidence));
}

/**
 * Main function: Detect current market regime
 * @param asOfDate - Optional: For backtesting, analyze as of this date
 */
export async function detectMarketRegime(asOfDate?: Date): Promise<RegimeAnalysis> {
  let spy: SPYData;
  let vix: VIXData;
  
  if (asOfDate) {
    // For backtesting, fetch data directly without caching
    [spy, vix] = await Promise.all([
      fetchSPYData(asOfDate),
      fetchVIXData(asOfDate),
    ]);
  } else {
    // For live analysis, use caching
    const spyKey = cacheKey('regime', 'spy_data', 'SPY');
    const vixKey = cacheKey('regime', 'vix_data', 'VIX');

    const [spyResult, vixResult] = await Promise.all([
      getOrFetch(spyKey, TTL.MARKET_DATA, () => fetchSPYData()),
      getOrFetch(vixKey, TTL.MARKET_DATA, () => fetchVIXData()),
    ]);

    spy = spyResult.data;
    vix = vixResult.data;
  }

  // Determine regime
  const regime = determineRegime(spy, vix);
  const confidence = calculateConfidence(spy, vix, regime);
  const trendStrength = calculateTrendStrength(spy.price, spy.sma50, spy.sma200, spy.rsi);

  return {
    regime,
    confidence,
    details: {
      spyAbove50SMA: spy.price > spy.sma50,
      spyAbove200SMA: spy.price > spy.sma200,
      vixLevel: vix.level,
      trendStrength,
      volatilityEnvironment: vix.environment,
      spyPrice: spy.price,
      spy50SMA: spy.sma50,
      spy200SMA: spy.sma200,
      goldenCross: spy.goldenCross,
      spyRSI: spy.rsi,
      spyATRPercent: spy.atrPercent,
    },
    timestamp: new Date().toISOString(),
  };
}

// ============================================
// REGIME THRESHOLDS
// ============================================

/**
 * Get trading thresholds based on market regime
 * These dynamically adjust entry criteria to match market conditions
 */
export function getRegimeThresholds(regime: MarketRegime): RegimeThresholds {
  switch (regime) {
    case 'BULL':
      return {
        minEntryScore: 6.0,
        minRRRatio: 2.0,
        requireVolumeConfirm: false,
        requireMultiTimeframe: false,
        allowShorts: false,
        maxPositionSize: 0.10, // 10% of portfolio
        description: 'Normal entry criteria - favorable market conditions',
      };

    case 'CHOPPY':
      return {
        minEntryScore: 7.5,
        minRRRatio: 3.0,
        requireVolumeConfirm: true,
        requireMultiTimeframe: true,
        allowShorts: false,
        maxPositionSize: 0.05, // 5% of portfolio (smaller positions)
        description: 'Stricter criteria - require confirmation signals',
      };

    case 'CRASH':
      return {
        minEntryScore: 9.0,
        minRRRatio: 4.0,
        requireVolumeConfirm: true,
        requireMultiTimeframe: true,
        allowShorts: true,
        maxPositionSize: 0.03, // 3% of portfolio (very small)
        description: 'Elite setups only - capital preservation mode',
      };
  }
}

/**
 * Get full market context (regime + thresholds + data)
 */
export async function getMarketContext(): Promise<MarketContext> {
  const spyKey = cacheKey('regime', 'spy_data', 'SPY');
  const vixKey = cacheKey('regime', 'vix_data', 'VIX');

  const [spyResult, vixResult] = await Promise.all([
    getOrFetch(spyKey, TTL.MARKET_DATA, fetchSPYData),
    getOrFetch(vixKey, TTL.MARKET_DATA, fetchVIXData),
  ]);

  const spy = spyResult.data;
  const vix = vixResult.data;
  const regime = await detectMarketRegime();
  const thresholds = getRegimeThresholds(regime.regime);

  return {
    regime,
    thresholds,
    spy,
    vix,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Check if a given score passes the regime threshold
 */
export function passesRegimeThreshold(
  score: number,
  regime: MarketRegime,
  hasVolumeConfirm: boolean = true,
  hasMTFConfirm: boolean = true
): { passes: boolean; reason: string } {
  const thresholds = getRegimeThresholds(regime);

  // Check minimum score
  if (score < thresholds.minEntryScore) {
    return {
      passes: false,
      reason: `Score ${score.toFixed(1)} below ${regime} regime minimum of ${thresholds.minEntryScore}`,
    };
  }

  // Check volume confirmation in CHOPPY/CRASH
  if (thresholds.requireVolumeConfirm && !hasVolumeConfirm) {
    return {
      passes: false,
      reason: `${regime} regime requires volume confirmation`,
    };
  }

  // Check multi-timeframe confirmation in CHOPPY/CRASH
  if (thresholds.requireMultiTimeframe && !hasMTFConfirm) {
    return {
      passes: false,
      reason: `${regime} regime requires 4H timeframe confirmation`,
    };
  }

  return {
    passes: true,
    reason: `Passes ${regime} regime criteria`,
  };
}

