/**
 * Financial Modeling Prep (FMP) Historical Data Service
 * Provides historical price data with proper rate limiting
 * Rate limit: 300 calls per minute (5 calls/second)
 *
 * Updated 2026-01-07: Migrated from legacy v3 API to stable API
 * Legacy endpoints deprecated as of August 31, 2025
 */

import { cacheKey, getOrFetch, TTL } from './cache';

const FMP_BASE_URL = 'https://financialmodelingprep.com/stable';

// ============================================
// RATE LIMITER - 300 calls/minute
// ============================================

class RateLimiter {
  private callTimestamps: number[] = [];
  private readonly maxCalls: number;
  private readonly windowMs: number;

  constructor(maxCallsPerMinute: number = 300) {
    this.maxCalls = maxCallsPerMinute;
    this.windowMs = 60 * 1000; // 1 minute
  }

  async throttle(): Promise<void> {
    const now = Date.now();

    // Remove timestamps older than the window
    this.callTimestamps = this.callTimestamps.filter(
      ts => now - ts < this.windowMs
    );

    // If we've hit the limit, wait until the oldest call expires
    if (this.callTimestamps.length >= this.maxCalls) {
      const oldestCall = this.callTimestamps[0];
      const waitTime = this.windowMs - (now - oldestCall) + 100; // +100ms buffer

      if (waitTime > 0) {
        console.log(`[FMP Rate Limit] Waiting ${waitTime}ms (${this.callTimestamps.length}/${this.maxCalls} calls)...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      // Clean up again after waiting
      const newNow = Date.now();
      this.callTimestamps = this.callTimestamps.filter(
        ts => newNow - ts < this.windowMs
      );
    }

    // Record this call
    this.callTimestamps.push(Date.now());
  }

  getUsage(): { current: number; max: number; percentUsed: number } {
    const now = Date.now();
    this.callTimestamps = this.callTimestamps.filter(
      ts => now - ts < this.windowMs
    );
    return {
      current: this.callTimestamps.length,
      max: this.maxCalls,
      percentUsed: (this.callTimestamps.length / this.maxCalls) * 100,
    };
  }
}

// Global rate limiter instance
const rateLimiter = new RateLimiter(300);

// ============================================
// TYPES
// ============================================

export interface FmpHistoricalQuote {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjClose: number;
  volume: number;
  unadjustedVolume: number;
  change: number;
  changePercent: number;
  vwap: number;
  label: string;
  changeOverTime: number;
}

export interface FmpQuote {
  symbol: string;
  name: string;
  price: number;
  changesPercentage: number;
  change: number;
  dayLow: number;
  dayHigh: number;
  yearHigh: number;
  yearLow: number;
  marketCap: number;
  priceAvg50: number;
  priceAvg200: number;
  exchange: string;
  volume: number;
  avgVolume: number;
  open: number;
  previousClose: number;
  eps: number;
  pe: number;
  earningsAnnouncement: string;
  sharesOutstanding: number;
  timestamp: number;
}

export interface HistoricalData {
  dates: string[];
  prices: number[];
  opens: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
  // Raw quotes for additional analysis
  quotes: FmpHistoricalQuote[];
}

// ============================================
// API FUNCTIONS
// ============================================

/**
 * Get FMP API key from environment
 */
function getApiKey(): string {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    throw new Error('[FMP] API key not configured. Set FMP_API_KEY in .env.local');
  }
  return apiKey;
}

/**
 * Check if FMP historical data is configured
 */
export function isFmpHistoricalConfigured(): boolean {
  return !!process.env.FMP_API_KEY;
}

/**
 * Stable API EOD response type
 */
interface FmpStableEodData {
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
  changePercent: number;
  vwap: number;
}

/**
 * Fetch historical daily prices for a ticker
 * Returns data in reverse chronological order (newest first)
 * Uses stable API endpoint: /stable/historical-price-eod/full
 */
export async function fetchHistoricalPrices(
  ticker: string,
  fromDate?: Date,
  toDate?: Date
): Promise<HistoricalData> {
  const apiKey = getApiKey();

  // Apply rate limiting
  await rateLimiter.throttle();

  // Build URL with new stable API format
  let url = `${FMP_BASE_URL}/historical-price-eod/full?symbol=${ticker}&apikey=${apiKey}`;

  if (fromDate) {
    url += `&from=${fromDate.toISOString().split('T')[0]}`;
  }
  if (toDate) {
    url += `&to=${toDate.toISOString().split('T')[0]}`;
  }

  try {
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 429) {
        console.error('[FMP] Rate limit exceeded. Waiting and retrying...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        return fetchHistoricalPrices(ticker, fromDate, toDate);
      }
      throw new Error(`FMP historical error: ${response.status}`);
    }

    const data: FmpStableEodData[] = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      return {
        dates: [],
        prices: [],
        opens: [],
        highs: [],
        lows: [],
        volumes: [],
        quotes: [],
      };
    }

    // Stable API returns data in descending order (newest first) - already sorted
    // Convert to FmpHistoricalQuote format for backwards compatibility
    const quotes: FmpHistoricalQuote[] = data.map(d => ({
      date: d.date,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      adjClose: d.close, // Stable API doesn't separate adj close
      volume: d.volume,
      unadjustedVolume: d.volume,
      change: d.change,
      changePercent: d.changePercent,
      vwap: d.vwap,
      label: d.date,
      changeOverTime: 0,
    }));

    return {
      dates: quotes.map(q => q.date),
      prices: quotes.map(q => q.close),
      opens: quotes.map(q => q.open),
      highs: quotes.map(q => q.high),
      lows: quotes.map(q => q.low),
      volumes: quotes.map(q => q.volume),
      quotes,
    };
  } catch (error) {
    console.error(`[FMP] Error fetching historical prices for ${ticker}:`, error);
    throw error;
  }
}

/**
 * Fetch historical prices with caching
 */
export async function getHistoricalPrices(
  ticker: string,
  fromDate?: Date,
  toDate?: Date
): Promise<HistoricalData> {
  // Create a cache key including the date range
  const fromStr = fromDate ? fromDate.toISOString().split('T')[0] : 'start';
  const toStr = toDate ? toDate.toISOString().split('T')[0] : 'now';
  const key = cacheKey('fmp', 'historical', `${ticker}_${fromStr}_${toStr}`);

  const { data } = await getOrFetch(
    key,
    TTL.MARKET_DATA, // Cache for 5 minutes
    () => fetchHistoricalPrices(ticker, fromDate, toDate)
  );

  return data;
}

/**
 * Stable API quote response type
 */
interface FmpStableQuote {
  symbol: string;
  name: string;
  price: number;
  changePercentage: number;
  change: number;
  volume: number;
  dayLow: number;
  dayHigh: number;
  yearHigh: number;
  yearLow: number;
  marketCap: number;
  priceAvg50: number;
  priceAvg200: number;
  exchange: string;
  open: number;
  previousClose: number;
  timestamp: number;
}

/**
 * Fetch current quote for a ticker
 * Uses stable API endpoint: /stable/quote?symbol=
 */
export async function fetchQuote(ticker: string): Promise<FmpQuote | null> {
  const apiKey = getApiKey();

  // Apply rate limiting
  await rateLimiter.throttle();

  const url = `${FMP_BASE_URL}/quote?symbol=${ticker}&apikey=${apiKey}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 429) {
        console.error('[FMP] Rate limit exceeded. Waiting and retrying...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        return fetchQuote(ticker);
      }
      throw new Error(`FMP quote error: ${response.status}`);
    }

    const data: FmpStableQuote[] = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }

    // Convert stable API response to FmpQuote format for backwards compatibility
    const q = data[0];
    return {
      symbol: q.symbol,
      name: q.name,
      price: q.price,
      changesPercentage: q.changePercentage,
      change: q.change,
      dayLow: q.dayLow,
      dayHigh: q.dayHigh,
      yearHigh: q.yearHigh,
      yearLow: q.yearLow,
      marketCap: q.marketCap,
      priceAvg50: q.priceAvg50,
      priceAvg200: q.priceAvg200,
      exchange: q.exchange,
      volume: q.volume,
      avgVolume: q.volume, // Stable API doesn't have avgVolume, use volume as fallback
      open: q.open,
      previousClose: q.previousClose,
      eps: 0, // Not in stable quote response
      pe: 0, // Not in stable quote response
      earningsAnnouncement: '',
      sharesOutstanding: 0,
      timestamp: q.timestamp,
    };
  } catch (error) {
    console.error(`[FMP] Error fetching quote for ${ticker}:`, error);
    throw error;
  }
}

/**
 * Fetch quotes for multiple tickers (more efficient)
 * Uses stable API endpoint: /stable/quote?symbol=AAPL,MSFT,...
 */
export async function fetchBatchQuotes(tickers: string[]): Promise<Map<string, FmpQuote>> {
  const apiKey = getApiKey();

  // Apply rate limiting
  await rateLimiter.throttle();

  const tickerList = tickers.join(',');
  const url = `${FMP_BASE_URL}/quote?symbol=${tickerList}&apikey=${apiKey}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 429) {
        console.error('[FMP] Rate limit exceeded. Waiting and retrying...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        return fetchBatchQuotes(tickers);
      }
      throw new Error(`FMP batch quote error: ${response.status}`);
    }

    const data: FmpStableQuote[] = await response.json();
    const result = new Map<string, FmpQuote>();

    if (Array.isArray(data)) {
      for (const q of data) {
        // Convert stable API response to FmpQuote format
        result.set(q.symbol, {
          symbol: q.symbol,
          name: q.name,
          price: q.price,
          changesPercentage: q.changePercentage,
          change: q.change,
          dayLow: q.dayLow,
          dayHigh: q.dayHigh,
          yearHigh: q.yearHigh,
          yearLow: q.yearLow,
          marketCap: q.marketCap,
          priceAvg50: q.priceAvg50,
          priceAvg200: q.priceAvg200,
          exchange: q.exchange,
          volume: q.volume,
          avgVolume: q.volume,
          open: q.open,
          previousClose: q.previousClose,
          eps: 0,
          pe: 0,
          earningsAnnouncement: '',
          sharesOutstanding: 0,
          timestamp: q.timestamp,
        });
      }
    }

    return result;
  } catch (error) {
    console.error(`[FMP] Error fetching batch quotes:`, error);
    throw error;
  }
}

/**
 * Prefetch historical data for multiple tickers efficiently
 * Uses batch processing to stay within rate limits
 */
export async function prefetchHistoricalData(
  tickers: string[],
  fromDate: Date,
  toDate: Date
): Promise<Map<string, HistoricalData>> {
  const results = new Map<string, HistoricalData>();
  const batchSize = 5; // Process 5 at a time to maximize throughput while respecting limits

  console.log(`[FMP] Prefetching historical data for ${tickers.length} tickers...`);
  const startTime = Date.now();

  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);

    // Fetch batch concurrently
    const promises = batch.map(async ticker => {
      try {
        const data = await getHistoricalPrices(ticker, fromDate, toDate);
        return { ticker, data };
      } catch (error) {
        console.warn(`[FMP] Failed to fetch ${ticker}:`, error);
        return { ticker, data: null };
      }
    });

    const batchResults = await Promise.all(promises);

    for (const { ticker, data } of batchResults) {
      if (data) {
        results.set(ticker, data);
      }
    }

    // Progress update
    const progress = Math.min(100, Math.round(((i + batchSize) / tickers.length) * 100));
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const usage = rateLimiter.getUsage();
    console.log(`[FMP] Progress: ${progress}% (${results.size}/${tickers.length}) | ${elapsed}s | API: ${usage.current}/${usage.max} calls/min`);
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[FMP] Prefetch complete: ${results.size} tickers in ${totalTime}s`);

  return results;
}

/**
 * Get the rate limiter usage stats
 */
export function getRateLimitUsage(): { current: number; max: number; percentUsed: number } {
  return rateLimiter.getUsage();
}
