/**
 * Momentum Analysis Types
 * Types for divergence detection and adaptive RSI thresholds
 */

// Divergence types
export type DivergenceType = 
  | 'REGULAR_BULLISH' 
  | 'REGULAR_BEARISH' 
  | 'HIDDEN_BULLISH' 
  | 'HIDDEN_BEARISH' 
  | 'NONE';

// Divergence implication for trading
export type DivergenceImplication = 'ENTRY_SIGNAL' | 'EXIT_SIGNAL' | 'NEUTRAL';

/**
 * Divergence signal detection result
 */
export interface DivergenceSignal {
  type: DivergenceType;
  indicator: 'RSI' | 'MACD';
  strength: number; // 1-10 confidence
  implication: DivergenceImplication;
  pricePoints: {
    recent: number;
    previous: number;
  };
  indicatorPoints: {
    recent: number;
    previous: number;
  };
  description: string;
}

/**
 * Combined divergence analysis for a ticker
 */
export interface DivergenceAnalysis {
  rsiDivergence: DivergenceSignal;
  macdDivergence: DivergenceSignal;
  strongest: DivergenceSignal;
  hasActionableSignal: boolean;
  recommendation: string;
}

/**
 * Adaptive RSI thresholds based on volatility
 */
export interface AdaptiveRSIThresholds {
  oversold: number; // Dynamic (typically 15-30)
  overbought: number; // Dynamic (typically 70-85)
  optimalBuyLow: number; // Ideal buy zone low
  optimalBuyHigh: number; // Ideal buy zone high
  volatilityFactor: number; // How much thresholds are adjusted
  description: string;
}

/**
 * Complete RSI analysis with adaptive thresholds
 */
export interface AdaptiveRSIAnalysis {
  currentRSI: number;
  thresholds: AdaptiveRSIThresholds;
  zone: 'OVERSOLD' | 'OPTIMAL_BUY' | 'NEUTRAL' | 'OVERBOUGHT' | 'EXTREME';
  atrPercent: number; // ATR as % of price
  isVolatile: boolean;
  score: number; // 0-10
  recommendation: string;
}

/**
 * Peak/Trough detection for divergence
 */
export interface SwingPoint {
  index: number;
  value: number;
  type: 'PEAK' | 'TROUGH';
}







