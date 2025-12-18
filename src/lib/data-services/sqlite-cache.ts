/**
 * SQLite Price Cache
 * Persistent local cache for historical price data to speed up backtests
 *
 * Features:
 * - Stores OHLCV data by ticker and date
 * - Automatic schema creation
 * - Cache-before-fetch pattern
 * - Statistics and cleanup utilities
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

// ============================================
// TYPES
// ============================================

export interface CachedOHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CacheStats {
  totalRecords: number;
  uniqueTickers: number;
  oldestDate: string | null;
  newestDate: string | null;
  dbSizeBytes: number;
  dbSizeMB: string;
}

// ============================================
// DATABASE INITIALIZATION
// ============================================

const DB_PATH = path.join(process.cwd(), 'data', 'price-cache.sqlite');

let db: Database.Database | null = null;

/**
 * Get or create the database connection
 */
function getDb(): Database.Database {
  if (!db) {
    // Ensure data directory exists
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Create database connection
    db = new Database(DB_PATH);

    // Enable WAL mode for better concurrent performance
    db.pragma('journal_mode = WAL');

    // Create tables if they don't exist
    initializeSchema(db);
  }
  return db;
}

/**
 * Initialize database schema
 */
function initializeSchema(database: Database.Database): void {
  // Daily OHLCV data
  database.exec(`
    CREATE TABLE IF NOT EXISTS price_data (
      ticker TEXT NOT NULL,
      date TEXT NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume INTEGER NOT NULL,
      source TEXT DEFAULT 'yahoo',
      fetched_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (ticker, date)
    );

    CREATE INDEX IF NOT EXISTS idx_price_ticker ON price_data(ticker);
    CREATE INDEX IF NOT EXISTS idx_price_date ON price_data(date);
    CREATE INDEX IF NOT EXISTS idx_price_ticker_date ON price_data(ticker, date);
  `);

  // 4-hour candle data
  database.exec(`
    CREATE TABLE IF NOT EXISTS intraday_4h (
      ticker TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume INTEGER NOT NULL,
      source TEXT DEFAULT 'yahoo',
      fetched_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (ticker, timestamp)
    );

    CREATE INDEX IF NOT EXISTS idx_4h_ticker ON intraday_4h(ticker);
  `);

  // Market data (SPY, VIX)
  database.exec(`
    CREATE TABLE IF NOT EXISTS market_data (
      ticker TEXT NOT NULL,
      date TEXT NOT NULL,
      close REAL NOT NULL,
      sma50 REAL,
      sma200 REAL,
      rsi REAL,
      atr REAL,
      fetched_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (ticker, date)
    );

    CREATE INDEX IF NOT EXISTS idx_market_ticker ON market_data(ticker);
  `);
}

// ============================================
// DAILY PRICE CACHE
// ============================================

/**
 * Get cached daily prices for a ticker within a date range
 * Returns null if any dates are missing in the range
 */
export function getCachedPrices(
  ticker: string,
  fromDate: string,
  toDate: string
): CachedOHLCV[] | null {
  const database = getDb();

  const stmt = database.prepare(`
    SELECT date, open, high, low, close, volume
    FROM price_data
    WHERE ticker = ? AND date >= ? AND date <= ?
    ORDER BY date DESC
  `);

  const rows = stmt.all(ticker, fromDate, toDate) as CachedOHLCV[];

  // Return null if no data found
  if (rows.length === 0) {
    return null;
  }

  return rows;
}

/**
 * Check if we have complete cached data for a ticker in a date range
 */
export function hasCachedData(
  ticker: string,
  fromDate: string,
  toDate: string,
  minDays: number = 100
): boolean {
  const database = getDb();

  const stmt = database.prepare(`
    SELECT COUNT(*) as count
    FROM price_data
    WHERE ticker = ? AND date >= ? AND date <= ?
  `);

  const result = stmt.get(ticker, fromDate, toDate) as { count: number };

  // Require at least minDays of data to consider it "complete"
  return result.count >= minDays;
}

/**
 * Price data input type for caching
 */
interface PriceDataInput {
  dates: string[];
  opens: number[];
  highs: number[];
  lows: number[];
  closes: number[];
  volumes: number[];
}

/**
 * Cache daily price data for a ticker
 */
export function cachePrices(
  ticker: string,
  data: PriceDataInput,
  source: string = 'yahoo'
): number {
  const database = getDb();

  const stmt = database.prepare(`
    INSERT OR REPLACE INTO price_data (ticker, date, open, high, low, close, volume, source, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const insertMany = database.transaction((priceData: PriceDataInput) => {
    let count = 0;
    for (let i = 0; i < priceData.dates.length; i++) {
      stmt.run(
        ticker,
        priceData.dates[i],
        priceData.opens[i],
        priceData.highs[i],
        priceData.lows[i],
        priceData.closes[i],
        priceData.volumes[i],
        source
      );
      count++;
    }
    return count;
  });

  return insertMany(data);
}

// ============================================
// 4-HOUR CANDLE CACHE
// ============================================

/**
 * Get cached 4-hour candles for a ticker
 */
export function getCached4HCandles(
  ticker: string,
  fromTimestamp: string,
  toTimestamp: string
): CachedOHLCV[] | null {
  const database = getDb();

  const stmt = database.prepare(`
    SELECT timestamp as date, open, high, low, close, volume
    FROM intraday_4h
    WHERE ticker = ? AND timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp DESC
  `);

  const rows = stmt.all(ticker, fromTimestamp, toTimestamp) as CachedOHLCV[];

  if (rows.length === 0) {
    return null;
  }

  return rows;
}

/**
 * 4-hour candle data input type
 */
interface CandleDataInput {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Cache 4-hour candle data
 */
export function cache4HCandles(
  ticker: string,
  candles: CandleDataInput[],
  source: string = 'yahoo'
): number {
  const database = getDb();

  const stmt = database.prepare(`
    INSERT OR REPLACE INTO intraday_4h (ticker, timestamp, open, high, low, close, volume, source, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const insertMany = database.transaction((candleData: CandleDataInput[]) => {
    let count = 0;
    for (const c of candleData) {
      stmt.run(ticker, c.timestamp, c.open, c.high, c.low, c.close, c.volume, source);
      count++;
    }
    return count;
  });

  return insertMany(candles);
}

// ============================================
// MARKET DATA CACHE (SPY, VIX)
// ============================================

export interface CachedMarketData {
  date: string;
  close: number;
  sma50: number | null;
  sma200: number | null;
  rsi: number | null;
  atr: number | null;
}

/**
 * Get cached market data
 */
export function getCachedMarketData(
  ticker: string,
  fromDate: string,
  toDate: string
): CachedMarketData[] | null {
  const database = getDb();

  const stmt = database.prepare(`
    SELECT date, close, sma50, sma200, rsi, atr
    FROM market_data
    WHERE ticker = ? AND date >= ? AND date <= ?
    ORDER BY date DESC
  `);

  const rows = stmt.all(ticker, fromDate, toDate) as CachedMarketData[];

  if (rows.length === 0) {
    return null;
  }

  return rows;
}

/**
 * Cache market data
 */
export function cacheMarketData(
  ticker: string,
  data: CachedMarketData[]
): number {
  const database = getDb();

  const stmt = database.prepare(`
    INSERT OR REPLACE INTO market_data (ticker, date, close, sma50, sma200, rsi, atr, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const insertMany = database.transaction((data: CachedMarketData[]) => {
    let count = 0;
    for (const d of data) {
      stmt.run(ticker, d.date, d.close, d.sma50, d.sma200, d.rsi, d.atr);
      count++;
    }
    return count;
  });

  return insertMany(data);
}

// ============================================
// CACHE MANAGEMENT
// ============================================

/**
 * Get cache statistics
 */
export function getCacheStats(): CacheStats {
  const database = getDb();

  const countStmt = database.prepare('SELECT COUNT(*) as count FROM price_data');
  const tickerStmt = database.prepare('SELECT COUNT(DISTINCT ticker) as count FROM price_data');
  const dateRangeStmt = database.prepare('SELECT MIN(date) as oldest, MAX(date) as newest FROM price_data');

  const count = (countStmt.get() as { count: number }).count;
  const tickers = (tickerStmt.get() as { count: number }).count;
  const dateRange = dateRangeStmt.get() as { oldest: string | null; newest: string | null };

  // Get file size
  let dbSizeBytes = 0;
  try {
    const stats = fs.statSync(DB_PATH);
    dbSizeBytes = stats.size;
  } catch {
    // File may not exist yet
  }

  return {
    totalRecords: count,
    uniqueTickers: tickers,
    oldestDate: dateRange.oldest,
    newestDate: dateRange.newest,
    dbSizeBytes,
    dbSizeMB: (dbSizeBytes / (1024 * 1024)).toFixed(2),
  };
}

/**
 * Get list of cached tickers
 */
export function getCachedTickers(): string[] {
  const database = getDb();

  const stmt = database.prepare('SELECT DISTINCT ticker FROM price_data ORDER BY ticker');
  const rows = stmt.all() as { ticker: string }[];

  return rows.map(r => r.ticker);
}

/**
 * Get date range for a specific ticker
 */
export function getTickerDateRange(ticker: string): { oldest: string | null; newest: string | null; count: number } {
  const database = getDb();

  const stmt = database.prepare(`
    SELECT MIN(date) as oldest, MAX(date) as newest, COUNT(*) as count
    FROM price_data
    WHERE ticker = ?
  `);

  return stmt.get(ticker) as { oldest: string | null; newest: string | null; count: number };
}

/**
 * Clean up old data (older than specified days)
 */
export function cleanupOldData(daysToKeep: number = 365): number {
  const database = getDb();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  const cutoffStr = cutoffDate.toISOString().split('T')[0];

  // Delete old price data
  const priceStmt = database.prepare('DELETE FROM price_data WHERE date < ?');
  const priceResult = priceStmt.run(cutoffStr);

  // Delete old 4h data
  const intradayStmt = database.prepare('DELETE FROM intraday_4h WHERE timestamp < ?');
  intradayStmt.run(cutoffStr);

  // Delete old market data
  const marketStmt = database.prepare('DELETE FROM market_data WHERE date < ?');
  marketStmt.run(cutoffStr);

  // Vacuum to reclaim space
  database.exec('VACUUM');

  return priceResult.changes;
}

/**
 * Clear all cached data for a specific ticker
 */
export function clearTickerCache(ticker: string): number {
  const database = getDb();

  const stmt = database.prepare('DELETE FROM price_data WHERE ticker = ?');
  const result = stmt.run(ticker);

  const stmt4h = database.prepare('DELETE FROM intraday_4h WHERE ticker = ?');
  stmt4h.run(ticker);

  const stmtMarket = database.prepare('DELETE FROM market_data WHERE ticker = ?');
  stmtMarket.run(ticker);

  return result.changes;
}

/**
 * Clear all cached data
 */
export function clearAllCache(): void {
  const database = getDb();

  database.exec('DELETE FROM price_data');
  database.exec('DELETE FROM intraday_4h');
  database.exec('DELETE FROM market_data');
  database.exec('VACUUM');
}

/**
 * Close database connection (for cleanup)
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// ============================================
// HIGH-LEVEL CACHE HELPERS
// ============================================

/**
 * Get or fetch daily prices with caching
 * Returns cached data if available, otherwise calls fetchFn and caches result
 */
export async function getOrFetchPrices(
  ticker: string,
  fromDate: string,
  toDate: string,
  fetchFn: () => Promise<{
    dates: string[];
    prices: number[];
    opens: number[];
    highs: number[];
    lows: number[];
    volumes: number[];
  }>
): Promise<{
  dates: string[];
  prices: number[];
  opens: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
  cached: boolean;
}> {
  // Try cache first
  const cached = getCachedPrices(ticker, fromDate, toDate);

  if (cached && cached.length >= 50) {
    // Return cached data (convert to expected format)
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

  // Fetch fresh data
  const fresh = await fetchFn();

  // Cache it
  if (fresh.dates.length > 0) {
    cachePrices(ticker, {
      dates: fresh.dates,
      opens: fresh.opens,
      highs: fresh.highs,
      lows: fresh.lows,
      closes: fresh.prices,
      volumes: fresh.volumes,
    });
  }

  return {
    ...fresh,
    cached: false,
  };
}
