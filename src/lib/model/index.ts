/**
 * Model Module
 * Exports ML model components for trade prediction
 */

// Labeling (Legacy - simple forward sim)
export {
  labelTrade,
  batchLabelTrades,
  calculateLabelStats,
  analyzeOptimalExit,
} from './labeling';
export type { TradeLabelResult } from './labeling';

// Labeling (Engine-based - matches simulator, recommended)
export {
  labelTradeWithEngine,
  batchLabelTradesWithEngine,
  calculateEngineLabelStats,
} from './labeling';
export type { EngineLabelResult } from './labeling';

// Logistic Regression
export {
  predictProbability,
  getFeatureImportance,
  trainModel,
  evaluateModel,
  serializeCoefficients,
  deserializeCoefficients,
  loadTrainedCoefficients,
  getActiveCoefficients,
  resetLoadedCoefficients,
  hasTrainedModel,
  DEFAULT_COEFFICIENTS,
} from './logistic';
export type { ModelCoefficients, TrainingExample, TrainingOptions, InitStrategy } from './logistic';

// Calibration
export {
  plattCalibrate,
  fitPlattScaling,
  isotonicCalibrate,
  fitIsotonicRegression,
  ensembleCalibrate,
  fitEnsembleCalibrator,
  evaluateCalibration,
  temperatureScale,
  findOptimalTemperature,
} from './calibration';
export type { PlattParameters, IsotonicModel, EnsembleCalibrator } from './calibration';




