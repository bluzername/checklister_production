/**
 * Veto System
 *
 * Evaluates timing of user-provided signals and determines whether to
 * veto (reject) the trade based on technical conditions.
 *
 * The veto system is designed to filter out bad timing, not find winners.
 * User provides signals (insider buying, politician trades, etc.) and
 * the system either vetoes or provides a trade plan.
 */

import * as fs from 'fs';

// ============================================
// TYPES
// ============================================

export interface VetoConfig {
  vetoThreshold: number;      // P(loss) above which to veto (default: 0.55)
  highConfidenceThreshold: number;  // P(loss) for "high confidence" veto
  modelPath: string;          // Path to model JSON
}

export interface VetoResult {
  ticker: string;
  signalDate: string;
  vetoed: boolean;
  pLoss: number;              // P(loss) from model
  pWin: number;               // P(win) = 1 - P(loss)
  confidence: 'low' | 'medium' | 'high' | 'very_high';
  verdict: 'PROCEED' | 'CAUTION' | 'VETO';
  reasons: string[];          // Explanations for the verdict
  features?: Record<string, number>;  // Optional: computed features
}

export interface ModelFile {
  version: string;
  features: string[];
  coefficients: {
    intercept: number;
    weights: Record<string, number>;
    featureMeans: Record<string, number>;
    featureStds: Record<string, number>;
  };
}

// ============================================
// DEFAULT CONFIG
// ============================================

export const DEFAULT_VETO_CONFIG: VetoConfig = {
  vetoThreshold: 0.60,        // Veto if P(loss) > 60% (optimal from grid search: 83% precision, 1.44 profit factor)
  highConfidenceThreshold: 0.65,
  modelPath: 'data/model-v2.json',
};

// ============================================
// MODEL FUNCTIONS
// ============================================

function sigmoid(z: number): number {
  if (z < -500) return 0;
  if (z > 500) return 1;
  return 1 / (1 + Math.exp(-z));
}

let cachedModel: ModelFile | null = null;
let cachedModelPath: string | null = null;

export function loadVetoModel(modelPath: string = DEFAULT_VETO_CONFIG.modelPath): ModelFile {
  // Return cached model if same path
  if (cachedModel && cachedModelPath === modelPath) {
    return cachedModel;
  }

  if (!fs.existsSync(modelPath)) {
    throw new Error(`Veto model not found: ${modelPath}. Run: npm run train:model:v2`);
  }

  cachedModel = JSON.parse(fs.readFileSync(modelPath, 'utf-8'));
  cachedModelPath = modelPath;
  return cachedModel!;
}

export function predictWinProbability(
  features: Record<string, number>,
  model: ModelFile
): number {
  const { intercept, weights, featureMeans, featureStds } = model.coefficients;

  let z = intercept;
  for (const [name, weight] of Object.entries(weights)) {
    const value = features[name] ?? 0;
    const mean = featureMeans[name] ?? 0;
    const std = featureStds[name] ?? 1;
    const normalized = std > 0.0001 ? (value - mean) / std : 0;
    z += weight * normalized;
  }

  return sigmoid(z);
}

export function predictLossProbability(
  features: Record<string, number>,
  model: ModelFile
): number {
  return 1 - predictWinProbability(features, model);
}

// ============================================
// VETO EVALUATION
// ============================================

export function evaluateVeto(
  features: Record<string, number>,
  ticker: string,
  signalDate: string,
  config: Partial<VetoConfig> = {}
): VetoResult {
  const fullConfig = { ...DEFAULT_VETO_CONFIG, ...config };
  const model = loadVetoModel(fullConfig.modelPath);

  const pWin = predictWinProbability(features, model);
  const pLoss = 1 - pWin;

  // Determine confidence level
  let confidence: VetoResult['confidence'];
  if (pLoss > 0.60) {
    confidence = 'very_high';
  } else if (pLoss > fullConfig.vetoThreshold) {
    confidence = 'high';
  } else if (pLoss > 0.50) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  // Determine verdict
  let verdict: VetoResult['verdict'];
  let vetoed = false;
  if (pLoss > fullConfig.vetoThreshold) {
    verdict = 'VETO';
    vetoed = true;
  } else if (pLoss > 0.50) {
    verdict = 'CAUTION';
  } else {
    verdict = 'PROCEED';
  }

  // Generate reasons
  const reasons = generateVetoReasons(features, pLoss, model, vetoed);

  return {
    ticker,
    signalDate,
    vetoed,
    pLoss,
    pWin,
    confidence,
    verdict,
    reasons,
    features,
  };
}

function generateVetoReasons(
  features: Record<string, number>,
  pLoss: number,
  model: ModelFile,
  vetoed: boolean
): string[] {
  const reasons: string[] = [];

  // Find top contributing features to the loss prediction
  const { weights, featureMeans, featureStds } = model.coefficients;
  const contributions: Array<{ feature: string; contribution: number; value: number }> = [];

  for (const [name, weight] of Object.entries(weights)) {
    const value = features[name] ?? 0;
    const mean = featureMeans[name] ?? 0;
    const std = featureStds[name] ?? 1;
    const normalized = std > 0.0001 ? (value - mean) / std : 0;
    const contribution = weight * normalized;

    // Negative contributions increase P(loss)
    contributions.push({ feature: name, contribution: -contribution, value });
  }

  // Sort by absolute contribution (descending)
  contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  // Add top contributing factors
  const topFactors = contributions.slice(0, 3);
  for (const { feature, contribution, value } of topFactors) {
    if (Math.abs(contribution) > 0.01) {
      const direction = contribution > 0 ? 'increases' : 'decreases';
      reasons.push(`${feature}=${value.toFixed(2)} ${direction} loss probability`);
    }
  }

  // Add contextual warnings based on feature values
  if (features.rsi14 !== undefined) {
    if (features.rsi14 > 70) {
      reasons.push('RSI overbought (>70) - potential reversal');
    } else if (features.rsi14 < 30) {
      reasons.push('RSI oversold (<30) - could be catching falling knife');
    }
  }

  if (features.spyMomentum !== undefined && features.spyMomentum < -2) {
    reasons.push('Market momentum negative (SPY weak)');
  }

  if (features.atrPercent !== undefined && features.atrPercent > 5) {
    reasons.push('High volatility (ATR% > 5) - larger stop needed');
  }

  if (features.pullbackFromHigh !== undefined && features.pullbackFromHigh < 2) {
    reasons.push('Near 52-week high - limited upside potential');
  }

  // Add overall assessment
  if (vetoed) {
    reasons.unshift(`Model predicts ${(pLoss * 100).toFixed(1)}% loss probability (above veto threshold)`);
  } else if (pLoss > 0.50) {
    reasons.unshift(`Model predicts ${(pLoss * 100).toFixed(1)}% loss probability (caution advised)`);
  } else {
    reasons.unshift(`Model predicts ${((1 - pLoss) * 100).toFixed(1)}% win probability (favorable)`);
  }

  return reasons;
}

// ============================================
// BATCH EVALUATION
// ============================================

export interface BatchVetoResult {
  results: VetoResult[];
  summary: {
    total: number;
    vetoed: number;
    vetoRate: number;
    proceedCount: number;
    cautionCount: number;
  };
}

export function evaluateVetoBatch(
  signals: Array<{ ticker: string; signalDate: string; features: Record<string, number> }>,
  config: Partial<VetoConfig> = {}
): BatchVetoResult {
  const results = signals.map(s => evaluateVeto(s.features, s.ticker, s.signalDate, config));

  const vetoed = results.filter(r => r.vetoed).length;
  const proceedCount = results.filter(r => r.verdict === 'PROCEED').length;
  const cautionCount = results.filter(r => r.verdict === 'CAUTION').length;

  return {
    results,
    summary: {
      total: results.length,
      vetoed,
      vetoRate: vetoed / results.length,
      proceedCount,
      cautionCount,
    },
  };
}

// ============================================
// FORMATTING
// ============================================

export function formatVetoResult(result: VetoResult): string {
  const lines: string[] = [];

  const statusIcon = result.vetoed ? '🚫' : result.verdict === 'CAUTION' ? '⚠️' : '✅';
  lines.push(`${statusIcon} ${result.ticker} - ${result.verdict}`);
  lines.push(`  P(loss): ${(result.pLoss * 100).toFixed(1)}% | P(win): ${(result.pWin * 100).toFixed(1)}%`);
  lines.push(`  Confidence: ${result.confidence}`);

  if (result.reasons.length > 0) {
    lines.push('  Reasons:');
    for (const reason of result.reasons.slice(0, 5)) {
      lines.push(`    - ${reason}`);
    }
  }

  return lines.join('\n');
}
