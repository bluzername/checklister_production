/**
 * EV-Based Ranking Module (D4)
 *
 * Since ML prediction has AUC ~0.52 (barely better than random),
 * we focus on Expected Value calculation using:
 * - Base win rate from setup selection (~40%)
 * - Known R-multiples from strategy (TP1=1.5R, TP2=2.5R, TP3=4R, Stop=-1R)
 * - Candidate features for relative ranking (not absolute filtering)
 *
 * Key insight: Use model for RANKING, not FILTERING.
 * Even marginal edge in ranking can improve outcomes when capital is limited.
 */

import * as fs from 'fs';

// ============================================
// TYPES
// ============================================

export interface TradeCandidate {
  ticker: string;
  entryPrice: number;
  stopLoss: number;
  stopPercent: number;      // Distance to stop as %
  riskR: number;            // $ risk per share
  features: Record<string, number>;
  analysisScore?: number;   // Legacy 10-criterion score
}

export interface RankedCandidate extends TradeCandidate {
  mlProbability: number;    // Model-predicted probability (0-100)
  expectedR: number;        // Expected R-multiple
  expectedValue: number;    // EV in dollars (per $100 risked)
  rank: number;
}

export interface ModelCoefficients {
  intercept: number;
  weights: Record<string, number>;
  featureMeans: Record<string, number>;
  featureStds: Record<string, number>;
}

export interface EVRankingConfig {
  // Strategy R-multiples
  tp1R: number;       // default: 1.5
  tp2R: number;       // default: 2.5
  tp3R: number;       // default: 4.0
  stopR: number;      // default: -1.0

  // TP tranche sizes (must sum to 1)
  tp1Size: number;    // default: 0.33
  tp2Size: number;    // default: 0.33
  tp3Size: number;    // default: 0.34

  // Base rate adjustment
  baseWinRate: number; // default: 0.40 (from historical data)

  // Filtering thresholds
  minEV: number;      // Minimum EV to consider (default: 0)
  maxCandidates: number; // Max candidates to return (default: 10)
}

// ============================================
// DEFAULT CONFIG
// ============================================

export const DEFAULT_EV_CONFIG: EVRankingConfig = {
  tp1R: 1.5,
  tp2R: 2.5,
  tp3R: 4.0,
  stopR: -1.0,
  tp1Size: 0.33,
  tp2Size: 0.33,
  tp3Size: 0.34,
  baseWinRate: 0.40,  // From 50K dataset: 39.9%
  minEV: 0,
  maxCandidates: 10,
};

// Feature order must match training
const FEATURE_ORDER: string[] = [
  'priceVsSma20',
  'priceVsSma50',
  'priceVsEma9',
  'sma20VsSma50',
  'ema9VsEma21',
  'positionInRange',
  'pullbackFromHigh',
  'atrPercent',
  'bbPosition',
  'volumeRatio',
  'rsi14',
  'momentum5',
  'momentum10',
  'momentum20',
  'momentum60',
  'candleBodyRatio',
  'isBullish',
  'isBreakout',
  'aboveSma20',
  'aboveSma50',
  'smaSlope',
];

// ============================================
// MODEL LOADING
// ============================================

let loadedCoefficients: ModelCoefficients | null = null;

/**
 * Load model coefficients from file
 */
export function loadEVModel(modelPath: string = 'data/model-50k.json'): ModelCoefficients {
  if (loadedCoefficients) {
    return loadedCoefficients;
  }

  try {
    const modelData = JSON.parse(fs.readFileSync(modelPath, 'utf-8'));
    loadedCoefficients = modelData.coefficients;
    return loadedCoefficients!;
  } catch (error) {
    console.warn(`Could not load model from ${modelPath}, using default coefficients`);
    // Return neutral coefficients (all zeros = base rate prediction)
    loadedCoefficients = {
      intercept: 0,
      weights: {},
      featureMeans: {},
      featureStds: {},
    };
    return loadedCoefficients;
  }
}

/**
 * Reset loaded coefficients (for testing)
 */
export function resetEVModel(): void {
  loadedCoefficients = null;
}

// ============================================
// PREDICTION
// ============================================

function sigmoid(z: number): number {
  if (z < -500) return 0;
  if (z > 500) return 1;
  return 1 / (1 + Math.exp(-z));
}

/**
 * Predict probability using loaded model
 * Returns probability as percentage (0-100)
 */
export function predictProbability(
  features: Record<string, number>,
  coefficients?: ModelCoefficients
): number {
  const coef = coefficients || loadEVModel();

  let z = coef.intercept;

  for (const feature of FEATURE_ORDER) {
    const value = features[feature] ?? 0;
    const mean = coef.featureMeans[feature] ?? 0;
    const std = coef.featureStds[feature] ?? 1;
    const normalized = std > 0.0001 ? (value - mean) / std : 0;
    z += (coef.weights[feature] ?? 0) * normalized;
  }

  return sigmoid(z) * 100;
}

// ============================================
// EXPECTED VALUE CALCULATION
// ============================================

/**
 * Calculate expected R-multiple given win probability
 *
 * E[R] = P(win) × E[R|win] + P(loss) × E[R|loss]
 *
 * where E[R|win] = blended TP exits
 *       E[R|loss] = stopR (typically -1)
 */
export function calculateExpectedR(
  winProbability: number,  // As percentage (0-100)
  config: EVRankingConfig = DEFAULT_EV_CONFIG
): number {
  const pWin = winProbability / 100;
  const pLoss = 1 - pWin;

  // Expected R if win (blended TP exits)
  const expectedWinR =
    config.tp1Size * config.tp1R +
    config.tp2Size * config.tp2R +
    config.tp3Size * config.tp3R;

  // Expected R if loss
  const expectedLossR = config.stopR;

  // Expected R-multiple
  return pWin * expectedWinR + pLoss * expectedLossR;
}

/**
 * Calculate expected dollar value per $100 risked
 */
export function calculateExpectedValue(
  winProbability: number,
  config: EVRankingConfig = DEFAULT_EV_CONFIG,
  dollarRisk: number = 100
): number {
  const expectedR = calculateExpectedR(winProbability, config);
  return expectedR * dollarRisk;
}

// ============================================
// RANKING
// ============================================

/**
 * Rank trade candidates by Expected Value
 *
 * Process:
 * 1. Score each candidate with ML model
 * 2. Calculate EV using predicted probability
 * 3. Sort by EV descending
 * 4. Return top N candidates
 */
export function rankCandidates(
  candidates: TradeCandidate[],
  config: EVRankingConfig = DEFAULT_EV_CONFIG
): RankedCandidate[] {
  const coefficients = loadEVModel();

  // Score and calculate EV for each candidate
  const scored = candidates.map(candidate => {
    const mlProbability = predictProbability(candidate.features, coefficients);

    // Blend ML probability with base rate (since ML signal is weak)
    // This acts as Bayesian shrinkage toward the prior
    const blendedProbability =
      0.5 * mlProbability + 0.5 * (config.baseWinRate * 100);

    const expectedR = calculateExpectedR(blendedProbability, config);
    const expectedValue = calculateExpectedValue(blendedProbability, config);

    return {
      ...candidate,
      mlProbability,
      expectedR,
      expectedValue,
      rank: 0,
    };
  });

  // Sort by EV descending
  scored.sort((a, b) => b.expectedValue - a.expectedValue);

  // Assign ranks and filter
  const ranked = scored
    .filter(c => c.expectedValue >= config.minEV)
    .slice(0, config.maxCandidates)
    .map((c, idx) => ({ ...c, rank: idx + 1 }));

  return ranked;
}

/**
 * Simple ranking by analysis score (legacy compatibility)
 * Uses only the 10-criterion score, no ML
 */
export function rankByAnalysisScore(
  candidates: TradeCandidate[],
  maxCandidates: number = 10
): TradeCandidate[] {
  return [...candidates]
    .filter(c => c.analysisScore !== undefined)
    .sort((a, b) => (b.analysisScore || 0) - (a.analysisScore || 0))
    .slice(0, maxCandidates);
}

// ============================================
// ANALYSIS
// ============================================

/**
 * Compute break-even win rate for given R-multiples
 * Useful for understanding minimum requirements
 */
export function calculateBreakEvenWinRate(
  config: EVRankingConfig = DEFAULT_EV_CONFIG
): number {
  const expectedWinR =
    config.tp1Size * config.tp1R +
    config.tp2Size * config.tp2R +
    config.tp3Size * config.tp3R;

  const expectedLossR = Math.abs(config.stopR);

  // Solve for P(win) where E[R] = 0:
  // P(win) × expectedWinR - P(loss) × expectedLossR = 0
  // P(win) × expectedWinR - (1 - P(win)) × expectedLossR = 0
  // P(win) × (expectedWinR + expectedLossR) = expectedLossR
  // P(win) = expectedLossR / (expectedWinR + expectedLossR)

  return expectedLossR / (expectedWinR + expectedLossR);
}

/**
 * Analyze strategy edge given actual win rate
 */
export function analyzeStrategyEdge(
  actualWinRate: number,  // As decimal (0-1)
  config: EVRankingConfig = DEFAULT_EV_CONFIG
): {
  breakEvenWinRate: number;
  edgePercent: number;
  expectedR: number;
  kellyFraction: number;
} {
  const breakEven = calculateBreakEvenWinRate(config);
  const edgePercent = (actualWinRate - breakEven) * 100;
  const expectedR = calculateExpectedR(actualWinRate * 100, config);

  // Kelly criterion (simplified)
  const expectedWinR =
    config.tp1Size * config.tp1R +
    config.tp2Size * config.tp2R +
    config.tp3Size * config.tp3R;

  // Kelly = (p × b - q) / b, where b = win/loss ratio
  const b = expectedWinR / Math.abs(config.stopR);
  const kelly = (actualWinRate * b - (1 - actualWinRate)) / b;

  return {
    breakEvenWinRate: breakEven,
    edgePercent,
    expectedR,
    kellyFraction: Math.max(0, kelly),
  };
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Print ranking summary to console
 */
export function printRankingSummary(ranked: RankedCandidate[]): void {
  console.log('\n' + '='.repeat(70));
  console.log('TRADE CANDIDATES RANKED BY EV');
  console.log('='.repeat(70));

  if (ranked.length === 0) {
    console.log('No candidates passed EV threshold.');
    return;
  }

  console.log(
    'Rank'.padEnd(6) +
    'Ticker'.padEnd(8) +
    'Entry'.padEnd(10) +
    'Stop%'.padEnd(8) +
    'P(win)'.padEnd(10) +
    'E[R]'.padEnd(10) +
    'EV/$100'.padEnd(10)
  );
  console.log('-'.repeat(70));

  for (const c of ranked) {
    console.log(
      `#${c.rank}`.padEnd(6) +
      c.ticker.padEnd(8) +
      `$${c.entryPrice.toFixed(2)}`.padEnd(10) +
      `${c.stopPercent.toFixed(1)}%`.padEnd(8) +
      `${c.mlProbability.toFixed(1)}%`.padEnd(10) +
      `${c.expectedR.toFixed(2)}R`.padEnd(10) +
      `$${c.expectedValue.toFixed(2)}`.padEnd(10)
    );
  }

  console.log('-'.repeat(70));
  console.log(`Total candidates: ${ranked.length}`);
}
