/**
 * Feature Engineering Pipeline
 * Orchestrates feature selection, interactions, and transformations
 */

import * as fs from 'fs';
import {
  TrainingExample,
  ModelCoefficients,
} from '../model/logistic';
import { FeatureVector } from '../backtest/types';
import {
  analyzeFeatureImportance,
  FeatureImportanceResult,
} from './feature-analysis';
import {
  selectFeatures,
  createReducedDataset,
  createReducedCoefficients,
  calculateCorrelationMatrix,
  findCorrelatedPairs,
  FeatureSelectionResult,
} from './feature-selector';
import {
  addInteractions,
  InteractionDefinition,
  CANDIDATE_INTERACTIONS,
} from './feature-interactions';

// ============================================
// TYPES
// ============================================

export interface FeatureConfig {
  version: string;
  baseFeatures: string[];           // Which features to include
  interactions: InteractionDefinition[];  // Feature interactions to add
  dropFeatures: string[];           // Features to explicitly drop
  selectionMethod: 'importance' | 'correlation' | 'combined' | 'manual';
  importanceThreshold: number;
  correlationThreshold: number;
}

export interface PipelineResult {
  config: FeatureConfig;
  originalFeatureCount: number;
  finalFeatureCount: number;
  selectedFeatures: string[];
  droppedFeatures: string[];
  addedInteractions: string[];
  importanceAnalysis?: FeatureImportanceResult;
  selectionResult?: FeatureSelectionResult;
  transformedExamples: TrainingExample[];
  reducedCoefficients?: ModelCoefficients;
}

// ============================================
// DEFAULT CONFIG
// ============================================

/**
 * Default feature configuration based on Phase 3 findings
 */
export const DEFAULT_FEATURE_CONFIG: FeatureConfig = {
  version: '1.0.0',
  baseFeatures: [
    // Top 10 features from importance analysis
    'price_vs_20ema',
    'score_rsi',
    'regime_confidence',
    'vix_level',
    'sector_rs_60d',
    'sector_rs_20d',
    'obv_trend',
    'rvol',
    'score_ma_fibonacci',
    'gap_percent',
  ],
  interactions: [],  // No interactions improved AUC
  dropFeatures: [
    // Low importance features
    'mtf_daily_score',
    'mtf_4h_score',
    'mtf_combined_score',
    'mtf_alignment',
    'higher_lows',
    'trend_status',
    'golden_cross',
    'rr_ratio',
    'pattern_type',
    'score_patterns_gaps',
    'cmf_value',
    'price_vs_200sma',
  ],
  selectionMethod: 'importance',
  importanceThreshold: 0.05,
  correlationThreshold: 0.85,
};

/**
 * Lean feature configuration - minimal feature set
 */
export const LEAN_FEATURE_CONFIG: FeatureConfig = {
  version: '1.0.0-lean',
  baseFeatures: [
    // Top 5 most important features only
    'price_vs_20ema',
    'score_rsi',
    'regime_confidence',
    'vix_level',
    'sector_rs_60d',
  ],
  interactions: [],
  dropFeatures: [],  // Will drop everything not in baseFeatures
  selectionMethod: 'manual',
  importanceThreshold: 0.1,
  correlationThreshold: 0.85,
};

// ============================================
// PIPELINE FUNCTIONS
// ============================================

function getFeatureValue(features: FeatureVector, name: string): number {
  return (features as unknown as Record<string, number>)[name] ?? 0;
}

/**
 * Apply feature configuration to examples
 */
export function applyFeatureConfig(
  examples: TrainingExample[],
  config: FeatureConfig
): TrainingExample[] {
  // Start with all examples
  let transformedExamples = examples;

  // 1. Add interactions if any
  if (config.interactions.length > 0) {
    transformedExamples = addInteractions(transformedExamples, config.interactions);
  }

  // 2. Filter to only include base features (and interactions)
  const allowedFeatures = new Set([
    ...config.baseFeatures,
    ...config.interactions.map(i => i.name),
  ]);

  transformedExamples = transformedExamples.map(e => {
    const filteredFeatures: Record<string, number> = {};

    for (const name of Array.from(allowedFeatures)) {
      const value = getFeatureValue(e.features, name);
      if (value !== undefined) {
        filteredFeatures[name] = value;
      }
    }

    return {
      features: filteredFeatures as unknown as FeatureVector,
      label: e.label,
    };
  });

  return transformedExamples;
}

/**
 * Run the full feature engineering pipeline
 */
export function runFeaturePipeline(
  examples: TrainingExample[],
  coefficients: ModelCoefficients,
  config?: Partial<FeatureConfig>
): PipelineResult {
  const fullConfig: FeatureConfig = {
    ...DEFAULT_FEATURE_CONFIG,
    ...config,
  };

  const originalFeatureCount = Object.keys(examples[0].features).length;
  let selectedFeatures: string[] = [];
  let droppedFeatures: string[] = [];
  let importanceAnalysis: FeatureImportanceResult | undefined;
  let selectionResult: FeatureSelectionResult | undefined;

  // 1. Determine which features to keep based on selection method
  if (fullConfig.selectionMethod === 'manual') {
    // Use manually specified base features
    selectedFeatures = fullConfig.baseFeatures;
    const allFeatures = Object.keys(examples[0].features);
    droppedFeatures = allFeatures.filter(f => !selectedFeatures.includes(f));
  } else {
    // Run automatic selection
    console.log('Running automatic feature selection...');
    selectionResult = selectFeatures(examples, coefficients, {
      method: fullConfig.selectionMethod,
      importanceThreshold: fullConfig.importanceThreshold,
      correlationThreshold: fullConfig.correlationThreshold,
      excludeFeatures: fullConfig.dropFeatures,
    });

    selectedFeatures = selectionResult.selectedFeatures;
    droppedFeatures = selectionResult.removedFeatures;

    // Also run importance analysis for reference
    importanceAnalysis = analyzeFeatureImportance(examples, coefficients, {
      includePermutation: true,
      verbose: false,
    });
  }

  // 2. Update config with selected features
  fullConfig.baseFeatures = selectedFeatures;

  // 3. Apply configuration to transform examples
  const transformedExamples = applyFeatureConfig(examples, fullConfig);

  // 4. Create reduced coefficients
  const reducedCoefficients = createReducedCoefficients(
    coefficients,
    selectedFeatures
  );

  return {
    config: fullConfig,
    originalFeatureCount,
    finalFeatureCount: selectedFeatures.length + fullConfig.interactions.length,
    selectedFeatures,
    droppedFeatures,
    addedInteractions: fullConfig.interactions.map(i => i.name),
    importanceAnalysis,
    selectionResult,
    transformedExamples,
    reducedCoefficients,
  };
}

// ============================================
// CONFIG MANAGEMENT
// ============================================

/**
 * Save feature configuration to file
 */
export function saveFeatureConfig(config: FeatureConfig, path: string): void {
  const configWithMeta = {
    ...config,
    savedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path, JSON.stringify(configWithMeta, null, 2));
}

/**
 * Load feature configuration from file
 */
export function loadFeatureConfig(path: string): FeatureConfig {
  if (!fs.existsSync(path)) {
    console.log(`Config not found at ${path}, using default.`);
    return DEFAULT_FEATURE_CONFIG;
  }
  return JSON.parse(fs.readFileSync(path, 'utf-8')) as FeatureConfig;
}

/**
 * Create a custom feature configuration
 */
export function createFeatureConfig(options: {
  baseFeatures: string[];
  interactions?: InteractionDefinition[];
  dropFeatures?: string[];
  selectionMethod?: 'importance' | 'correlation' | 'combined' | 'manual';
  version?: string;
}): FeatureConfig {
  return {
    version: options.version || '1.0.0-custom',
    baseFeatures: options.baseFeatures,
    interactions: options.interactions || [],
    dropFeatures: options.dropFeatures || [],
    selectionMethod: options.selectionMethod || 'manual',
    importanceThreshold: 0.05,
    correlationThreshold: 0.85,
  };
}

// ============================================
// FORMATTING
// ============================================

/**
 * Format pipeline results for display
 */
export function formatPipelineReport(result: PipelineResult): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('╔══════════════════════════════════════════════════════════════════╗');
  lines.push('║             FEATURE ENGINEERING PIPELINE REPORT                  ║');
  lines.push('╚══════════════════════════════════════════════════════════════════╝');
  lines.push(`Config version: ${result.config.version}`);
  lines.push(`Selection method: ${result.config.selectionMethod}`);

  // Summary
  lines.push('\n┌────────────────────────────────────────────────────────────────┐');
  lines.push('│                        SUMMARY                                 │');
  lines.push('├────────────────────────────────────────────────────────────────┤');
  lines.push(`│  Original features:     ${result.originalFeatureCount.toString().padEnd(39)} │`);
  lines.push(`│  Final features:        ${result.finalFeatureCount.toString().padEnd(39)} │`);
  lines.push(`│  Dropped:               ${result.droppedFeatures.length.toString().padEnd(39)} │`);
  lines.push(`│  Interactions added:    ${result.addedInteractions.length.toString().padEnd(39)} │`);
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

  // Performance if available
  if (result.selectionResult) {
    const perf = result.selectionResult.performanceComparison;
    lines.push('\n┌────────────────────────────────────────────────────────────────┐');
    lines.push('│                  PERFORMANCE IMPACT                            │');
    lines.push('├────────────────────────────────────────────────────────────────┤');
    lines.push(`│  Original AUC:     ${perf.originalAUC.toFixed(1).padStart(6)}%                                   │`);
    lines.push(`│  Reduced AUC:      ${perf.reducedAUC.toFixed(1).padStart(6)}%                                   │`);
    lines.push(`│  AUC Change:       ${perf.aucDrop >= 0 ? '-' : '+'}${Math.abs(perf.aucDrop).toFixed(2).padStart(5)}%                                   │`);
    lines.push('└────────────────────────────────────────────────────────────────┘');
  }

  return lines.join('\n');
}
