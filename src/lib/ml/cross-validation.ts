/**
 * Cross-Validation Framework
 * K-fold cross-validation with confidence intervals
 */

import {
  TrainingExample,
  ModelCoefficients,
  trainModel,
  evaluateModel,
  TrainingOptions,
} from '../model/logistic';
import { generateStratifiedKFolds, KFold } from './data-splitter';

// ============================================
// TYPES
// ============================================

export interface MetricStats {
  mean: number;
  std: number;
  min: number;
  max: number;
  values: number[];
  ci95: [number, number]; // 95% confidence interval
}

export interface CVResult {
  folds: number;
  seed: number;
  totalSamples: number;
  metrics: {
    auc: MetricStats;
    accuracy: MetricStats;
    precision: MetricStats;
    recall: MetricStats;
    f1Score: MetricStats;
    calibrationError: MetricStats;
  };
  foldResults: FoldResult[];
  trainingOptions: TrainingOptions;
  duration: number; // ms
}

export interface FoldResult {
  fold: number;
  trainSize: number;
  valSize: number;
  metrics: {
    auc: number;
    accuracy: number;
    precision: number;
    recall: number;
    f1Score: number;
    calibrationError: number;
  };
}

export interface CVOptions {
  k?: number;             // Number of folds (default: 5)
  seed?: number;          // Random seed
  trainingOptions?: Partial<TrainingOptions>;
  verbose?: boolean;      // Print progress
}

// ============================================
// STATISTICS HELPERS
// ============================================

function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function calculateStd(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = calculateMean(values);
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / (values.length - 1));
}

function calculateCI95(values: number[]): [number, number] {
  const mean = calculateMean(values);
  const std = calculateStd(values);
  const n = values.length;
  // t-value for 95% CI with n-1 degrees of freedom (approximation)
  const tValue = n <= 5 ? 2.776 : n <= 10 ? 2.262 : n <= 20 ? 2.086 : 1.96;
  const margin = tValue * (std / Math.sqrt(n));
  return [mean - margin, mean + margin];
}

function createMetricStats(values: number[]): MetricStats {
  return {
    mean: calculateMean(values),
    std: calculateStd(values),
    min: Math.min(...values),
    max: Math.max(...values),
    values,
    ci95: calculateCI95(values),
  };
}

// ============================================
// CROSS-VALIDATION
// ============================================

/**
 * Run k-fold cross-validation
 *
 * @param examples - Training examples
 * @param options - CV configuration
 * @returns Cross-validation results with statistics
 */
export function crossValidate(
  examples: TrainingExample[],
  options: CVOptions = {}
): CVResult {
  const {
    k = 5,
    seed = Date.now(),
    trainingOptions = {},
    verbose = false,
  } = options;

  const startTime = Date.now();

  // Generate stratified folds
  const folds = generateStratifiedKFolds(examples, k, seed);

  // Default training options
  const defaultOpts: TrainingOptions = {
    learningRate: 0.01,
    iterations: 2000,
    regularization: 0.01,
    momentum: 0.9,
    initStrategy: 'default',
    seed,
    ...trainingOptions,
  };

  // Results storage
  const foldResults: FoldResult[] = [];
  const aucValues: number[] = [];
  const accValues: number[] = [];
  const precValues: number[] = [];
  const recValues: number[] = [];
  const f1Values: number[] = [];
  const calErrValues: number[] = [];

  if (verbose) {
    console.log(`\nRunning ${k}-fold cross-validation...`);
    console.log(`Total samples: ${examples.length}`);
    console.log(`Seed: ${seed}`);
    console.log('-'.repeat(50));
  }

  // Run each fold
  for (const fold of folds) {
    if (verbose) {
      console.log(`\nFold ${fold.fold}/${k}:`);
      console.log(`  Train: ${fold.train.length}, Val: ${fold.validation.length}`);
    }

    // Train model on this fold
    const coefficients = trainModel(fold.train, {
      ...defaultOpts,
      seed: seed + fold.fold, // Different seed per fold
    });

    // Evaluate on validation set
    const metrics = evaluateModel(fold.validation, coefficients);

    // Store results
    const foldResult: FoldResult = {
      fold: fold.fold,
      trainSize: fold.train.length,
      valSize: fold.validation.length,
      metrics: {
        auc: metrics.auc,
        accuracy: metrics.accuracy,
        precision: metrics.precision,
        recall: metrics.recall,
        f1Score: metrics.f1Score,
        calibrationError: metrics.calibrationError,
      },
    };

    foldResults.push(foldResult);
    aucValues.push(metrics.auc);
    accValues.push(metrics.accuracy);
    precValues.push(metrics.precision);
    recValues.push(metrics.recall);
    f1Values.push(metrics.f1Score);
    calErrValues.push(metrics.calibrationError);

    if (verbose) {
      console.log(`  AUC: ${metrics.auc.toFixed(1)}%, Acc: ${metrics.accuracy.toFixed(1)}%`);
    }
  }

  const duration = Date.now() - startTime;

  return {
    folds: k,
    seed,
    totalSamples: examples.length,
    metrics: {
      auc: createMetricStats(aucValues),
      accuracy: createMetricStats(accValues),
      precision: createMetricStats(precValues),
      recall: createMetricStats(recValues),
      f1Score: createMetricStats(f1Values),
      calibrationError: createMetricStats(calErrValues),
    },
    foldResults,
    trainingOptions: defaultOpts,
    duration,
  };
}

// ============================================
// TIME-SERIES CROSS-VALIDATION
// ============================================

/**
 * Time-series cross-validation (walk-forward)
 * Prevents future data leakage by only training on past data
 *
 * @param examples - Training examples (must be sorted chronologically)
 * @param options - CV configuration
 * @param dateExtractor - Function to extract date from example
 * @returns Cross-validation results
 */
export function timeSeriesCrossValidate(
  examples: TrainingExample[],
  options: CVOptions = {},
  dateExtractor: (example: TrainingExample) => Date
): CVResult {
  const {
    k = 5,
    seed = Date.now(),
    trainingOptions = {},
    verbose = false,
  } = options;

  const startTime = Date.now();

  // Sort by date
  const sorted = [...examples].sort((a, b) =>
    dateExtractor(a).getTime() - dateExtractor(b).getTime()
  );

  // Calculate fold boundaries (expanding window)
  const minTrainSize = Math.floor(sorted.length * 0.4); // Minimum 40% for training
  const foldSize = Math.floor((sorted.length - minTrainSize) / k);

  const defaultOpts: TrainingOptions = {
    learningRate: 0.01,
    iterations: 2000,
    regularization: 0.01,
    momentum: 0.9,
    initStrategy: 'default',
    seed,
    ...trainingOptions,
  };

  const foldResults: FoldResult[] = [];
  const aucValues: number[] = [];
  const accValues: number[] = [];
  const precValues: number[] = [];
  const recValues: number[] = [];
  const f1Values: number[] = [];
  const calErrValues: number[] = [];

  if (verbose) {
    console.log(`\nRunning ${k}-fold time-series cross-validation...`);
    console.log(`Total samples: ${examples.length}`);
    console.log(`Min training size: ${minTrainSize}`);
    console.log('-'.repeat(50));
  }

  for (let i = 0; i < k; i++) {
    // Training set: all data up to current point
    const trainEnd = minTrainSize + i * foldSize;
    const valEnd = Math.min(trainEnd + foldSize, sorted.length);

    const train = sorted.slice(0, trainEnd);
    const validation = sorted.slice(trainEnd, valEnd);

    if (validation.length === 0) continue;

    if (verbose) {
      console.log(`\nFold ${i + 1}/${k}:`);
      console.log(`  Train: ${train.length} (up to ${trainEnd})`);
      console.log(`  Val: ${validation.length} (${trainEnd} to ${valEnd})`);
    }

    // Train and evaluate
    const coefficients = trainModel(train, {
      ...defaultOpts,
      seed: seed + i,
    });
    const metrics = evaluateModel(validation, coefficients);

    const foldResult: FoldResult = {
      fold: i + 1,
      trainSize: train.length,
      valSize: validation.length,
      metrics: {
        auc: metrics.auc,
        accuracy: metrics.accuracy,
        precision: metrics.precision,
        recall: metrics.recall,
        f1Score: metrics.f1Score,
        calibrationError: metrics.calibrationError,
      },
    };

    foldResults.push(foldResult);
    aucValues.push(metrics.auc);
    accValues.push(metrics.accuracy);
    precValues.push(metrics.precision);
    recValues.push(metrics.recall);
    f1Values.push(metrics.f1Score);
    calErrValues.push(metrics.calibrationError);

    if (verbose) {
      console.log(`  AUC: ${metrics.auc.toFixed(1)}%, Acc: ${metrics.accuracy.toFixed(1)}%`);
    }
  }

  const duration = Date.now() - startTime;

  return {
    folds: foldResults.length,
    seed,
    totalSamples: examples.length,
    metrics: {
      auc: createMetricStats(aucValues),
      accuracy: createMetricStats(accValues),
      precision: createMetricStats(precValues),
      recall: createMetricStats(recValues),
      f1Score: createMetricStats(f1Values),
      calibrationError: createMetricStats(calErrValues),
    },
    foldResults,
    trainingOptions: defaultOpts,
    duration,
  };
}

// ============================================
// FORMATTING
// ============================================

/**
 * Format CV results for display
 */
export function formatCVResults(result: CVResult): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('╔══════════════════════════════════════════════════════════════╗');
  lines.push('║              CROSS-VALIDATION RESULTS                        ║');
  lines.push('╚══════════════════════════════════════════════════════════════╝');
  lines.push(`  Folds: ${result.folds} | Samples: ${result.totalSamples} | Seed: ${result.seed}`);
  lines.push(`  Duration: ${(result.duration / 1000).toFixed(1)}s`);

  lines.push('\n┌─────────────────────────────────────────────────────────────┐');
  lines.push('│                    METRIC STATISTICS                        │');
  lines.push('├──────────────────┬────────┬────────┬────────────────────────┤');
  lines.push('│ Metric           │  Mean  │  Std   │  95% CI                │');
  lines.push('├──────────────────┼────────┼────────┼────────────────────────┤');

  const formatRow = (name: string, stats: MetricStats) => {
    const mean = stats.mean.toFixed(1).padStart(5) + '%';
    const std = stats.std.toFixed(1).padStart(5) + '%';
    const ci = `[${stats.ci95[0].toFixed(1)}, ${stats.ci95[1].toFixed(1)}]%`;
    return `│ ${name.padEnd(16)} │ ${mean} │ ${std} │ ${ci.padEnd(22)} │`;
  };

  lines.push(formatRow('AUC', result.metrics.auc));
  lines.push(formatRow('Accuracy', result.metrics.accuracy));
  lines.push(formatRow('Precision', result.metrics.precision));
  lines.push(formatRow('Recall', result.metrics.recall));
  lines.push(formatRow('F1 Score', result.metrics.f1Score));
  lines.push(formatRow('Calibration Err', result.metrics.calibrationError));

  lines.push('└──────────────────┴────────┴────────┴────────────────────────┘');

  // Per-fold results
  lines.push('\n┌───────────────────────────────────────────────────────────────┐');
  lines.push('│                      PER-FOLD RESULTS                         │');
  lines.push('├───────┬─────────┬─────────┬────────┬─────────┬────────────────┤');
  lines.push('│ Fold  │ Train   │   Val   │  AUC   │   Acc   │ Cal. Error     │');
  lines.push('├───────┼─────────┼─────────┼────────┼─────────┼────────────────┤');

  for (const fold of result.foldResults) {
    const foldNum = fold.fold.toString().padStart(3);
    const train = fold.trainSize.toString().padStart(5);
    const val = fold.valSize.toString().padStart(5);
    const auc = fold.metrics.auc.toFixed(1).padStart(5) + '%';
    const acc = fold.metrics.accuracy.toFixed(1).padStart(5) + '%';
    const calErr = fold.metrics.calibrationError.toFixed(1).padStart(5) + '%';
    lines.push(`│  ${foldNum}  │ ${train}   │ ${val}   │ ${auc} │  ${acc} │ ${calErr.padEnd(14)} │`);
  }

  lines.push('└───────┴─────────┴─────────┴────────┴─────────┴────────────────┘');

  // Quality assessment
  lines.push('\n' + '─'.repeat(65));
  const aucStd = result.metrics.auc.std;
  if (aucStd < 2) {
    lines.push('✓ Excellent stability: AUC std < 2%');
  } else if (aucStd < 3) {
    lines.push('✓ Good stability: AUC std < 3%');
  } else if (aucStd < 5) {
    lines.push('⚠️  Moderate variance: AUC std < 5%, consider more data');
  } else {
    lines.push('⚠️  High variance: AUC std >= 5%, results may be unreliable');
  }
  lines.push('─'.repeat(65));

  return lines.join('\n');
}

/**
 * Format CV results as JSON for storage
 */
export function serializeCVResults(result: CVResult): string {
  return JSON.stringify(result, null, 2);
}
