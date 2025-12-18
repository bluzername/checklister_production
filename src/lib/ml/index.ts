/**
 * ML Module
 * Exports experiment tracking and model registry components
 */

// Types
export * from './types';

// Experiment Tracking
export {
  createExperiment,
  getExperiment,
  updateExperiment,
  logMetrics,
  completeExperiment,
  listExperiments,
  getLatestExperiment,
  deleteExperiment,
  getExperimentStats,
  compareExperiments,
  formatExperimentSummary,
  formatExperimentsTable,
} from './experiment-tracker';

// Model Registry
export {
  registerModel,
  getModel,
  getProductionModel,
  loadModelCoefficients,
  listModels,
  promoteToProduction,
  rollbackModel,
  compareModels,
  updateBacktestMetrics,
  formatModelSummary,
  formatModelsTable,
  formatComparisonReport,
} from './model-registry';

// Data Splitting
export {
  stratifiedSplit,
  trainValidationSplit,
  temporalSplit,
  generateStratifiedKFolds,
  calculateSplitStats,
  verifyClassBalance,
  formatSplitStats,
  type SplitResult,
  type SplitConfig,
  type SplitStats,
  type KFold,
} from './data-splitter';

// Cross-Validation
export {
  crossValidate,
  timeSeriesCrossValidate,
  formatCVResults,
  serializeCVResults,
  type CVResult,
  type CVOptions,
  type MetricStats,
  type FoldResult,
} from './cross-validation';

// Ticker Splits (Holdout Test Set Protection)
export {
  getTickerSplits,
  getTrainTickers,
  getValidationTickers,
  getTestTickers,
  isTestTicker,
  isTrainTicker,
  isValidationTicker,
  getTickersBySplit,
  getSplitInfo,
  formatSplitInfo,
  getTrainUniverseBySize,
  getValidationUniverseBySize,
  SPLIT_CONFIG,
  type TickerSplits,
  type SplitInfo,
} from './ticker-splits';

// Feature Analysis
export {
  coefficientImportance,
  permutationImportance,
  ablationStudy,
  combineImportanceScores,
  analyzeFeatureImportance,
  formatFeatureImportanceReport,
  type FeatureImportance,
  type FeatureImportanceResult,
  type PermutationResult,
  type AblationResult,
  type AnalysisOptions,
} from './feature-analysis';

// Feature Selection
export {
  selectFeatures,
  selectByImportance,
  selectByCorrelation,
  calculateCorrelationMatrix,
  findCorrelatedPairs,
  createReducedDataset,
  createReducedCoefficients,
  evaluateFeatureSelection,
  trainReducedModel,
  formatSelectionReport,
  type FeatureSelectionConfig,
  type FeatureSelectionResult,
  type CorrelationPair,
} from './feature-selector';

// Feature Interactions
export {
  calculateInteraction,
  addInteractions,
  createInteractionCoefficients,
  evaluateInteraction,
  analyzeInteractions,
  trainWithInteractions,
  formatInteractionReport,
  CANDIDATE_INTERACTIONS,
  type InteractionDefinition,
  type InteractionResult,
  type InteractionAnalysisResult,
} from './feature-interactions';

// Feature Pipeline
export {
  applyFeatureConfig,
  runFeaturePipeline,
  saveFeatureConfig,
  loadFeatureConfig,
  createFeatureConfig,
  formatPipelineReport,
  DEFAULT_FEATURE_CONFIG,
  LEAN_FEATURE_CONFIG,
  type FeatureConfig,
  type PipelineResult,
} from './feature-pipeline';

// Ensemble Learning
export {
  trainEnsemble,
  ensemblePredict,
  ensemblePredictProbability,
  evaluateEnsemble,
  serializeEnsemble,
  deserializeEnsemble,
  formatEnsembleReport,
  type EnsembleModel,
  type EnsembleMetrics,
  type EnsemblePrediction,
} from './ensemble';

// PIT Safety Contract
export {
  FEATURE_PIT_CONTRACTS,
  getUnsafeFeatures,
  getSafeFeatures,
  isFeaturePITSafe,
  validatePITSafety,
  printPITSafetySummary,
  type PITSafetyStatus,
  type FeaturePITContract,
} from './feature-pit-safety';

// PIT Enforcement
export {
  enablePITEnforcement,
  disablePITEnforcement,
  isPITEnforcementEnabled,
  validateAsOfDate,
  logPITWarning,
  validateFeatureVector,
  assertDateNotFuture,
  getPITStats,
  printPITEnforcementSummary,
  withPITEnforcement,
  createPITSafeCacheKey,
} from './pit-enforcement';

// EV-Based Ranking (D4)
export {
  loadEVModel,
  resetEVModel,
  predictProbability as predictEVProbability,
  calculateExpectedR,
  calculateExpectedValue,
  rankCandidates,
  rankByAnalysisScore,
  calculateBreakEvenWinRate,
  analyzeStrategyEdge,
  printRankingSummary,
  DEFAULT_EV_CONFIG,
  type TradeCandidate,
  type RankedCandidate,
  type EVRankingConfig,
} from './ev-ranking';
