/**
 * Financial Modeling Prep (FMP) Historical Data Service
 * Provides historical price data with proper rate limiting
 * Rate limit: 300 calls per minute (5 calls/second)
 */

import { cacheKey, getOrFetch, TTL } from './cache';

const FMP_BASE_URL = 'https://financialmodelingprep.com/api/v3';

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
 * Fetch historical daily prices for a ticker
 * Returns data in reverse chronological order (newest first)
 */
export async function fetchHistoricalPrices(
  ticker: string,
  fromDate?: Date,
  toDate?: Date
): Promise<HistoricalData> {
  const apiKey = getApiKey();

  // Apply rate limiting
  await rateLimiter.throttle();

  // Build URL with optional date range
  let url = `${FMP_BASE_URL}/historical-price-full/${ticker}?apikey=${apiKey}`;

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

    const data = await response.json();

    if (!data || !data.historical || data.historical.length === 0) {
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

    const quotes: FmpHistoricalQuote[] = data.historical;

    // Sort by date descending (newest first) for consistency with Yahoo Finance
    quotes.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

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
 * Fetch current quote for a ticker
 */
export async function fetchQuote(ticker: string): Promise<FmpQuote | null> {
  const apiKey = getApiKey();

  // Apply rate limiting
  await rateLimiter.throttle();

  const url = `${FMP_BASE_URL}/quote/${ticker}?apikey=${apiKey}`;

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

    const data: FmpQuote[] = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }

    return data[0];
  } catch (error) {
    console.error(`[FMP] Error fetching quote for ${ticker}:`, error);
    throw error;
  }
}

/**
 * Fetch quotes for multiple tickers (more efficient)
 */
export async function fetchBatchQuotes(tickers: string[]): Promise<Map<string, FmpQuote>> {
  const apiKey = getApiKey();

  // Apply rate limiting
  await rateLimiter.throttle();

  const tickerList = tickers.join(',');
  const url = `${FMP_BASE_URL}/quote/${tickerList}?apikey=${apiKey}`;

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

    const data: FmpQuote[] = await response.json();
    const result = new Map<string, FmpQuote>();

    if (Array.isArray(data)) {
      for (const quote of data) {
        result.set(quote.symbol, quote);
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
