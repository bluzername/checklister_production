/**
 * Feature Analysis Module
 * Provides feature importance analysis using multiple methods:
 * 1. Coefficient magnitude (from logistic regression)
 * 2. Permutation importance (shuffle feature, measure AUC drop)
 * 3. Ablation study (remove feature, retrain, compare)
 */

import {
  TrainingExample,
  ModelCoefficients,
  trainModel,
  evaluateModel,
  TrainingOptions,
} from '../model/logistic';
import { FeatureVector } from '../backtest/types';

// ============================================
// TYPES
// ============================================

export interface FeatureImportance {
  feature: string;
  coefficientMagnitude: number;
  normalizedCoefficient: number;
  permutationImportance?: number;
  ablationImportance?: number;
  combinedScore: number;
  rank: number;
}

export interface FeatureImportanceResult {
  generatedAt: string;
  method: 'coefficient' | 'permutation' | 'ablation' | 'combined';
  baselineAUC: number;
  features: FeatureImportance[];
  topFeatures: string[];
  lowImportanceFeatures: string[];
  recommendations: string[];
}

export interface PermutationResult {
  feature: string;
  originalAUC: number;
  permutedAUC: number;
  aucDrop: number;
  importance: number;
}

export interface AblationResult {
  feature: string;
  fullModelAUC: number;
  reducedModelAUC: number;
  aucDrop: number;
  importance: number;
}

// ============================================
// HELPERS
// ============================================

function getFeatureValue(features: FeatureVector, name: string): number {
  return (features as unknown as Record<string, number>)[name] ?? 0;
}

function setFeatureValue(features: FeatureVector, name: string, value: number): void {
  (features as unknown as Record<string, number>)[name] = value;
}

function getFeatureNames(example: TrainingExample): string[] {
  return Object.keys(example.features);
}

function getWeight(coefficients: ModelCoefficients, name: string): number {
  return (coefficients.weights as unknown as Record<string, number>)[name] ?? 0;
}

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
 * Shuffle array using Fisher-Yates with seeded random
 */
function shuffleArray<T>(array: T[], random: () => number): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// ============================================
// COEFFICIENT-BASED IMPORTANCE
// ============================================

/**
 * Calculate feature importance from coefficient magnitudes
 * Normalizes by feature standard deviation for fair comparison
 */
export function coefficientImportance(
  coefficients: ModelCoefficients,
  examples: TrainingExample[]
): FeatureImportance[] {
  const featureNames = Object.keys(coefficients.weights);

  // Calculate feature standard deviations for normalization
  const featureStds: Record<string, number> = {};
  for (const name of featureNames) {
    const values = examples.map(e => getFeatureValue(e.features, name));
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, v) => a + Math.pow(v - mean, 2), 0) / values.length;
    featureStds[name] = Math.sqrt(variance) || 1; // Avoid division by zero
  }

  // Calculate importance scores
  const importances: FeatureImportance[] = featureNames.map(name => {
    const coef = getWeight(coefficients, name);
    const magnitude = Math.abs(coef);
    const normalized = magnitude * featureStds[name]; // Scale by std

    return {
      feature: name,
      coefficientMagnitude: magnitude,
      normalizedCoefficient: normalized,
      combinedScore: normalized, // Will be updated if other methods used
      rank: 0, // Will be set after sorting
    };
  });

  // Sort by normalized coefficient and assign ranks
  importances.sort((a, b) => b.normalizedCoefficient - a.normalizedCoefficient);
  importances.forEach((imp, idx) => {
    imp.rank = idx + 1;
  });

  return importances;
}

// ============================================
// PERMUTATION IMPORTANCE
// ============================================

/**
 * Calculate permutation importance by shuffling each feature
 * and measuring the drop in AUC
 */
export function permutationImportance(
  examples: TrainingExample[],
  coefficients: ModelCoefficients,
  options: {
    numPermutations?: number;
    seed?: number;
    verbose?: boolean;
  } = {}
): PermutationResult[] {
  const {
    numPermutations = 5,
    seed = 42,
    verbose = false,
  } = options;

  const featureNames = getFeatureNames(examples[0]);
  const random = createSeededRandom(seed);

  // Calculate baseline AUC
  const baselineMetrics = evaluateModel(examples, coefficients);
  const baselineAUC = baselineMetrics.auc;

  if (verbose) {
    console.log(`Baseline AUC: ${baselineAUC.toFixed(2)}%`);
    console.log(`Computing permutation importance for ${featureNames.length} features...`);
  }

  const results: PermutationResult[] = [];

  for (const featureName of featureNames) {
    if (verbose) {
      process.stdout.write(`  ${featureName}...`);
    }

    // Collect all values for this feature
    const featureValues = examples.map(e => getFeatureValue(e.features, featureName));

    // Run multiple permutations and average
    let totalAucDrop = 0;

    for (let p = 0; p < numPermutations; p++) {
      // Shuffle feature values
      const shuffledValues = shuffleArray(featureValues, random);

      // Create permuted examples
      const permutedExamples: TrainingExample[] = examples.map((e, i) => {
        const permutedFeatures = { ...e.features } as unknown as Record<string, number>;
        permutedFeatures[featureName] = shuffledValues[i];
        return {
          features: permutedFeatures as unknown as FeatureVector,
          label: e.label,
        };
      });

      // Evaluate with permuted feature
      const permutedMetrics = evaluateModel(permutedExamples, coefficients);
      totalAucDrop += baselineAUC - permutedMetrics.auc;
    }

    const avgAucDrop = totalAucDrop / numPermutations;

    results.push({
      feature: featureName,
      originalAUC: baselineAUC,
      permutedAUC: baselineAUC - avgAucDrop,
      aucDrop: avgAucDrop,
      importance: Math.max(0, avgAucDrop), // Importance is the AUC drop
    });

    if (verbose) {
      console.log(` AUC drop: ${avgAucDrop.toFixed(2)}%`);
    }
  }

  // Sort by importance
  results.sort((a, b) => b.importance - a.importance);

  return results;
}

// ============================================
// ABLATION STUDY
// ============================================

/**
 * Perform ablation study by removing each feature and retraining
 * This is more expensive but more accurate
 */
export function ablationStudy(
  examples: TrainingExample[],
  trainingOptions: Partial<TrainingOptions> = {},
  options: {
    seed?: number;
    verbose?: boolean;
    validationSplit?: number;
  } = {}
): AblationResult[] {
  const {
    seed = 42,
    verbose = false,
    validationSplit = 0.2,
  } = options;

  const featureNames = getFeatureNames(examples[0]);

  // Split data for validation
  const splitIdx = Math.floor(examples.length * (1 - validationSplit));
  const trainData = examples.slice(0, splitIdx);
  const valData = examples.slice(splitIdx);

  // Train full model
  if (verbose) {
    console.log('Training full model...');
  }
  const fullCoefficients = trainModel(trainData, {
    learningRate: 0.01,
    iterations: 1000,
    regularization: 0.01,
    seed,
    ...trainingOptions,
  });
  const fullMetrics = evaluateModel(valData, fullCoefficients);
  const fullAUC = fullMetrics.auc;

  if (verbose) {
    console.log(`Full model AUC: ${fullAUC.toFixed(2)}%`);
    console.log(`Running ablation study for ${featureNames.length} features...`);
  }

  const results: AblationResult[] = [];

  for (const featureName of featureNames) {
    if (verbose) {
      process.stdout.write(`  Removing ${featureName}...`);
    }

    // Create examples with feature set to 0 (effectively removing it)
    const reducedTrainData = trainData.map(e => {
      const features = { ...e.features } as unknown as Record<string, number>;
      features[featureName] = 0;
      return {
        features: features as unknown as FeatureVector,
        label: e.label,
      };
    });

    const reducedValData = valData.map(e => {
      const features = { ...e.features } as unknown as Record<string, number>;
      features[featureName] = 0;
      return {
        features: features as unknown as FeatureVector,
        label: e.label,
      };
    });

    // Train reduced model
    const reducedCoefficients = trainModel(reducedTrainData, {
      learningRate: 0.01,
      iterations: 1000,
      regularization: 0.01,
      seed,
      ...trainingOptions,
    });
    const reducedMetrics = evaluateModel(reducedValData, reducedCoefficients);
    const reducedAUC = reducedMetrics.auc;

    const aucDrop = fullAUC - reducedAUC;

    results.push({
      feature: featureName,
      fullModelAUC: fullAUC,
      reducedModelAUC: reducedAUC,
      aucDrop,
      importance: Math.max(0, aucDrop),
    });

    if (verbose) {
      console.log(` AUC: ${reducedAUC.toFixed(2)}% (drop: ${aucDrop.toFixed(2)}%)`);
    }
  }

  // Sort by importance
  results.sort((a, b) => b.importance - a.importance);

  return results;
}

// ============================================
// COMBINED ANALYSIS
// ============================================

/**
 * Combine multiple importance methods into a single ranking
 */
export function combineImportanceScores(
  coefficientResults: FeatureImportance[],
  permutationResults?: PermutationResult[],
  ablationResults?: AblationResult[]
): FeatureImportance[] {
  // Create a map for easy lookup
  const featureMap: Record<string, FeatureImportance> = {};

  for (const result of coefficientResults) {
    featureMap[result.feature] = { ...result };
  }

  // Add permutation importance if available
  if (permutationResults) {
    // Normalize permutation importance to 0-1 scale
    const maxPerm = Math.max(...permutationResults.map(r => r.importance), 0.001);
    for (const result of permutationResults) {
      if (featureMap[result.feature]) {
        featureMap[result.feature].permutationImportance = result.importance / maxPerm;
      }
    }
  }

  // Add ablation importance if available
  if (ablationResults) {
    // Normalize ablation importance to 0-1 scale
    const maxAbl = Math.max(...ablationResults.map(r => r.importance), 0.001);
    for (const result of ablationResults) {
      if (featureMap[result.feature]) {
        featureMap[result.feature].ablationImportance = result.importance / maxAbl;
      }
    }
  }

  // Calculate combined score
  const features = Object.values(featureMap);

  // Normalize coefficient importance to 0-1 scale
  const maxCoef = Math.max(...features.map(f => f.normalizedCoefficient), 0.001);

  for (const feature of features) {
    const coefScore = feature.normalizedCoefficient / maxCoef;
    const permScore = feature.permutationImportance ?? coefScore;
    const ablScore = feature.ablationImportance ?? coefScore;

    // Weighted average (permutation and ablation count more if available)
    const weights = [1, permutationResults ? 2 : 0, ablationResults ? 2 : 0];
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    feature.combinedScore = (
      coefScore * weights[0] +
      permScore * weights[1] +
      ablScore * weights[2]
    ) / totalWeight;
  }

  // Sort by combined score and assign ranks
  features.sort((a, b) => b.combinedScore - a.combinedScore);
  features.forEach((f, idx) => {
    f.rank = idx + 1;
  });

  return features;
}

// ============================================
// FULL ANALYSIS
// ============================================

export interface AnalysisOptions {
  includePermutation?: boolean;
  includeAblation?: boolean;
  numPermutations?: number;
  trainingOptions?: Partial<TrainingOptions>;
  seed?: number;
  verbose?: boolean;
  lowImportanceThreshold?: number;
}

/**
 * Run full feature importance analysis
 */
export function analyzeFeatureImportance(
  examples: TrainingExample[],
  coefficients: ModelCoefficients,
  options: AnalysisOptions = {}
): FeatureImportanceResult {
  const {
    includePermutation = true,
    includeAblation = false, // Expensive, off by default
    numPermutations = 5,
    trainingOptions = {},
    seed = 42,
    verbose = false,
    lowImportanceThreshold = 0.05,
  } = options;

  if (verbose) {
    console.log('='.repeat(60));
    console.log('FEATURE IMPORTANCE ANALYSIS');
    console.log('='.repeat(60));
  }

  // 1. Coefficient-based importance
  if (verbose) {
    console.log('\n1. Coefficient Magnitude Analysis');
    console.log('-'.repeat(40));
  }
  const coefficientResults = coefficientImportance(coefficients, examples);

  // 2. Permutation importance (optional)
  let permutationResults: PermutationResult[] | undefined;
  if (includePermutation) {
    if (verbose) {
      console.log('\n2. Permutation Importance Analysis');
      console.log('-'.repeat(40));
    }
    permutationResults = permutationImportance(examples, coefficients, {
      numPermutations,
      seed,
      verbose,
    });
  }

  // 3. Ablation study (optional, expensive)
  let ablationResults: AblationResult[] | undefined;
  if (includeAblation) {
    if (verbose) {
      console.log('\n3. Ablation Study');
      console.log('-'.repeat(40));
    }
    ablationResults = ablationStudy(examples, trainingOptions, {
      seed,
      verbose,
    });
  }

  // 4. Combine scores
  const combinedResults = combineImportanceScores(
    coefficientResults,
    permutationResults,
    ablationResults
  );

  // Calculate baseline AUC
  const baselineMetrics = evaluateModel(examples, coefficients);

  // Identify top and low importance features
  const topFeatures = combinedResults
    .filter(f => f.combinedScore >= 0.3)
    .map(f => f.feature);

  const lowImportanceFeatures = combinedResults
    .filter(f => f.combinedScore < lowImportanceThreshold)
    .map(f => f.feature);

  // Generate recommendations
  const recommendations: string[] = [];

  if (lowImportanceFeatures.length > 0) {
    recommendations.push(
      `${lowImportanceFeatures.length} features have very low importance (<${lowImportanceThreshold * 100}%). ` +
      `Consider removing: ${lowImportanceFeatures.slice(0, 5).join(', ')}${lowImportanceFeatures.length > 5 ? '...' : ''}`
    );
  }

  if (topFeatures.length < 10) {
    recommendations.push(
      `Only ${topFeatures.length} features have high importance (>30%). ` +
      'Consider feature engineering to create more predictive features.'
    );
  }

  const method = includeAblation ? 'combined' :
                 includePermutation ? 'permutation' : 'coefficient';

  return {
    generatedAt: new Date().toISOString(),
    method,
    baselineAUC: baselineMetrics.auc,
    features: combinedResults,
    topFeatures,
    lowImportanceFeatures,
    recommendations,
  };
}

// ============================================
// FORMATTING
// ============================================

/**
 * Format feature importance results for display
 */
export function formatFeatureImportanceReport(result: FeatureImportanceResult): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('╔══════════════════════════════════════════════════════════════════╗');
  lines.push('║              FEATURE IMPORTANCE REPORT                           ║');
  lines.push('╚══════════════════════════════════════════════════════════════════╝');
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Method: ${result.method}`);
  lines.push(`Baseline AUC: ${result.baselineAUC.toFixed(1)}%`);

  // Top features
  lines.push('\n┌────────────────────────────────────────────────────────────────┐');
  lines.push('│                    TOP 20 FEATURES                             │');
  lines.push('├──────┬────────────────────────┬──────────┬──────────┬──────────┤');
  lines.push('│ Rank │ Feature                │ Coef Mag │ Perm Imp │ Combined │');
  lines.push('├──────┼────────────────────────┼──────────┼──────────┼──────────┤');

  for (const feature of result.features.slice(0, 20)) {
    const name = feature.feature.length > 20
      ? feature.feature.substring(0, 17) + '...'
      : feature.feature;
    const rank = feature.rank.toString().padStart(4);
    const coef = feature.normalizedCoefficient.toFixed(3).padStart(8);
    const perm = feature.permutationImportance !== undefined
      ? feature.permutationImportance.toFixed(3).padStart(8)
      : '    N/A ';
    const combined = feature.combinedScore.toFixed(3).padStart(8);

    lines.push(`│ ${rank} │ ${name.padEnd(22)} │ ${coef} │ ${perm} │ ${combined} │`);
  }
  lines.push('└──────┴────────────────────────┴──────────┴──────────┴──────────┘');

  // Low importance features
  if (result.lowImportanceFeatures.length > 0) {
    lines.push('\n┌────────────────────────────────────────────────────────────────┐');
    lines.push('│                LOW IMPORTANCE FEATURES                         │');
    lines.push('├────────────────────────────────────────────────────────────────┤');

    const lowFeatures = result.lowImportanceFeatures.join(', ');
    // Word wrap
    const words = lowFeatures.split(', ');
    let currentLine = '';
    for (const word of words) {
      if ((currentLine + ', ' + word).length > 60) {
        lines.push(`│  ${(currentLine + ',').padEnd(62)} │`);
        currentLine = word;
      } else {
        currentLine = currentLine ? currentLine + ', ' + word : word;
      }
    }
    if (currentLine) {
      lines.push(`│  ${currentLine.padEnd(62)} │`);
    }
    lines.push('└────────────────────────────────────────────────────────────────┘');
  }

  // Recommendations
  lines.push('\n┌────────────────────────────────────────────────────────────────┐');
  lines.push('│                     RECOMMENDATIONS                            │');
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

  return lines.join('\n');
}
