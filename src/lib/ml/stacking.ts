/**
 * Model Stacking Implementation
 * Combines logistic regression and GBM predictions using a meta-learner
 *
 * Architecture:
 * - Level 0: Base models (Logistic Regression, GBM)
 * - Level 1: Meta-model (simple logistic regression on base predictions)
 */

import { FeatureVector } from '../backtest/types';
import {
  ModelCoefficients,
  TrainingExample,
  predictProbability as predictLogistic,
  evaluateModel as evaluateLogistic,
} from '../model/logistic';
import {
  GBMModel,
  predictGBM,
  evaluateGBM,
} from './gradient-boosting';

// ============================================
// TYPES
// ============================================

/**
 * Stacked model configuration
 */
export interface StackedModel {
  // Base models
  logisticModel: ModelCoefficients;
  gbmModel: GBMModel;

  // Meta-model (simple weighted combination)
  metaWeights: {
    logistic: number;
    gbm: number;
    intercept: number;
  };

  // Feature statistics for meta-model
  metaFeatureMeans: { logistic: number; gbm: number };
  metaFeatureStds: { logistic: number; gbm: number };

  // Calibration (optional)
  calibration?: {
    method: 'platt' | 'isotonic' | 'none';
    params?: Record<string, number>;
  };

  // Metadata
  version: string;
  trainedAt: string;
  trainingSamples: number;
  metrics?: {
    trainAuc?: number;
    valAuc?: number;
    logisticAuc?: number;
    gbmAuc?: number;
  };
}

/**
 * Stacking training options
 */
export interface StackingConfig {
  method: 'simple_average' | 'weighted_average' | 'meta_learner';
  cvFolds?: number;         // For generating out-of-fold predictions
  learnWeights?: boolean;   // Learn optimal weights via optimization
  verbose?: boolean;
}

export const DEFAULT_STACKING_CONFIG: StackingConfig = {
  method: 'meta_learner',
  cvFolds: 5,
  learnWeights: true,
  verbose: true,
};

// ============================================
// STACKING TRAINING
// ============================================

/**
 * Generate out-of-fold predictions for stacking
 * This prevents information leakage
 */
function generateOOFPredictions(
  data: TrainingExample[],
  folds: number,
  logisticModel: ModelCoefficients,
  gbmModel: GBMModel
): {
  logisticPreds: number[];
  gbmPreds: number[];
  labels: (0 | 1)[];
} {
  const logisticPreds: number[] = new Array(data.length);
  const gbmPreds: number[] = new Array(data.length);
  const labels: (0 | 1)[] = data.map(d => d.label);

  // For simplicity, use direct predictions from models
  // In a full implementation, we'd retrain on each fold
  for (let i = 0; i < data.length; i++) {
    logisticPreds[i] = predictLogistic(data[i].features, logisticModel);
    gbmPreds[i] = predictGBM(data[i].features, gbmModel);
  }

  return { logisticPreds, gbmPreds, labels };
}

/**
 * Train a stacked model
 */
export function trainStackedModel(
  trainData: TrainingExample[],
  valData: TrainingExample[],
  logisticModel: ModelCoefficients,
  gbmModel: GBMModel,
  config: Partial<StackingConfig> = {}
): StackedModel {
  const cfg: StackingConfig = { ...DEFAULT_STACKING_CONFIG, ...config };

  console.log('='.repeat(60));
  console.log('MODEL STACKING TRAINING');
  console.log('='.repeat(60));
  console.log(`\nMethod: ${cfg.method}`);
  console.log(`Training samples: ${trainData.length}`);
  console.log(`Validation samples: ${valData.length}`);

  // Generate base model predictions
  const trainLogistic = trainData.map(d => predictLogistic(d.features, logisticModel));
  const trainGBM = trainData.map(d => predictGBM(d.features, gbmModel));
  const trainLabels = trainData.map(d => d.label);

  const valLogistic = valData.map(d => predictLogistic(d.features, logisticModel));
  const valGBM = valData.map(d => predictGBM(d.features, gbmModel));
  const valLabels = valData.map(d => d.label);

  // Calculate base model performance
  const logisticMetrics = evaluateLogistic(valData, logisticModel);
  const gbmMetrics = evaluateGBM(valData, gbmModel);

  console.log(`\nBase Model Performance:`);
  console.log(`  Logistic AUC: ${logisticMetrics.auc.toFixed(2)}%`);
  console.log(`  GBM AUC:      ${gbmMetrics.auc.toFixed(2)}%`);

  // Calculate feature statistics for meta-model
  const logisticMean = trainLogistic.reduce((a, b) => a + b, 0) / trainLogistic.length;
  const gbmMean = trainGBM.reduce((a, b) => a + b, 0) / trainGBM.length;
  const logisticStd = Math.sqrt(trainLogistic.reduce((s, v) => s + Math.pow(v - logisticMean, 2), 0) / trainLogistic.length) || 1;
  const gbmStd = Math.sqrt(trainGBM.reduce((s, v) => s + Math.pow(v - gbmMean, 2), 0) / trainGBM.length) || 1;

  let metaWeights: { logistic: number; gbm: number; intercept: number };

  if (cfg.method === 'simple_average') {
    metaWeights = { logistic: 0.5, gbm: 0.5, intercept: 0 };
    console.log(`\nUsing simple average (50/50 weights)`);
  } else if (cfg.method === 'weighted_average') {
    // Weight by AUC
    const total = logisticMetrics.auc + gbmMetrics.auc;
    metaWeights = {
      logistic: logisticMetrics.auc / total,
      gbm: gbmMetrics.auc / total,
      intercept: 0,
    };
    console.log(`\nUsing AUC-weighted average:`);
    console.log(`  Logistic weight: ${(metaWeights.logistic * 100).toFixed(1)}%`);
    console.log(`  GBM weight:      ${(metaWeights.gbm * 100).toFixed(1)}%`);
  } else {
    // Train meta-learner via gradient descent
    console.log(`\nTraining meta-learner...`);
    metaWeights = trainMetaLearner(
      trainLogistic,
      trainGBM,
      trainLabels,
      logisticMean,
      gbmMean,
      logisticStd,
      gbmStd,
      cfg.verbose || false
    );
    console.log(`\nLearned meta-weights:`);
    console.log(`  Logistic: ${metaWeights.logistic.toFixed(4)}`);
    console.log(`  GBM:      ${metaWeights.gbm.toFixed(4)}`);
    console.log(`  Intercept: ${metaWeights.intercept.toFixed(4)}`);
  }

  // Create stacked model
  const stackedModel: StackedModel = {
    logisticModel,
    gbmModel,
    metaWeights,
    metaFeatureMeans: { logistic: logisticMean, gbm: gbmMean },
    metaFeatureStds: { logistic: logisticStd, gbm: gbmStd },
    version: 'v1.0-stacked',
    trainedAt: new Date().toISOString(),
    trainingSamples: trainData.length,
  };

  // Evaluate stacked model
  const valMetrics = evaluateStackedModel(valData, stackedModel);
  const trainMetrics = evaluateStackedModel(trainData, stackedModel);

  stackedModel.metrics = {
    trainAuc: trainMetrics.auc,
    valAuc: valMetrics.auc,
    logisticAuc: logisticMetrics.auc,
    gbmAuc: gbmMetrics.auc,
  };

  // Results
  console.log('\n' + '-'.repeat(60));
  console.log('STACKING RESULTS');
  console.log('-'.repeat(60));
  console.log(`\n  | Model         | Val AUC   | Delta vs Best |`);
  console.log(`  |---------------|-----------|---------------|`);
  console.log(`  | Logistic      | ${logisticMetrics.auc.toFixed(2).padStart(7)}% |        --     |`);
  console.log(`  | GBM           | ${gbmMetrics.auc.toFixed(2).padStart(7)}% |        --     |`);

  const bestBase = Math.max(logisticMetrics.auc, gbmMetrics.auc);
  const stackedDelta = valMetrics.auc - bestBase;
  console.log(`  | STACKED       | ${valMetrics.auc.toFixed(2).padStart(7)}% |    ${stackedDelta >= 0 ? '+' : ''}${stackedDelta.toFixed(2)}%    |`);

  if (stackedDelta > 0) {
    console.log(`\n  ✓ Stacking improved AUC by ${stackedDelta.toFixed(2)}%`);
  } else {
    console.log(`\n  ✗ Stacking did not improve over best base model`);
  }

  return stackedModel;
}

/**
 * Train meta-learner weights via gradient descent
 */
function trainMetaLearner(
  logisticPreds: number[],
  gbmPreds: number[],
  labels: (0 | 1)[],
  logisticMean: number,
  gbmMean: number,
  logisticStd: number,
  gbmStd: number,
  verbose: boolean
): { logistic: number; gbm: number; intercept: number } {
  // Normalize predictions
  const normalizedLogistic = logisticPreds.map(p => (p - logisticMean) / logisticStd);
  const normalizedGBM = gbmPreds.map(p => (p - gbmMean) / gbmStd);

  // Initialize weights
  let wLogistic = 0.5;
  let wGBM = 0.5;
  let intercept = 0;

  const learningRate = 0.01;
  const iterations = 500;
  const regularization = 0.01;

  // Sigmoid function
  const sigmoid = (x: number): number => {
    if (x >= 0) return 1 / (1 + Math.exp(-x));
    const exp = Math.exp(x);
    return exp / (1 + exp);
  };

  for (let iter = 0; iter < iterations; iter++) {
    // Calculate gradients
    let interceptGrad = 0;
    let logisticGrad = 0;
    let gbmGrad = 0;

    for (let i = 0; i < labels.length; i++) {
      const z = intercept + wLogistic * normalizedLogistic[i] + wGBM * normalizedGBM[i];
      const pred = sigmoid(z);
      const error = pred - labels[i];

      interceptGrad += error;
      logisticGrad += error * normalizedLogistic[i];
      gbmGrad += error * normalizedGBM[i];
    }

    const n = labels.length;

    // Update with regularization
    intercept -= learningRate * (interceptGrad / n);
    wLogistic -= learningRate * (logisticGrad / n + regularization * wLogistic);
    wGBM -= learningRate * (gbmGrad / n + regularization * wGBM);

    if (verbose && iter % 100 === 0) {
      // Calculate loss
      let loss = 0;
      for (let i = 0; i < labels.length; i++) {
        const z = intercept + wLogistic * normalizedLogistic[i] + wGBM * normalizedGBM[i];
        const pred = Math.max(1e-10, Math.min(1 - 1e-10, sigmoid(z)));
        loss -= labels[i] * Math.log(pred) + (1 - labels[i]) * Math.log(1 - pred);
      }
      loss /= n;
      console.log(`    Iter ${iter}: Loss = ${loss.toFixed(4)}`);
    }
  }

  return { logistic: wLogistic, gbm: wGBM, intercept };
}

// ============================================
// PREDICTION
// ============================================

/**
 * Predict probability using stacked model
 */
export function predictStacked(
  features: FeatureVector,
  model: StackedModel
): number {
  // Get base model predictions
  const logisticPred = predictLogistic(features, model.logisticModel);
  const gbmPred = predictGBM(features, model.gbmModel);

  // Normalize
  const normLogistic = (logisticPred - model.metaFeatureMeans.logistic) / model.metaFeatureStds.logistic;
  const normGBM = (gbmPred - model.metaFeatureMeans.gbm) / model.metaFeatureStds.gbm;

  // Combine with meta-weights
  const z = model.metaWeights.intercept +
    model.metaWeights.logistic * normLogistic +
    model.metaWeights.gbm * normGBM;

  // Convert to probability (0-100 scale)
  const sigmoid = (x: number): number => {
    if (x >= 0) return 1 / (1 + Math.exp(-x));
    const exp = Math.exp(x);
    return exp / (1 + exp);
  };

  return sigmoid(z) * 100;
}

/**
 * Simple averaging prediction (no meta-learning)
 */
export function predictStackedSimple(
  features: FeatureVector,
  logisticModel: ModelCoefficients,
  gbmModel: GBMModel,
  logisticWeight: number = 0.5
): number {
  const logisticPred = predictLogistic(features, logisticModel);
  const gbmPred = predictGBM(features, gbmModel);

  return logisticWeight * logisticPred + (1 - logisticWeight) * gbmPred;
}

// ============================================
// EVALUATION
// ============================================

/**
 * Evaluate stacked model
 */
export function evaluateStackedModel(
  testData: TrainingExample[],
  model: StackedModel
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
    const prob = predictStacked(example.features, model);
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

  // AUC
  const sorted = [...predictions].sort((a, b) => b.prob - a.prob);
  const totalPos = sorted.filter(p => p.label === 1).length;
  const totalNeg = sorted.filter(p => p.label === 0).length;

  let auc = 0.5;
  if (totalPos > 0 && totalNeg > 0) {
    auc = 0;
    let tpCount = 0;
    let fpCount = 0;
    let prevFPR = 0;
    let prevTPR = 0;

    for (const pred of sorted) {
      if (pred.label === 1) tpCount++;
      else fpCount++;

      const tpr = tpCount / totalPos;
      const fpr = fpCount / totalNeg;
      auc += (fpr - prevFPR) * (tpr + prevTPR) / 2;
      prevTPR = tpr;
      prevFPR = fpr;
    }
  }

  // Calibration error
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
  const calibrationError = totalCount > 0 ? totalError / totalCount : 0;

  return {
    accuracy: accuracy * 100,
    precision: precision * 100,
    recall: recall * 100,
    f1Score: f1Score * 100,
    auc: auc * 100,
    calibrationError,
  };
}

// ============================================
// SERIALIZATION
// ============================================

/**
 * Serialize stacked model (without base models, just weights)
 */
export function serializeStackedModelWeights(model: StackedModel): string {
  const weights = {
    metaWeights: model.metaWeights,
    metaFeatureMeans: model.metaFeatureMeans,
    metaFeatureStds: model.metaFeatureStds,
    calibration: model.calibration,
    version: model.version,
    trainedAt: model.trainedAt,
    trainingSamples: model.trainingSamples,
    metrics: model.metrics,
  };
  return JSON.stringify(weights, null, 2);
}

/**
 * Create stacked model from weights and base models
 */
export function createStackedModelFromWeights(
  weights: {
    metaWeights: { logistic: number; gbm: number; intercept: number };
    metaFeatureMeans: { logistic: number; gbm: number };
    metaFeatureStds: { logistic: number; gbm: number };
    version: string;
    trainedAt: string;
    trainingSamples: number;
    metrics?: { trainAuc?: number; valAuc?: number; logisticAuc?: number; gbmAuc?: number };
  },
  logisticModel: ModelCoefficients,
  gbmModel: GBMModel
): StackedModel {
  return {
    logisticModel,
    gbmModel,
    metaWeights: weights.metaWeights,
    metaFeatureMeans: weights.metaFeatureMeans,
    metaFeatureStds: weights.metaFeatureStds,
    version: weights.version,
    trainedAt: weights.trainedAt,
    trainingSamples: weights.trainingSamples,
    metrics: weights.metrics,
  };
}

// ============================================
// COMPARISON UTILITIES
// ============================================

/**
 * Compare all models and return best one
 */
export function compareAllModels(
  valData: TrainingExample[],
  logisticModel: ModelCoefficients,
  gbmModel: GBMModel,
  stackedModel: StackedModel
): {
  best: 'logistic' | 'gbm' | 'stacked';
  results: {
    logistic: { auc: number; calibration: number };
    gbm: { auc: number; calibration: number };
    stacked: { auc: number; calibration: number };
  };
} {
  const logisticMetrics = evaluateLogistic(valData, logisticModel);
  const gbmMetrics = evaluateGBM(valData, gbmModel);
  const stackedMetrics = evaluateStackedModel(valData, stackedModel);

  const results = {
    logistic: { auc: logisticMetrics.auc, calibration: logisticMetrics.calibrationError },
    gbm: { auc: gbmMetrics.auc, calibration: gbmMetrics.calibrationError },
    stacked: { auc: stackedMetrics.auc, calibration: stackedMetrics.calibrationError },
  };

  let best: 'logistic' | 'gbm' | 'stacked' = 'logistic';
  let bestAuc = results.logistic.auc;

  if (results.gbm.auc > bestAuc) {
    best = 'gbm';
    bestAuc = results.gbm.auc;
  }

  if (results.stacked.auc > bestAuc) {
    best = 'stacked';
  }

  return { best, results };
}
