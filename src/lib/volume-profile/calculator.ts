/**
 * Volume Profile Calculator
 * Calculates OBV, CMF, RVOL and combines into a professional-grade volume analysis
 */

import {
  OBVAnalysis,
  CMFAnalysis,
  RVOLAnalysis,
  PriceContext,
  VolumeProfileMetrics,
} from './types';

// ============================================
// ON-BALANCE VOLUME (OBV)
// ============================================

/**
 * Calculate On-Balance Volume
 * OBV accumulates volume on up days, subtracts on down days
 * Shows whether volume is flowing into or out of a security
 * 
 * @param prices - Array of closing prices (newest first)
 * @param volumes - Array of volumes (newest first)
 */
export function calculateOBV(prices: number[], volumes: number[]): OBVAnalysis {
  if (prices.length < 10 || volumes.length < 10) {
    return {
      value: 0,
      trend: 'FLAT',
      divergence: 'NONE',
      signalStrength: 5,
    };
  }

  // Calculate OBV
  let obv = 0;
  const obvValues: number[] = [];

  // Process from oldest to newest
  for (let i = prices.length - 2; i >= 0; i--) {
    const priceChange = prices[i] - prices[i + 1];
    
    if (priceChange > 0) {
      obv += volumes[i];
    } else if (priceChange < 0) {
      obv -= volumes[i];
    }
    // No change = no volume added
    
    obvValues.unshift(obv);
  }

  // Determine OBV trend (compare current to 5-day ago)
  const currentOBV = obvValues[0] || 0;
  const obv5DaysAgo = obvValues[4] || 0;
  const obvChange = currentOBV - obv5DaysAgo;
  
  let trend: 'UP' | 'DOWN' | 'FLAT';
  if (obvChange > 0) {
    trend = 'UP';
  } else if (obvChange < 0) {
    trend = 'DOWN';
  } else {
    trend = 'FLAT';
  }

  // Check for divergence (price vs OBV)
  const priceChange5d = prices[0] - prices[4];
  let divergence: 'BULLISH' | 'BEARISH' | 'NONE' = 'NONE';

  // Bullish divergence: Price down, OBV up (accumulation despite price drop)
  if (priceChange5d < 0 && obvChange > 0) {
    divergence = 'BULLISH';
  }
  // Bearish divergence: Price up, OBV down (distribution despite price rise)
  else if (priceChange5d > 0 && obvChange < 0) {
    divergence = 'BEARISH';
  }

  // Signal strength (0-10)
  let signalStrength = 5;
  if (trend === 'UP') {
    signalStrength += 2;
    if (divergence === 'BULLISH') signalStrength += 2;
  } else if (trend === 'DOWN') {
    signalStrength -= 2;
    if (divergence === 'BEARISH') signalStrength -= 2;
  }

  return {
    value: currentOBV,
    trend,
    divergence,
    signalStrength: Math.max(0, Math.min(10, signalStrength)),
  };
}

// ============================================
// CHAIKIN MONEY FLOW (CMF)
// ============================================

/**
 * Calculate Chaikin Money Flow
 * CMF measures buying/selling pressure based on where price closes within the range
 * Positive = buying pressure, Negative = selling pressure
 * 
 * @param highs - Array of high prices (newest first)
 * @param lows - Array of low prices (newest first)
 * @param closes - Array of closing prices (newest first)
 * @param volumes - Array of volumes (newest first)
 * @param period - Lookback period (default 20)
 */
export function calculateCMF(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
  period: number = 20
): CMFAnalysis {
  if (highs.length < period || lows.length < period || 
      closes.length < period || volumes.length < period) {
    return {
      value: 0,
      isPositive: false,
      flowStrength: 'NEUTRAL',
      signalStrength: 5,
    };
  }

  let moneyFlowVolume = 0;
  let totalVolume = 0;

  for (let i = 0; i < period; i++) {
    const high = highs[i];
    const low = lows[i];
    const close = closes[i];
    const volume = volumes[i];

    // Avoid division by zero
    const range = high - low;
    if (range === 0) continue;

    // Money Flow Multiplier = ((Close - Low) - (High - Close)) / (High - Low)
    // This equals: (2 * Close - High - Low) / (High - Low)
    const mfMultiplier = ((close - low) - (high - close)) / range;

    // Money Flow Volume = MF Multiplier × Volume
    moneyFlowVolume += mfMultiplier * volume;
    totalVolume += volume;
  }

  // CMF = Sum of Money Flow Volume / Sum of Volume
  const cmfValue = totalVolume > 0 ? moneyFlowVolume / totalVolume : 0;
  const isPositive = cmfValue > 0;

  // Classify flow strength
  let flowStrength: CMFAnalysis['flowStrength'];
  if (cmfValue > 0.25) {
    flowStrength = 'STRONG_INFLOW';
  } else if (cmfValue > 0.05) {
    flowStrength = 'WEAK_INFLOW';
  } else if (cmfValue >= -0.05) {
    flowStrength = 'NEUTRAL';
  } else if (cmfValue >= -0.25) {
    flowStrength = 'WEAK_OUTFLOW';
  } else {
    flowStrength = 'STRONG_OUTFLOW';
  }

  // Signal strength (0-10)
  let signalStrength = 5;
  if (flowStrength === 'STRONG_INFLOW') signalStrength = 9;
  else if (flowStrength === 'WEAK_INFLOW') signalStrength = 7;
  else if (flowStrength === 'WEAK_OUTFLOW') signalStrength = 3;
  else if (flowStrength === 'STRONG_OUTFLOW') signalStrength = 1;

  return {
    value: Math.round(cmfValue * 1000) / 1000,
    isPositive,
    flowStrength,
    signalStrength,
  };
}

// ============================================
// RELATIVE VOLUME (RVOL)
// ============================================

/**
 * Calculate Relative Volume
 * RVOL = Current Volume / Average Volume
 * Shows unusual activity compared to typical volume
 * 
 * @param volumes - Array of volumes (newest first)
 * @param avgPeriod - Period for average calculation (default 30)
 */
export function calculateRVOL(volumes: number[], avgPeriod: number = 30): RVOLAnalysis {
  if (volumes.length < avgPeriod) {
    return {
      current: volumes[0] || 0,
      ratio: 1,
      interpretation: 'NORMAL',
      signalStrength: 5,
    };
  }

  const currentVolume = volumes[0];
  const avgVolume = volumes.slice(1, avgPeriod + 1).reduce((a, b) => a + b, 0) / avgPeriod;
  const ratio = avgVolume > 0 ? currentVolume / avgVolume : 1;

  // Classify volume level
  let interpretation: RVOLAnalysis['interpretation'];
  if (ratio >= 3.0) {
    interpretation = 'VERY_HIGH';
  } else if (ratio >= 1.5) {
    interpretation = 'HIGH';
  } else if (ratio >= 0.75) {
    interpretation = 'NORMAL';
  } else if (ratio >= 0.4) {
    interpretation = 'LOW';
  } else {
    interpretation = 'VERY_LOW';
  }

  // Signal strength (higher RVOL = stronger signal for breakouts)
  let signalStrength = 5;
  if (ratio >= 3.0) signalStrength = 10;
  else if (ratio >= 2.0) signalStrength = 8;
  else if (ratio >= 1.5) signalStrength = 7;
  else if (ratio >= 1.0) signalStrength = 5;
  else signalStrength = 3;

  return {
    current: Math.round(currentVolume),
    ratio: Math.round(ratio * 100) / 100,
    interpretation,
    signalStrength,
  };
}

// ============================================
// PRICE CONTEXT ANALYSIS
// ============================================

/**
 * Analyze price action context for volume interpretation
 */
export function analyzePriceContext(
  open: number,
  high: number,
  low: number,
  close: number,
  prevClose: number
): PriceContext {
  const isRising = close > prevClose;
  const rangePercent = open > 0 ? ((close - open) / open) * 100 : 0;
  const isGreenCandle = close > open;
  
  // Check where close is within the range
  const range = high - low;
  if (range === 0) {
    return {
      isRising,
      rangePercent: Math.round(rangePercent * 100) / 100,
      isGreenCandle,
      nearHigh: true,
      nearLow: true,
    };
  }
  
  const closePosition = (close - low) / range;
  const nearHigh = closePosition >= 0.8; // Close in top 20% of range
  const nearLow = closePosition <= 0.2; // Close in bottom 20% of range

  return {
    isRising,
    rangePercent: Math.round(rangePercent * 100) / 100,
    isGreenCandle,
    nearHigh,
    nearLow,
  };
}

// ============================================
// COMBINED VOLUME PROFILE ANALYSIS
// ============================================

/**
 * Calculate comprehensive volume profile metrics
 * Combines OBV, CMF, and RVOL into a single score
 */
export function calculateVolumeProfile(
  opens: number[],
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[]
): VolumeProfileMetrics {
  // Calculate individual metrics
  const obv = calculateOBV(closes, volumes);
  const cmf = calculateCMF(highs, lows, closes, volumes, 20);
  const rvol = calculateRVOL(volumes, 30);
  
  // Price context for current candle
  const priceContext = analyzePriceContext(
    opens[0],
    highs[0],
    lows[0],
    closes[0],
    closes[1] || opens[0]
  );

  // Calculate component scores
  const rvolScore = calculateRVOLScore(rvol, priceContext);
  const obvScore = calculateOBVScore(obv);
  const cmfScore = calculateCMFScore(cmf);

  // Price-Volume alignment check
  const priceVolumeAlignment = checkPriceVolumeAlignment(priceContext, rvol, obv);
  
  // Institutional activity detection
  const institutionalActivity = detectInstitutionalActivity(rvol, cmf, priceContext);

  // Calculate overall score (weighted average)
  // Weights: RVOL 30%, OBV 35%, CMF 35%
  const overallScore = (rvolScore * 0.3) + (obvScore * 0.35) + (cmfScore * 0.35);

  // Determine interpretation
  const interpretation = interpretVolumeProfile(overallScore, priceVolumeAlignment);
  
  // Determine smart money signal
  const smartMoneySignal = interpretSmartMoney(obv, cmf, priceContext);

  // Calculate confidence
  const confidence = calculateConfidence(rvol, obv, cmf, priceVolumeAlignment);

  return {
    rvol,
    obv,
    cmf,
    priceContext,
    overallScore: Math.round(overallScore * 10) / 10,
    interpretation,
    smartMoneySignal,
    confidence,
    details: {
      rvolScore: Math.round(rvolScore * 10) / 10,
      obvScore: Math.round(obvScore * 10) / 10,
      cmfScore: Math.round(cmfScore * 10) / 10,
      priceVolumeAlignment,
      institutionalActivity,
    },
  };
}

// ============================================
// SCORING HELPERS
// ============================================

function calculateRVOLScore(rvol: RVOLAnalysis, priceContext: PriceContext): number {
  let score = rvol.signalStrength;
  
  // Bonus for high volume on green candles
  if (rvol.ratio >= 1.5 && priceContext.isGreenCandle && priceContext.nearHigh) {
    score += 1;
  }
  
  // Penalty for high volume on red candles (distribution)
  if (rvol.ratio >= 1.5 && !priceContext.isGreenCandle && priceContext.nearLow) {
    score -= 2;
  }
  
  return Math.max(0, Math.min(10, score));
}

function calculateOBVScore(obv: OBVAnalysis): number {
  let score = obv.signalStrength;
  
  // Bonus for bullish divergence
  if (obv.divergence === 'BULLISH') {
    score += 2;
  }
  
  // Penalty for bearish divergence
  if (obv.divergence === 'BEARISH') {
    score -= 2;
  }
  
  return Math.max(0, Math.min(10, score));
}

function calculateCMFScore(cmf: CMFAnalysis): number {
  return cmf.signalStrength;
}

function checkPriceVolumeAlignment(
  priceContext: PriceContext,
  rvol: RVOLAnalysis,
  obv: OBVAnalysis
): boolean {
  // Good alignment: Price rising + High volume + OBV up
  if (priceContext.isRising && rvol.ratio >= 1.2 && obv.trend === 'UP') {
    return true;
  }
  
  // Bad alignment would be: Price rising + High volume + OBV down (distribution)
  // We return true only for good alignment
  return false;
}

function detectInstitutionalActivity(
  rvol: RVOLAnalysis,
  cmf: CMFAnalysis,
  priceContext: PriceContext
): boolean {
  // Institutional buying: Very high volume + Strong CMF + Price rising
  if (rvol.ratio >= 2.0 && cmf.flowStrength === 'STRONG_INFLOW' && priceContext.isRising) {
    return true;
  }
  
  // Institutional accumulation: High volume + Positive CMF + Close near high
  if (rvol.ratio >= 1.5 && cmf.isPositive && priceContext.nearHigh) {
    return true;
  }
  
  return false;
}

function interpretVolumeProfile(
  score: number,
  priceVolumeAlignment: boolean
): VolumeProfileMetrics['interpretation'] {
  if (score >= 8.5) return 'STRONG_ACCUMULATION';
  if (score >= 7 || (score >= 6.5 && priceVolumeAlignment)) return 'ACCUMULATION';
  if (score >= 4) return 'NEUTRAL';
  if (score >= 2.5) return 'DISTRIBUTION';
  return 'STRONG_DISTRIBUTION';
}

function interpretSmartMoney(
  obv: OBVAnalysis,
  cmf: CMFAnalysis,
  priceContext: PriceContext
): VolumeProfileMetrics['smartMoneySignal'] {
  // Strong buying signals
  if (obv.trend === 'UP' && cmf.isPositive && priceContext.nearHigh) {
    return 'BUYING';
  }
  
  // Strong selling signals
  if (obv.trend === 'DOWN' && !cmf.isPositive && priceContext.nearLow) {
    return 'SELLING';
  }
  
  // Bullish divergence is a buying signal
  if (obv.divergence === 'BULLISH') {
    return 'BUYING';
  }
  
  // Bearish divergence is a selling signal
  if (obv.divergence === 'BEARISH') {
    return 'SELLING';
  }
  
  return 'NEUTRAL';
}

function calculateConfidence(
  rvol: RVOLAnalysis,
  obv: OBVAnalysis,
  cmf: CMFAnalysis,
  priceVolumeAlignment: boolean
): number {
  let confidence = 50;
  
  // High RVOL increases confidence
  if (rvol.ratio >= 2.0) confidence += 15;
  else if (rvol.ratio >= 1.5) confidence += 10;
  
  // Clear OBV trend increases confidence
  if (obv.trend !== 'FLAT') confidence += 10;
  
  // Strong CMF increases confidence
  if (cmf.flowStrength === 'STRONG_INFLOW' || cmf.flowStrength === 'STRONG_OUTFLOW') {
    confidence += 15;
  } else if (cmf.flowStrength !== 'NEUTRAL') {
    confidence += 10;
  }
  
  // Price-volume alignment increases confidence
  if (priceVolumeAlignment) confidence += 10;
  
  // Divergence detection increases confidence in the signal
  if (obv.divergence !== 'NONE') confidence += 10;
  
  return Math.min(100, confidence);
}







