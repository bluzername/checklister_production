/**
 * Maintenance Task Configuration
 *
 * Defines recurring maintenance tasks with their schedules and descriptions.
 * These are used to remind the user when tasks are due or overdue.
 */

export interface MaintenanceTask {
  id: string;
  name: string;
  description: string;
  intervalDays: number;        // How often the task should be done
  warningDays: number;         // Days before due to start warning
  criticalDays: number;        // Days overdue to become critical (flashing)
  category: 'model' | 'data' | 'validation' | 'system';
}

export const MAINTENANCE_TASKS: MaintenanceTask[] = [
  {
    id: 'model_retrain',
    name: 'Model Retraining',
    description: 'Retrain the ML model with latest labeled data to maintain prediction accuracy',
    intervalDays: 30,          // Monthly
    warningDays: 7,            // Warn 7 days before
    criticalDays: 7,           // Critical if 7 days overdue
    category: 'model',
  },
  {
    id: 'price_cache_refresh',
    name: 'Price Cache Refresh',
    description: 'Refresh the price cache with latest market data for accurate backtesting',
    intervalDays: 7,           // Weekly
    warningDays: 2,            // Warn 2 days before
    criticalDays: 3,           // Critical if 3 days overdue
    category: 'data',
  },
  {
    id: 'walk_forward_validation',
    name: 'Walk-Forward Validation',
    description: 'Run walk-forward validation to ensure model performance is stable',
    intervalDays: 14,          // Bi-weekly
    warningDays: 3,            // Warn 3 days before
    criticalDays: 7,           // Critical if 7 days overdue
    category: 'validation',
  },
  {
    id: 'dataset_quality_check',
    name: 'Dataset Quality Check',
    description: 'Check training data for feature drift, class imbalance, and data quality issues',
    intervalDays: 30,          // Monthly
    warningDays: 7,            // Warn 7 days before
    criticalDays: 14,          // Critical if 14 days overdue
    category: 'data',
  },
  {
    id: 'backtest_benchmark',
    name: 'Backtest vs Benchmark',
    description: 'Compare strategy performance against SPY benchmark over recent period',
    intervalDays: 14,          // Bi-weekly
    warningDays: 3,            // Warn 3 days before
    criticalDays: 7,           // Critical if 7 days overdue
    category: 'validation',
  },
];

// Storage key prefix for localStorage
export const MAINTENANCE_STORAGE_KEY = 'maintenance_tasks';

export interface TaskStatus {
  taskId: string;
  lastCompleted: number | null;  // timestamp
  snoozedUntil: number | null;   // timestamp (for dismissing temporarily)
}

export type TaskState = 'ok' | 'due_soon' | 'overdue' | 'critical';

export function getTaskState(task: MaintenanceTask, status: TaskStatus | undefined): TaskState {
  const now = Date.now();

  // If snoozed and snooze hasn't expired, treat as ok
  if (status?.snoozedUntil && status.snoozedUntil > now) {
    return 'ok';
  }

  // If never completed, it's overdue
  if (!status?.lastCompleted) {
    return 'overdue';
  }

  const daysSinceCompletion = (now - status.lastCompleted) / (1000 * 60 * 60 * 24);
  const daysUntilDue = task.intervalDays - daysSinceCompletion;

  if (daysUntilDue < -task.criticalDays) {
    return 'critical';
  } else if (daysUntilDue < 0) {
    return 'overdue';
  } else if (daysUntilDue <= task.warningDays) {
    return 'due_soon';
  }

  return 'ok';
}

export function formatDaysRemaining(task: MaintenanceTask, status: TaskStatus | undefined): string {
  if (!status?.lastCompleted) {
    return 'Never completed';
  }

  const now = Date.now();
  const daysSinceCompletion = (now - status.lastCompleted) / (1000 * 60 * 60 * 24);
  const daysUntilDue = Math.round(task.intervalDays - daysSinceCompletion);

  if (daysUntilDue < 0) {
    return `${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue) !== 1 ? 's' : ''} overdue`;
  } else if (daysUntilDue === 0) {
    return 'Due today';
  } else if (daysUntilDue === 1) {
    return 'Due tomorrow';
  }

  return `Due in ${daysUntilDue} days`;
}
