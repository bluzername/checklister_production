/**
 * ML Types
 * Shared types for experiment tracking and model registry
 */

// ============================================
// EXPERIMENT TRACKING
// ============================================

export type ExperimentType = 'training' | 'backtest' | 'optimization';
export type ExperimentStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ExperimentConfig {
  // Training parameters
  learningRate?: number;
  iterations?: number;
  regularization?: number;
  regularizationType?: 'L1' | 'L2' | 'elastic';
  initStrategy?: string;
  momentum?: number;
  seed?: number;

  // Data parameters
  trainValSplit?: number;
  stratified?: boolean;
  crossValidationFolds?: number;

  // Feature configuration
  features?: string[];
  featureConfig?: {
    dropFeatures?: string[];
    interactions?: [string, string][];
  };

  // Backtest parameters
  entryThreshold?: number;
  minRRRatio?: number;
  maxPositions?: number;
  months?: number;
  universe?: string;
}

export interface ExperimentMetrics {
  // Classification metrics
  auc?: number;
  accuracy?: number;
  precision?: number;
  recall?: number;
  f1Score?: number;
  calibrationError?: number;

  // Backtest metrics
  backtestWinRate?: number;
  sharpeRatio?: number;
  sortinoRatio?: number;
  profitFactor?: number;
  maxDrawdown?: number;
  totalReturn?: number;
  totalTrades?: number;
  avgR?: number;

  // Cross-validation results
  cvAucMean?: number;
  cvAucStd?: number;
  cvAccuracyMean?: number;
  cvAccuracyStd?: number;
}

export interface Experiment {
  id: string;
  name: string;
  type: ExperimentType;
  status: ExperimentStatus;
  config: ExperimentConfig;
  metrics: ExperimentMetrics;
  startedAt: string;
  completedAt?: string;
  duration?: number;  // milliseconds
  notes?: string;
  parentId?: string;  // For tracking experiment lineage
  tags?: string[];
  modelVersion?: string;  // If this experiment produced a model
}

export interface ExperimentFilter {
  type?: ExperimentType;
  status?: ExperimentStatus;
  tags?: string[];
  fromDate?: string;
  toDate?: string;
  minAuc?: number;
  modelVersion?: string;
}

// ============================================
// MODEL REGISTRY
// ============================================

export interface ValidationMetrics {
  auc: number;
  calibrationError: number;
  accuracy: number;
  precision?: number;
  recall?: number;
  f1Score?: number;
}

export interface BacktestMetrics {
  winRate: number;
  sharpeRatio: number;
  profitFactor: number;
  totalReturn?: number;
  maxDrawdown?: number;
  totalTrades?: number;
}

export interface RegisteredModel {
  version: string;              // Semantic version: v1.2.0
  experimentId: string;         // Link to training experiment
  coefficientsPath: string;     // Path to coefficients JSON file
  modelType: 'logistic' | 'ensemble' | 'gbm' | 'neural';
  featureCount: number;
  trainingSamples: number;
  validationMetrics: ValidationMetrics;
  backtestMetrics?: BacktestMetrics;
  isProduction: boolean;
  createdAt: string;
  promotedAt?: string;
  retiredAt?: string;
  tags: string[];
  notes?: string;
  parentVersion?: string;       // For tracking model lineage
}

export interface ModelRegistry {
  currentProductionVersion: string | null;
  models: RegisteredModel[];
  lastUpdated: string;
}

export interface ModelComparison {
  v1: string;
  v2: string;
  validationDelta: {
    auc: number;
    calibrationError: number;
    accuracy: number;
  };
  backtestDelta?: {
    winRate: number;
    sharpeRatio: number;
    profitFactor: number;
  };
  recommendation: 'promote_v2' | 'keep_v1' | 'needs_review';
  significanceTest?: {
    pValue: number;
    significant: boolean;
  };
}

export interface ModelFilter {
  modelType?: string;
  isProduction?: boolean;
  tags?: string[];
  minAuc?: number;
  fromDate?: string;
  toDate?: string;
}

// ============================================
// PERFORMANCE TRACKING
// ============================================

export interface PerformanceSnapshot {
  date: string;
  modelVersion: string;
  metrics: {
    auc: number;
    calibrationError: number;
    backtestWinRate?: number;
    backtestSharpe?: number;
  };
  notes?: string;
}

export interface PerformanceHistory {
  snapshots: PerformanceSnapshot[];
  bestAuc: { version: string; value: number };
  bestSharpe: { version: string; value: number };
  lastUpdated: string;
}

// ============================================
// FEATURE ANALYSIS
// ============================================

export interface FeatureImportance {
  feature: string;
  weight: number;
  normalizedWeight: number;
  permutationImportance?: number;
  rank: number;
}

export interface FeatureCorrelation {
  feature1: string;
  feature2: string;
  correlation: number;
}

export interface FeatureAnalysisReport {
  modelVersion: string;
  analyzedAt: string;
  featureCount: number;
  importanceRanking: FeatureImportance[];
  highCorrelations: FeatureCorrelation[];  // |r| > 0.85
  lowImportanceFeatures: string[];          // < 1% contribution
  recommendations: string[];
}

// ============================================
// CROSS-VALIDATION
// ============================================

export interface CVFoldResult {
  fold: number;
  trainSize: number;
  valSize: number;
  metrics: ExperimentMetrics;
}

export interface CVResult {
  folds: number;
  stratified: boolean;
  results: CVFoldResult[];
  aggregated: {
    auc: { mean: number; std: number; min: number; max: number };
    accuracy: { mean: number; std: number; min: number; max: number };
    calibrationError: { mean: number; std: number; min: number; max: number };
  };
  stable: boolean;  // std < 3%
}

// ============================================
// UTILITY TYPES
// ============================================

export type MetricName = keyof ExperimentMetrics;

export interface MetricThreshold {
  metric: MetricName;
  minValue?: number;
  maxValue?: number;
}

export interface PromotionCriteria {
  minAuc: number;
  maxCalibrationError: number;
  minBacktestWinRate?: number;
  minBacktestSharpe?: number;
  requiresBacktest: boolean;
}

export const DEFAULT_PROMOTION_CRITERIA: PromotionCriteria = {
  minAuc: 0.65,
  maxCalibrationError: 0.10,
  minBacktestWinRate: 0.45,
  minBacktestSharpe: 0.2,
  requiresBacktest: true,
};
