/**
 * Unified Price Data Provider
 * Abstracts data fetching behind a common interface
 * Supports FMP (primary) and Yahoo Finance (fallback)
 *
 * Set DATA_PROVIDER=fmp in .env.local to use FMP
 * Set DATA_PROVIDER=yahoo to force Yahoo Finance
 */

import {
  fetchHistoricalPrices,
  fetchQuote,
  isFmpHistoricalConfigured,
  HistoricalData,
  FmpQuote,
  getRateLimitUsage,
} from './fmp-historical';

import {
  getCachedPrices,
  cachePrices,
  getCacheStats,
  CacheStats,
} from './sqlite-cache';

// ============================================
// TYPES
// ============================================

export interface PriceQuote {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  volume: number;
  avgVolume: number;
  marketCap: number;
  pe: number;
  sector?: string;
}

export interface ChartData {
  dates: string[];
  prices: number[];
  opens: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
}

export type DataProvider = 'fmp' | 'yahoo' | 'auto';

// ============================================
// PROVIDER SELECTION
// ============================================

/**
 * Get the active data provider
 */
export function getActiveProvider(): DataProvider {
  const envProvider = process.env.DATA_PROVIDER?.toLowerCase();

  if (envProvider === 'fmp') return 'fmp';
  if (envProvider === 'yahoo') return 'yahoo';

  // Auto: prefer FMP if configured, otherwise Yahoo
  if (isFmpHistoricalConfigured()) {
    return 'fmp';
  }

  return 'yahoo';
}

/**
 * Check if FMP is the active provider
 */
export function isFmpActive(): boolean {
  return getActiveProvider() === 'fmp';
}

// ============================================
// FMP IMPLEMENTATIONS
// ============================================

async function fetchHistoricalFromFmp(
  ticker: string,
  fromDate: Date,
  toDate: Date
): Promise<ChartData> {
  const data = await fetchHistoricalPrices(ticker, fromDate, toDate);

  return {
    dates: data.dates,
    prices: data.prices,
    opens: data.opens,
    highs: data.highs,
    lows: data.lows,
    volumes: data.volumes,
  };
}

async function fetchQuoteFromFmp(ticker: string): Promise<PriceQuote | null> {
  const quote = await fetchQuote(ticker);

  if (!quote) return null;

  return {
    symbol: quote.symbol,
    price: quote.price,
    open: quote.open,
    high: quote.dayHigh,
    low: quote.dayLow,
    previousClose: quote.previousClose,
    volume: quote.volume,
    avgVolume: quote.avgVolume,
    marketCap: quote.marketCap,
    pe: quote.pe,
    sector: undefined, // FMP doesn't provide sector in quote endpoint
  };
}

// ============================================
// YAHOO FINANCE IMPLEMENTATIONS
// ============================================

// Dynamic import to avoid loading yahoo-finance2 if not needed
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let yahooFinance: any = null;

async function getYahooFinance() {
  if (!yahooFinance) {
    const YahooFinance = (await import('yahoo-finance2')).default;
    yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
  }
  return yahooFinance;
}

async function fetchHistoricalFromYahoo(
  ticker: string,
  fromDate: Date,
  toDate: Date
): Promise<ChartData> {
  const yf = await getYahooFinance();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const historical = await yf.chart(ticker, {
    period1: fromDate,
    period2: toDate,
    interval: '1d',
  }) as any;

  if (!historical || !historical.quotes || historical.quotes.length === 0) {
    return {
      dates: [],
      prices: [],
      opens: [],
      highs: [],
      lows: [],
      volumes: [],
    };
  }

  // Filter valid quotes and sort descending (newest first)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const validQuotes = historical.quotes.filter((q: any) => q.close != null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dates = validQuotes.map((q: any) => new Date(q.date).toISOString().split('T')[0]).reverse();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prices = validQuotes.map((q: any) => q.close as number).reverse();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opens = validQuotes.map((q: any) => q.open as number).reverse();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const highs = validQuotes.map((q: any) => q.high as number).reverse();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lows = validQuotes.map((q: any) => q.low as number).reverse();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const volumes = validQuotes.map((q: any) => q.volume as number).reverse();

  return { dates, prices, opens, highs, lows, volumes };
}

async function fetchQuoteFromYahoo(ticker: string): Promise<PriceQuote | null> {
  const yf = await getYahooFinance();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const quote = await yf.quote(ticker) as any;

  if (!quote || !quote.regularMarketPrice) return null;

  return {
    symbol: ticker,
    price: quote.regularMarketPrice,
    open: quote.regularMarketOpen || quote.regularMarketPrice,
    high: quote.regularMarketDayHigh || quote.regularMarketPrice,
    low: quote.regularMarketDayLow || quote.regularMarketPrice,
    previousClose: quote.regularMarketPreviousClose || quote.regularMarketPrice,
    volume: quote.regularMarketVolume || 0,
    avgVolume: quote.averageDailyVolume3Month || 0,
    marketCap: quote.marketCap || 0,
    pe: quote.trailingPE || 0,
    sector: quote.sector,
  };
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Fetch historical price data for a ticker
 * Automatically uses the configured provider (FMP or Yahoo)
 * Now with SQLite caching for faster subsequent requests
 */
export async function getHistoricalPrices(
  ticker: string,
  fromDate: Date,
  toDate: Date,
  forceProvider?: DataProvider,
  options?: { skipCache?: boolean; minCacheDays?: number }
): Promise<ChartData & { cached?: boolean }> {
  const provider = forceProvider || getActiveProvider();
  const fromDateStr = fromDate.toISOString().split('T')[0];
  const toDateStr = toDate.toISOString().split('T')[0];
  const minDays = options?.minCacheDays ?? 50;

  // Check SQLite cache first (unless explicitly skipped)
  if (!options?.skipCache) {
    try {
      const cached = getCachedPrices(ticker, fromDateStr, toDateStr);

      if (cached && cached.length >= minDays) {
        // Cache hit - return cached data
        return {
          dates: cached.map(c => c.date),
          prices: cached.map(c => c.close),
          opens: cached.map(c => c.open),
          highs: cached.map(c => c.high),
          lows: cached.map(c => c.low),
          volumes: cached.map(c => c.volume),
          cached: true,
        };
      }
    } catch (cacheError) {
      // Cache read failed, continue with API fetch
      console.warn(`[PriceProvider] Cache read failed for ${ticker}:`, cacheError);
    }
  }

  // Cache miss - fetch from API
  try {
    let data: ChartData;

    if (provider === 'fmp') {
      data = await fetchHistoricalFromFmp(ticker, fromDate, toDate);
    } else {
      data = await fetchHistoricalFromYahoo(ticker, fromDate, toDate);
    }

    // Cache the fetched data for future use
    if (data.dates.length > 0) {
      try {
        cachePrices(ticker, {
          dates: data.dates,
          opens: data.opens,
          highs: data.highs,
          lows: data.lows,
          closes: data.prices,
          volumes: data.volumes,
        }, provider);
      } catch (cacheError) {
        // Cache write failed, but we still have the data
        console.warn(`[PriceProvider] Cache write failed for ${ticker}:`, cacheError);
      }
    }

    return { ...data, cached: false };
  } catch (error) {
    // If FMP fails and we have fallback enabled, try Yahoo
    if (provider === 'fmp' && process.env.FALLBACK_TO_YAHOO !== 'false') {
      console.warn(`[PriceProvider] FMP failed for ${ticker}, falling back to Yahoo`);
      const data = await fetchHistoricalFromYahoo(ticker, fromDate, toDate);

      // Cache the fallback data too
      if (data.dates.length > 0) {
        try {
          cachePrices(ticker, {
            dates: data.dates,
            opens: data.opens,
            highs: data.highs,
            lows: data.lows,
            closes: data.prices,
            volumes: data.volumes,
          }, 'yahoo');
        } catch (cacheError) {
          console.warn(`[PriceProvider] Cache write failed for ${ticker}:`, cacheError);
        }
      }

      return { ...data, cached: false };
    }
    throw error;
  }
}

/**
 * Fetch current quote for a ticker
 */
export async function getQuote(
  ticker: string,
  forceProvider?: DataProvider
): Promise<PriceQuote | null> {
  const provider = forceProvider || getActiveProvider();

  try {
    if (provider === 'fmp') {
      return await fetchQuoteFromFmp(ticker);
    } else {
      return await fetchQuoteFromYahoo(ticker);
    }
  } catch (error) {
    // If FMP fails and we have fallback enabled, try Yahoo
    if (provider === 'fmp' && process.env.FALLBACK_TO_YAHOO !== 'false') {
      console.warn(`[PriceProvider] FMP quote failed for ${ticker}, falling back to Yahoo`);
      return await fetchQuoteFromYahoo(ticker);
    }
    throw error;
  }
}

/**
 * Get provider status information including cache stats
 */
export function getProviderStatus(): {
  activeProvider: DataProvider;
  fmpConfigured: boolean;
  fmpRateLimitUsage?: { current: number; max: number; percentUsed: number };
  cache?: CacheStats;
} {
  const activeProvider = getActiveProvider();
  const fmpConfigured = isFmpHistoricalConfigured();

  let cache: CacheStats | undefined;
  try {
    cache = getCacheStats();
  } catch {
    // Cache not available
  }

  return {
    activeProvider,
    fmpConfigured,
    fmpRateLimitUsage: fmpConfigured ? getRateLimitUsage() : undefined,
    cache,
  };
}

// Re-export types
export type { HistoricalData, FmpQuote };
export type { CacheStats };
