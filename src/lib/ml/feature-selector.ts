/**
 * Feature Selection Module
 * Provides methods for selecting important features and removing redundant ones
 */

import {
  TrainingExample,
  ModelCoefficients,
  trainModel,
  evaluateModel,
  TrainingOptions,
} from '../model/logistic';
import { FeatureVector } from '../backtest/types';
import {
  analyzeFeatureImportance,
  FeatureImportanceResult,
} from './feature-analysis';

// ============================================
// TYPES
// ============================================

export interface FeatureSelectionConfig {
  method: 'importance' | 'correlation' | 'combined';
  importanceThreshold?: number;     // Min combined score to keep (default: 0.05)
  correlationThreshold?: number;    // Max correlation to allow (default: 0.85)
  minFeatures?: number;             // Minimum features to keep (default: 10)
  maxFeatures?: number;             // Maximum features to keep (default: 30)
  includeFeatures?: string[];       // Always include these features
  excludeFeatures?: string[];       // Always exclude these features
}

export interface FeatureSelectionResult {
  generatedAt: string;
  config: FeatureSelectionConfig;
  originalFeatureCount: number;
  selectedFeatureCount: number;
  selectedFeatures: string[];
  removedFeatures: string[];
  removalReasons: Record<string, string>;
  correlationMatrix?: Record<string, Record<string, number>>;
  performanceComparison: {
    originalAUC: number;
    reducedAUC: number;
    aucDrop: number;
    aucDropPercent: number;
    originalAccuracy: number;
    reducedAccuracy: number;
  };
  recommendations: string[];
}

export interface CorrelationPair {
  feature1: string;
  feature2: string;
  correlation: number;
}

// ============================================
// HELPERS
// ============================================

function getFeatureValue(features: FeatureVector, name: string): number {
  return (features as unknown as Record<string, number>)[name] ?? 0;
}

/**
 * Calculate Pearson correlation between two arrays
 */
function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n !== y.length || n === 0) return 0;

  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  const denominator = Math.sqrt(denomX * denomY);
  if (denominator === 0) return 0;

  return numerator / denominator;
}

/**
 * Calculate correlation matrix for all features
 */
export function calculateCorrelationMatrix(
  examples: TrainingExample[],
  featureNames: string[]
): Record<string, Record<string, number>> {
  const matrix: Record<string, Record<string, number>> = {};

  // Extract feature values
  const featureValues: Record<string, number[]> = {};
  for (const name of featureNames) {
    featureValues[name] = examples.map(e => getFeatureValue(e.features, name));
  }

  // Calculate correlations
  for (const name1 of featureNames) {
    matrix[name1] = {};
    for (const name2 of featureNames) {
      if (name1 === name2) {
        matrix[name1][name2] = 1.0;
      } else if (matrix[name2]?.[name1] !== undefined) {
        matrix[name1][name2] = matrix[name2][name1];
      } else {
        matrix[name1][name2] = pearsonCorrelation(
          featureValues[name1],
          featureValues[name2]
        );
      }
    }
  }

  return matrix;
}

/**
 * Find highly correlated feature pairs
 */
export function findCorrelatedPairs(
  correlationMatrix: Record<string, Record<string, number>>,
  threshold: number
): CorrelationPair[] {
  const pairs: CorrelationPair[] = [];
  const features = Object.keys(correlationMatrix);

  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      const corr = Math.abs(correlationMatrix[features[i]][features[j]]);
      if (corr >= threshold) {
        pairs.push({
          feature1: features[i],
          feature2: features[j],
          correlation: correlationMatrix[features[i]][features[j]],
        });
      }
    }
  }

  return pairs.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
}

// ============================================
// FEATURE SELECTION
// ============================================

/**
 * Select features based on importance scores
 */
export function selectByImportance(
  importanceResult: FeatureImportanceResult,
  config: FeatureSelectionConfig
): { selected: string[]; removed: string[]; reasons: Record<string, string> } {
  const {
    importanceThreshold = 0.05,
    minFeatures = 10,
    maxFeatures = 30,
    includeFeatures = [],
    excludeFeatures = [],
  } = config;

  const selected: string[] = [];
  const removed: string[] = [];
  const reasons: Record<string, string> = {};

  // Sort features by importance
  const sortedFeatures = [...importanceResult.features].sort(
    (a, b) => b.combinedScore - a.combinedScore
  );

  for (const feature of sortedFeatures) {
    const name = feature.feature;

    // Always exclude if in excludeFeatures
    if (excludeFeatures.includes(name)) {
      removed.push(name);
      reasons[name] = 'Explicitly excluded';
      continue;
    }

    // Always include if in includeFeatures
    if (includeFeatures.includes(name)) {
      selected.push(name);
      continue;
    }

    // Check if we've hit the max
    if (selected.length >= maxFeatures) {
      removed.push(name);
      reasons[name] = `Exceeded max features (${maxFeatures})`;
      continue;
    }

    // Check importance threshold
    if (feature.combinedScore < importanceThreshold) {
      // But keep if we need to meet minimum
      if (selected.length < minFeatures) {
        selected.push(name);
      } else {
        removed.push(name);
        reasons[name] = `Low importance (${(feature.combinedScore * 100).toFixed(1)}% < ${importanceThreshold * 100}%)`;
      }
    } else {
      selected.push(name);
    }
  }

  return { selected, removed, reasons };
}

/**
 * Select features handling correlated pairs
 * When two features are highly correlated, keep the one with higher importance
 */
export function selectByCorrelation(
  featureNames: string[],
  importanceResult: FeatureImportanceResult,
  correlationMatrix: Record<string, Record<string, number>>,
  config: FeatureSelectionConfig
): { selected: string[]; removed: string[]; reasons: Record<string, string> } {
  const {
    correlationThreshold = 0.85,
    includeFeatures = [],
    excludeFeatures = [],
  } = config;

  const selected = new Set<string>(featureNames);
  const removed: string[] = [];
  const reasons: Record<string, string> = {};

  // Find correlated pairs
  const correlatedPairs = findCorrelatedPairs(correlationMatrix, correlationThreshold);

  // Create importance lookup
  const importanceMap: Record<string, number> = {};
  for (const f of importanceResult.features) {
    importanceMap[f.feature] = f.combinedScore;
  }

  // Process correlated pairs
  for (const pair of correlatedPairs) {
    if (!selected.has(pair.feature1) || !selected.has(pair.feature2)) {
      continue; // Already removed one
    }

    // Don't remove if in includeFeatures
    if (includeFeatures.includes(pair.feature1) && includeFeatures.includes(pair.feature2)) {
      continue;
    }

    // Remove the one with lower importance
    const imp1 = importanceMap[pair.feature1] ?? 0;
    const imp2 = importanceMap[pair.feature2] ?? 0;

    let toRemove: string;
    let toKeep: string;

    if (includeFeatures.includes(pair.feature1)) {
      toRemove = pair.feature2;
      toKeep = pair.feature1;
    } else if (includeFeatures.includes(pair.feature2)) {
      toRemove = pair.feature1;
      toKeep = pair.feature2;
    } else if (imp1 >= imp2) {
      toRemove = pair.feature2;
      toKeep = pair.feature1;
    } else {
      toRemove = pair.feature1;
      toKeep = pair.feature2;
    }

    if (!excludeFeatures.includes(toKeep)) {
      selected.delete(toRemove);
      removed.push(toRemove);
      reasons[toRemove] = `Highly correlated with ${toKeep} (r=${pair.correlation.toFixed(2)})`;
    }
  }

  // Remove explicitly excluded
  for (const name of excludeFeatures) {
    if (selected.has(name)) {
      selected.delete(name);
      removed.push(name);
      reasons[name] = 'Explicitly excluded';
    }
  }

  return {
    selected: Array.from(selected),
    removed,
    reasons,
  };
}

/**
 * Create a reduced training set with only selected features
 */
export function createReducedDataset(
  examples: TrainingExample[],
  selectedFeatures: string[]
): TrainingExample[] {
  return examples.map(e => {
    const reducedFeatures: Record<string, number> = {};
    for (const name of selectedFeatures) {
      reducedFeatures[name] = getFeatureValue(e.features, name);
    }
    return {
      features: reducedFeatures as unknown as FeatureVector,
      label: e.label,
    };
  });
}

/**
 * Create reduced coefficients with only selected features
 */
export function createReducedCoefficients(
  coefficients: ModelCoefficients,
  selectedFeatures: string[]
): ModelCoefficients {
  const reducedWeights: Record<string, number> = {};
  const reducedMeans: Record<string, number> = {};
  const reducedStds: Record<string, number> = {};

  for (const feature of selectedFeatures) {
    reducedWeights[feature] = (coefficients.weights as unknown as Record<string, number>)[feature] || 0;
    reducedMeans[feature] = (coefficients.featureMeans as unknown as Record<string, number>)[feature] || 0;
    reducedStds[feature] = (coefficients.featureStds as unknown as Record<string, number>)[feature] || 1;
  }

  return {
    ...coefficients,
    weights: reducedWeights as unknown as typeof coefficients.weights,
    featureMeans: reducedMeans as unknown as typeof coefficients.featureMeans,
    featureStds: reducedStds as unknown as typeof coefficients.featureStds,
    version: coefficients.version + '-reduced',
  };
}

/**
 * Evaluate a model with reduced features
 * Uses the existing coefficients with only selected features
 */
export function evaluateFeatureSelection(
  examples: TrainingExample[],
  selectedFeatures: string[],
  originalCoefficients: ModelCoefficients,
  trainingOptions: Partial<TrainingOptions> = {}
): { reducedAUC: number; originalAUC: number; reducedAccuracy: number; originalAccuracy: number } {
  // Evaluate original model
  const originalMetrics = evaluateModel(examples, originalCoefficients);

  // Create reduced dataset and coefficients
  const reducedExamples = createReducedDataset(examples, selectedFeatures);
  const reducedCoefficients = createReducedCoefficients(originalCoefficients, selectedFeatures);

  // Evaluate reduced model (using original coefficients with reduced features)
  const reducedMetrics = evaluateModel(reducedExamples, reducedCoefficients);

  return {
    originalAUC: originalMetrics.auc,
    reducedAUC: reducedMetrics.auc,
    originalAccuracy: originalMetrics.accuracy,
    reducedAccuracy: reducedMetrics.accuracy,
  };
}

/**
 * Train and evaluate a new model with reduced features
 * More expensive but can find optimal weights for reduced feature set
 */
export function trainReducedModel(
  examples: TrainingExample[],
  selectedFeatures: string[],
  trainingOptions: Partial<TrainingOptions> = {}
): { coefficients: ModelCoefficients; metrics: { auc: number; accuracy: number } } {
  // Create reduced dataset
  const reducedExamples = createReducedDataset(examples, selectedFeatures);

  // Split for train/val
  const splitIdx = Math.floor(reducedExamples.length * 0.8);
  const trainData = reducedExamples.slice(0, splitIdx);
  const valData = reducedExamples.slice(splitIdx);

  // Train reduced model
  const reducedCoefficients = trainModel(trainData, {
    learningRate: 0.005,  // Lower learning rate for stability
    iterations: 2000,
    regularization: 0.01,
    seed: 42,
    ...trainingOptions,
  });

  // Evaluate reduced model
  const reducedMetrics = evaluateModel(valData, reducedCoefficients);

  return {
    coefficients: reducedCoefficients,
    metrics: {
      auc: reducedMetrics.auc,
      accuracy: reducedMetrics.accuracy,
    },
  };
}

// ============================================
// MAIN SELECTION FUNCTION
// ============================================

/**
 * Run feature selection with combined methods
 */
export function selectFeatures(
  examples: TrainingExample[],
  coefficients: ModelCoefficients,
  config: FeatureSelectionConfig = { method: 'combined' }
): FeatureSelectionResult {
  const featureNames = Object.keys(examples[0].features);

  // 1. Get feature importance
  console.log('Analyzing feature importance...');
  const importanceResult = analyzeFeatureImportance(examples, coefficients, {
    includePermutation: true,
    includeAblation: false,
    verbose: false,
  });

  // 2. Calculate correlation matrix
  console.log('Calculating correlation matrix...');
  const correlationMatrix = calculateCorrelationMatrix(examples, featureNames);

  // 3. Select features based on method
  let selectionResult: { selected: string[]; removed: string[]; reasons: Record<string, string> };

  if (config.method === 'importance') {
    selectionResult = selectByImportance(importanceResult, config);
  } else if (config.method === 'correlation') {
    selectionResult = selectByCorrelation(
      featureNames,
      importanceResult,
      correlationMatrix,
      config
    );
  } else {
    // Combined: first filter by importance, then by correlation
    const importanceSelection = selectByImportance(importanceResult, {
      ...config,
      maxFeatures: 50, // Don't cap yet
    });

    const correlationSelection = selectByCorrelation(
      importanceSelection.selected,
      importanceResult,
      correlationMatrix,
      config
    );

    selectionResult = {
      selected: correlationSelection.selected,
      removed: [
        ...importanceSelection.removed,
        ...correlationSelection.removed,
      ],
      reasons: {
        ...importanceSelection.reasons,
        ...correlationSelection.reasons,
      },
    };
  }

  // 4. Evaluate performance
  console.log('Evaluating reduced model...');
  const performance = evaluateFeatureSelection(
    examples,
    selectionResult.selected,
    coefficients
  );

  // 5. Generate recommendations
  const recommendations: string[] = [];

  const aucDrop = performance.originalAUC - performance.reducedAUC;
  const aucDropPercent = (aucDrop / performance.originalAUC) * 100;

  if (aucDropPercent > 2) {
    recommendations.push(
      `Warning: AUC dropped ${aucDropPercent.toFixed(1)}% with reduced features. ` +
      `Consider keeping more features or adjusting thresholds.`
    );
  } else if (aucDropPercent < -1) {
    recommendations.push(
      `Good news: AUC improved by ${(-aucDropPercent).toFixed(1)}% with reduced features! ` +
      `Removing low-importance features may have reduced noise.`
    );
  }

  if (selectionResult.selected.length < 15) {
    recommendations.push(
      `Only ${selectionResult.selected.length} features selected. ` +
      `Consider lowering the importance threshold to include more.`
    );
  }

  if (selectionResult.removed.length > 25) {
    recommendations.push(
      `${selectionResult.removed.length} features removed. ` +
      `Consider reviewing the excluded features for potential feature engineering.`
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    config,
    originalFeatureCount: featureNames.length,
    selectedFeatureCount: selectionResult.selected.length,
    selectedFeatures: selectionResult.selected,
    removedFeatures: selectionResult.removed,
    removalReasons: selectionResult.reasons,
    performanceComparison: {
      originalAUC: performance.originalAUC,
      reducedAUC: performance.reducedAUC,
      aucDrop,
      aucDropPercent,
      originalAccuracy: performance.originalAccuracy,
      reducedAccuracy: performance.reducedAccuracy,
    },
    recommendations,
  };
}

// ============================================
// FORMATTING
// ============================================

/**
 * Format feature selection results for display
 */
export function formatSelectionReport(result: FeatureSelectionResult): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('╔══════════════════════════════════════════════════════════════════╗');
  lines.push('║              FEATURE SELECTION REPORT                            ║');
  lines.push('╚══════════════════════════════════════════════════════════════════╝');
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Method: ${result.config.method}`);

  // Summary
  lines.push('\n┌────────────────────────────────────────────────────────────────┐');
  lines.push('│                        SUMMARY                                 │');
  lines.push('├────────────────────────────────────────────────────────────────┤');
  lines.push(`│  Original features:  ${result.originalFeatureCount.toString().padEnd(42)} │`);
  lines.push(`│  Selected features:  ${result.selectedFeatureCount.toString().padEnd(42)} │`);
  lines.push(`│  Removed features:   ${result.removedFeatures.length.toString().padEnd(42)} │`);
  lines.push('└────────────────────────────────────────────────────────────────┘');

  // Performance comparison
  lines.push('\n┌────────────────────────────────────────────────────────────────┐');
  lines.push('│                  PERFORMANCE COMPARISON                        │');
  lines.push('├────────────────────────────────────────────────────────────────┤');
  const perf = result.performanceComparison;
  lines.push(`│  Original AUC:     ${perf.originalAUC.toFixed(1).padStart(6)}%                                   │`);
  lines.push(`│  Reduced AUC:      ${perf.reducedAUC.toFixed(1).padStart(6)}%                                   │`);
  lines.push(`│  AUC Change:       ${perf.aucDrop >= 0 ? '-' : '+'}${Math.abs(perf.aucDrop).toFixed(2).padStart(5)}% (${perf.aucDropPercent >= 0 ? '-' : '+'}${Math.abs(perf.aucDropPercent).toFixed(1)}%)                        │`);
  lines.push(`│  Original Acc:     ${perf.originalAccuracy.toFixed(1).padStart(6)}%                                   │`);
  lines.push(`│  Reduced Acc:      ${perf.reducedAccuracy.toFixed(1).padStart(6)}%                                   │`);
  lines.push('└────────────────────────────────────────────────────────────────┘');

  // Selected features
  lines.push('\n┌────────────────────────────────────────────────────────────────┐');
  lines.push('│                   SELECTED FEATURES                            │');
  lines.push('├────────────────────────────────────────────────────────────────┤');

  for (let i = 0; i < result.selectedFeatures.length; i += 2) {
    const f1 = result.selectedFeatures[i] || '';
    const f2 = result.selectedFeatures[i + 1] || '';
    lines.push(`│  ${(i + 1).toString().padStart(2)}. ${f1.padEnd(25)}  ${f2 ? `${(i + 2).toString().padStart(2)}. ${f2.padEnd(20)}` : ''.padEnd(25)} │`);
  }
  lines.push('└────────────────────────────────────────────────────────────────┘');

  // Removed features with reasons
  if (result.removedFeatures.length > 0) {
    lines.push('\n┌────────────────────────────────────────────────────────────────┐');
    lines.push('│                   REMOVED FEATURES                             │');
    lines.push('├────────────────────────────────────────────────────────────────┤');

    for (const feature of result.removedFeatures.slice(0, 15)) {
      const reason = result.removalReasons[feature] || 'Unknown';
      const shortReason = reason.length > 38 ? reason.substring(0, 35) + '...' : reason;
      lines.push(`│  ${feature.padEnd(22)} ${shortReason.padEnd(40)} │`);
    }
    if (result.removedFeatures.length > 15) {
      lines.push(`│  ... and ${result.removedFeatures.length - 15} more features                                 │`);
    }
    lines.push('└────────────────────────────────────────────────────────────────┘');
  }

  // Recommendations
  if (result.recommendations.length > 0) {
    lines.push('\n┌────────────────────────────────────────────────────────────────┐');
    lines.push('│                    RECOMMENDATIONS                             │');
    lines.push('├────────────────────────────────────────────────────────────────┤');

    for (const rec of result.recommendations) {
      const words = rec.split(' ');
      let currentLine = '';
      for (const word of words) {
        if ((currentLine + ' ' + word).length > 60) {
          lines.push(`│  ${currentLine.padEnd(62)} │`);
          currentLine = word;
        } else {
          currentLine = currentLine ? currentLine + ' ' + word : word;
        }
      }
      if (currentLine) {
        lines.push(`│  ${currentLine.padEnd(62)} │`);
      }
      lines.push('│                                                                │');
    }
    lines.push('└────────────────────────────────────────────────────────────────┘');
  }

  return lines.join('\n');
}
