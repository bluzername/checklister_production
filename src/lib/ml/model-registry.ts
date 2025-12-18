/**
 * Model Registry
 * Version and compare trained models systematically
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  RegisteredModel,
  ModelRegistry,
  ModelComparison,
  ModelFilter,
  ValidationMetrics,
  BacktestMetrics,
  DEFAULT_PROMOTION_CRITERIA,
  PromotionCriteria,
} from './types';
import { ModelCoefficients } from '../model/logistic';

// ============================================
// CONFIGURATION
// ============================================

const MODELS_DIR = path.join(process.cwd(), 'data', 'models');
const REGISTRY_FILE = path.join(MODELS_DIR, 'registry.json');
const PRODUCTION_COEFFICIENTS = path.join(process.cwd(), 'data', 'model-coefficients.json');

// ============================================
// INITIALIZATION
// ============================================

function ensureDirectoryExists(): void {
  if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
  }
}

function loadRegistry(): ModelRegistry {
  ensureDirectoryExists();
  if (fs.existsSync(REGISTRY_FILE)) {
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf-8'));
  }
  return {
    currentProductionVersion: null,
    models: [],
    lastUpdated: new Date().toISOString(),
  };
}

function saveRegistry(registry: ModelRegistry): void {
  registry.lastUpdated = new Date().toISOString();
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

// ============================================
// VERSION MANAGEMENT
// ============================================

/**
 * Parse semantic version string
 */
function parseVersion(version: string): { major: number; minor: number; patch: number } {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Invalid version format: ${version}`);
  }
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

/**
 * Get the next version number
 */
function getNextVersion(
  registry: ModelRegistry,
  bumpType: 'major' | 'minor' | 'patch' = 'patch'
): string {
  if (registry.models.length === 0) {
    return 'v1.0.0';
  }

  // Find highest version
  let maxVersion = { major: 0, minor: 0, patch: 0 };
  for (const model of registry.models) {
    const v = parseVersion(model.version);
    if (
      v.major > maxVersion.major ||
      (v.major === maxVersion.major && v.minor > maxVersion.minor) ||
      (v.major === maxVersion.major && v.minor === maxVersion.minor && v.patch > maxVersion.patch)
    ) {
      maxVersion = v;
    }
  }

  // Bump version
  switch (bumpType) {
    case 'major':
      return `v${maxVersion.major + 1}.0.0`;
    case 'minor':
      return `v${maxVersion.major}.${maxVersion.minor + 1}.0`;
    case 'patch':
    default:
      return `v${maxVersion.major}.${maxVersion.minor}.${maxVersion.patch + 1}`;
  }
}

// ============================================
// MODEL REGISTRATION
// ============================================

/**
 * Register a new model version
 */
export function registerModel(
  experimentId: string,
  coefficients: ModelCoefficients,
  validationMetrics: ValidationMetrics,
  options?: {
    modelType?: 'logistic' | 'ensemble' | 'gbm' | 'neural';
    backtestMetrics?: BacktestMetrics;
    tags?: string[];
    notes?: string;
    bumpType?: 'major' | 'minor' | 'patch';
    parentVersion?: string;
  }
): string {
  ensureDirectoryExists();
  const registry = loadRegistry();

  const version = getNextVersion(registry, options?.bumpType || 'patch');
  const coefficientsPath = path.join(MODELS_DIR, `${version}.json`);

  // Save coefficients with version metadata
  const coefficientsWithMeta = {
    ...coefficients,
    version,
    registeredAt: new Date().toISOString(),
  };
  fs.writeFileSync(coefficientsPath, JSON.stringify(coefficientsWithMeta, null, 2));

  // Create registered model entry
  const model: RegisteredModel = {
    version,
    experimentId,
    coefficientsPath: `data/models/${version}.json`,
    modelType: options?.modelType || 'logistic',
    featureCount: Object.keys(coefficients.weights).length,
    trainingSamples: coefficients.trainingSamples,
    validationMetrics,
    backtestMetrics: options?.backtestMetrics,
    isProduction: false,
    createdAt: new Date().toISOString(),
    tags: options?.tags || [],
    notes: options?.notes,
    parentVersion: options?.parentVersion,
  };

  registry.models.push(model);
  saveRegistry(registry);

  console.log(`[Registry] Registered model ${version}`);
  console.log(`   AUC: ${(validationMetrics.auc * 100).toFixed(1)}%`);
  console.log(`   Calibration Error: ${(validationMetrics.calibrationError * 100).toFixed(1)}%`);

  return version;
}

/**
 * Get a model by version
 */
export function getModel(version: string): RegisteredModel | null {
  const registry = loadRegistry();
  return registry.models.find(m => m.version === version) || null;
}

/**
 * Get the current production model
 */
export function getProductionModel(): RegisteredModel | null {
  const registry = loadRegistry();
  if (!registry.currentProductionVersion) {
    return null;
  }
  return getModel(registry.currentProductionVersion);
}

/**
 * Load coefficients for a model version
 */
export function loadModelCoefficients(version: string): ModelCoefficients | null {
  const model = getModel(version);
  if (!model) {
    return null;
  }

  const fullPath = path.join(process.cwd(), model.coefficientsPath);
  if (!fs.existsSync(fullPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
}

/**
 * List all models with optional filtering
 */
export function listModels(filter?: ModelFilter): RegisteredModel[] {
  const registry = loadRegistry();
  let models = [...registry.models];

  if (filter) {
    if (filter.modelType) {
      models = models.filter(m => m.modelType === filter.modelType);
    }
    if (filter.isProduction !== undefined) {
      models = models.filter(m => m.isProduction === filter.isProduction);
    }
    if (filter.tags && filter.tags.length > 0) {
      models = models.filter(m =>
        filter.tags!.some(tag => m.tags.includes(tag))
      );
    }
    if (filter.minAuc !== undefined) {
      models = models.filter(m => m.validationMetrics.auc >= filter.minAuc!);
    }
    if (filter.fromDate) {
      models = models.filter(m => m.createdAt >= filter.fromDate!);
    }
    if (filter.toDate) {
      models = models.filter(m => m.createdAt <= filter.toDate!);
    }
  }

  // Sort by version descending (newest first)
  models.sort((a, b) => {
    const va = parseVersion(a.version);
    const vb = parseVersion(b.version);
    if (va.major !== vb.major) return vb.major - va.major;
    if (va.minor !== vb.minor) return vb.minor - va.minor;
    return vb.patch - va.patch;
  });

  return models;
}

// ============================================
// PROMOTION & ROLLBACK
// ============================================

/**
 * Promote a model to production
 */
export function promoteToProduction(
  version: string,
  criteria?: PromotionCriteria
): { success: boolean; reason?: string } {
  const registry = loadRegistry();
  const model = registry.models.find(m => m.version === version);

  if (!model) {
    return { success: false, reason: `Model ${version} not found` };
  }

  // Check promotion criteria
  const c = criteria || DEFAULT_PROMOTION_CRITERIA;

  if (model.validationMetrics.auc < c.minAuc) {
    return {
      success: false,
      reason: `AUC ${(model.validationMetrics.auc * 100).toFixed(1)}% below minimum ${(c.minAuc * 100).toFixed(1)}%`,
    };
  }

  if (model.validationMetrics.calibrationError > c.maxCalibrationError) {
    return {
      success: false,
      reason: `Calibration error ${(model.validationMetrics.calibrationError * 100).toFixed(1)}% above maximum ${(c.maxCalibrationError * 100).toFixed(1)}%`,
    };
  }

  if (c.requiresBacktest && !model.backtestMetrics) {
    return { success: false, reason: 'Backtest metrics required but not available' };
  }

  if (c.minBacktestWinRate && model.backtestMetrics) {
    if (model.backtestMetrics.winRate < c.minBacktestWinRate) {
      return {
        success: false,
        reason: `Win rate ${(model.backtestMetrics.winRate * 100).toFixed(1)}% below minimum ${(c.minBacktestWinRate * 100).toFixed(1)}%`,
      };
    }
  }

  if (c.minBacktestSharpe && model.backtestMetrics) {
    if (model.backtestMetrics.sharpeRatio < c.minBacktestSharpe) {
      return {
        success: false,
        reason: `Sharpe ${model.backtestMetrics.sharpeRatio.toFixed(2)} below minimum ${c.minBacktestSharpe.toFixed(2)}`,
      };
    }
  }

  // Demote current production model
  for (const m of registry.models) {
    if (m.isProduction) {
      m.isProduction = false;
    }
  }

  // Promote new model
  model.isProduction = true;
  model.promotedAt = new Date().toISOString();
  registry.currentProductionVersion = version;

  // Copy coefficients to production location
  const coefficients = loadModelCoefficients(version);
  if (coefficients) {
    fs.writeFileSync(PRODUCTION_COEFFICIENTS, JSON.stringify(coefficients, null, 2));
  }

  saveRegistry(registry);

  console.log(`[Registry] ✓ Promoted ${version} to production`);
  return { success: true };
}

/**
 * Rollback to a previous model version
 */
export function rollbackModel(toVersion: string): { success: boolean; reason?: string } {
  const model = getModel(toVersion);
  if (!model) {
    return { success: false, reason: `Model ${toVersion} not found` };
  }

  const registry = loadRegistry();
  const currentProd = registry.currentProductionVersion;

  // Demote current
  for (const m of registry.models) {
    if (m.isProduction) {
      m.isProduction = false;
      m.retiredAt = new Date().toISOString();
    }
  }

  // Promote rollback target
  const targetModel = registry.models.find(m => m.version === toVersion);
  if (targetModel) {
    targetModel.isProduction = true;
    targetModel.promotedAt = new Date().toISOString();
    registry.currentProductionVersion = toVersion;
  }

  // Copy coefficients
  const coefficients = loadModelCoefficients(toVersion);
  if (coefficients) {
    fs.writeFileSync(PRODUCTION_COEFFICIENTS, JSON.stringify(coefficients, null, 2));
  }

  saveRegistry(registry);

  console.log(`[Registry] ↩ Rolled back from ${currentProd} to ${toVersion}`);
  return { success: true };
}

// ============================================
// COMPARISON
// ============================================

/**
 * Compare two model versions
 */
export function compareModels(v1: string, v2: string): ModelComparison | null {
  const model1 = getModel(v1);
  const model2 = getModel(v2);

  if (!model1 || !model2) {
    return null;
  }

  const validationDelta = {
    auc: model2.validationMetrics.auc - model1.validationMetrics.auc,
    calibrationError: model2.validationMetrics.calibrationError - model1.validationMetrics.calibrationError,
    accuracy: model2.validationMetrics.accuracy - model1.validationMetrics.accuracy,
  };

  let backtestDelta: ModelComparison['backtestDelta'];
  if (model1.backtestMetrics && model2.backtestMetrics) {
    backtestDelta = {
      winRate: model2.backtestMetrics.winRate - model1.backtestMetrics.winRate,
      sharpeRatio: model2.backtestMetrics.sharpeRatio - model1.backtestMetrics.sharpeRatio,
      profitFactor: model2.backtestMetrics.profitFactor - model1.backtestMetrics.profitFactor,
    };
  }

  // Determine recommendation
  let recommendation: ModelComparison['recommendation'] = 'needs_review';

  const aucImproved = validationDelta.auc > 0.01;  // > 1% improvement
  const calibrationImproved = validationDelta.calibrationError < 0;
  const sharpeImproved = backtestDelta && backtestDelta.sharpeRatio > 0;

  if (aucImproved && calibrationImproved) {
    recommendation = 'promote_v2';
  } else if (validationDelta.auc < -0.02 || validationDelta.calibrationError > 0.03) {
    recommendation = 'keep_v1';
  }

  return {
    v1,
    v2,
    validationDelta,
    backtestDelta,
    recommendation,
  };
}

/**
 * Update backtest metrics for a model
 */
export function updateBacktestMetrics(version: string, metrics: BacktestMetrics): void {
  const registry = loadRegistry();
  const model = registry.models.find(m => m.version === version);

  if (!model) {
    throw new Error(`Model ${version} not found`);
  }

  model.backtestMetrics = metrics;
  saveRegistry(registry);

  console.log(`[Registry] Updated backtest metrics for ${version}`);
}

// ============================================
// FORMATTING
// ============================================

/**
 * Format model summary
 */
export function formatModelSummary(model: RegisteredModel): string {
  const lines: string[] = [];
  const prodBadge = model.isProduction ? ' [PRODUCTION]' : '';

  lines.push(`${model.version}${prodBadge}`);
  lines.push(`   Type: ${model.modelType} | Features: ${model.featureCount} | Samples: ${model.trainingSamples}`);
  lines.push(`   Created: ${model.createdAt}`);

  lines.push(`   Validation: AUC ${(model.validationMetrics.auc * 100).toFixed(1)}% | CalErr ${(model.validationMetrics.calibrationError * 100).toFixed(1)}% | Acc ${(model.validationMetrics.accuracy * 100).toFixed(1)}%`);

  if (model.backtestMetrics) {
    lines.push(`   Backtest: WinRate ${(model.backtestMetrics.winRate * 100).toFixed(1)}% | Sharpe ${model.backtestMetrics.sharpeRatio.toFixed(2)} | PF ${model.backtestMetrics.profitFactor.toFixed(2)}`);
  }

  if (model.tags.length > 0) {
    lines.push(`   Tags: ${model.tags.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Format models as table
 */
export function formatModelsTable(models: RegisteredModel[]): string {
  if (models.length === 0) {
    return 'No models registered.';
  }

  const lines: string[] = [];
  lines.push('┌──────────┬──────────┬─────────┬─────────┬─────────┬─────────┬──────┐');
  lines.push('│ Version  │ Type     │ AUC     │ CalErr  │ WinRate │ Sharpe  │ Prod │');
  lines.push('├──────────┼──────────┼─────────┼─────────┼─────────┼─────────┼──────┤');

  for (const model of models) {
    const version = model.version.padEnd(8);
    const type = model.modelType.substring(0, 8).padEnd(8);
    const auc = `${(model.validationMetrics.auc * 100).toFixed(1)}%`.padStart(7);
    const calErr = `${(model.validationMetrics.calibrationError * 100).toFixed(1)}%`.padStart(7);
    const winRate = model.backtestMetrics
      ? `${(model.backtestMetrics.winRate * 100).toFixed(1)}%`.padStart(7)
      : '   -   ';
    const sharpe = model.backtestMetrics
      ? model.backtestMetrics.sharpeRatio.toFixed(2).padStart(7)
      : '   -   ';
    const prod = model.isProduction ? '  ✓  ' : '     ';

    lines.push(`│ ${version} │ ${type} │ ${auc} │ ${calErr} │ ${winRate} │ ${sharpe} │${prod}│`);
  }

  lines.push('└──────────┴──────────┴─────────┴─────────┴─────────┴─────────┴──────┘');

  return lines.join('\n');
}

/**
 * Format comparison report
 */
export function formatComparisonReport(comparison: ModelComparison): string {
  const lines: string[] = [];

  lines.push(`Model Comparison: ${comparison.v1} vs ${comparison.v2}`);
  lines.push('═'.repeat(50));

  lines.push('\nValidation Metrics:');
  lines.push(`   AUC:              ${formatDelta(comparison.validationDelta.auc * 100, '%')}`);
  lines.push(`   Calibration:      ${formatDelta(-comparison.validationDelta.calibrationError * 100, '%', true)}`);
  lines.push(`   Accuracy:         ${formatDelta(comparison.validationDelta.accuracy * 100, '%')}`);

  if (comparison.backtestDelta) {
    lines.push('\nBacktest Metrics:');
    lines.push(`   Win Rate:         ${formatDelta(comparison.backtestDelta.winRate * 100, '%')}`);
    lines.push(`   Sharpe Ratio:     ${formatDelta(comparison.backtestDelta.sharpeRatio, '')}`);
    lines.push(`   Profit Factor:    ${formatDelta(comparison.backtestDelta.profitFactor, '')}`);
  }

  lines.push('\n' + '─'.repeat(50));
  const recIcon = {
    promote_v2: '✓ Recommend promoting',
    keep_v1: '✗ Keep current version',
    needs_review: '? Needs manual review',
  }[comparison.recommendation];
  lines.push(`Recommendation: ${recIcon} ${comparison.v2}`);

  return lines.join('\n');
}

function formatDelta(value: number, suffix: string, inverted: boolean = false): string {
  const sign = value >= 0 ? '+' : '';
  const icon = inverted
    ? (value >= 0 ? '↓' : '↑')
    : (value >= 0 ? '↑' : '↓');
  return `${sign}${value.toFixed(1)}${suffix} ${icon}`;
}
