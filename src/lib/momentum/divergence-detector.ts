/**
 * Divergence Detector
 * Detects RSI and MACD divergences for early exit/entry signals
 * 
 * REGULAR DIVERGENCE: Price vs Momentum disagreement → Reversal signal
 * HIDDEN DIVERGENCE: Trend continuation signal
 */

import {
  DivergenceType,
  DivergenceSignal,
  DivergenceAnalysis,
  DivergenceImplication,
  SwingPoint,
} from './types';

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Find swing highs (local peaks) in data
 * A peak is a point higher than its neighbors
 */
function findSwingHighs(data: number[], lookback: number = 3): SwingPoint[] {
  const peaks: SwingPoint[] = [];
  
  for (let i = lookback; i < data.length - lookback; i++) {
    let isPeak = true;
    
    for (let j = 1; j <= lookback; j++) {
      if (data[i] <= data[i - j] || data[i] <= data[i + j]) {
        isPeak = false;
        break;
      }
    }
    
    if (isPeak) {
      peaks.push({ index: i, value: data[i], type: 'PEAK' });
    }
  }
  
  return peaks;
}

/**
 * Find swing lows (local troughs) in data
 * A trough is a point lower than its neighbors
 */
function findSwingLows(data: number[], lookback: number = 3): SwingPoint[] {
  const troughs: SwingPoint[] = [];
  
  for (let i = lookback; i < data.length - lookback; i++) {
    let isTrough = true;
    
    for (let j = 1; j <= lookback; j++) {
      if (data[i] >= data[i - j] || data[i] >= data[i + j]) {
        isTrough = false;
        break;
      }
    }
    
    if (isTrough) {
      troughs.push({ index: i, value: data[i], type: 'TROUGH' });
    }
  }
  
  return troughs;
}

/**
 * Calculate RSI values for an array of prices
 */
function calculateRSIArray(prices: number[], period: number = 14): number[] {
  const rsiValues: number[] = [];
  
  for (let i = 0; i < prices.length - period; i++) {
    const slice = prices.slice(i, i + period + 1);
    let gains = 0;
    let losses = 0;
    
    for (let j = 0; j < period; j++) {
      const change = slice[j] - slice[j + 1];
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) {
      rsiValues.push(100);
    } else {
      const rs = avgGain / avgLoss;
      rsiValues.push(100 - (100 / (1 + rs)));
    }
  }
  
  return rsiValues;
}

/**
 * Calculate MACD histogram values
 */
function calculateMACDHistogramArray(prices: number[]): number[] {
  if (prices.length < 26) return [];
  
  const histogramValues: number[] = [];
  
  // Need to calculate EMA for each position
  for (let i = 0; i < prices.length - 26; i++) {
    const slice = prices.slice(i);
    const reversedSlice = [...slice].reverse();
    
    // EMA calculation
    const ema12 = calculateEMAValue(reversedSlice, 12);
    const ema26 = calculateEMAValue(reversedSlice, 26);
    const macd = ema12 - ema26;
    
    histogramValues.push(macd);
  }
  
  return histogramValues;
}

function calculateEMAValue(data: number[], period: number): number {
  if (data.length < period) return 0;
  const k = 2 / (period + 1);
  let ema = data[0];
  for (let i = 1; i < data.length; i++) {
    ema = (data[i] * k) + (ema * (1 - k));
  }
  return ema;
}

// ============================================
// DIVERGENCE DETECTION
// ============================================

/**
 * Detect RSI divergence
 * 
 * REGULAR BULLISH: Price makes lower low, RSI makes higher low → Reversal up
 * REGULAR BEARISH: Price makes higher high, RSI makes lower high → Reversal down
 * HIDDEN BULLISH: Price makes higher low, RSI makes lower low → Continuation up
 * HIDDEN BEARISH: Price makes lower high, RSI makes higher high → Continuation down
 */
export function detectRSIDivergence(
  prices: number[],
  period: number = 14,
  lookback: number = 20
): DivergenceSignal {
  if (prices.length < period + lookback) {
    return createEmptySignal('RSI');
  }
  
  // Calculate RSI values
  const rsiValues = calculateRSIArray(prices, period);
  
  if (rsiValues.length < lookback) {
    return createEmptySignal('RSI');
  }
  
  // Limit to lookback period
  const recentPrices = prices.slice(0, lookback);
  const recentRSI = rsiValues.slice(0, lookback);
  
  // Find swing points
  const priceLows = findSwingLows(recentPrices, 2);
  const priceHighs = findSwingHighs(recentPrices, 2);
  const rsiLows = findSwingLows(recentRSI, 2);
  const rsiHighs = findSwingHighs(recentRSI, 2);
  
  // Check for Regular Bullish Divergence (price lower-low, RSI higher-low)
  if (priceLows.length >= 2 && rsiLows.length >= 2) {
    const recentPriceLow = priceLows[0];
    const prevPriceLow = priceLows[1];
    const recentRSILow = rsiLows[0];
    const prevRSILow = rsiLows[1];
    
    // Price making lower low, RSI making higher low
    if (recentPriceLow.value < prevPriceLow.value && 
        recentRSILow.value > prevRSILow.value) {
      const strength = Math.min(10, Math.abs(recentRSILow.value - prevRSILow.value) / 2);
      
      return {
        type: 'REGULAR_BULLISH',
        indicator: 'RSI',
        strength: Math.round(strength * 10) / 10,
        implication: 'ENTRY_SIGNAL',
        pricePoints: { recent: recentPriceLow.value, previous: prevPriceLow.value },
        indicatorPoints: { recent: recentRSILow.value, previous: prevRSILow.value },
        description: 'Price lower low + RSI higher low → Potential bullish reversal',
      };
    }
  }
  
  // Check for Regular Bearish Divergence (price higher-high, RSI lower-high)
  if (priceHighs.length >= 2 && rsiHighs.length >= 2) {
    const recentPriceHigh = priceHighs[0];
    const prevPriceHigh = priceHighs[1];
    const recentRSIHigh = rsiHighs[0];
    const prevRSIHigh = rsiHighs[1];
    
    // Price making higher high, RSI making lower high
    if (recentPriceHigh.value > prevPriceHigh.value && 
        recentRSIHigh.value < prevRSIHigh.value) {
      const strength = Math.min(10, Math.abs(prevRSIHigh.value - recentRSIHigh.value) / 2);
      
      return {
        type: 'REGULAR_BEARISH',
        indicator: 'RSI',
        strength: Math.round(strength * 10) / 10,
        implication: 'EXIT_SIGNAL',
        pricePoints: { recent: recentPriceHigh.value, previous: prevPriceHigh.value },
        indicatorPoints: { recent: recentRSIHigh.value, previous: prevRSIHigh.value },
        description: 'Price higher high + RSI lower high → Potential bearish reversal (EXIT)',
      };
    }
  }
  
  // Check for Hidden Bullish Divergence (price higher-low, RSI lower-low)
  if (priceLows.length >= 2 && rsiLows.length >= 2) {
    const recentPriceLow = priceLows[0];
    const prevPriceLow = priceLows[1];
    const recentRSILow = rsiLows[0];
    const prevRSILow = rsiLows[1];
    
    // Price making higher low, RSI making lower low
    if (recentPriceLow.value > prevPriceLow.value && 
        recentRSILow.value < prevRSILow.value) {
      const strength = Math.min(8, Math.abs(prevRSILow.value - recentRSILow.value) / 3);
      
      return {
        type: 'HIDDEN_BULLISH',
        indicator: 'RSI',
        strength: Math.round(strength * 10) / 10,
        implication: 'ENTRY_SIGNAL',
        pricePoints: { recent: recentPriceLow.value, previous: prevPriceLow.value },
        indicatorPoints: { recent: recentRSILow.value, previous: prevRSILow.value },
        description: 'Price higher low + RSI lower low → Uptrend continuation',
      };
    }
  }
  
  // Check for Hidden Bearish Divergence (price lower-high, RSI higher-high)
  if (priceHighs.length >= 2 && rsiHighs.length >= 2) {
    const recentPriceHigh = priceHighs[0];
    const prevPriceHigh = priceHighs[1];
    const recentRSIHigh = rsiHighs[0];
    const prevRSIHigh = rsiHighs[1];
    
    // Price making lower high, RSI making higher high
    if (recentPriceHigh.value < prevPriceHigh.value && 
        recentRSIHigh.value > prevRSIHigh.value) {
      const strength = Math.min(8, Math.abs(recentRSIHigh.value - prevRSIHigh.value) / 3);
      
      return {
        type: 'HIDDEN_BEARISH',
        indicator: 'RSI',
        strength: Math.round(strength * 10) / 10,
        implication: 'EXIT_SIGNAL',
        pricePoints: { recent: recentPriceHigh.value, previous: prevPriceHigh.value },
        indicatorPoints: { recent: recentRSIHigh.value, previous: prevRSIHigh.value },
        description: 'Price lower high + RSI higher high → Downtrend continuation (EXIT)',
      };
    }
  }
  
  return createEmptySignal('RSI');
}

/**
 * Detect MACD divergence
 * Same logic as RSI but using MACD histogram
 */
export function detectMACDDivergence(
  prices: number[],
  lookback: number = 20
): DivergenceSignal {
  if (prices.length < 26 + lookback) {
    return createEmptySignal('MACD');
  }
  
  // Calculate MACD histogram values
  const macdHistogram = calculateMACDHistogramArray(prices);
  
  if (macdHistogram.length < lookback) {
    return createEmptySignal('MACD');
  }
  
  // Limit to lookback period
  const recentPrices = prices.slice(0, lookback);
  const recentMACD = macdHistogram.slice(0, lookback);
  
  // Find swing points
  const priceLows = findSwingLows(recentPrices, 2);
  const priceHighs = findSwingHighs(recentPrices, 2);
  const macdLows = findSwingLows(recentMACD, 2);
  const macdHighs = findSwingHighs(recentMACD, 2);
  
  // Check for Regular Bullish Divergence
  if (priceLows.length >= 2 && macdLows.length >= 2) {
    const recentPriceLow = priceLows[0];
    const prevPriceLow = priceLows[1];
    const recentMACDLow = macdLows[0];
    const prevMACDLow = macdLows[1];
    
    if (recentPriceLow.value < prevPriceLow.value && 
        recentMACDLow.value > prevMACDLow.value) {
      return {
        type: 'REGULAR_BULLISH',
        indicator: 'MACD',
        strength: 7,
        implication: 'ENTRY_SIGNAL',
        pricePoints: { recent: recentPriceLow.value, previous: prevPriceLow.value },
        indicatorPoints: { recent: recentMACDLow.value, previous: prevMACDLow.value },
        description: 'Price lower low + MACD higher low → Bullish divergence',
      };
    }
  }
  
  // Check for Regular Bearish Divergence
  if (priceHighs.length >= 2 && macdHighs.length >= 2) {
    const recentPriceHigh = priceHighs[0];
    const prevPriceHigh = priceHighs[1];
    const recentMACDHigh = macdHighs[0];
    const prevMACDHigh = macdHighs[1];
    
    if (recentPriceHigh.value > prevPriceHigh.value && 
        recentMACDHigh.value < prevMACDHigh.value) {
      return {
        type: 'REGULAR_BEARISH',
        indicator: 'MACD',
        strength: 7,
        implication: 'EXIT_SIGNAL',
        pricePoints: { recent: recentPriceHigh.value, previous: prevPriceHigh.value },
        indicatorPoints: { recent: recentMACDHigh.value, previous: prevMACDHigh.value },
        description: 'Price higher high + MACD lower high → Bearish divergence (EXIT)',
      };
    }
  }
  
  return createEmptySignal('MACD');
}

/**
 * Create empty/neutral signal
 */
function createEmptySignal(indicator: 'RSI' | 'MACD'): DivergenceSignal {
  return {
    type: 'NONE',
    indicator,
    strength: 0,
    implication: 'NEUTRAL',
    pricePoints: { recent: 0, previous: 0 },
    indicatorPoints: { recent: 0, previous: 0 },
    description: 'No divergence detected',
  };
}

/**
 * Analyze all divergences for a ticker
 */
export function analyzeDivergences(prices: number[]): DivergenceAnalysis {
  const rsiDivergence = detectRSIDivergence(prices, 14, 20);
  const macdDivergence = detectMACDDivergence(prices, 20);
  
  // Determine strongest signal
  const strongest = rsiDivergence.strength > macdDivergence.strength 
    ? rsiDivergence 
    : macdDivergence;
  
  // Check for actionable signals
  const hasActionableSignal = 
    (rsiDivergence.type !== 'NONE' && rsiDivergence.strength >= 5) ||
    (macdDivergence.type !== 'NONE' && macdDivergence.strength >= 5);
  
  // Generate recommendation
  let recommendation = 'No divergence signals detected';
  
  if (strongest.implication === 'EXIT_SIGNAL' && strongest.strength >= 6) {
    recommendation = '⚠️ Strong exit signal - Consider taking profits or tightening stops';
  } else if (strongest.implication === 'ENTRY_SIGNAL' && strongest.strength >= 6) {
    recommendation = '✅ Bullish divergence detected - Good entry opportunity';
  } else if (strongest.type !== 'NONE') {
    recommendation = `Weak ${strongest.type.replace('_', ' ').toLowerCase()} divergence - Monitor closely`;
  }
  
  return {
    rsiDivergence,
    macdDivergence,
    strongest,
    hasActionableSignal,
    recommendation,
  };
}







