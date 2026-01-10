#!/usr/bin/env npx ts-node
/**
 * Train Model v2 - With Improved Features
 *
 * Trains a logistic regression model on the improved 40-feature dataset.
 * Evaluates AUC improvement over v1 (21 features).
 *
 * Usage:
 *   npx ts-node scripts/train-model-v2.ts
 *
 * Created: 2025-12-16
 */

import * as fs from 'fs';

// ============================================
// TYPES
// ============================================

interface Sample {
  ticker: string;
  signalDate: string;
  features: Record<string, number>;
  label: 0 | 1;
  realizedR: number;
  exitReason: string;
}

interface DataFile {
  metadata: {
    version: string;
    features: string[];
    featureStats: Record<string, { mean: number; std: number; min: number; max: number }>;
  };
  samples: Sample[];
}

interface ModelCoefficients {
  intercept: number;
  weights: Record<string, number>;
  featureMeans: Record<string, number>;
  featureStds: Record<string, number>;
}

// ============================================
// METRICS
// ============================================

function sigmoid(z: number): number {
  if (z < -500) return 0;
  if (z > 500) return 1;
  return 1 / (1 + Math.exp(-z));
}

function calculateAUC(predictions: number[], labels: number[]): number {
  const pairs: Array<{ pred: number; label: number }> = predictions.map((pred, i) => ({
    pred,
    label: labels[i],
  }));

  // Sort by prediction descending
  pairs.sort((a, b) => b.pred - a.pred);

  let positives = 0;
  let negatives = 0;
  let auc = 0;

  for (const { label } of pairs) {
    if (label === 1) {
      positives++;
    } else {
      negatives++;
      auc += positives;
    }
  }

  if (positives === 0 || negatives === 0) return 0.5;
  return auc / (positives * negatives);
}

function calculateMetrics(predictions: number[], labels: number[], threshold: number = 0.5): {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  auc: number;
} {
  let tp = 0, fp = 0, tn = 0, fn = 0;

  for (let i = 0; i < predictions.length; i++) {
    const pred = predictions[i] >= threshold ? 1 : 0;
    const actual = labels[i];

    if (pred === 1 && actual === 1) tp++;
    else if (pred === 1 && actual === 0) fp++;
    else if (pred === 0 && actual === 0) tn++;
    else fn++;
  }

  const accuracy = (tp + tn) / (tp + tn + fp + fn);
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
  const auc = calculateAUC(predictions, labels);

  return { accuracy, precision, recall, f1, auc };
}

// ============================================
// TRAINING
// ============================================

function trainLogisticRegression(
  X: number[][],
  y: number[],
  featureNames: string[],
  learningRate: number = 0.1,
  iterations: number = 1000,
  regularization: number = 0.01,
  classWeight: number = 1.5 // Weight for positive class
): ModelCoefficients {
  const n = X.length;
  const m = X[0].length;

  // Initialize weights
  let weights = new Array(m).fill(0);
  let intercept = 0;

  // Compute feature means and stds
  const featureMeans: number[] = [];
  const featureStds: number[] = [];

  for (let j = 0; j < m; j++) {
    const values = X.map(row => row[j]);
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / n;
    const std = Math.sqrt(variance);

    featureMeans.push(mean);
    featureStds.push(std > 0.0001 ? std : 1);
  }

  // Normalize features
  const X_norm = X.map(row =>
    row.map((val, j) => (val - featureMeans[j]) / featureStds[j])
  );

  // Gradient descent
  for (let iter = 0; iter < iterations; iter++) {
    let gradWeights = new Array(m).fill(0);
    let gradIntercept = 0;

    for (let i = 0; i < n; i++) {
      const z = intercept + X_norm[i].reduce((acc, x, j) => acc + x * weights[j], 0);
      const pred = sigmoid(z);
      const error = pred - y[i];

      // Apply class weight
      const weight = y[i] === 1 ? classWeight : 1;

      gradIntercept += error * weight;
      for (let j = 0; j < m; j++) {
        gradWeights[j] += error * X_norm[i][j] * weight;
      }
    }

    // Update with regularization
    intercept -= (learningRate / n) * gradIntercept;
    for (let j = 0; j < m; j++) {
      weights[j] -= (learningRate / n) * (gradWeights[j] + regularization * weights[j]);
    }
  }

  // Convert to named format
  const weightsMap: Record<string, number> = {};
  const meansMap: Record<string, number> = {};
  const stdsMap: Record<string, number> = {};

  for (let j = 0; j < m; j++) {
    weightsMap[featureNames[j]] = weights[j];
    meansMap[featureNames[j]] = featureMeans[j];
    stdsMap[featureNames[j]] = featureStds[j];
  }

  return {
    intercept,
    weights: weightsMap,
    featureMeans: meansMap,
    featureStds: stdsMap,
  };
}

function predict(
  features: Record<string, number>,
  coefficients: ModelCoefficients
): number {
  let z = coefficients.intercept;

  for (const [name, weight] of Object.entries(coefficients.weights)) {
    const value = features[name] ?? 0;
    const mean = coefficients.featureMeans[name] ?? 0;
    const std = coefficients.featureStds[name] ?? 1;
    const normalized = std > 0.0001 ? (value - mean) / std : 0;
    z += weight * normalized;
  }

  return sigmoid(z);
}

// ============================================
// MAIN
// ============================================

async function main(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('TRAINING MODEL v2 (40 IMPROVED FEATURES)');
  console.log('='.repeat(60));

  // Load v2 dataset
  const dataPath = 'data/training-50k-v2.json';
  if (!fs.existsSync(dataPath)) {
    console.error(`\n[ERROR] Dataset not found: ${dataPath}`);
    console.error('Run: npm run train:offline:v2:50k');
    process.exit(1);
  }

  console.log(`\nLoading dataset from ${dataPath}...`);
  const data: DataFile = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  const featureNames = data.metadata.features;
  console.log(`  Samples: ${data.samples.length.toLocaleString()}`);
  console.log(`  Features: ${featureNames.length}`);
  console.log(`  Version: ${data.metadata.version}`);

  // Split data: 70% train, 15% validation, 15% test
  const shuffled = [...data.samples].sort(() => Math.random() - 0.5);
  const trainEnd = Math.floor(shuffled.length * 0.70);
  const valEnd = Math.floor(shuffled.length * 0.85);

  const trainSamples = shuffled.slice(0, trainEnd);
  const valSamples = shuffled.slice(trainEnd, valEnd);
  const testSamples = shuffled.slice(valEnd);

  console.log(`\nData splits:`);
  console.log(`  Train: ${trainSamples.length.toLocaleString()} (${(trainSamples.filter(s => s.label === 1).length / trainSamples.length * 100).toFixed(1)}% wins)`);
  console.log(`  Validation: ${valSamples.length.toLocaleString()} (${(valSamples.filter(s => s.label === 1).length / valSamples.length * 100).toFixed(1)}% wins)`);
  console.log(`  Test: ${testSamples.length.toLocaleString()} (${(testSamples.filter(s => s.label === 1).length / testSamples.length * 100).toFixed(1)}% wins)`);

  // Prepare training data
  const X_train = trainSamples.map(s => featureNames.map(f => s.features[f] ?? 0));
  const y_train = trainSamples.map(s => s.label);

  // Train model
  console.log(`\nTraining logistic regression...`);
  const startTime = Date.now();

  const coefficients = trainLogisticRegression(
    X_train,
    y_train,
    featureNames,
    0.1,    // learning rate
    1000,   // iterations
    0.01,   // regularization
    1.5     // class weight for wins
  );

  const trainDuration = (Date.now() - startTime) / 1000;
  console.log(`  Training time: ${trainDuration.toFixed(2)}s`);

  // Evaluate on all splits
  console.log('\n' + '-'.repeat(60));
  console.log('EVALUATION RESULTS');
  console.log('-'.repeat(60));

  const evaluateSplit = (samples: Sample[], name: string) => {
    const predictions = samples.map(s => predict(s.features, coefficients));
    const labels = samples.map(s => s.label);
    const metrics = calculateMetrics(predictions, labels);

    console.log(`\n${name}:`);
    console.log(`  AUC:       ${metrics.auc.toFixed(4)}`);
    console.log(`  Accuracy:  ${(metrics.accuracy * 100).toFixed(1)}%`);
    console.log(`  Precision: ${(metrics.precision * 100).toFixed(1)}%`);
    console.log(`  Recall:    ${(metrics.recall * 100).toFixed(1)}%`);
    console.log(`  F1:        ${(metrics.f1 * 100).toFixed(1)}%`);

    return metrics;
  };

  evaluateSplit(trainSamples, 'TRAIN');
  const valMetrics = evaluateSplit(valSamples, 'VALIDATION');
  const testMetrics = evaluateSplit(testSamples, 'TEST (HOLDOUT)');

  // Feature importance
  console.log('\n' + '-'.repeat(60));
  console.log('TOP 15 FEATURE IMPORTANCE (by |coefficient|)');
  console.log('-'.repeat(60));

  const sortedFeatures = Object.entries(coefficients.weights)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 15);

  for (const [name, weight] of sortedFeatures) {
    const sign = weight >= 0 ? '+' : '';
    console.log(`  ${name.padEnd(25)} ${sign}${weight.toFixed(4)}`);
  }

  // Compare with v1
  console.log('\n' + '='.repeat(60));
  console.log('COMPARISON: v1 (21 features) vs v2 (40 features)');
  console.log('='.repeat(60));
  console.log(`\n  v1 Holdout AUC:    ~0.525 (from analysis)`);
  console.log(`  v2 Holdout AUC:    ${testMetrics.auc.toFixed(4)}`);
  console.log(`  Improvement:       ${testMetrics.auc > 0.525 ? '+' : ''}${((testMetrics.auc - 0.525) * 100).toFixed(2)} percentage points`);

  if (testMetrics.auc > 0.55) {
    console.log('\n  ✅ Meaningful improvement! Consider trying GBM next.');
  } else if (testMetrics.auc > 0.525) {
    console.log('\n  ⚠️  Marginal improvement. More feature work needed.');
  } else {
    console.log('\n  ❌ No improvement. Features still lack predictive power.');
  }

  // Save model
  const modelOutput = {
    version: '2.0-improved-40features',
    trainedAt: new Date().toISOString(),
    trainingSamples: trainSamples.length,
    features: featureNames,
    coefficients,
    metrics: {
      train: evaluateSplit(trainSamples, '(computed)'),
      validation: valMetrics,
      holdout: testMetrics,
    },
    config: {
      learningRate: 0.1,
      iterations: 1000,
      regularization: 0.01,
      classWeight: 1.5,
    },
  };

  const outputPath = 'data/model-v2.json';
  fs.writeFileSync(outputPath, JSON.stringify(modelOutput, null, 2));
  console.log(`\nModel saved to ${outputPath}`);

  // Feature correlation analysis for new features
  console.log('\n' + '-'.repeat(60));
  console.log('NEW FEATURE CORRELATIONS WITH LABEL');
  console.log('-'.repeat(60));

  const newFeatures = [
    'momAccel5', 'momAccel10', 'volRegime', 'meanRevScore',
    'trendConsistency5', 'trendConsistency10',
    'oversoldBounce', 'overboughtWarning', 'trendWithMom',
    'pullbackInUptrend', 'breakoutWithVol', 'lowVolBreakout',
    'highVolConsolidation', 'acceleratingUp', 'deceleratingDown',
    'spyTrend', 'spyMomentum', 'spyVolRegime', 'relativeStrength',
  ];

  for (const feat of newFeatures) {
    if (!featureNames.includes(feat)) continue;

    const values = data.samples.map(s => s.features[feat] ?? 0);
    const labels = data.samples.map(s => s.label);

    const meanValue = values.reduce((a, b) => a + b, 0) / values.length;
    const meanLabel = (labels as number[]).reduce((a, b) => a + b, 0) / labels.length;

    let covariance = 0;
    let varValue = 0;
    let varLabel = 0;

    for (let i = 0; i < values.length; i++) {
      const dv = values[i] - meanValue;
      const dl = labels[i] - meanLabel;
      covariance += dv * dl;
      varValue += dv * dv;
      varLabel += dl * dl;
    }

    const correlation = Math.sqrt(varValue) * Math.sqrt(varLabel) > 0 ?
      covariance / (Math.sqrt(varValue) * Math.sqrt(varLabel)) : 0;

    const sign = correlation >= 0 ? '+' : '';
    console.log(`  ${feat.padEnd(22)} ${sign}${correlation.toFixed(4)}`);
  }
}

main().catch(console.error);
