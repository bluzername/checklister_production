/**
 * Ensemble Module
 * Train multiple models and combine their predictions
 */

import {
  TrainingExample,
  ModelCoefficients,
  trainModel,
  evaluateModel,
  predictProbability,
  TrainingOptions,
} from '../model/logistic';
import { FeatureVector } from '../backtest/types';

// ============================================
// TYPES
// ============================================

export interface EnsembleModel {
  version: string;
  numModels: number;
  models: ModelCoefficients[];
  weights: number[];  // Per-model weights (sum to 1)
  method: 'average' | 'weighted' | 'voting';
  createdAt: string;
  trainingOptions: Partial<TrainingOptions>;
  bootstrapRatio: number;
}

export interface EnsembleMetrics {
  auc: number;
  accuracy: number;
  calibrationError: number;
  individualAUCs: number[];
  predictionVariance: number;
}

export interface EnsemblePrediction {
  probability: number;
  individualPredictions: number[];
  confidence: number;  // Based on agreement between models
  variance: number;
}

// ============================================
// HELPERS
// ============================================

/**
 * Create a seeded random number generator
 */
function createSeededRandom(seed: number): () => number {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Bootstrap sample (sampling with replacement)
 */
function bootstrapSample<T>(
  data: T[],
  ratio: number,
  random: () => number
): T[] {
  const sampleSize = Math.floor(data.length * ratio);
  const sample: T[] = [];

  for (let i = 0; i < sampleSize; i++) {
    const idx = Math.floor(random() * data.length);
    sample.push(data[idx]);
  }

  return sample;
}

// ============================================
// ENSEMBLE TRAINING
// ============================================

/**
 * Train an ensemble of models
 */
export function trainEnsemble(
  examples: TrainingExample[],
  numModels: number = 5,
  options: {
    trainingOptions?: Partial<TrainingOptions>;
    method?: 'average' | 'weighted' | 'voting';
    bootstrapRatio?: number;
    baseSeed?: number;
    verbose?: boolean;
  } = {}
): EnsembleModel {
  const {
    trainingOptions = {},
    method = 'average',
    bootstrapRatio = 1.0,  // 1.0 = full dataset size (with replacement)
    baseSeed = 42,
    verbose = true,
  } = options;

  if (verbose) {
    console.log(`Training ensemble of ${numModels} models...`);
    console.log(`  Method: ${method}`);
    console.log(`  Bootstrap ratio: ${bootstrapRatio}`);
  }

  const models: ModelCoefficients[] = [];
  const aucs: number[] = [];

  // Split off validation set for weighting
  const splitIdx = Math.floor(examples.length * 0.8);
  const trainData = examples.slice(0, splitIdx);
  const valData = examples.slice(splitIdx);

  for (let i = 0; i < numModels; i++) {
    const modelSeed = baseSeed + i * 1000;
    const random = createSeededRandom(modelSeed);

    if (verbose) {
      console.log(`\n  Training model ${i + 1}/${numModels} (seed: ${modelSeed})...`);
    }

    // Bootstrap sample
    const sampleData = bootstrapSample(trainData, bootstrapRatio, random);

    // Train with different seed
    const modelOptions: TrainingOptions = {
      ...trainingOptions,
      seed: modelSeed,
    };

    const coefficients = trainModel(sampleData, modelOptions);
    models.push(coefficients);

    // Evaluate on validation set
    const metrics = evaluateModel(valData, coefficients);
    aucs.push(metrics.auc);

    if (verbose) {
      console.log(`  Model ${i + 1} AUC: ${metrics.auc.toFixed(2)}%`);
    }
  }

  // Calculate weights based on performance
  let weights: number[];
  if (method === 'weighted') {
    // Weight by AUC (softmax-like)
    const totalAuc = aucs.reduce((a, b) => a + b, 0);
    weights = aucs.map(auc => auc / totalAuc);
  } else {
    // Equal weights
    weights = aucs.map(() => 1 / numModels);
  }

  if (verbose) {
    console.log(`\nEnsemble trained successfully.`);
    console.log(`  Individual AUCs: ${aucs.map(a => a.toFixed(1)).join(', ')}%`);
    console.log(`  Weights: ${weights.map(w => w.toFixed(3)).join(', ')}`);
  }

  return {
    version: 'ensemble-v1.0',
    numModels,
    models,
    weights,
    method,
    createdAt: new Date().toISOString(),
    trainingOptions,
    bootstrapRatio,
  };
}

// ============================================
// ENSEMBLE PREDICTION
// ============================================

/**
 * Get prediction from ensemble
 */
export function ensemblePredict(
  features: FeatureVector,
  ensemble: EnsembleModel
): EnsemblePrediction {
  const predictions = ensemble.models.map(model =>
    predictProbability(features, model)
  );

  let probability: number;

  if (ensemble.method === 'voting') {
    // Hard voting (majority)
    const votes = predictions.filter(p => p >= 50).length;
    probability = (votes / predictions.length) * 100;
  } else if (ensemble.method === 'weighted') {
    // Weighted average
    probability = predictions.reduce(
      (sum, pred, i) => sum + pred * ensemble.weights[i],
      0
    );
  } else {
    // Simple average
    probability = predictions.reduce((a, b) => a + b, 0) / predictions.length;
  }

  // Calculate variance and confidence
  const mean = predictions.reduce((a, b) => a + b, 0) / predictions.length;
  const variance = predictions.reduce(
    (sum, p) => sum + Math.pow(p - mean, 2),
    0
  ) / predictions.length;

  // Confidence based on agreement (low variance = high confidence)
  // Normalize variance by max possible (assuming 0-100 range)
  const maxVariance = 2500;  // (100-0)^2 / 4
  const confidence = Math.max(0, 100 - (variance / maxVariance) * 100);

  return {
    probability,
    individualPredictions: predictions,
    confidence,
    variance,
  };
}

/**
 * Get simple probability prediction (for compatibility)
 */
export function ensemblePredictProbability(
  features: FeatureVector,
  ensemble: EnsembleModel
): number {
  return ensemblePredict(features, ensemble).probability;
}

// ============================================
// ENSEMBLE EVALUATION
// ============================================

/**
 * Evaluate ensemble on test data
 */
export function evaluateEnsemble(
  examples: TrainingExample[],
  ensemble: EnsembleModel
): EnsembleMetrics {
  // Get predictions
  const predictions: { prob: number; label: number; variance: number }[] = [];

  for (const example of examples) {
    const pred = ensemblePredict(example.features, ensemble);
    predictions.push({
      prob: pred.probability,
      label: example.label,
      variance: pred.variance,
    });
  }

  // Calculate AUC
  const sortedPredictions = [...predictions].sort((a, b) => b.prob - a.prob);
  let positives = 0;
  let negatives = 0;
  let auc = 0;

  for (const pred of sortedPredictions) {
    if (pred.label === 1) {
      positives++;
    } else {
      negatives++;
      auc += positives;
    }
  }

  const totalPairs = positives * negatives;
  const aucPercent = totalPairs > 0 ? (auc / totalPairs) * 100 : 50;

  // Calculate accuracy
  let correct = 0;
  for (const pred of predictions) {
    const predicted = pred.prob >= 50 ? 1 : 0;
    if (predicted === pred.label) correct++;
  }
  const accuracy = (correct / predictions.length) * 100;

  // Calculate calibration error
  const numBuckets = 10;
  const buckets: { probSum: number; labelSum: number; count: number }[] = [];
  for (let i = 0; i < numBuckets; i++) {
    buckets.push({ probSum: 0, labelSum: 0, count: 0 });
  }

  for (const pred of predictions) {
    const bucketIdx = Math.min(
      Math.floor(pred.prob / (100 / numBuckets)),
      numBuckets - 1
    );
    buckets[bucketIdx].probSum += pred.prob;
    buckets[bucketIdx].labelSum += pred.label;
    buckets[bucketIdx].count++;
  }

  let calibrationError = 0;
  let totalInBuckets = 0;

  for (const bucket of buckets) {
    if (bucket.count > 0) {
      const avgProb = bucket.probSum / bucket.count;
      const actualRate = (bucket.labelSum / bucket.count) * 100;
      calibrationError += Math.abs(avgProb - actualRate) * bucket.count;
      totalInBuckets += bucket.count;
    }
  }

  calibrationError = totalInBuckets > 0 ? calibrationError / totalInBuckets : 0;

  // Calculate individual AUCs
  const individualAUCs: number[] = [];
  for (const model of ensemble.models) {
    const metrics = evaluateModel(examples, model);
    individualAUCs.push(metrics.auc);
  }

  // Calculate average prediction variance
  const avgVariance = predictions.reduce((sum, p) => sum + p.variance, 0) / predictions.length;

  return {
    auc: aucPercent,
    accuracy,
    calibrationError,
    individualAUCs,
    predictionVariance: avgVariance,
  };
}

// ============================================
// SERIALIZATION
// ============================================

/**
 * Save ensemble to file
 */
export function serializeEnsemble(ensemble: EnsembleModel): string {
  return JSON.stringify(ensemble, null, 2);
}

/**
 * Load ensemble from string
 */
export function deserializeEnsemble(json: string): EnsembleModel {
  return JSON.parse(json) as EnsembleModel;
}

// ============================================
// FORMATTING
// ============================================

/**
 * Format ensemble metrics for display
 */
export function formatEnsembleReport(
  ensemble: EnsembleModel,
  metrics?: EnsembleMetrics
): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('╔══════════════════════════════════════════════════════════════════╗');
  lines.push('║                    ENSEMBLE MODEL REPORT                         ║');
  lines.push('╚══════════════════════════════════════════════════════════════════╝');
  lines.push(`Version: ${ensemble.version}`);
  lines.push(`Created: ${ensemble.createdAt}`);

  lines.push('\n┌────────────────────────────────────────────────────────────────┐');
  lines.push('│                    CONFIGURATION                               │');
  lines.push('├────────────────────────────────────────────────────────────────┤');
  lines.push(`│  Number of models:   ${ensemble.numModels.toString().padEnd(42)} │`);
  lines.push(`│  Method:             ${ensemble.method.padEnd(42)} │`);
  lines.push(`│  Bootstrap ratio:    ${ensemble.bootstrapRatio.toString().padEnd(42)} │`);
  lines.push('└────────────────────────────────────────────────────────────────┘');

  if (metrics) {
    lines.push('\n┌────────────────────────────────────────────────────────────────┐');
    lines.push('│                      PERFORMANCE                               │');
    lines.push('├────────────────────────────────────────────────────────────────┤');
    lines.push(`│  Ensemble AUC:       ${metrics.auc.toFixed(2).padStart(6)}%                                   │`);
    lines.push(`│  Accuracy:           ${metrics.accuracy.toFixed(2).padStart(6)}%                                   │`);
    lines.push(`│  Calibration Error:  ${metrics.calibrationError.toFixed(2).padStart(6)}%                                   │`);
    lines.push(`│  Pred. Variance:     ${metrics.predictionVariance.toFixed(2).padStart(6)}                                    │`);
    lines.push('├────────────────────────────────────────────────────────────────┤');
    lines.push(`│  Individual AUCs:    ${metrics.individualAUCs.map(a => a.toFixed(1)).join(', ').padEnd(42)} │`);
    lines.push('└────────────────────────────────────────────────────────────────┘');

    // Compare to individual models
    const avgIndividualAUC = metrics.individualAUCs.reduce((a, b) => a + b, 0) / metrics.individualAUCs.length;
    const improvement = metrics.auc - avgIndividualAUC;

    lines.push('\n┌────────────────────────────────────────────────────────────────┐');
    lines.push('│                      COMPARISON                                │');
    lines.push('├────────────────────────────────────────────────────────────────┤');
    lines.push(`│  Avg Individual AUC: ${avgIndividualAUC.toFixed(2)}%                                      │`);
    lines.push(`│  Ensemble Gain:      ${improvement >= 0 ? '+' : ''}${improvement.toFixed(2)}%                                       │`);
    lines.push('└────────────────────────────────────────────────────────────────┘');
  }

  return lines.join('\n');
}
