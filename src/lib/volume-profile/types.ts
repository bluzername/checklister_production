/**
 * Volume Profile Types
 * Types for advanced volume analysis (OBV, CMF, RVOL)
 */

/**
 * On-Balance Volume analysis
 */
export interface OBVAnalysis {
  value: number;
  trend: 'UP' | 'DOWN' | 'FLAT';
  divergence: 'BULLISH' | 'BEARISH' | 'NONE';
  signalStrength: number; // 0-10
}

/**
 * Chaikin Money Flow analysis
 */
export interface CMFAnalysis {
  value: number; // -1 to +1
  isPositive: boolean;
  flowStrength: 'STRONG_INFLOW' | 'WEAK_INFLOW' | 'NEUTRAL' | 'WEAK_OUTFLOW' | 'STRONG_OUTFLOW';
  signalStrength: number; // 0-10
}

/**
 * Relative Volume analysis
 */
export interface RVOLAnalysis {
  current: number;
  ratio: number; // vs 30-day average
  interpretation: 'VERY_HIGH' | 'HIGH' | 'NORMAL' | 'LOW' | 'VERY_LOW';
  signalStrength: number; // 0-10
}

/**
 * Price action context for volume analysis
 */
export interface PriceContext {
  isRising: boolean;
  rangePercent: number; // (close - open) / open
  isGreenCandle: boolean;
  nearHigh: boolean; // close within 20% of high-low range
  nearLow: boolean; // close within 20% of low-high range
}

/**
 * Combined volume profile metrics
 */
export interface VolumeProfileMetrics {
  rvol: RVOLAnalysis;
  obv: OBVAnalysis;
  cmf: CMFAnalysis;
  priceContext: PriceContext;
  
  // Combined analysis
  overallScore: number; // 0-10
  interpretation: 'STRONG_ACCUMULATION' | 'ACCUMULATION' | 'NEUTRAL' | 'DISTRIBUTION' | 'STRONG_DISTRIBUTION';
  smartMoneySignal: 'BUYING' | 'SELLING' | 'NEUTRAL';
  confidence: number; // 0-100%
  
  // Detailed breakdown
  details: {
    rvolScore: number;
    obvScore: number;
    cmfScore: number;
    priceVolumeAlignment: boolean;
    institutionalActivity: boolean;
  };
}







