/**
 * Experiment Tracker
 * Logs and manages ML experiments with hyperparameters and results
 */

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  Experiment,
  ExperimentConfig,
  ExperimentMetrics,
  ExperimentStatus,
  ExperimentType,
  ExperimentFilter,
} from './types';

// ============================================
// CONFIGURATION
// ============================================

const EXPERIMENTS_DIR = path.join(process.cwd(), 'data', 'experiments');
const INDEX_FILE = path.join(EXPERIMENTS_DIR, 'index.json');

// ============================================
// INITIALIZATION
// ============================================

function ensureDirectoryExists(): void {
  if (!fs.existsSync(EXPERIMENTS_DIR)) {
    fs.mkdirSync(EXPERIMENTS_DIR, { recursive: true });
  }
}

function loadIndex(): { experiments: string[]; lastUpdated: string } {
  ensureDirectoryExists();
  if (fs.existsSync(INDEX_FILE)) {
    return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
  }
  return { experiments: [], lastUpdated: new Date().toISOString() };
}

function saveIndex(index: { experiments: string[]; lastUpdated: string }): void {
  index.lastUpdated = new Date().toISOString();
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
}

// ============================================
// EXPERIMENT CRUD
// ============================================

/**
 * Create a new experiment and return its ID
 */
export function createExperiment(
  name: string,
  type: ExperimentType,
  config: ExperimentConfig,
  options?: {
    parentId?: string;
    tags?: string[];
    notes?: string;
  }
): string {
  ensureDirectoryExists();

  const id = uuidv4();
  const experiment: Experiment = {
    id,
    name,
    type,
    status: 'running',
    config,
    metrics: {},
    startedAt: new Date().toISOString(),
    parentId: options?.parentId,
    tags: options?.tags || [],
    notes: options?.notes,
  };

  // Save experiment file
  const filePath = path.join(EXPERIMENTS_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(experiment, null, 2));

  // Update index
  const index = loadIndex();
  index.experiments.push(id);
  saveIndex(index);

  console.log(`[Experiment] Created: ${name} (${id})`);
  return id;
}

/**
 * Get an experiment by ID
 */
export function getExperiment(id: string): Experiment | null {
  const filePath = path.join(EXPERIMENTS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * Update experiment with partial data
 */
export function updateExperiment(
  id: string,
  updates: Partial<Omit<Experiment, 'id' | 'startedAt'>>
): void {
  const experiment = getExperiment(id);
  if (!experiment) {
    throw new Error(`Experiment not found: ${id}`);
  }

  const updated = { ...experiment, ...updates };
  const filePath = path.join(EXPERIMENTS_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));
}

/**
 * Log metrics for an experiment
 */
export function logMetrics(id: string, metrics: Partial<ExperimentMetrics>): void {
  const experiment = getExperiment(id);
  if (!experiment) {
    throw new Error(`Experiment not found: ${id}`);
  }

  experiment.metrics = { ...experiment.metrics, ...metrics };
  const filePath = path.join(EXPERIMENTS_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(experiment, null, 2));

  // Log key metrics to console
  const keyMetrics: string[] = [];
  if (metrics.auc !== undefined) keyMetrics.push(`AUC: ${(metrics.auc * 100).toFixed(1)}%`);
  if (metrics.accuracy !== undefined) keyMetrics.push(`Acc: ${(metrics.accuracy * 100).toFixed(1)}%`);
  if (metrics.calibrationError !== undefined) keyMetrics.push(`CalErr: ${(metrics.calibrationError * 100).toFixed(1)}%`);
  if (metrics.sharpeRatio !== undefined) keyMetrics.push(`Sharpe: ${metrics.sharpeRatio.toFixed(2)}`);

  if (keyMetrics.length > 0) {
    console.log(`[Experiment] Metrics logged: ${keyMetrics.join(', ')}`);
  }
}

/**
 * Mark experiment as completed
 */
export function completeExperiment(
  id: string,
  status: 'completed' | 'failed',
  notes?: string
): void {
  const experiment = getExperiment(id);
  if (!experiment) {
    throw new Error(`Experiment not found: ${id}`);
  }

  const completedAt = new Date().toISOString();
  const duration = new Date(completedAt).getTime() - new Date(experiment.startedAt).getTime();

  updateExperiment(id, {
    status,
    completedAt,
    duration,
    notes: notes || experiment.notes,
  });

  const statusIcon = status === 'completed' ? '✓' : '✗';
  console.log(`[Experiment] ${statusIcon} ${status}: ${experiment.name} (${(duration / 1000).toFixed(1)}s)`);
}

/**
 * List experiments with optional filtering
 */
export function listExperiments(filter?: ExperimentFilter): Experiment[] {
  const index = loadIndex();
  let experiments: Experiment[] = [];

  for (const id of index.experiments) {
    const exp = getExperiment(id);
    if (exp) {
      experiments.push(exp);
    }
  }

  // Apply filters
  if (filter) {
    if (filter.type) {
      experiments = experiments.filter(e => e.type === filter.type);
    }
    if (filter.status) {
      experiments = experiments.filter(e => e.status === filter.status);
    }
    if (filter.tags && filter.tags.length > 0) {
      experiments = experiments.filter(e =>
        filter.tags!.some(tag => e.tags?.includes(tag))
      );
    }
    if (filter.fromDate) {
      experiments = experiments.filter(e => e.startedAt >= filter.fromDate!);
    }
    if (filter.toDate) {
      experiments = experiments.filter(e => e.startedAt <= filter.toDate!);
    }
    if (filter.minAuc !== undefined) {
      experiments = experiments.filter(e =>
        e.metrics.auc !== undefined && e.metrics.auc >= filter.minAuc!
      );
    }
    if (filter.modelVersion) {
      experiments = experiments.filter(e => e.modelVersion === filter.modelVersion);
    }
  }

  // Sort by start date descending
  experiments.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  return experiments;
}

/**
 * Get the most recent experiment of a given type
 */
export function getLatestExperiment(type?: ExperimentType): Experiment | null {
  const experiments = listExperiments(type ? { type } : undefined);
  return experiments.length > 0 ? experiments[0] : null;
}

/**
 * Delete an experiment
 */
export function deleteExperiment(id: string): boolean {
  const filePath = path.join(EXPERIMENTS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) {
    return false;
  }

  fs.unlinkSync(filePath);

  const index = loadIndex();
  index.experiments = index.experiments.filter(eid => eid !== id);
  saveIndex(index);

  return true;
}

// ============================================
// ANALYSIS HELPERS
// ============================================

/**
 * Get statistics about experiments
 */
export function getExperimentStats(): {
  total: number;
  byType: Record<ExperimentType, number>;
  byStatus: Record<ExperimentStatus, number>;
  avgDuration: number;
  bestAuc: { id: string; value: number } | null;
} {
  const experiments = listExperiments();

  const byType: Record<ExperimentType, number> = {
    training: 0,
    backtest: 0,
    optimization: 0,
  };

  const byStatus: Record<ExperimentStatus, number> = {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
  };

  let totalDuration = 0;
  let durationCount = 0;
  let bestAuc: { id: string; value: number } | null = null;

  for (const exp of experiments) {
    byType[exp.type]++;
    byStatus[exp.status]++;

    if (exp.duration) {
      totalDuration += exp.duration;
      durationCount++;
    }

    if (exp.metrics.auc !== undefined) {
      if (!bestAuc || exp.metrics.auc > bestAuc.value) {
        bestAuc = { id: exp.id, value: exp.metrics.auc };
      }
    }
  }

  return {
    total: experiments.length,
    byType,
    byStatus,
    avgDuration: durationCount > 0 ? totalDuration / durationCount : 0,
    bestAuc,
  };
}

/**
 * Compare two experiments
 */
export function compareExperiments(id1: string, id2: string): {
  exp1: Experiment;
  exp2: Experiment;
  metricsDelta: Partial<ExperimentMetrics>;
  configDiff: string[];
} | null {
  const exp1 = getExperiment(id1);
  const exp2 = getExperiment(id2);

  if (!exp1 || !exp2) {
    return null;
  }

  // Calculate metrics delta
  const metricsDelta: Partial<ExperimentMetrics> = {};
  const metricKeys: (keyof ExperimentMetrics)[] = [
    'auc', 'accuracy', 'precision', 'recall', 'f1Score',
    'calibrationError', 'sharpeRatio', 'profitFactor', 'backtestWinRate'
  ];

  for (const key of metricKeys) {
    const v1 = exp1.metrics[key];
    const v2 = exp2.metrics[key];
    if (v1 !== undefined && v2 !== undefined) {
      metricsDelta[key] = v2 - v1;
    }
  }

  // Find config differences
  const configDiff: string[] = [];
  const configKeys = Object.keys({ ...exp1.config, ...exp2.config }) as (keyof ExperimentConfig)[];

  for (const key of configKeys) {
    const v1 = JSON.stringify(exp1.config[key]);
    const v2 = JSON.stringify(exp2.config[key]);
    if (v1 !== v2) {
      configDiff.push(`${key}: ${v1} → ${v2}`);
    }
  }

  return { exp1, exp2, metricsDelta, configDiff };
}

// ============================================
// FORMATTING
// ============================================

/**
 * Format experiment summary for console output
 */
export function formatExperimentSummary(exp: Experiment): string {
  const lines: string[] = [];
  const statusIcon = {
    pending: '○',
    running: '◐',
    completed: '●',
    failed: '✗',
  }[exp.status];

  lines.push(`${statusIcon} ${exp.name} (${exp.id.substring(0, 8)})`);
  lines.push(`   Type: ${exp.type} | Status: ${exp.status}`);
  lines.push(`   Started: ${exp.startedAt}`);

  if (exp.duration) {
    lines.push(`   Duration: ${(exp.duration / 1000).toFixed(1)}s`);
  }

  // Key metrics
  const metrics: string[] = [];
  if (exp.metrics.auc !== undefined) metrics.push(`AUC: ${(exp.metrics.auc * 100).toFixed(1)}%`);
  if (exp.metrics.accuracy !== undefined) metrics.push(`Acc: ${(exp.metrics.accuracy * 100).toFixed(1)}%`);
  if (exp.metrics.sharpeRatio !== undefined) metrics.push(`Sharpe: ${exp.metrics.sharpeRatio.toFixed(2)}`);
  if (exp.metrics.backtestWinRate !== undefined) metrics.push(`WinRate: ${(exp.metrics.backtestWinRate * 100).toFixed(1)}%`);

  if (metrics.length > 0) {
    lines.push(`   Metrics: ${metrics.join(' | ')}`);
  }

  if (exp.tags && exp.tags.length > 0) {
    lines.push(`   Tags: ${exp.tags.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Format experiments as table
 */
export function formatExperimentsTable(experiments: Experiment[]): string {
  if (experiments.length === 0) {
    return 'No experiments found.';
  }

  const lines: string[] = [];
  lines.push('┌──────────┬──────────────┬──────────┬─────────┬─────────┬─────────┐');
  lines.push('│ ID       │ Name         │ Type     │ Status  │ AUC     │ Sharpe  │');
  lines.push('├──────────┼──────────────┼──────────┼─────────┼─────────┼─────────┤');

  for (const exp of experiments.slice(0, 20)) {
    const id = exp.id.substring(0, 8);
    const name = exp.name.substring(0, 12).padEnd(12);
    const type = exp.type.substring(0, 8).padEnd(8);
    const status = exp.status.substring(0, 7).padEnd(7);
    const auc = exp.metrics.auc !== undefined
      ? `${(exp.metrics.auc * 100).toFixed(1)}%`.padStart(7)
      : '   -   ';
    const sharpe = exp.metrics.sharpeRatio !== undefined
      ? exp.metrics.sharpeRatio.toFixed(2).padStart(7)
      : '   -   ';

    lines.push(`│ ${id} │ ${name} │ ${type} │ ${status} │ ${auc} │ ${sharpe} │`);
  }

  lines.push('└──────────┴──────────────┴──────────┴─────────┴─────────┴─────────┘');

  if (experiments.length > 20) {
    lines.push(`... and ${experiments.length - 20} more experiments`);
  }

  return lines.join('\n');
}
