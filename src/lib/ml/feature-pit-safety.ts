/**
 * Feature Point-in-Time (PIT) Safety Contract
 *
 * This module documents and enforces which features are safe for use in backtesting
 * and historical training data generation.
 *
 * PIT-SAFE: Feature can be computed using ONLY data available at the decision timestamp.
 * PIT-UNSAFE: Feature uses current/future data that wouldn't be available historically.
 *
 * Created: 2025-12-15
 * Last Updated: 2025-12-15
 *
 * STATUS: ALL 54 FEATURES ARE NOW PIT-SAFE
 * - MTF features fixed: Added asOfDate support to data-fetcher.ts, analyzer.ts, analysis.ts
 * - Fundamentals fixed: Added asOfDate support to fmp.ts, passed through from analysis.ts
 */

export type PITSafetyStatus = 'PIT_SAFE' | 'PIT_UNSAFE' | 'PIT_CONDITIONAL';

export interface FeaturePITContract {
  featureName: string;
  status: PITSafetyStatus;
  dataSource: string;
  requiresAsOfDate: boolean;
  notes?: string;
}

/**
 * Complete Feature PIT Safety Registry
 *
 * All 54 features in the FeatureVector are documented here.
 */
export const FEATURE_PIT_CONTRACTS: FeaturePITContract[] = [
  // ============================================
  // CRITERION SCORES (10 features) - ALL PIT-SAFE
  // ============================================
  {
    featureName: 'score_market_condition',
    status: 'PIT_SAFE',
    dataSource: 'SPY historical prices via getHistoricalPrices(asOfDate)',
    requiresAsOfDate: true,
  },
  {
    featureName: 'score_sector_condition',
    status: 'PIT_SAFE',
    dataSource: 'Sector ETF historical prices via fetchSectorData(asOfDate)',
    requiresAsOfDate: true,
  },
  {
    featureName: 'score_company_condition',
    status: 'PIT_SAFE',
    dataSource: 'getFundamentals(ticker, asOfDate) - filters earnings by date',
    requiresAsOfDate: true,
    notes: 'FIXED: FMP API now filters earnings to only those released before asOfDate.',
  },
  {
    featureName: 'score_catalyst',
    status: 'PIT_SAFE',
    dataSource: 'Skipped during backtests (returns neutral)',
    requiresAsOfDate: false,
    notes: 'Sentiment analysis disabled for backtests via isBacktest flag',
  },
  {
    featureName: 'score_patterns_gaps',
    status: 'PIT_SAFE',
    dataSource: 'Historical OHLC filtered to asOfDate',
    requiresAsOfDate: true,
  },
  {
    featureName: 'score_support_resistance',
    status: 'PIT_SAFE',
    dataSource: 'Historical OHLC filtered to asOfDate',
    requiresAsOfDate: true,
  },
  {
    featureName: 'score_price_movement',
    status: 'PIT_SAFE',
    dataSource: 'Historical prices filtered to asOfDate',
    requiresAsOfDate: true,
  },
  {
    featureName: 'score_volume',
    status: 'PIT_SAFE',
    dataSource: 'Historical volume data filtered to asOfDate',
    requiresAsOfDate: true,
  },
  {
    featureName: 'score_ma_fibonacci',
    status: 'PIT_SAFE',
    dataSource: 'Historical prices for MA calculations',
    requiresAsOfDate: true,
  },
  {
    featureName: 'score_rsi',
    status: 'PIT_SAFE',
    dataSource: 'Historical prices for RSI calculation',
    requiresAsOfDate: true,
  },

  // ============================================
  // MARKET CONTEXT (7 features) - ALL PIT-SAFE
  // ============================================
  {
    featureName: 'regime',
    status: 'PIT_SAFE',
    dataSource: 'detectMarketRegime(asOfDate) - SPY/VIX filtered',
    requiresAsOfDate: true,
  },
  {
    featureName: 'regime_confidence',
    status: 'PIT_SAFE',
    dataSource: 'Derived from regime detection',
    requiresAsOfDate: true,
  },
  {
    featureName: 'vix_level',
    status: 'PIT_SAFE',
    dataSource: 'fetchVIXLevel(asOfDate) - historical VIX',
    requiresAsOfDate: true,
  },
  {
    featureName: 'spy_above_50sma',
    status: 'PIT_SAFE',
    dataSource: 'fetchMarketData(asOfDate) - SPY prices',
    requiresAsOfDate: true,
  },
  {
    featureName: 'spy_above_200sma',
    status: 'PIT_SAFE',
    dataSource: 'fetchMarketData(asOfDate) - SPY prices',
    requiresAsOfDate: true,
  },
  {
    featureName: 'golden_cross',
    status: 'PIT_SAFE',
    dataSource: 'Derived from SPY 50/200 SMA positions',
    requiresAsOfDate: true,
  },
  {
    featureName: 'rr_ratio',
    status: 'PIT_SAFE',
    dataSource: 'Calculated from historical swing levels',
    requiresAsOfDate: true,
  },

  // ============================================
  // TECHNICAL INDICATORS (6 features) - ALL PIT-SAFE
  // ============================================
  {
    featureName: 'rsi_value',
    status: 'PIT_SAFE',
    dataSource: 'calculateRSI() from historical prices',
    requiresAsOfDate: true,
  },
  {
    featureName: 'atr_percent',
    status: 'PIT_SAFE',
    dataSource: 'calculateATR() from historical OHLC',
    requiresAsOfDate: true,
  },
  {
    featureName: 'price_vs_200sma',
    status: 'PIT_SAFE',
    dataSource: 'Current price vs 200-period SMA',
    requiresAsOfDate: true,
  },
  {
    featureName: 'price_vs_50sma',
    status: 'PIT_SAFE',
    dataSource: 'Current price vs 50-period SMA',
    requiresAsOfDate: true,
  },
  {
    featureName: 'price_vs_20ema',
    status: 'PIT_SAFE',
    dataSource: 'Current price vs 20-period EMA',
    requiresAsOfDate: true,
  },
  {
    featureName: 'near_support',
    status: 'PIT_SAFE',
    dataSource: 'Price near EMA support zones',
    requiresAsOfDate: true,
  },

  // ============================================
  // VOLUME METRICS (3 features) - ALL PIT-SAFE
  // ============================================
  {
    featureName: 'rvol',
    status: 'PIT_SAFE',
    dataSource: 'Current volume / 30-day average',
    requiresAsOfDate: true,
  },
  {
    featureName: 'obv_trend',
    status: 'PIT_SAFE',
    dataSource: 'OBV calculation from historical data',
    requiresAsOfDate: true,
  },
  {
    featureName: 'cmf_value',
    status: 'PIT_SAFE',
    dataSource: 'CMF calculation from historical OHLCV',
    requiresAsOfDate: true,
  },

  // ============================================
  // SECTOR ANALYSIS (2 features) - ALL PIT-SAFE
  // ============================================
  {
    featureName: 'sector_rs_20d',
    status: 'PIT_SAFE',
    dataSource: 'fetchSectorData(sectorETF, asOfDate)',
    requiresAsOfDate: true,
  },
  {
    featureName: 'sector_rs_60d',
    status: 'PIT_SAFE',
    dataSource: 'fetchSectorData(sectorETF, asOfDate)',
    requiresAsOfDate: true,
  },

  // ============================================
  // DIVERGENCE (2 features) - ALL PIT-SAFE
  // ============================================
  {
    featureName: 'divergence_type',
    status: 'PIT_SAFE',
    dataSource: 'analyzeDivergences(filteredPrices)',
    requiresAsOfDate: true,
  },
  {
    featureName: 'divergence_strength',
    status: 'PIT_SAFE',
    dataSource: 'analyzeDivergences(filteredPrices)',
    requiresAsOfDate: true,
  },

  // ============================================
  // PATTERNS (4 features) - ALL PIT-SAFE
  // ============================================
  {
    featureName: 'pattern_type',
    status: 'PIT_SAFE',
    dataSource: 'Pattern detection from historical OHLC',
    requiresAsOfDate: true,
  },
  {
    featureName: 'gap_percent',
    status: 'PIT_SAFE',
    dataSource: 'Gap calculation from historical data',
    requiresAsOfDate: true,
  },
  {
    featureName: 'bull_flag_detected',
    status: 'PIT_SAFE',
    dataSource: 'Pattern detection from historical OHLC',
    requiresAsOfDate: true,
  },
  {
    featureName: 'hammer_detected',
    status: 'PIT_SAFE',
    dataSource: 'Candlestick pattern from historical OHLC',
    requiresAsOfDate: true,
  },

  // ============================================
  // TREND ANALYSIS (3 features) - ALL PIT-SAFE
  // ============================================
  {
    featureName: 'higher_highs',
    status: 'PIT_SAFE',
    dataSource: 'checkTrendStructure() from historical data',
    requiresAsOfDate: true,
  },
  {
    featureName: 'higher_lows',
    status: 'PIT_SAFE',
    dataSource: 'checkTrendStructure() from historical data',
    requiresAsOfDate: true,
  },
  {
    featureName: 'trend_status',
    status: 'PIT_SAFE',
    dataSource: 'Derived from price structure',
    requiresAsOfDate: true,
  },

  // ============================================
  // SEASONALITY (7 features) - ALL PIT-SAFE
  // ============================================
  {
    featureName: 'day_of_week',
    status: 'PIT_SAFE',
    dataSource: 'Extracted from asOfDate parameter',
    requiresAsOfDate: true,
    notes: 'Uses: analysisDate.getDay()',
  },
  {
    featureName: 'month_of_year',
    status: 'PIT_SAFE',
    dataSource: 'Extracted from asOfDate parameter',
    requiresAsOfDate: true,
    notes: 'Uses: analysisDate.getMonth() + 1',
  },
  {
    featureName: 'quarter',
    status: 'PIT_SAFE',
    dataSource: 'Derived from month',
    requiresAsOfDate: true,
  },
  {
    featureName: 'is_earnings_season',
    status: 'PIT_SAFE',
    dataSource: 'Derived from month (Jan/Apr/Jul/Oct)',
    requiresAsOfDate: true,
  },
  {
    featureName: 'is_month_start',
    status: 'PIT_SAFE',
    dataSource: 'First 5 trading days of month',
    requiresAsOfDate: true,
  },
  {
    featureName: 'is_month_end',
    status: 'PIT_SAFE',
    dataSource: 'Last 5 trading days of month',
    requiresAsOfDate: true,
  },
  {
    featureName: 'is_year_start',
    status: 'PIT_SAFE',
    dataSource: 'January detection',
    requiresAsOfDate: true,
  },

  // ============================================
  // VIX CONTEXT (2 features) - ALL PIT-SAFE
  // ============================================
  {
    featureName: 'vix_percentile',
    status: 'PIT_SAFE',
    dataSource: 'getVixPercentile(vixLevel)',
    requiresAsOfDate: true,
    notes: 'VIX level comes from historical fetch',
  },
  {
    featureName: 'vix_regime',
    status: 'PIT_SAFE',
    dataSource: 'getVixRegime(vixLevel)',
    requiresAsOfDate: true,
  },

  // ============================================
  // MARKET MOMENTUM (3 features) - ALL PIT-SAFE
  // ============================================
  {
    featureName: 'spy_10d_return',
    status: 'PIT_SAFE',
    dataSource: 'SPY historical prices from market_condition',
    requiresAsOfDate: true,
  },
  {
    featureName: 'spy_20d_return',
    status: 'PIT_SAFE',
    dataSource: 'SPY historical prices from market_condition',
    requiresAsOfDate: true,
  },
  {
    featureName: 'spy_rsi',
    status: 'PIT_SAFE',
    dataSource: 'SPY RSI from market_condition',
    requiresAsOfDate: true,
  },

  // ============================================
  // SECTOR MOMENTUM (1 feature) - PIT-SAFE
  // ============================================
  {
    featureName: 'sector_momentum',
    status: 'PIT_SAFE',
    dataSource: 'Average of sector RS scores',
    requiresAsOfDate: true,
  },

  // ============================================
  // MULTI-TIMEFRAME (4 features) - NOW PIT-SAFE!
  // Fixed: 2025-12-15 - Added asOfDate support throughout the MTF call chain
  // ============================================
  {
    featureName: 'mtf_daily_score',
    status: 'PIT_SAFE',
    dataSource: 'getMultiTimeframeAlignment(ticker, score, trend, regime, asOfDate)',
    requiresAsOfDate: true,
    notes: 'FIXED: Now passes asOfDate through the entire MTF call chain.',
  },
  {
    featureName: 'mtf_4h_score',
    status: 'PIT_SAFE',
    dataSource: 'analyze4Hour(ticker, asOfDate) → get4HourData(ticker, asOfDate)',
    requiresAsOfDate: true,
    notes: 'FIXED: Uses asOfDate for period2, filters candles to historical date.',
  },
  {
    featureName: 'mtf_combined_score',
    status: 'PIT_SAFE',
    dataSource: 'Derived from mtf_4h_score (now PIT-safe)',
    requiresAsOfDate: true,
    notes: 'FIXED: Inherits PIT safety from fixed mtf_4h_score.',
  },
  {
    featureName: 'mtf_alignment',
    status: 'PIT_SAFE',
    dataSource: 'Derived from daily + 4H alignment (now PIT-safe)',
    requiresAsOfDate: true,
    notes: 'FIXED: Inherits PIT safety from fixed mtf_4h_score.',
  },
];

/**
 * Get all PIT-unsafe features
 */
export function getUnsafeFeatures(): string[] {
  return FEATURE_PIT_CONTRACTS
    .filter(f => f.status === 'PIT_UNSAFE')
    .map(f => f.featureName);
}

/**
 * Get all PIT-safe features
 */
export function getSafeFeatures(): string[] {
  return FEATURE_PIT_CONTRACTS
    .filter(f => f.status === 'PIT_SAFE')
    .map(f => f.featureName);
}

/**
 * Check if a specific feature is PIT-safe
 */
export function isFeaturePITSafe(featureName: string): boolean {
  const contract = FEATURE_PIT_CONTRACTS.find(f => f.featureName === featureName);
  return contract?.status === 'PIT_SAFE';
}

/**
 * Validate that a feature vector only contains PIT-safe features for backtesting
 * Returns list of unsafe features if any are found
 */
export function validatePITSafety(featureNames: string[]): {
  safe: boolean;
  unsafeFeatures: string[];
} {
  const unsafeFeatures = featureNames.filter(name => {
    const contract = FEATURE_PIT_CONTRACTS.find(f => f.featureName === name);
    return contract?.status === 'PIT_UNSAFE';
  });

  return {
    safe: unsafeFeatures.length === 0,
    unsafeFeatures,
  };
}

/**
 * Print PIT safety summary
 */
export function printPITSafetySummary(): void {
  const safe = FEATURE_PIT_CONTRACTS.filter(f => f.status === 'PIT_SAFE').length;
  const unsafe = FEATURE_PIT_CONTRACTS.filter(f => f.status === 'PIT_UNSAFE').length;
  const conditional = FEATURE_PIT_CONTRACTS.filter(f => f.status === 'PIT_CONDITIONAL').length;
  const total = FEATURE_PIT_CONTRACTS.length;

  console.log('='.repeat(60));
  console.log('FEATURE PIT SAFETY SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Features: ${total}`);
  console.log(`PIT-SAFE: ${safe} (${((safe / total) * 100).toFixed(1)}%)`);
  console.log(`PIT-UNSAFE: ${unsafe} (${((unsafe / total) * 100).toFixed(1)}%)`);
  console.log(`PIT-CONDITIONAL: ${conditional}`);
  console.log('');

  if (unsafe > 0) {
    console.log('⚠️  UNSAFE FEATURES:');
    FEATURE_PIT_CONTRACTS
      .filter(f => f.status === 'PIT_UNSAFE')
      .forEach(f => {
        console.log(`  - ${f.featureName}: ${f.notes || f.dataSource}`);
      });
  }
  console.log('='.repeat(60));
}
