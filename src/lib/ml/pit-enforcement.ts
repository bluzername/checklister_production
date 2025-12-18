/**
 * Point-in-Time (PIT) Safety Enforcement
 *
 * Runtime validation and enforcement to prevent look-ahead bias
 * in backtests and training data generation.
 *
 * Created: 2025-12-15
 */

import { FeatureVector } from '../backtest/types';
import { getUnsafeFeatures, FEATURE_PIT_CONTRACTS } from './feature-pit-safety';

// ============================================
// GLOBAL PIT ENFORCEMENT STATE
// ============================================

/**
 * Global flag to enable strict PIT enforcement mode
 * When enabled, any PIT violation will throw an error
 */
let pitEnforcementEnabled = false;

/**
 * Counter for PIT safety warnings (for logging/monitoring)
 */
let pitWarningCount = 0;

/**
 * Enable strict PIT enforcement
 * Call this at the start of backtests or training data generation
 */
export function enablePITEnforcement(): void {
  pitEnforcementEnabled = true;
  pitWarningCount = 0;
  console.log('[PIT] Strict PIT enforcement ENABLED - look-ahead bias will throw errors');
}

/**
 * Disable PIT enforcement (for live trading)
 */
export function disablePITEnforcement(): void {
  pitEnforcementEnabled = false;
  if (pitWarningCount > 0) {
    console.log(`[PIT] Enforcement disabled. Total warnings during session: ${pitWarningCount}`);
  }
}

/**
 * Check if PIT enforcement is enabled
 */
export function isPITEnforcementEnabled(): boolean {
  return pitEnforcementEnabled;
}

// ============================================
// VALIDATION FUNCTIONS
// ============================================

/**
 * Validate that asOfDate is provided when running in PIT-enforced mode
 * Call this at the start of any function that requires PIT safety
 *
 * @param functionName - Name of the calling function (for error messages)
 * @param asOfDate - The asOfDate parameter to validate
 * @throws Error if enforcement is enabled and asOfDate is missing
 */
export function validateAsOfDate(functionName: string, asOfDate?: Date): void {
  if (pitEnforcementEnabled && !asOfDate) {
    const error = `[PIT VIOLATION] ${functionName} called without asOfDate while PIT enforcement is enabled. ` +
      'This would cause look-ahead bias in backtests. Either provide asOfDate or disable enforcement for live trading.';

    pitWarningCount++;
    throw new Error(error);
  }
}

/**
 * Log a PIT safety warning (non-fatal)
 * Use for soft warnings when strict enforcement is not required
 */
export function logPITWarning(message: string): void {
  pitWarningCount++;
  console.warn(`[PIT WARNING #${pitWarningCount}] ${message}`);
}

/**
 * Validate that a feature vector doesn't contain PIT-unsafe features
 *
 * @param features - Feature vector to validate
 * @param context - Context for error messages (e.g., "backtest entry for AAPL on 2024-01-15")
 * @throws Error if enforcement is enabled and unsafe features are detected
 */
export function validateFeatureVector(features: FeatureVector, context?: string): void {
  const unsafeFeatures = getUnsafeFeatures();

  if (unsafeFeatures.length === 0) {
    // All features are safe, no validation needed
    return;
  }

  // Check if any unsafe features have non-default values
  // (indicating they were actually computed)
  const activeUnsafeFeatures: string[] = [];

  for (const featureName of unsafeFeatures) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const value = (features as any)[featureName];
    if (value !== undefined && value !== null && value !== 0) {
      activeUnsafeFeatures.push(featureName);
    }
  }

  if (activeUnsafeFeatures.length > 0 && pitEnforcementEnabled) {
    const contextStr = context ? ` (${context})` : '';
    const error = `[PIT VIOLATION] Feature vector contains ${activeUnsafeFeatures.length} PIT-unsafe features${contextStr}: ` +
      activeUnsafeFeatures.join(', ');

    pitWarningCount++;
    throw new Error(error);
  }
}

/**
 * Assert that an analysis date is not in the future relative to asOfDate
 * Prevents using "current" data that wouldn't be available historically
 *
 * @param dataDate - The date of the data being used
 * @param asOfDate - The historical "as of" date
 * @param dataType - Type of data for error messages
 */
export function assertDateNotFuture(
  dataDate: Date,
  asOfDate: Date,
  dataType: string
): void {
  if (pitEnforcementEnabled && dataDate > asOfDate) {
    const error = `[PIT VIOLATION] ${dataType} has date ${dataDate.toISOString()} ` +
      `which is after asOfDate ${asOfDate.toISOString()}. This would be look-ahead bias.`;

    pitWarningCount++;
    throw new Error(error);
  }
}

// ============================================
// REPORTING FUNCTIONS
// ============================================

/**
 * Get PIT enforcement statistics
 */
export function getPITStats(): {
  enforcementEnabled: boolean;
  warningCount: number;
  totalFeatures: number;
  safeFeatures: number;
  unsafeFeatures: number;
} {
  const unsafeCount = getUnsafeFeatures().length;
  const totalCount = FEATURE_PIT_CONTRACTS.length;

  return {
    enforcementEnabled: pitEnforcementEnabled,
    warningCount: pitWarningCount,
    totalFeatures: totalCount,
    safeFeatures: totalCount - unsafeCount,
    unsafeFeatures: unsafeCount,
  };
}

/**
 * Print PIT enforcement summary
 * Call at the end of a backtest/training run
 */
export function printPITEnforcementSummary(): void {
  const stats = getPITStats();

  console.log('\n' + '='.repeat(50));
  console.log('PIT SAFETY ENFORCEMENT SUMMARY');
  console.log('='.repeat(50));
  console.log(`Enforcement Mode: ${stats.enforcementEnabled ? 'ENABLED' : 'DISABLED'}`);
  console.log(`Total PIT Warnings: ${stats.warningCount}`);
  console.log(`Feature Coverage: ${stats.safeFeatures}/${stats.totalFeatures} PIT-safe`);

  if (stats.unsafeFeatures > 0) {
    console.log(`\n⚠️  ${stats.unsafeFeatures} features are still PIT-UNSAFE`);
    console.log('Unsafe features:', getUnsafeFeatures().join(', '));
  } else {
    console.log(`\n✅ ALL ${stats.totalFeatures} FEATURES ARE PIT-SAFE`);
  }

  console.log('='.repeat(50) + '\n');
}

// ============================================
// DECORATORS / WRAPPERS FOR COMMON PATTERNS
// ============================================

/**
 * Wrapper to run a function with PIT enforcement enabled
 * Automatically enables/disables enforcement and prints summary
 *
 * @param name - Name of the operation for logging
 * @param fn - Async function to run with enforcement
 */
export async function withPITEnforcement<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  console.log(`\n[PIT] Starting "${name}" with PIT enforcement enabled`);
  enablePITEnforcement();

  try {
    const result = await fn();
    printPITEnforcementSummary();
    return result;
  } catch (error) {
    if (error instanceof Error && error.message.includes('[PIT VIOLATION]')) {
      console.error('\n❌ PIT VIOLATION DETECTED - ABORTING');
      console.error(error.message);
      printPITEnforcementSummary();
    }
    throw error;
  } finally {
    disablePITEnforcement();
  }
}

/**
 * Create a cache key that includes the date for PIT-safe caching
 * Use this to ensure cached data is segmented by historical date
 *
 * @param prefix - Cache key prefix
 * @param identifier - Unique identifier (e.g., ticker)
 * @param asOfDate - The historical date (undefined for live)
 */
export function createPITSafeCacheKey(
  prefix: string,
  identifier: string,
  asOfDate?: Date
): string {
  const dateKey = asOfDate ? asOfDate.toISOString().split('T')[0] : 'live';
  return `${prefix}:${identifier}:${dateKey}`;
}
