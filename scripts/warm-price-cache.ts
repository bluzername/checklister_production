#!/usr/bin/env npx ts-node
/**
 * Cache Warming Script
 * Pre-fetches price data for tickers to populate SQLite cache
 *
 * Usage:
 *   npx ts-node scripts/warm-price-cache.ts [options]
 *
 * Options:
 *   --tickers <list>  Comma-separated list of tickers
 *   --universe <size> Use predefined universe (small, medium, large)
 *   --months <n>      Number of months of history to cache (default: 12)
 *   --stats           Show cache statistics only
 *   --clear           Clear all cached data
 */

import { getHistoricalPrices, getProviderStatus } from '../src/lib/data-services/price-provider';
import {
  getCacheStats,
  getCachedTickers,
  getTickerDateRange,
  clearAllCache,
  clearTickerCache,
  closeDatabase,
} from '../src/lib/data-services/sqlite-cache';
import { SP500_TICKERS } from '../src/lib/universe/filter';
import { getTrainTickers, getValidationTickers } from '../src/lib/ml/ticker-splits';

// ============================================
// CONFIGURATION
// ============================================

interface WarmConfig {
  tickers: string[];
  months: number;
  showStatsOnly: boolean;
  clearCache: boolean;
}

const UNIVERSES: Record<string, string[]> = {
  small: SP500_TICKERS.slice(0, 10),
  medium: SP500_TICKERS.slice(0, 50),
  large: SP500_TICKERS.slice(0, 150),
  full: SP500_TICKERS,
  train: getTrainTickers(),
  validation: getValidationTickers(),
  all: [...getTrainTickers(), ...getValidationTickers()],
};

// ============================================
// CACHE OPERATIONS
// ============================================

function showCacheStats(): void {
  const stats = getCacheStats();

  console.log('\n='.repeat(50));
  console.log('PRICE CACHE STATISTICS');
  console.log('='.repeat(50));

  console.log(`\nDatabase Size: ${stats.dbSizeMB} MB`);
  console.log(`Total Records: ${stats.totalRecords.toLocaleString()}`);
  console.log(`Unique Tickers: ${stats.uniqueTickers}`);
  console.log(`Date Range: ${stats.oldestDate || 'N/A'} to ${stats.newestDate || 'N/A'}`);

  // Show cached tickers
  const tickers = getCachedTickers();
  if (tickers.length > 0) {
    console.log(`\nCached Tickers (${tickers.length}):`);

    // Show first 20 with date ranges
    const showTickers = tickers.slice(0, 20);
    for (const ticker of showTickers) {
      const range = getTickerDateRange(ticker);
      console.log(`  ${ticker.padEnd(6)} ${range.count.toString().padStart(4)} days  ${range.oldest} to ${range.newest}`);
    }

    if (tickers.length > 20) {
      console.log(`  ... and ${tickers.length - 20} more`);
    }
  } else {
    console.log('\nNo tickers cached yet.');
  }

  // Provider status
  const providerStatus = getProviderStatus();
  console.log(`\nActive Provider: ${providerStatus.activeProvider}`);
  if (providerStatus.fmpRateLimitUsage) {
    console.log(`FMP Rate Limit: ${providerStatus.fmpRateLimitUsage.percentUsed.toFixed(1)}% used`);
  }

  console.log('');
}

async function warmCache(config: WarmConfig): Promise<void> {
  console.log('\n='.repeat(50));
  console.log('WARMING PRICE CACHE');
  console.log('='.repeat(50));

  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - config.months);

  console.log(`\nConfiguration:`);
  console.log(`  Tickers: ${config.tickers.length}`);
  console.log(`  Date Range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
  console.log(`  Months: ${config.months}`);

  const providerStatus = getProviderStatus();
  console.log(`  Provider: ${providerStatus.activeProvider}`);

  console.log('\nWarming cache...\n');

  let fetched = 0;
  let cached = 0;
  let errors = 0;

  const startTime = Date.now();

  for (let i = 0; i < config.tickers.length; i++) {
    const ticker = config.tickers[i];
    const progress = `[${(i + 1).toString().padStart(3)}/${config.tickers.length}]`;

    try {
      const result = await getHistoricalPrices(
        ticker,
        startDate,
        endDate,
        undefined,
        { skipCache: false, minCacheDays: 20 }
      );

      if (result.cached) {
        console.log(`${progress} ${ticker.padEnd(6)} CACHED (${result.dates.length} days)`);
        cached++;
      } else {
        console.log(`${progress} ${ticker.padEnd(6)} FETCHED (${result.dates.length} days)`);
        fetched++;
      }

      // Small delay between API calls to avoid rate limiting
      if (!result.cached) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      console.log(`${progress} ${ticker.padEnd(6)} ERROR: ${error instanceof Error ? error.message : 'Unknown'}`);
      errors++;
    }
  }

  const duration = Date.now() - startTime;

  console.log('\n' + '-'.repeat(50));
  console.log('SUMMARY');
  console.log('-'.repeat(50));
  console.log(`  Already Cached: ${cached}`);
  console.log(`  Newly Fetched:  ${fetched}`);
  console.log(`  Errors:         ${errors}`);
  console.log(`  Duration:       ${(duration / 1000).toFixed(1)}s`);

  // Show updated stats
  showCacheStats();
}

// ============================================
// CLI ARGUMENT PARSING
// ============================================

function parseArgs(): WarmConfig {
  const args = process.argv.slice(2);
  const config: WarmConfig = {
    tickers: UNIVERSES.small,
    months: 12,
    showStatsOnly: false,
    clearCache: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--tickers':
        if (nextArg) {
          config.tickers = nextArg.split(',').map(t => t.trim().toUpperCase());
          i++;
        }
        break;
      case '--universe':
        if (nextArg && nextArg in UNIVERSES) {
          config.tickers = UNIVERSES[nextArg as keyof typeof UNIVERSES];
          i++;
        }
        break;
      case '--months':
        if (nextArg) {
          config.months = parseInt(nextArg, 10);
          i++;
        }
        break;
      case '--stats':
        config.showStatsOnly = true;
        break;
      case '--clear':
        config.clearCache = true;
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
Cache Warming Script - Pre-fetch price data to SQLite cache

Usage:
  npx ts-node scripts/warm-price-cache.ts [options]

Options:
  --tickers <list>   Comma-separated list of tickers (e.g., AAPL,MSFT,GOOGL)
  --universe <size>  Use predefined universe: small (10), medium (50), large (150)
  --months <n>       Number of months of history to cache (default: 12)
  --stats            Show cache statistics only (no warming)
  --clear            Clear all cached data

Examples:
  # Show cache statistics
  npx ts-node scripts/warm-price-cache.ts --stats

  # Warm cache for specific tickers
  npx ts-node scripts/warm-price-cache.ts --tickers AAPL,MSFT,GOOGL --months 18

  # Warm cache for medium universe (50 stocks)
  npx ts-node scripts/warm-price-cache.ts --universe medium --months 12

  # Clear all cached data
  npx ts-node scripts/warm-price-cache.ts --clear
`);
}

// ============================================
// MAIN
// ============================================

async function main(): Promise<void> {
  const config = parseArgs();

  try {
    if (config.clearCache) {
      console.log('\nClearing all cached data...');
      clearAllCache();
      console.log('Cache cleared successfully.');
      showCacheStats();
      return;
    }

    if (config.showStatsOnly) {
      showCacheStats();
      return;
    }

    await warmCache(config);
  } catch (error) {
    console.error('\nError:', error);
    process.exit(1);
  } finally {
    closeDatabase();
  }
}

main();
