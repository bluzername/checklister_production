/**
 * Market Regime Types
 * Defines types for market regime detection and adaptive thresholds
 */

// Market regime classification
export type MarketRegime = 'BULL' | 'CHOPPY' | 'CRASH';

// Volatility environment classification
export type VolatilityEnvironment = 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';

/**
 * Detailed regime analysis with confidence metrics
 */
export interface RegimeAnalysis {
  regime: MarketRegime;
  confidence: number; // 0-100%
  details: {
    spyAbove50SMA: boolean;
    spyAbove200SMA: boolean;
    vixLevel: number;
    trendStrength: number; // 0-10
    volatilityEnvironment: VolatilityEnvironment;
    spyPrice: number;
    spy50SMA: number;
    spy200SMA: number;
    goldenCross: boolean; // 50 SMA > 200 SMA
    spyRSI: number;
    spyATRPercent: number; // ATR as % of price
  };
  timestamp: string;
}

/**
 * Dynamic thresholds based on market regime
 * These determine entry criteria in different market conditions
 */
export interface RegimeThresholds {
  minEntryScore: number; // 6.0 to 9.0 (score out of 10)
  minRRRatio: number; // 2.0 to 4.0 (risk/reward ratio)
  requireVolumeConfirm: boolean;
  requireMultiTimeframe: boolean;
  allowShorts: boolean;
  maxPositionSize: number; // As fraction of portfolio (0.05 = 5%)
  description: string;
}

/**
 * SPY market data structure
 */
export interface SPYData {
  price: number;
  sma50: number;
  sma200: number;
  goldenCross: boolean;
  rsi: number;
  atr: number;
  atrPercent: number;
  recentHighs: number[];
  recentLows: number[];
  recentCloses: number[];
  timestamp: string;
}

/**
 * VIX data structure
 */
export interface VIXData {
  level: number;
  percentile20d: number; // VIX percentile over 20 days
  environment: VolatilityEnvironment;
  isSafe: boolean; // VIX < 25
  isElevated: boolean; // VIX 20-25
  isExtreme: boolean; // VIX > 25
  timestamp: string;
}

/**
 * Combined market context
 */
export interface MarketContext {
  regime: RegimeAnalysis;
  thresholds: RegimeThresholds;
  spy: SPYData;
  vix: VIXData;
  lastUpdated: string;
}







