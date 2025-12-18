/**
 * Multi-Timeframe Data Fetcher
 * Fetches 4-hour candle data from available sources
 *
 * Strategy:
 * 1. Try Yahoo Finance 1-hour data and aggregate to 4-hour
 * 2. Fallback to estimating from daily data
 *
 * PIT Safety: All functions now accept asOfDate parameter for backtesting.
 * When asOfDate is provided, data is filtered to only include candles up to that date.
 */

import YahooFinance from 'yahoo-finance2';
import { cacheKey, getOrFetch, TTL } from '../data-services/cache';
import { logApiCall } from '../data-services/logger';
import { OHLCVCandle, IntradayDataResponse } from './types';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

// Cache TTL for 4H data (4 hours)
const TTL_4H = 4 * 60 * 60 * 1000;

/**
 * Aggregate 1-hour candles into 4-hour candles
 * Groups every 4 consecutive 1H candles into one 4H candle
 */
function aggregate1HTo4H(candles1h: OHLCVCandle[]): OHLCVCandle[] {
  if (candles1h.length < 4) return [];

  const candles4h: OHLCVCandle[] = [];

  // Sort by timestamp (oldest first for aggregation)
  const sorted = [...candles1h].sort((a, b) => a.timestamp - b.timestamp);

  for (let i = 0; i < sorted.length - 3; i += 4) {
    const group = sorted.slice(i, i + 4);

    const candle4h: OHLCVCandle = {
      timestamp: group[0].timestamp,
      date: group[0].date,
      open: group[0].open,
      high: Math.max(...group.map(c => c.high)),
      low: Math.min(...group.map(c => c.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, c) => sum + c.volume, 0),
    };

    candles4h.push(candle4h);
  }

  // Return newest first
  return candles4h.reverse();
}

/**
 * Filter candles to only include those up to asOfDate (PIT safety)
 */
function filterCandlesByDate(candles: OHLCVCandle[], asOfDate: Date): OHLCVCandle[] {
  const cutoffTime = asOfDate.getTime();
  return candles.filter(c => c.timestamp <= cutoffTime);
}

/**
 * Fetch 1-hour data from Yahoo Finance and aggregate to 4-hour
 *
 * @param ticker - Stock ticker symbol
 * @param asOfDate - Optional date to filter data for PIT safety (backtesting)
 */
async function fetchYahoo1HData(ticker: string, asOfDate?: Date): Promise<IntradayDataResponse | null> {
  const startTime = Date.now();

  try {
    // Use asOfDate or current date for period2 (PIT safety)
    const effectiveDate = asOfDate || new Date();

    // Fetch last 10 days of 1-hour data (240 candles = 60 4H candles)
    const period1 = new Date(effectiveDate.getTime() - 10 * 24 * 60 * 60 * 1000);
    const period2 = effectiveDate;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const historical = await yahooFinance.chart(ticker, {
      period1,
      period2,
      interval: '1h',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

    if (!historical?.quotes?.length) {
      return null;
    }

    // Convert to our OHLCV format
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let candles1h: OHLCVCandle[] = historical.quotes
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((q: any) => q.close != null && q.open != null)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((q: any) => ({
        timestamp: new Date(q.date).getTime(),
        date: new Date(q.date).toISOString(),
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        volume: q.volume || 0,
      }));

    // PIT Safety: Filter candles to only include those up to asOfDate
    if (asOfDate) {
      candles1h = filterCandlesByDate(candles1h, asOfDate);
    }

    // Aggregate to 4-hour candles
    const candles4h = aggregate1HTo4H(candles1h);

    const latency = Date.now() - startTime;
    logApiCall({
      service: 'yahoo',
      operation: '1h_to_4h',
      ticker,
      latency_ms: latency,
      success: true,
    });

    return {
      candles: candles4h,
      ticker,
      interval: '4h',
      dataSource: 'yahoo_1h',
    };
  } catch (error) {
    const latency = Date.now() - startTime;
    logApiCall({
      service: 'yahoo',
      operation: '1h_to_4h',
      ticker,
      latency_ms: latency,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * Estimate 4-hour candles from daily data
 * This is a fallback when intraday data isn't available
 * Creates pseudo-4H candles by interpolating daily data
 *
 * @param ticker - Stock ticker symbol
 * @param asOfDate - Optional date to filter data for PIT safety (backtesting)
 */
async function estimateFrom4HDaily(ticker: string, asOfDate?: Date): Promise<IntradayDataResponse | null> {
  const startTime = Date.now();

  try {
    // Use asOfDate or current date for period2 (PIT safety)
    const effectiveDate = asOfDate || new Date();

    const period1 = new Date(effectiveDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    const period2 = effectiveDate;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const historical = await yahooFinance.chart(ticker, {
      period1,
      period2,
      interval: '1d',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

    if (!historical?.quotes?.length) {
      return null;
    }

    // Create pseudo 4H candles from daily data
    // We'll split each daily candle into 2 pseudo-4H candles
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let candles4h: OHLCVCandle[] = historical.quotes
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((q: any) => q.close != null && q.open != null)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .flatMap((q: any) => {
        const midPrice = (q.open + q.close) / 2;
        const midHigh = (q.open > q.close) ? q.high : (q.high + midPrice) / 2;
        const midLow = (q.open < q.close) ? q.low : (q.low + midPrice) / 2;
        const timestamp = new Date(q.date).getTime();

        return [
          // First "4H" candle (morning session)
          {
            timestamp: timestamp,
            date: new Date(timestamp).toISOString(),
            open: q.open,
            high: midHigh,
            low: midLow,
            close: midPrice,
            volume: Math.round((q.volume || 0) / 2),
          },
          // Second "4H" candle (afternoon session)
          {
            timestamp: timestamp + 4 * 60 * 60 * 1000,
            date: new Date(timestamp + 4 * 60 * 60 * 1000).toISOString(),
            open: midPrice,
            high: q.high,
            low: q.low,
            close: q.close,
            volume: Math.round((q.volume || 0) / 2),
          },
        ];
      });

    // PIT Safety: Filter candles to only include those up to asOfDate
    if (asOfDate) {
      candles4h = filterCandlesByDate(candles4h, asOfDate);
    }

    // Reverse to get newest first
    candles4h = candles4h.reverse();

    const latency = Date.now() - startTime;
    logApiCall({
      service: 'yahoo',
      operation: 'daily_to_4h_estimate',
      ticker,
      latency_ms: latency,
      success: true,
    });

    return {
      candles: candles4h.slice(0, 60), // Return last 60 4H candles
      ticker,
      interval: '4h',
      dataSource: 'estimated',
    };
  } catch (error) {
    const latency = Date.now() - startTime;
    logApiCall({
      service: 'yahoo',
      operation: 'daily_to_4h_estimate',
      ticker,
      latency_ms: latency,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * Main function: Get 4-hour candle data with caching
 * Tries multiple sources in order of preference
 *
 * @param ticker - Stock ticker symbol
 * @param asOfDate - Optional date to filter data for PIT safety (backtesting)
 *                   When provided, all data is filtered to only include candles up to this date.
 *                   This prevents look-ahead bias in historical backtests.
 */
export async function get4HourData(ticker: string, asOfDate?: Date): Promise<IntradayDataResponse> {
  // Include asOfDate in cache key for PIT-safe caching
  const dateKey = asOfDate ? asOfDate.toISOString().split('T')[0] : 'live';
  const key = cacheKey('mtf', '4h_data', `${ticker}_${dateKey}`);

  const { data } = await getOrFetch(
    key,
    TTL_4H,
    async () => {
      // Try Yahoo 1H data first (most accurate)
      const yahoo1h = await fetchYahoo1HData(ticker, asOfDate);
      if (yahoo1h && yahoo1h.candles.length >= 20) {
        return yahoo1h;
      }

      // Fallback to estimated from daily
      const estimated = await estimateFrom4HDaily(ticker, asOfDate);
      if (estimated && estimated.candles.length >= 20) {
        return estimated;
      }

      // Last resort: return empty fallback
      return {
        candles: [],
        ticker,
        interval: '4h',
        dataSource: 'fallback' as const,
      };
    }
  );

  return data;
}

/**
 * Check if 4H data is available and reliable
 */
export function is4HDataReliable(data: IntradayDataResponse): boolean {
  return (
    data.candles.length >= 20 &&
    (data.dataSource === 'yahoo_1h' || data.dataSource === 'estimated')
  );
}
