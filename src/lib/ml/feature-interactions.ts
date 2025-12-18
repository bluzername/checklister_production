/**
 * Feature Interactions Module
 * Creates derived features by combining existing features
 */

import {
  TrainingExample,
  ModelCoefficients,
  trainModel,
  evaluateModel,
} from '../model/logistic';
import { FeatureVector } from '../backtest/types';

// ============================================
// TYPES
// ============================================

export interface InteractionDefinition {
  name: string;
  description: string;
  type: 'multiply' | 'divide' | 'add' | 'subtract' | 'polynomial' | 'ratio' | 'custom';
  features: string[];
  degree?: number;
  customFn?: (values: number[]) => number;
}

export interface InteractionResult {
  name: string;
  aucImprovement: number;
  baselineAUC: number;
  withInteractionAUC: number;
  isSignificant: boolean;
  coefficient?: number;
}

export interface InteractionAnalysisResult {
  generatedAt: string;
  baselineAUC: number;
  interactions: InteractionResult[];
  recommendedInteractions: string[];
  totalAUCImprovement: number;
  recommendations: string[];
}

// ============================================
// PREDEFINED INTERACTIONS
// ============================================

/**
 * Predefined feature interactions based on domain knowledge
 */
export const CANDIDATE_INTERACTIONS: InteractionDefinition[] = [
  // Regime-based interactions
  {
    name: 'regime_vix',
    description: 'VIX impact varies by regime confidence',
    type: 'multiply',
    features: ['regime_confidence', 'vix_level'],
  },
  {
    name: 'regime_price_ma',
    description: 'Price vs MA signal weighted by regime',
    type: 'multiply',
    features: ['regime_confidence', 'price_vs_20ema'],
  },

  // RSI-based interactions
  {
    name: 'rsi_ma_confluence',
    description: 'RSI combined with MA signal',
    type: 'multiply',
    features: ['score_rsi', 'score_ma_fibonacci'],
  },
  {
    name: 'rsi_vix',
    description: 'RSI signal adjusted for volatility',
    type: 'multiply',
    features: ['score_rsi', 'vix_level'],
  },

  // Volume-based interactions
  {
    name: 'volume_price_confirm',
    description: 'Volume confirms price movement',
    type: 'multiply',
    features: ['rvol', 'price_vs_20ema'],
  },
  {
    name: 'obv_price',
    description: 'OBV trend with price trend',
    type: 'multiply',
    features: ['obv_trend', 'price_vs_20ema'],
  },

  // Sector interactions
  {
    name: 'sector_momentum',
    description: 'Short and long-term sector strength',
    type: 'multiply',
    features: ['sector_rs_20d', 'sector_rs_60d'],
  },
  {
    name: 'sector_vix',
    description: 'Sector strength in volatile market',
    type: 'multiply',
    features: ['sector_rs_20d', 'vix_level'],
  },

  // Price-based interactions
  {
    name: 'gap_volume',
    description: 'Gap confirmed by volume',
    type: 'multiply',
    features: ['gap_percent', 'rvol'],
  },
  {
    name: 'ma_rsi_combo',
    description: 'MA and RSI combined signal',
    type: 'multiply',
    features: ['score_ma_fibonacci', 'score_rsi'],
  },

  // Polynomial features
  {
    name: 'price_vs_20ema_sq',
    description: 'Price vs 20EMA squared (captures non-linear)',
    type: 'polynomial',
    features: ['price_vs_20ema'],
    degree: 2,
  },
  {
    name: 'vix_level_sq',
    description: 'VIX squared (extreme volatility effect)',
    type: 'polynomial',
    features: ['vix_level'],
    degree: 2,
  },

  // Ratio features
  {
    name: 'sector_trend_ratio',
    description: 'Ratio of short to long-term sector RS',
    type: 'ratio',
    features: ['sector_rs_20d', 'sector_rs_60d'],
  },
];

// ============================================
// HELPERS
// ============================================

function getFeatureValue(features: FeatureVector, name: string): number {
  return (features as unknown as Record<string, number>)[name] ?? 0;
}

function setFeatureValue(features: FeatureVector, name: string, value: number): void {
  (features as unknown as Record<string, number>)[name] = value;
}

/**
 * Calculate interaction value based on definition
 */
export function calculateInteraction(
  features: FeatureVector,
  interaction: InteractionDefinition
): number {
  const values = interaction.features.map(f => getFeatureValue(features, f));

  switch (interaction.type) {
    case 'multiply':
      return values.reduce((a, b) => a * b, 1);

    case 'divide':
      if (values.length !== 2 || values[1] === 0) return 0;
      return values[0] / values[1];

    case 'add':
      return values.reduce((a, b) => a + b, 0);

    case 'subtract':
      if (values.length !== 2) return 0;
      return values[0] - values[1];

    case 'polynomial':
      if (values.length !== 1) return 0;
      const degree = interaction.degree ?? 2;
      return Math.pow(values[0], degree);

    case 'ratio':
      if (values.length !== 2) return 0;
      const denominator = values[1] || 1; // Avoid division by zero
      return values[0] / denominator;

    case 'custom':
      if (!interaction.customFn) return 0;
      return interaction.customFn(values);

    default:
      return 0;
  }
}

// ============================================
// INTERACTION CREATION
// ============================================

/**
 * Add interaction features to examples
 */
export function addInteractions(
  examples: TrainingExample[],
  interactions: InteractionDefinition[]
): TrainingExample[] {
  return examples.map(e => {
    const newFeatures = { ...e.features } as unknown as Record<string, number>;

    for (const interaction of interactions) {
      const value = calculateInteraction(e.features, interaction);
      newFeatures[interaction.name] = value;
    }

    return {
      features: newFeatures as unknown as FeatureVector,
      label: e.label,
    };
  });
}

/**
 * Create interaction coefficients for a set of interactions
 */
export function createInteractionCoefficients(
  baseCoefficients: ModelCoefficients,
  interactions: InteractionDefinition[]
): ModelCoefficients {
  const newWeights = { ...baseCoefficients.weights } as unknown as Record<string, number>;
  const newMeans = { ...baseCoefficients.featureMeans } as unknown as Record<string, number>;
  const newStds = { ...baseCoefficients.featureStds } as unknown as Record<string, number>;

  for (const interaction of interactions) {
    newWeights[interaction.name] = 0; // Initialize to 0
    newMeans[interaction.name] = 0;
    newStds[interaction.name] = 1;
  }

  return {
    ...baseCoefficients,
    weights: newWeights as unknown as typeof baseCoefficients.weights,
    featureMeans: newMeans as unknown as typeof baseCoefficients.featureMeans,
    featureStds: newStds as unknown as typeof baseCoefficients.featureStds,
    version: baseCoefficients.version + '-interactions',
  };
}

// ============================================
// INTERACTION EVALUATION
// ============================================

/**
 * Evaluate a single interaction's impact
 */
export function evaluateInteraction(
  examples: TrainingExample[],
  interaction: InteractionDefinition,
  verbose: boolean = false
): InteractionResult {
  // Split data
  const splitIdx = Math.floor(examples.length * 0.8);
  const trainData = examples.slice(0, splitIdx);
  const valData = examples.slice(splitIdx);

  // Train baseline model
  const baselineCoefficients = trainModel(trainData, {
    learningRate: 0.01,
    iterations: 1000,
    regularization: 0.01,
    seed: 42,
  });
  const baselineMetrics = evaluateModel(valData, baselineCoefficients);
  const baselineAUC = baselineMetrics.auc;

  // Add interaction to data
  const trainWithInteraction = addInteractions(trainData, [interaction]);
  const valWithInteraction = addInteractions(valData, [interaction]);

  // Train model with interaction
  const interactionCoefficients = trainModel(trainWithInteraction, {
    learningRate: 0.01,
    iterations: 1000,
    regularization: 0.01,
    seed: 42,
  });
  const interactionMetrics = evaluateModel(valWithInteraction, interactionCoefficients);
  const withInteractionAUC = interactionMetrics.auc;

  const aucImprovement = withInteractionAUC - baselineAUC;
  const isSignificant = aucImprovement > 0.5; // 0.5% improvement threshold

  if (verbose) {
    console.log(`  ${interaction.name}: ${baselineAUC.toFixed(2)}% → ${withInteractionAUC.toFixed(2)}% (${aucImprovement >= 0 ? '+' : ''}${aucImprovement.toFixed(2)}%)${isSignificant ? ' ✓' : ''}`);
  }

  // Get coefficient for the interaction
  const coefficient = (interactionCoefficients.weights as unknown as Record<string, number>)[interaction.name] || 0;

  return {
    name: interaction.name,
    baselineAUC,
    withInteractionAUC,
    aucImprovement,
    isSignificant,
    coefficient,
  };
}

/**
 * Evaluate all candidate interactions
 */
export function analyzeInteractions(
  examples: TrainingExample[],
  candidateInteractions: InteractionDefinition[] = CANDIDATE_INTERACTIONS,
  options: { verbose?: boolean; minImprovement?: number } = {}
): InteractionAnalysisResult {
  const { verbose = false, minImprovement = 0.5 } = options;

  if (verbose) {
    console.log('Evaluating feature interactions...\n');
  }

  const results: InteractionResult[] = [];

  for (const interaction of candidateInteractions) {
    // Check if all required features exist
    const featureNames = Object.keys(examples[0].features);
    const hasAllFeatures = interaction.features.every(f => featureNames.includes(f));

    if (!hasAllFeatures) {
      if (verbose) {
        console.log(`  ${interaction.name}: Skipped (missing features)`);
      }
      continue;
    }

    const result = evaluateInteraction(examples, interaction, verbose);
    results.push(result);
  }

  // Sort by improvement
  results.sort((a, b) => b.aucImprovement - a.aucImprovement);

  // Calculate baseline AUC
  const splitIdx = Math.floor(examples.length * 0.8);
  const baselineCoefficients = trainModel(examples.slice(0, splitIdx), {
    learningRate: 0.01,
    iterations: 1000,
    regularization: 0.01,
    seed: 42,
  });
  const baselineMetrics = evaluateModel(examples.slice(splitIdx), baselineCoefficients);

  // Identify recommended interactions
  const recommendedInteractions = results
    .filter(r => r.aucImprovement >= minImprovement)
    .map(r => r.name);

  // Calculate total potential improvement
  const totalAUCImprovement = recommendedInteractions.length > 0
    ? results.filter(r => r.aucImprovement >= minImprovement)
        .reduce((sum, r) => sum + r.aucImprovement, 0)
    : 0;

  // Generate recommendations
  const recommendations: string[] = [];

  if (recommendedInteractions.length > 0) {
    recommendations.push(
      `${recommendedInteractions.length} interactions show significant improvement. ` +
      `Adding these could improve AUC by up to ${totalAUCImprovement.toFixed(1)}%.`
    );
  } else {
    recommendations.push(
      'No interactions showed significant improvement (>0.5%). ' +
      'The existing features may already capture these relationships.'
    );
  }

  if (results.some(r => r.aucImprovement < -1)) {
    const harmful = results.filter(r => r.aucImprovement < -1).map(r => r.name);
    recommendations.push(
      `Warning: Some interactions hurt performance: ${harmful.join(', ')}. ` +
      'These should be avoided.'
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    baselineAUC: baselineMetrics.auc,
    interactions: results,
    recommendedInteractions,
    totalAUCImprovement,
    recommendations,
  };
}

// ============================================
// COMBINED TRAINING
// ============================================

/**
 * Train a model with selected interactions
 */
export function trainWithInteractions(
  examples: TrainingExample[],
  interactions: InteractionDefinition[]
): { coefficients: ModelCoefficients; metrics: { auc: number; accuracy: number } } {
  // Add interactions to all examples
  const enhancedExamples = addInteractions(examples, interactions);

  // Split data
  const splitIdx = Math.floor(enhancedExamples.length * 0.8);
  const trainData = enhancedExamples.slice(0, splitIdx);
  const valData = enhancedExamples.slice(splitIdx);

  // Train model
  const coefficients = trainModel(trainData, {
    learningRate: 0.01,
    iterations: 1000,
    regularization: 0.01,
    seed: 42,
  });

  // Evaluate
  const metrics = evaluateModel(valData, coefficients);

  return {
    coefficients,
    metrics: {
      auc: metrics.auc,
      accuracy: metrics.accuracy,
    },
  };
}

// ============================================
// FORMATTING
// ============================================

/**
 * Format interaction analysis results
 */
export function formatInteractionReport(result: InteractionAnalysisResult): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('╔══════════════════════════════════════════════════════════════════╗');
  lines.push('║              FEATURE INTERACTIONS REPORT                         ║');
  lines.push('╚══════════════════════════════════════════════════════════════════╝');
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`Baseline AUC: ${result.baselineAUC.toFixed(1)}%`);

  // All interactions
  lines.push('\n┌────────────────────────────────────────────────────────────────┐');
  lines.push('│                  INTERACTION ANALYSIS                          │');
  lines.push('├──────┬────────────────────────┬──────────┬──────────┬──────────┤');
  lines.push('│ Rank │ Interaction            │ Baseline │   With   │  Change  │');
  lines.push('├──────┼────────────────────────┼──────────┼──────────┼──────────┤');

  for (let i = 0; i < Math.min(result.interactions.length, 15); i++) {
    const r = result.interactions[i];
    const rank = (i + 1).toString().padStart(4);
    const name = r.name.length > 20 ? r.name.substring(0, 17) + '...' : r.name;
    const baseline = r.baselineAUC.toFixed(1).padStart(6) + '%';
    const withInt = r.withInteractionAUC.toFixed(1).padStart(6) + '%';
    const change = (r.aucImprovement >= 0 ? '+' : '') + r.aucImprovement.toFixed(2) + '%';
    const marker = r.isSignificant ? ' ✓' : '';

    lines.push(`│ ${rank} │ ${name.padEnd(22)} │ ${baseline} │ ${withInt} │ ${change.padStart(7)}${marker} │`);
  }
  lines.push('└──────┴────────────────────────┴──────────┴──────────┴──────────┘');

  // Recommended interactions
  if (result.recommendedInteractions.length > 0) {
    lines.push('\n┌────────────────────────────────────────────────────────────────┐');
    lines.push('│              RECOMMENDED INTERACTIONS                          │');
    lines.push('├────────────────────────────────────────────────────────────────┤');

    for (const name of result.recommendedInteractions) {
      const r = result.interactions.find(i => i.name === name)!;
      const desc = CANDIDATE_INTERACTIONS.find(i => i.name === name)?.description || '';
      lines.push(`│  ${name.padEnd(25)} +${r.aucImprovement.toFixed(2)}%               │`);
      if (desc) {
        lines.push(`│    ${desc.padEnd(60)} │`);
      }
    }
    lines.push('└────────────────────────────────────────────────────────────────┘');
  }

  // Recommendations
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

  // Summary
  lines.push('\n=================================================================');
  lines.push('SUMMARY');
  lines.push('=================================================================');
  lines.push(`Interactions tested: ${result.interactions.length}`);
  lines.push(`Significant improvements: ${result.recommendedInteractions.length}`);
  lines.push(`Potential total AUC improvement: +${result.totalAUCImprovement.toFixed(1)}%`);

  return lines.join('\n');
}
