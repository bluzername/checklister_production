/**
 * Gradient Boosting Implementation
 * Pure JavaScript implementation for binary classification
 *
 * Features:
 * - Decision tree weak learners
 * - Binary cross-entropy loss (log loss)
 * - Feature importance calculation
 * - Supports regularization (shrinkage, max_depth, min_samples)
 */

import { FeatureVector } from '../backtest/types';
import { TrainingExample } from '../model/logistic';

// ============================================
// TYPES
// ============================================

/**
 * Decision tree node
 */
interface TreeNode {
  isLeaf: boolean;
  prediction?: number;      // Leaf value (gradient)
  feature?: string;         // Split feature
  threshold?: number;       // Split threshold
  left?: TreeNode;          // Left child (feature <= threshold)
  right?: TreeNode;         // Right child (feature > threshold)
  gain?: number;            // Information gain at this split
  samples?: number;         // Number of samples at this node
}

/**
 * Decision tree model
 */
interface DecisionTree {
  root: TreeNode;
  maxDepth: number;
  minSamplesLeaf: number;
  featureImportance: Record<string, number>;
}

/**
 * Gradient Boosting Model
 */
export interface GBMModel {
  trees: DecisionTree[];
  learningRate: number;
  baseScore: number;           // Initial prediction (log odds)
  featureImportance: Record<string, number>;
  featureMeans: Record<string, number>;
  featureStds: Record<string, number>;
  version: string;
  trainedAt: string;
  trainingSamples: number;
  config: GBMConfig;
  metrics?: {
    trainAuc?: number;
    valAuc?: number;
    trainLoss?: number;
    valLoss?: number;
  };
}

/**
 * GBM Training Configuration
 */
export interface GBMConfig {
  numTrees: number;           // Number of boosting iterations
  maxDepth: number;           // Max tree depth (3-6 recommended)
  learningRate: number;       // Shrinkage factor (0.01-0.1)
  subsample: number;          // Row sampling ratio (0.8 typical)
  colsample: number;          // Column sampling ratio (0.8 typical)
  minSamplesLeaf: number;     // Min samples per leaf
  minSamplesSplit: number;    // Min samples to split
  l2Regularization: number;   // L2 regularization on leaf weights
  seed?: number;              // Random seed
  earlyStoppingRounds?: number; // Stop if no improvement for N rounds
  verbose?: boolean;
}

export const DEFAULT_GBM_CONFIG: GBMConfig = {
  numTrees: 100,
  maxDepth: 4,
  learningRate: 0.1,
  subsample: 0.8,
  colsample: 0.8,
  minSamplesLeaf: 10,
  minSamplesSplit: 20,
  l2Regularization: 1.0,
  seed: 42,
  earlyStoppingRounds: 10,
  verbose: true,
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Seeded random number generator
 */
function seededRandom(seed: number): () => number {
  return function() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

/**
 * Sigmoid function
 */
function sigmoid(x: number): number {
  if (x >= 0) {
    return 1 / (1 + Math.exp(-x));
  } else {
    const exp = Math.exp(x);
    return exp / (1 + exp);
  }
}

/**
 * Calculate log loss
 */
function logLoss(y: number, p: number): number {
  const eps = 1e-15;
  p = Math.max(eps, Math.min(1 - eps, p));
  return -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
}

/**
 * Compute feature statistics for normalization
 */
function computeFeatureStats(
  data: TrainingExample[]
): { means: Record<string, number>; stds: Record<string, number> } {
  if (data.length === 0) {
    return { means: {}, stds: {} };
  }

  const featureKeys = Object.keys(data[0].features);
  const means: Record<string, number> = {};
  const stds: Record<string, number> = {};

  for (const key of featureKeys) {
    const values = data.map(d => d.features[key as keyof FeatureVector]);
    means[key] = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - means[key], 2), 0) / values.length;
    stds[key] = Math.sqrt(variance) || 1;
  }

  return { means, stds };
}

/**
 * Subsample data with replacement
 */
function subsampleData(
  data: { features: Record<string, number>; gradient: number; hessian: number }[],
  ratio: number,
  random: () => number
): typeof data {
  const n = Math.floor(data.length * ratio);
  const sampled: typeof data = [];

  for (let i = 0; i < n; i++) {
    const idx = Math.floor(random() * data.length);
    sampled.push(data[idx]);
  }

  return sampled;
}

/**
 * Subsample features
 */
function subsampleFeatures(
  featureKeys: string[],
  ratio: number,
  random: () => number
): string[] {
  const n = Math.max(1, Math.floor(featureKeys.length * ratio));
  const shuffled = [...featureKeys].sort(() => random() - 0.5);
  return shuffled.slice(0, n);
}

// ============================================
// DECISION TREE
// ============================================

/**
 * Find best split for a node
 */
function findBestSplit(
  data: { features: Record<string, number>; gradient: number; hessian: number }[],
  featureKeys: string[],
  minSamplesLeaf: number,
  l2Reg: number
): { feature: string; threshold: number; gain: number } | null {
  if (data.length < minSamplesLeaf * 2) {
    return null;
  }

  let bestGain = 0;
  let bestFeature = '';
  let bestThreshold = 0;

  // Sum of gradients and hessians for current node
  const sumG = data.reduce((s, d) => s + d.gradient, 0);
  const sumH = data.reduce((s, d) => s + d.hessian, 0);
  const currentScore = (sumG * sumG) / (sumH + l2Reg);

  for (const feature of featureKeys) {
    // Sort data by feature value
    const sorted = [...data].sort((a, b) => a.features[feature] - b.features[feature]);

    // Accumulate left side statistics
    let leftG = 0;
    let leftH = 0;

    // Try each possible split
    for (let i = 0; i < sorted.length - minSamplesLeaf; i++) {
      leftG += sorted[i].gradient;
      leftH += sorted[i].hessian;

      // Skip if not enough samples on left
      if (i + 1 < minSamplesLeaf) continue;

      // Skip if values are the same
      if (i < sorted.length - 1 && sorted[i].features[feature] === sorted[i + 1].features[feature]) {
        continue;
      }

      const rightG = sumG - leftG;
      const rightH = sumH - leftH;

      // Skip if not enough samples on right
      if (sorted.length - i - 1 < minSamplesLeaf) continue;

      // Calculate gain
      const leftScore = (leftG * leftG) / (leftH + l2Reg);
      const rightScore = (rightG * rightG) / (rightH + l2Reg);
      const gain = leftScore + rightScore - currentScore;

      if (gain > bestGain) {
        bestGain = gain;
        bestFeature = feature;
        bestThreshold = (sorted[i].features[feature] + sorted[i + 1].features[feature]) / 2;
      }
    }
  }

  if (bestGain <= 0) {
    return null;
  }

  return { feature: bestFeature, threshold: bestThreshold, gain: bestGain };
}

/**
 * Calculate leaf prediction (optimal leaf weight)
 */
function calculateLeafPrediction(
  data: { gradient: number; hessian: number }[],
  l2Reg: number
): number {
  const sumG = data.reduce((s, d) => s + d.gradient, 0);
  const sumH = data.reduce((s, d) => s + d.hessian, 0);
  return -sumG / (sumH + l2Reg);
}

/**
 * Build a decision tree recursively
 */
function buildTree(
  data: { features: Record<string, number>; gradient: number; hessian: number }[],
  featureKeys: string[],
  depth: number,
  maxDepth: number,
  minSamplesLeaf: number,
  minSamplesSplit: number,
  l2Reg: number,
  featureImportance: Record<string, number>
): TreeNode {
  // Create leaf if max depth reached or not enough samples
  if (depth >= maxDepth || data.length < minSamplesSplit) {
    return {
      isLeaf: true,
      prediction: calculateLeafPrediction(data, l2Reg),
      samples: data.length,
    };
  }

  // Find best split
  const split = findBestSplit(data, featureKeys, minSamplesLeaf, l2Reg);

  if (!split) {
    return {
      isLeaf: true,
      prediction: calculateLeafPrediction(data, l2Reg),
      samples: data.length,
    };
  }

  // Update feature importance
  featureImportance[split.feature] = (featureImportance[split.feature] || 0) + split.gain * data.length;

  // Split data
  const leftData = data.filter(d => d.features[split.feature] <= split.threshold);
  const rightData = data.filter(d => d.features[split.feature] > split.threshold);

  // Recursively build children
  return {
    isLeaf: false,
    feature: split.feature,
    threshold: split.threshold,
    gain: split.gain,
    samples: data.length,
    left: buildTree(leftData, featureKeys, depth + 1, maxDepth, minSamplesLeaf, minSamplesSplit, l2Reg, featureImportance),
    right: buildTree(rightData, featureKeys, depth + 1, maxDepth, minSamplesLeaf, minSamplesSplit, l2Reg, featureImportance),
  };
}

/**
 * Predict with a single tree
 */
function predictTree(features: Record<string, number>, node: TreeNode): number {
  if (node.isLeaf) {
    return node.prediction || 0;
  }

  const featureValue = features[node.feature!];
  if (featureValue <= node.threshold!) {
    return predictTree(features, node.left!);
  } else {
    return predictTree(features, node.right!);
  }
}

// ============================================
// GRADIENT BOOSTING TRAINING
// ============================================

/**
 * Train a Gradient Boosting Model
 */
export function trainGBM(
  trainingData: TrainingExample[],
  validationData: TrainingExample[] = [],
  config: Partial<GBMConfig> = {}
): GBMModel {
  const cfg: GBMConfig = { ...DEFAULT_GBM_CONFIG, ...config };
  const random = seededRandom(cfg.seed || 42);

  console.log('='.repeat(60));
  console.log('GRADIENT BOOSTING TRAINING');
  console.log('='.repeat(60));
  console.log(`\nConfiguration:`);
  console.log(`  Trees: ${cfg.numTrees}`);
  console.log(`  Max Depth: ${cfg.maxDepth}`);
  console.log(`  Learning Rate: ${cfg.learningRate}`);
  console.log(`  Subsample: ${cfg.subsample}`);
  console.log(`  Col Sample: ${cfg.colsample}`);
  console.log(`  L2 Reg: ${cfg.l2Regularization}`);
  console.log(`  Min Samples Leaf: ${cfg.minSamplesLeaf}`);
  console.log(`  Early Stopping: ${cfg.earlyStoppingRounds} rounds`);
  console.log(`\n  Training samples: ${trainingData.length}`);
  console.log(`  Validation samples: ${validationData.length}`);

  // Compute feature statistics
  const { means, stds } = computeFeatureStats(trainingData);
  const featureKeys = Object.keys(trainingData[0].features);

  // Calculate base score (log odds of positive class)
  const posCount = trainingData.filter(d => d.label === 1).length;
  const baseProb = posCount / trainingData.length;
  const baseScore = Math.log(baseProb / (1 - baseProb));

  console.log(`\n  Positive rate: ${(baseProb * 100).toFixed(1)}%`);
  console.log(`  Base score: ${baseScore.toFixed(4)}`);

  // Initialize predictions with base score
  const trainPreds = new Array(trainingData.length).fill(baseScore);
  const valPreds = new Array(validationData.length).fill(baseScore);

  // Normalize features
  const normalizeFeatures = (features: FeatureVector): Record<string, number> => {
    const normalized: Record<string, number> = {};
    for (const key of featureKeys) {
      const value = features[key as keyof FeatureVector];
      normalized[key] = stds[key] > 0 ? (value - means[key]) / stds[key] : 0;
    }
    return normalized;
  };

  const normalizedTrain = trainingData.map(d => ({
    features: normalizeFeatures(d.features),
    label: d.label,
  }));

  const normalizedVal = validationData.map(d => ({
    features: normalizeFeatures(d.features),
    label: d.label,
  }));

  // Train trees
  const trees: DecisionTree[] = [];
  const featureImportance: Record<string, number> = {};

  let bestValLoss = Infinity;
  let roundsWithoutImprovement = 0;

  console.log('\nTraining progress:');
  console.log('-'.repeat(60));

  for (let t = 0; t < cfg.numTrees; t++) {
    // Calculate gradients and hessians
    const trainGradHess = normalizedTrain.map((d, i) => {
      const p = sigmoid(trainPreds[i]);
      const gradient = p - d.label;      // First derivative of log loss
      const hessian = p * (1 - p);       // Second derivative of log loss
      return { features: d.features, gradient, hessian };
    });

    // Subsample data
    const sampledData = subsampleData(trainGradHess, cfg.subsample, random);

    // Subsample features
    const sampledFeatures = subsampleFeatures(featureKeys, cfg.colsample, random);

    // Build tree
    const treeImportance: Record<string, number> = {};
    const root = buildTree(
      sampledData,
      sampledFeatures,
      0,
      cfg.maxDepth,
      cfg.minSamplesLeaf,
      cfg.minSamplesSplit,
      cfg.l2Regularization,
      treeImportance
    );

    const tree: DecisionTree = {
      root,
      maxDepth: cfg.maxDepth,
      minSamplesLeaf: cfg.minSamplesLeaf,
      featureImportance: treeImportance,
    };

    trees.push(tree);

    // Update predictions
    for (let i = 0; i < normalizedTrain.length; i++) {
      trainPreds[i] += cfg.learningRate * predictTree(normalizedTrain[i].features, root);
    }

    for (let i = 0; i < normalizedVal.length; i++) {
      valPreds[i] += cfg.learningRate * predictTree(normalizedVal[i].features, root);
    }

    // Accumulate feature importance
    for (const [feat, imp] of Object.entries(treeImportance)) {
      featureImportance[feat] = (featureImportance[feat] || 0) + imp;
    }

    // Calculate losses
    const trainLoss = normalizedTrain.reduce((sum, d, i) =>
      sum + logLoss(d.label, sigmoid(trainPreds[i])), 0) / normalizedTrain.length;

    let valLoss = 0;
    if (normalizedVal.length > 0) {
      valLoss = normalizedVal.reduce((sum, d, i) =>
        sum + logLoss(d.label, sigmoid(valPreds[i])), 0) / normalizedVal.length;
    }

    // Log progress
    if (cfg.verbose && (t % 10 === 0 || t === cfg.numTrees - 1)) {
      const trainAuc = calculateAUCFromPreds(trainPreds, normalizedTrain.map(d => d.label));
      let valAucStr = 'N/A';
      if (normalizedVal.length > 0) {
        const valAuc = calculateAUCFromPreds(valPreds, normalizedVal.map(d => d.label));
        valAucStr = `${(valAuc * 100).toFixed(2)}%`;
      }
      console.log(`  Tree ${t + 1}/${cfg.numTrees} | Train Loss: ${trainLoss.toFixed(4)} | Val Loss: ${valLoss.toFixed(4)} | Train AUC: ${(trainAuc * 100).toFixed(2)}% | Val AUC: ${valAucStr}`);
    }

    // Early stopping
    if (normalizedVal.length > 0 && cfg.earlyStoppingRounds) {
      if (valLoss < bestValLoss - 0.0001) {
        bestValLoss = valLoss;
        roundsWithoutImprovement = 0;
      } else {
        roundsWithoutImprovement++;
        if (roundsWithoutImprovement >= cfg.earlyStoppingRounds) {
          console.log(`\n  Early stopping at tree ${t + 1} (no improvement for ${cfg.earlyStoppingRounds} rounds)`);
          break;
        }
      }
    }
  }

  // Normalize feature importance
  const totalImportance = Object.values(featureImportance).reduce((a, b) => a + b, 0);
  if (totalImportance > 0) {
    for (const key of Object.keys(featureImportance)) {
      featureImportance[key] /= totalImportance;
    }
  }

  // Calculate final metrics
  const trainAuc = calculateAUCFromPreds(trainPreds, normalizedTrain.map(d => d.label));
  let valAuc = 0;
  if (normalizedVal.length > 0) {
    valAuc = calculateAUCFromPreds(valPreds, normalizedVal.map(d => d.label));
  }

  const trainLoss = normalizedTrain.reduce((sum, d, i) =>
    sum + logLoss(d.label, sigmoid(trainPreds[i])), 0) / normalizedTrain.length;

  let valLoss = 0;
  if (normalizedVal.length > 0) {
    valLoss = normalizedVal.reduce((sum, d, i) =>
      sum + logLoss(d.label, sigmoid(valPreds[i])), 0) / normalizedVal.length;
  }

  console.log('\n' + '-'.repeat(60));
  console.log('Training Complete!');
  console.log(`  Trees trained: ${trees.length}`);
  console.log(`  Final Train AUC: ${(trainAuc * 100).toFixed(2)}%`);
  console.log(`  Final Val AUC: ${(valAuc * 100).toFixed(2)}%`);
  console.log(`  Final Train Loss: ${trainLoss.toFixed(4)}`);
  console.log(`  Final Val Loss: ${valLoss.toFixed(4)}`);

  return {
    trees,
    learningRate: cfg.learningRate,
    baseScore,
    featureImportance,
    featureMeans: means,
    featureStds: stds,
    version: 'v1.0-gbm',
    trainedAt: new Date().toISOString(),
    trainingSamples: trainingData.length,
    config: cfg,
    metrics: {
      trainAuc: trainAuc * 100,
      valAuc: valAuc * 100,
      trainLoss,
      valLoss,
    },
  };
}

/**
 * Calculate AUC from predictions
 */
function calculateAUCFromPreds(preds: number[], labels: (0 | 1)[]): number {
  const sorted = preds.map((p, i) => ({ pred: sigmoid(p), label: labels[i] }))
    .sort((a, b) => b.pred - a.pred);

  const totalPos = sorted.filter(s => s.label === 1).length;
  const totalNeg = sorted.filter(s => s.label === 0).length;

  if (totalPos === 0 || totalNeg === 0) return 0.5;

  let auc = 0;
  let tpCount = 0;
  let fpCount = 0;
  let prevFPR = 0;
  let prevTPR = 0;

  for (const s of sorted) {
    if (s.label === 1) {
      tpCount++;
    } else {
      fpCount++;
    }
    const tpr = tpCount / totalPos;
    const fpr = fpCount / totalNeg;
    auc += (fpr - prevFPR) * (tpr + prevTPR) / 2;
    prevTPR = tpr;
    prevFPR = fpr;
  }

  return auc;
}

// ============================================
// PREDICTION
// ============================================

/**
 * Predict probability using GBM
 */
export function predictGBM(
  features: FeatureVector,
  model: GBMModel
): number {
  // Normalize features
  const normalized: Record<string, number> = {};
  for (const key of Object.keys(features)) {
    const value = features[key as keyof FeatureVector];
    const mean = model.featureMeans[key] || 0;
    const std = model.featureStds[key] || 1;
    normalized[key] = std > 0 ? (value - mean) / std : 0;
  }

  // Sum tree predictions
  let score = model.baseScore;
  for (const tree of model.trees) {
    score += model.learningRate * predictTree(normalized, tree.root);
  }

  // Convert to probability (0-100 scale)
  return sigmoid(score) * 100;
}

/**
 * Get feature importance from GBM
 */
export function getGBMFeatureImportance(
  model: GBMModel
): { feature: string; importance: number }[] {
  return Object.entries(model.featureImportance)
    .map(([feature, importance]) => ({ feature, importance }))
    .sort((a, b) => b.importance - a.importance);
}

// ============================================
// EVALUATION
// ============================================

/**
 * Evaluate GBM on test data
 */
export function evaluateGBM(
  testData: TrainingExample[],
  model: GBMModel
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
    const prob = predictGBM(example.features, model);
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
 * Serialize GBM model to JSON
 */
export function serializeGBM(model: GBMModel): string {
  return JSON.stringify(model, null, 2);
}

/**
 * Deserialize GBM model from JSON
 */
export function deserializeGBM(json: string): GBMModel {
  return JSON.parse(json) as GBMModel;
}

// ============================================
// CROSS-VALIDATION
// ============================================

/**
 * Run k-fold cross-validation for GBM
 */
export function crossValidateGBM(
  data: TrainingExample[],
  k: number = 5,
  config: Partial<GBMConfig> = {}
): {
  aucMean: number;
  aucStd: number;
  foldResults: { fold: number; auc: number; trainAuc: number }[];
} {
  console.log(`\nRunning ${k}-fold Cross-Validation for GBM...`);

  const foldSize = Math.floor(data.length / k);
  const foldResults: { fold: number; auc: number; trainAuc: number }[] = [];

  for (let fold = 0; fold < k; fold++) {
    const valStart = fold * foldSize;
    const valEnd = fold === k - 1 ? data.length : (fold + 1) * foldSize;

    const valData = data.slice(valStart, valEnd);
    const trainData = [...data.slice(0, valStart), ...data.slice(valEnd)];

    console.log(`\nFold ${fold + 1}/${k}: Train=${trainData.length}, Val=${valData.length}`);

    // Train GBM with reduced verbosity
    const model = trainGBM(trainData, valData, { ...config, verbose: false });

    // Evaluate
    const metrics = evaluateGBM(valData, model);
    const trainMetrics = evaluateGBM(trainData, model);

    foldResults.push({
      fold: fold + 1,
      auc: metrics.auc,
      trainAuc: trainMetrics.auc,
    });

    console.log(`  Val AUC: ${metrics.auc.toFixed(2)}%, Train AUC: ${trainMetrics.auc.toFixed(2)}%`);
  }

  const aucs = foldResults.map(f => f.auc);
  const aucMean = aucs.reduce((a, b) => a + b, 0) / aucs.length;
  const aucStd = Math.sqrt(aucs.reduce((sum, auc) => sum + Math.pow(auc - aucMean, 2), 0) / aucs.length);

  console.log(`\nCV Results: AUC = ${aucMean.toFixed(2)}% ± ${aucStd.toFixed(2)}%`);

  return { aucMean, aucStd, foldResults };
}
