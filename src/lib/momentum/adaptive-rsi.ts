/**
 * Adaptive RSI Thresholds
 * Dynamically adjusts RSI overbought/oversold levels based on volatility (ATR)
 * 
 * High volatility stocks need wider RSI ranges
 * Low volatility stocks need tighter RSI ranges
 */

import {
  AdaptiveRSIThresholds,
  AdaptiveRSIAnalysis,
} from './types';

// Default RSI thresholds
const BASE_OVERSOLD = 30;
const BASE_OVERBOUGHT = 70;

// Volatility bands (ATR as % of price)
const LOW_VOLATILITY_THRESHOLD = 1.0; // ATR < 1% of price
const HIGH_VOLATILITY_THRESHOLD = 3.0; // ATR > 3% of price
const EXTREME_VOLATILITY_THRESHOLD = 5.0; // ATR > 5% of price

/**
 * Calculate adaptive RSI thresholds based on ATR
 * 
 * Logic:
 * - Low volatility (ATR < 1%): Tighter ranges (35-65)
 * - Normal volatility (1-3%): Standard ranges (30-70)
 * - High volatility (3-5%): Wider ranges (25-75)
 * - Extreme volatility (>5%): Very wide ranges (20-80)
 */
export function calculateAdaptiveRSIThresholds(
  atr: number,
  currentPrice: number
): AdaptiveRSIThresholds {
  // Calculate ATR as percentage of price
  const atrPercent = (atr / currentPrice) * 100;
  
  // Calculate volatility factor (0 = low, 1 = normal, 2+ = high)
  let volatilityFactor = 1.0;
  
  if (atrPercent < LOW_VOLATILITY_THRESHOLD) {
    volatilityFactor = 0.5;
  } else if (atrPercent < HIGH_VOLATILITY_THRESHOLD) {
    volatilityFactor = 1.0;
  } else if (atrPercent < EXTREME_VOLATILITY_THRESHOLD) {
    volatilityFactor = 1.5;
  } else {
    volatilityFactor = 2.0;
  }
  
  // Calculate adaptive thresholds
  // Higher volatility = wider ranges (lower oversold, higher overbought)
  const adjustment = (volatilityFactor - 1) * 10;
  
  const oversold = Math.max(15, BASE_OVERSOLD - adjustment);
  const overbought = Math.min(85, BASE_OVERBOUGHT + adjustment);
  
  // Optimal buy zone remains relatively stable
  // Best entries are typically RSI 40-55 in uptrends
  const optimalBuyLow = Math.max(35, 40 - adjustment / 2);
  const optimalBuyHigh = Math.min(60, 55 + adjustment / 2);
  
  // Generate description
  let description: string;
  if (volatilityFactor <= 0.5) {
    description = 'Low volatility - using tighter RSI ranges';
  } else if (volatilityFactor <= 1.0) {
    description = 'Normal volatility - standard RSI thresholds';
  } else if (volatilityFactor <= 1.5) {
    description = 'High volatility - wider RSI ranges to avoid whipsaws';
  } else {
    description = 'Extreme volatility - very wide RSI ranges';
  }
  
  return {
    oversold: Math.round(oversold),
    overbought: Math.round(overbought),
    optimalBuyLow: Math.round(optimalBuyLow),
    optimalBuyHigh: Math.round(optimalBuyHigh),
    volatilityFactor: Math.round(volatilityFactor * 100) / 100,
    description,
  };
}

/**
 * Determine RSI zone based on adaptive thresholds
 */
function determineRSIZone(
  rsi: number,
  thresholds: AdaptiveRSIThresholds
): AdaptiveRSIAnalysis['zone'] {
  if (rsi <= thresholds.oversold) {
    return 'OVERSOLD';
  }
  if (rsi >= thresholds.overbought) {
    return 'EXTREME'; // Overbought is extreme for swing trading
  }
  if (rsi >= 75) {
    return 'OVERBOUGHT'; // Still cautious zone
  }
  if (rsi >= thresholds.optimalBuyLow && rsi <= thresholds.optimalBuyHigh) {
    return 'OPTIMAL_BUY';
  }
  return 'NEUTRAL';
}

/**
 * Calculate RSI score based on adaptive thresholds
 */
function calculateAdaptiveRSIScore(
  rsi: number,
  thresholds: AdaptiveRSIThresholds
): number {
  // Score breakdown:
  // - Optimal buy zone (40-55): 8-10 points
  // - Neutral zone: 5-7 points
  // - Oversold: 4-6 points (could be opportunity, could be falling knife)
  // - Overbought: 2-4 points (caution)
  // - Extreme: 0-2 points (avoid)
  
  const zone = determineRSIZone(rsi, thresholds);
  
  switch (zone) {
    case 'OPTIMAL_BUY':
      // Peak score when RSI is in the sweet spot (45-55)
      const distanceFromCenter = Math.abs(rsi - 50);
      return Math.min(10, 9 - (distanceFromCenter / 10));
      
    case 'NEUTRAL':
      if (rsi >= 50 && rsi < 65) {
        return 7; // Healthy uptrend momentum
      } else if (rsi >= 35 && rsi < 40) {
        return 6; // Approaching buy zone
      }
      return 5;
      
    case 'OVERSOLD':
      // Oversold can be opportunity but also risk
      return rsi < 20 ? 4 : 5;
      
    case 'OVERBOUGHT':
      return 3; // Caution zone
      
    case 'EXTREME':
      return 1; // Avoid entries
  }
}

/**
 * Generate recommendation based on RSI analysis
 */
function generateRSIRecommendation(
  zone: AdaptiveRSIAnalysis['zone'],
  rsi: number,
  isVolatile: boolean
): string {
  switch (zone) {
    case 'OPTIMAL_BUY':
      return `RSI ${rsi} in optimal buy zone - ideal entry point`;
      
    case 'NEUTRAL':
      if (rsi > 50) {
        return `RSI ${rsi} showing positive momentum - acceptable entry`;
      }
      return `RSI ${rsi} neutral - wait for better entry`;
      
    case 'OVERSOLD':
      if (isVolatile) {
        return `RSI ${rsi} oversold in volatile stock - potential bounce but risky`;
      }
      return `RSI ${rsi} oversold - watch for reversal signals`;
      
    case 'OVERBOUGHT':
      return `RSI ${rsi} overbought - consider waiting for pullback`;
      
    case 'EXTREME':
      return `RSI ${rsi} extreme - avoid new entries, consider taking profits`;
  }
}

/**
 * Perform complete adaptive RSI analysis
 */
export function analyzeAdaptiveRSI(
  rsi: number,
  atr: number,
  currentPrice: number
): AdaptiveRSIAnalysis {
  const thresholds = calculateAdaptiveRSIThresholds(atr, currentPrice);
  const atrPercent = (atr / currentPrice) * 100;
  const isVolatile = atrPercent > HIGH_VOLATILITY_THRESHOLD;
  const zone = determineRSIZone(rsi, thresholds);
  const score = calculateAdaptiveRSIScore(rsi, thresholds);
  const recommendation = generateRSIRecommendation(zone, Math.round(rsi), isVolatile);
  
  return {
    currentRSI: Math.round(rsi),
    thresholds,
    zone,
    atrPercent: Math.round(atrPercent * 100) / 100,
    isVolatile,
    score: Math.round(score * 10) / 10,
    recommendation,
  };
}

/**
 * Quick check if RSI is in acceptable buy range with adaptive thresholds
 */
export function isRSIBuyable(rsi: number, atr: number, currentPrice: number): boolean {
  const thresholds = calculateAdaptiveRSIThresholds(atr, currentPrice);
  const zone = determineRSIZone(rsi, thresholds);
  
  return zone === 'OPTIMAL_BUY' || zone === 'NEUTRAL';
}







