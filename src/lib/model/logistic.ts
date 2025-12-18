/**
 * Logistic Regression Model
 * Simple interpretable model for trade success prediction
 */

import { FeatureVector } from '../backtest/types';

/**
 * Model coefficients learned from training
 * These would be updated after training on historical data
 */
export interface ModelCoefficients {
  intercept: number;
  weights: Record<keyof FeatureVector, number>;
  featureMeans: Record<keyof FeatureVector, number>;
  featureStds: Record<keyof FeatureVector, number>;
  version: string;
  trainedAt: string;
  trainingSamples: number;
  validationAccuracy: number;
}

/**
 * Default model coefficients (baseline heuristic)
 * These approximate the current 10-criterion scoring system
 */
export const DEFAULT_COEFFICIENTS: ModelCoefficients = {
  intercept: -4.0,
  weights: {
    // Criterion scores (most important)
    score_market_condition: 0.30,
    score_sector_condition: 0.25,
    score_company_condition: 0.20,
    score_catalyst: 0.35,
    score_patterns_gaps: 0.30,
    score_support_resistance: 0.35,
    score_price_movement: 0.25,
    score_volume: 0.30,
    score_ma_fibonacci: 0.25,
    score_rsi: 0.20,
    
    // Market context
    regime: 0.50, // BULL=2, CHOPPY=1, CRASH=0
    regime_confidence: 0.02,
    vix_level: -0.05, // Higher VIX = lower probability
    spy_above_50sma: 0.30,
    spy_above_200sma: 0.40,
    golden_cross: 0.20,
    
    // Technical indicators - MEAN REVERSION: Low RSI is bullish
    rsi_value: -0.15,  // NEGATIVE: Lower RSI = higher buy signal (mean reversion)
    atr_percent: -0.10, // Higher volatility = more risk
    price_vs_200sma: 0.02,
    price_vs_50sma: 0.02,
    price_vs_20ema: 0.01,
    
    // Volume metrics
    rvol: 0.15,
    obv_trend: 0.20,
    cmf_value: 0.50,
    
    // Sector
    sector_rs_20d: 0.15,
    sector_rs_60d: 0.10,
    
    // Support/Resistance
    rr_ratio: 0.20,
    near_support: 0.25,
    
    // Multi-timeframe
    mtf_daily_score: 0.10,
    mtf_4h_score: 0.10,
    mtf_combined_score: 0.15,
    mtf_alignment: 0.30,
    
    // Divergence - CRITICAL for mean reversion entries
    divergence_type: 0.35,  // INCREASED: Bullish divergence is key signal
    divergence_strength: 0.20,  // INCREASED: Stronger divergence = better signal
    
    // Pattern
    pattern_type: 0.20,
    gap_percent: 0.05,
    bull_flag_detected: 0.25,
    hammer_detected: 0.20,
    
    // Trend
    higher_highs: 0.20,
    higher_lows: 0.25,
    trend_status: 0.25,

    // ============================================
    // MACRO / SENTIMENT FEATURES (Phase 5.1.4)
    // ============================================

    // Seasonality (most have weak historical effects, small initial weights)
    day_of_week: 0.02, // Monday effect: Mondays historically weaker
    month_of_year: 0.01, // Weak seasonal patterns
    quarter: 0.02, // Q4 historically stronger
    is_earnings_season: 0.10, // Higher volatility during earnings
    is_month_start: 0.05, // Fund flows at month start
    is_month_end: 0.05, // Fund flows at month end
    is_year_start: 0.10, // January effect

    // VIX context
    vix_percentile: -0.02, // Higher VIX percentile = more risk
    vix_regime: -0.10, // Higher VIX regime = more risk

    // Market momentum context - MEAN REVERSION adjustments
    spy_10d_return: 0.05, // REDUCED: Less focus on momentum
    spy_20d_return: 0.05, // REDUCED: Less focus on momentum
    spy_rsi: -0.10, // NEGATIVE: Market oversold is bullish (mean reversion)

    // Breadth indicators
    sector_momentum: 0.15, // Positive sector momentum is bullish
  },
  // Mean/std for normalization (initialized to defaults)
  featureMeans: {} as Record<keyof FeatureVector, number>,
  featureStds: {} as Record<keyof FeatureVector, number>,
  version: 'v1.0-baseline',
  trainedAt: new Date().toISOString(),
  trainingSamples: 0,
  validationAccuracy: 0,
};

// Initialize means and stds with reasonable defaults
Object.keys(DEFAULT_COEFFICIENTS.weights).forEach(key => {
  DEFAULT_COEFFICIENTS.featureMeans[key as keyof FeatureVector] = 5;
  DEFAULT_COEFFICIENTS.featureStds[key as keyof FeatureVector] = 3;
});

/**
 * Sigmoid function
 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Predict probability using logistic regression
 */
export function predictProbability(
  features: FeatureVector,
  coefficients: ModelCoefficients = DEFAULT_COEFFICIENTS
): number {
  let logit = coefficients.intercept;

  // Sum weighted normalized features
  for (const [key, value] of Object.entries(features)) {
    const featureKey = key as keyof FeatureVector;
    const weight = coefficients.weights[featureKey] || 0;
    const mean = coefficients.featureMeans[featureKey] || 0;
    const std = coefficients.featureStds[featureKey] || 1;

    // Normalize feature
    const normalizedValue = std > 0 ? (value - mean) / std : value - mean;
    
    logit += weight * normalizedValue;
  }

  // Convert to probability
  const probability = sigmoid(logit) * 100;
  
  // Clamp to reasonable range
  return Math.max(0, Math.min(100, probability));
}

/**
 * Get feature importance from coefficients
 */
export function getFeatureImportance(
  coefficients: ModelCoefficients = DEFAULT_COEFFICIENTS
): { feature: string; importance: number }[] {
  return Object.entries(coefficients.weights)
    .map(([feature, weight]) => ({
      feature,
      importance: Math.abs(weight),
    }))
    .sort((a, b) => b.importance - a.importance);
}

/**
 * Training data point
 */
export interface TrainingExample {
  features: FeatureVector;
  label: 0 | 1;
}

/**
 * Initialization strategies for model weights
 */
export type InitStrategy = 'default' | 'zero' | 'random' | 'xavier' | 'small_random';

/**
 * Training options
 */
export type RegularizationType = 'L1' | 'L2' | 'elastic';

/**
 * Class weight options for handling imbalanced data
 * - 'balanced': Auto-compute inverse frequency weights (n_samples / (n_classes * n_class_samples))
 * - { positive: number, negative: number }: Manual weights for each class
 */
export type ClassWeightOption = 'none' | 'balanced' | { positive: number; negative: number };

export interface TrainingOptions {
  learningRate?: number;
  iterations?: number;
  regularization?: number;
  regularizationType?: RegularizationType;  // L1, L2, or elastic net
  elasticRatio?: number;  // For elastic net: 0 = pure L2, 1 = pure L1
  initStrategy?: InitStrategy;
  momentum?: number;  // Momentum for gradient descent
  seed?: number;      // Random seed for reproducibility
  lrSchedule?: 'constant' | 'step' | 'exponential' | 'cosine';  // Learning rate schedule
  lrDecay?: number;   // Decay factor for scheduled LR
  lrStepSize?: number;  // Step size for step decay
  classWeight?: ClassWeightOption;  // Handle class imbalance (Phase 5.1.3)
}

/**
 * Compute class weights for handling imbalanced data
 * Returns weight multiplier for each class
 */
export function computeClassWeights(
  data: TrainingExample[],
  option: ClassWeightOption
): { positive: number; negative: number } {
  if (option === 'none') {
    return { positive: 1.0, negative: 1.0 };
  }

  const positiveCount = data.filter(d => d.label === 1).length;
  const negativeCount = data.filter(d => d.label === 0).length;
  const total = data.length;

  if (typeof option === 'object') {
    return option;
  }

  // 'balanced' option: inverse frequency weighting
  // weight = n_samples / (n_classes * n_class_samples)
  if (option === 'balanced') {
    const positiveWeight = total / (2 * positiveCount);
    const negativeWeight = total / (2 * negativeCount);
    return { positive: positiveWeight, negative: negativeWeight };
  }

  return { positive: 1.0, negative: 1.0 };
}

/**
 * Simple seeded random number generator
 */
function seededRandom(seed: number): () => number {
  return function() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

/**
 * Initialize weights based on strategy
 */
function initializeWeights(
  featureKeys: (keyof FeatureVector)[],
  strategy: InitStrategy,
  random: () => number
): Record<keyof FeatureVector, number> {
  const weights: Record<string, number> = {};
  const numFeatures = featureKeys.length;

  for (const key of featureKeys) {
    switch (strategy) {
      case 'zero':
        weights[key] = 0;
        break;
      case 'random':
        // Random between -1 and 1
        weights[key] = (random() * 2 - 1);
        break;
      case 'xavier':
        // Xavier initialization: scale by sqrt(1/n)
        weights[key] = (random() * 2 - 1) * Math.sqrt(1 / numFeatures);
        break;
      case 'small_random':
        // Small random values between -0.1 and 0.1
        weights[key] = (random() * 2 - 1) * 0.1;
        break;
      case 'default':
      default:
        // Use DEFAULT_COEFFICIENTS values
        weights[key] = DEFAULT_COEFFICIENTS.weights[key];
        break;
    }
  }

  return weights as Record<keyof FeatureVector, number>;
}

/**
 * Train logistic regression model using gradient descent
 *
 * This is a simple implementation - for production, consider using
 * a proper ML library like TensorFlow.js or ml.js
 */
export function trainModel(
  trainingData: TrainingExample[],
  learningRateOrOptions: number | TrainingOptions = 0.01,
  iterations: number = 1000,
  regularization: number = 0.01
): ModelCoefficients {
  // Parse options
  let options: TrainingOptions;
  if (typeof learningRateOrOptions === 'number') {
    options = {
      learningRate: learningRateOrOptions,
      iterations,
      regularization,
      regularizationType: 'L2',
      elasticRatio: 0.5,
      initStrategy: 'default',
      momentum: 0,
      seed: Date.now(),
      lrSchedule: 'constant',
      lrDecay: 0.95,
      lrStepSize: 100,
      classWeight: 'none',
    };
  } else {
    options = {
      learningRate: 0.01,
      iterations: 1000,
      regularization: 0.01,
      regularizationType: 'L2',
      elasticRatio: 0.5,
      initStrategy: 'default',
      momentum: 0,
      seed: Date.now(),
      lrSchedule: 'constant',
      lrDecay: 0.95,
      lrStepSize: 100,
      classWeight: 'none',
      ...learningRateOrOptions,
    };
  }

  const {
    learningRate: baseLr = 0.01,
    iterations: iters = 1000,
    regularization: reg = 0.01,
    regularizationType = 'L2',
    elasticRatio = 0.5,
    initStrategy = 'default',
    momentum = 0,
    seed = Date.now(),
    lrSchedule = 'constant',
    lrDecay = 0.95,
    lrStepSize = 100,
    classWeight = 'none',
  } = options;

  // Compute class weights for imbalance handling
  const classWeights = computeClassWeights(trainingData, classWeight);
  if (classWeight !== 'none') {
    console.log(`  Class weights: positive=${classWeights.positive.toFixed(2)}, negative=${classWeights.negative.toFixed(2)}`);
  }

  // Learning rate scheduling function
  const getLearningRate = (iter: number): number => {
    switch (lrSchedule) {
      case 'step':
        // Reduce LR by decay factor every stepSize iterations
        return baseLr * Math.pow(lrDecay, Math.floor(iter / lrStepSize));
      case 'exponential':
        // Exponential decay
        return baseLr * Math.pow(lrDecay, iter / 100);
      case 'cosine':
        // Cosine annealing to near-zero
        return baseLr * 0.5 * (1 + Math.cos(Math.PI * iter / iters));
      case 'constant':
      default:
        return baseLr;
    }
  };

  // Regularization function
  const getRegularizationTerm = (weight: number): number => {
    switch (regularizationType) {
      case 'L1':
        // L1: derivative of |w| is sign(w)
        return reg * Math.sign(weight);
      case 'elastic':
        // Elastic Net: combination of L1 and L2
        const l1Term = elasticRatio * reg * Math.sign(weight);
        const l2Term = (1 - elasticRatio) * reg * weight;
        return l1Term + l2Term;
      case 'L2':
      default:
        // L2: derivative of w^2 is 2w, but we use w (absorbed factor of 2)
        return reg * weight;
    }
  };

  if (trainingData.length === 0) {
    return DEFAULT_COEFFICIENTS;
  }

  const random = seededRandom(seed);

  // Initialize coefficients structure
  const coefficients: ModelCoefficients = JSON.parse(JSON.stringify(DEFAULT_COEFFICIENTS));
  const featureKeys = Object.keys(coefficients.weights) as (keyof FeatureVector)[];

  // Initialize weights based on strategy
  coefficients.weights = initializeWeights(featureKeys, initStrategy, random);

  // Initialize intercept based on strategy
  if (initStrategy === 'zero') {
    coefficients.intercept = 0;
  } else if (initStrategy === 'random' || initStrategy === 'xavier' || initStrategy === 'small_random') {
    coefficients.intercept = (random() * 2 - 1) * 0.5;
  }
  // else keep default intercept

  console.log(`  Init strategy: ${initStrategy}, Momentum: ${momentum}, Seed: ${seed}`);

  // Track velocity for momentum
  let interceptVelocity = 0;
  const weightVelocities: Record<string, number> = {};
  for (const key of featureKeys) {
    weightVelocities[key] = 0;
  }
  
  for (const key of featureKeys) {
    const values = trainingData.map(d => d.features[key]);
    coefficients.featureMeans[key] = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - coefficients.featureMeans[key], 2), 0) / values.length;
    coefficients.featureStds[key] = Math.sqrt(variance) || 1;
  }

  // Normalize features
  const normalizedData = trainingData.map(d => ({
    features: {} as FeatureVector,
    label: d.label,
  }));

  for (let i = 0; i < trainingData.length; i++) {
    for (const key of featureKeys) {
      const value = trainingData[i].features[key];
      const mean = coefficients.featureMeans[key];
      const std = coefficients.featureStds[key];
      normalizedData[i].features[key] = std > 0 ? (value - mean) / std : 0;
    }
  }

  // Gradient descent with momentum and scheduled learning rate
  for (let iter = 0; iter < iters; iter++) {
    // Get current learning rate based on schedule
    const lr = getLearningRate(iter);

    // Calculate gradients
    let interceptGradient = 0;
    const weightGradients: Record<string, number> = {};

    for (const key of featureKeys) {
      weightGradients[key] = 0;
    }

    for (const example of normalizedData) {
      // Forward pass
      let logit = coefficients.intercept;
      for (const key of featureKeys) {
        logit += coefficients.weights[key] * example.features[key];
      }
      const prediction = sigmoid(logit);
      const error = prediction - example.label;

      // Apply class weight for imbalance handling
      const sampleWeight = example.label === 1 ? classWeights.positive : classWeights.negative;

      // Accumulate weighted gradients
      interceptGradient += error * sampleWeight;
      for (const key of featureKeys) {
        weightGradients[key] += error * example.features[key] * sampleWeight;
      }
    }

    // Update weights with momentum
    const n = normalizedData.length;

    // Intercept update with momentum
    interceptVelocity = momentum * interceptVelocity + lr * (interceptGradient / n);
    coefficients.intercept -= interceptVelocity;

    for (const key of featureKeys) {
      // Add regularization (L1, L2, or Elastic Net)
      const regTerm = getRegularizationTerm(coefficients.weights[key]);
      const gradient = (weightGradients[key] / n) + regTerm;

      // Momentum update
      weightVelocities[key] = momentum * weightVelocities[key] + lr * gradient;
      coefficients.weights[key] -= weightVelocities[key];
    }

    // Log progress periodically
    if (iter % 100 === 0) {
      const loss = calculateLoss(normalizedData, coefficients);
      console.log(`Iteration ${iter}: Loss = ${loss.toFixed(4)}`);
    }
  }

  // Calculate validation accuracy
  let correct = 0;
  for (const example of normalizedData) {
    const prob = predictProbabilityNormalized(example.features, coefficients);
    const predicted = prob >= 50 ? 1 : 0;
    if (predicted === example.label) correct++;
  }

  coefficients.validationAccuracy = (correct / normalizedData.length) * 100;
  coefficients.trainingSamples = trainingData.length;
  coefficients.trainedAt = new Date().toISOString();
  coefficients.version = 'v1.0-trained';

  return coefficients;
}

/**
 * Calculate cross-entropy loss
 */
function calculateLoss(
  data: { features: FeatureVector; label: 0 | 1 }[],
  coefficients: ModelCoefficients
): number {
  let loss = 0;
  
  for (const example of data) {
    const prob = predictProbabilityNormalized(example.features, coefficients) / 100;
    const clampedProb = Math.max(1e-10, Math.min(1 - 1e-10, prob));
    
    if (example.label === 1) {
      loss -= Math.log(clampedProb);
    } else {
      loss -= Math.log(1 - clampedProb);
    }
  }
  
  return loss / data.length;
}

/**
 * Predict probability for already-normalized features
 */
function predictProbabilityNormalized(
  features: FeatureVector,
  coefficients: ModelCoefficients
): number {
  let logit = coefficients.intercept;

  for (const [key, value] of Object.entries(features)) {
    const featureKey = key as keyof FeatureVector;
    const weight = coefficients.weights[featureKey] || 0;
    logit += weight * value;
  }

  return sigmoid(logit) * 100;
}

/**
 * Save coefficients to JSON
 */
export function serializeCoefficients(coefficients: ModelCoefficients): string {
  return JSON.stringify(coefficients, null, 2);
}

/**
 * Load coefficients from JSON
 */
export function deserializeCoefficients(json: string): ModelCoefficients {
  return JSON.parse(json) as ModelCoefficients;
}

/**
 * Evaluate model on test data
 */
export function evaluateModel(
  testData: TrainingExample[],
  coefficients: ModelCoefficients
): {
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  auc: number;
  calibrationError: number;
} {
  if (testData.length === 0) {
    return { accuracy: 0, precision: 0, recall: 0, f1Score: 0, auc: 0, calibrationError: 0 };
  }

  let tp = 0, fp = 0, tn = 0, fn = 0;
  const predictions: { prob: number; label: 0 | 1 }[] = [];

  for (const example of testData) {
    const prob = predictProbability(example.features, coefficients);
    const predicted = prob >= 50 ? 1 : 0;
    
    predictions.push({ prob, label: example.label });

    if (predicted === 1 && example.label === 1) tp++;
    else if (predicted === 1 && example.label === 0) fp++;
    else if (predicted === 0 && example.label === 0) tn++;
    else fn++;
  }

  const accuracy = (tp + tn) / testData.length;
  const precision = tp > 0 ? tp / (tp + fp) : 0;
  const recall = tp > 0 ? tp / (tp + fn) : 0;
  const f1Score = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

  // Simple AUC approximation
  const auc = calculateAUC(predictions);

  // Calibration error (mean absolute error between predicted prob and actual rate)
  const calibrationError = calculateCalibrationError(predictions);

  return {
    accuracy: accuracy * 100,
    precision: precision * 100,
    recall: recall * 100,
    f1Score: f1Score * 100,
    auc: auc * 100,
    calibrationError,
  };
}

/**
 * Calculate AUC using trapezoidal rule
 */
function calculateAUC(predictions: { prob: number; label: 0 | 1 }[]): number {
  // Sort by probability descending
  const sorted = [...predictions].sort((a, b) => b.prob - a.prob);
  
  const totalPositive = sorted.filter(p => p.label === 1).length;
  const totalNegative = sorted.filter(p => p.label === 0).length;
  
  if (totalPositive === 0 || totalNegative === 0) return 0.5;

  let auc = 0;
  let tpCount = 0;
  let fpCount = 0;
  let prevFPR = 0;
  let prevTPR = 0;

  for (const pred of sorted) {
    if (pred.label === 1) {
      tpCount++;
    } else {
      fpCount++;
    }

    const tpr = tpCount / totalPositive;
    const fpr = fpCount / totalNegative;

    // Trapezoidal area
    auc += (fpr - prevFPR) * (tpr + prevTPR) / 2;

    prevTPR = tpr;
    prevFPR = fpr;
  }

  return auc;
}

/**
 * Calculate calibration error
 */
function calculateCalibrationError(predictions: { prob: number; label: 0 | 1 }[]): number {
  // Group into deciles
  const buckets: { probSum: number; labelSum: number; count: number }[] = [];
  for (let i = 0; i < 10; i++) {
    buckets.push({ probSum: 0, labelSum: 0, count: 0 });
  }

  for (const pred of predictions) {
    const bucketIdx = Math.min(9, Math.floor(pred.prob / 10));
    buckets[bucketIdx].probSum += pred.prob;
    buckets[bucketIdx].labelSum += pred.label;
    buckets[bucketIdx].count++;
  }

  let totalError = 0;
  let totalCount = 0;

  for (const bucket of buckets) {
    if (bucket.count > 0) {
      const avgProb = bucket.probSum / bucket.count;
      const actualRate = (bucket.labelSum / bucket.count) * 100;
      totalError += Math.abs(avgProb - actualRate) * bucket.count;
      totalCount += bucket.count;
    }
  }

  return totalCount > 0 ? totalError / totalCount : 0;
}

// ============================================
// MODEL LOADING
// ============================================

// Cache for loaded coefficients
let loadedCoefficients: ModelCoefficients | null = null;
let coefficientsLoadAttempted = false;

/**
 * Try to load trained coefficients from file
 * Falls back to DEFAULT_COEFFICIENTS if file doesn't exist
 */
export function loadTrainedCoefficients(): ModelCoefficients {
  // Return cached if already loaded
  if (loadedCoefficients) {
    return loadedCoefficients;
  }

  // Only attempt to load once
  if (coefficientsLoadAttempted) {
    return DEFAULT_COEFFICIENTS;
  }

  coefficientsLoadAttempted = true;

  // Try to load from file
  const possiblePaths = [
    './data/model-coefficients.json',
    '../data/model-coefficients.json',
    '../../data/model-coefficients.json',
    process.cwd() + '/data/model-coefficients.json',
  ];

  for (const filePath of possiblePaths) {
    try {
      // Dynamic import to avoid issues in browser environments
      const fs = require('fs');
      const path = require('path');
      
      const resolvedPath = path.resolve(filePath);
      
      if (fs.existsSync(resolvedPath)) {
        const content = fs.readFileSync(resolvedPath, 'utf-8');
        loadedCoefficients = deserializeCoefficients(content);
        
        // Validate loaded coefficients
        if (loadedCoefficients.trainingSamples > 0) {
          console.log(`[Model] Loaded trained coefficients (v${loadedCoefficients.version}, ${loadedCoefficients.trainingSamples} samples)`);
          return loadedCoefficients;
        }
      }
    } catch {
      // Continue trying other paths
    }
  }

  // Fall back to default
  console.log('[Model] Using default coefficients (no trained model found)');
  return DEFAULT_COEFFICIENTS;
}

/**
 * Get the currently active coefficients
 * Prefers trained coefficients if available
 */
export function getActiveCoefficients(): ModelCoefficients {
  return loadTrainedCoefficients();
}

/**
 * Reset loaded coefficients (useful for testing)
 */
export function resetLoadedCoefficients(): void {
  loadedCoefficients = null;
  coefficientsLoadAttempted = false;
}

/**
 * Check if trained coefficients are available
 */
export function hasTrainedModel(): boolean {
  const coef = loadTrainedCoefficients();
  return coef.trainingSamples > 0;
}
