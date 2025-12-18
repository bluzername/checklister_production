/**
 * Ticker Universe Splits
 * Defines train/validation/test ticker splits to prevent data leakage
 *
 * IMPORTANT: Test set tickers should ONLY be used for final model evaluation,
 * not during hyperparameter tuning or feature selection.
 */

import { SP500_TICKERS } from '../universe/filter';

// ============================================
// SPLIT CONFIGURATION
// ============================================

/**
 * Universe split ratios
 * - Train: 60% - Used for model training
 * - Validation: 20% - Used for hyperparameter tuning and model selection
 * - Test: 20% - Used ONLY for final evaluation
 */
export const SPLIT_CONFIG = {
  trainRatio: 0.6,
  validationRatio: 0.2,
  testRatio: 0.2,
  seed: 42, // Fixed seed for reproducibility
} as const;

// ============================================
// TICKER SPLIT FUNCTIONS
// ============================================

/**
 * Seeded shuffle for reproducible splits
 * Uses Mulberry32 PRNG for consistency across runs
 */
function createSeededRandom(seed: number): () => number {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function shuffleArray<T>(array: T[], random: () => number): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Get the ticker splits from the universe
 * Shuffles with fixed seed then splits by ratio
 */
export interface TickerSplits {
  train: string[];
  validation: string[];
  test: string[];
  seed: number;
  totalTickers: number;
}

let cachedSplits: TickerSplits | null = null;

/**
 * Get ticker splits (cached for consistency within session)
 */
export function getTickerSplits(): TickerSplits {
  if (cachedSplits) {
    return cachedSplits;
  }

  const random = createSeededRandom(SPLIT_CONFIG.seed);
  const shuffled = shuffleArray(SP500_TICKERS, random);

  const total = shuffled.length;
  const trainEnd = Math.floor(total * SPLIT_CONFIG.trainRatio);
  const valEnd = trainEnd + Math.floor(total * SPLIT_CONFIG.validationRatio);

  cachedSplits = {
    train: shuffled.slice(0, trainEnd),
    validation: shuffled.slice(trainEnd, valEnd),
    test: shuffled.slice(valEnd),
    seed: SPLIT_CONFIG.seed,
    totalTickers: total,
  };

  return cachedSplits;
}

/**
 * Get only training tickers (safe for general use)
 */
export function getTrainTickers(): string[] {
  return getTickerSplits().train;
}

/**
 * Get only validation tickers (safe for hyperparameter tuning)
 */
export function getValidationTickers(): string[] {
  return getTickerSplits().validation;
}

/**
 * Get test tickers with warning
 * ONLY use for final model evaluation
 */
export function getTestTickers(acknowledge: boolean = false): string[] {
  if (!acknowledge) {
    console.warn('⚠️  WARNING: Test tickers should ONLY be used for FINAL evaluation!');
    console.warn('   Pass acknowledge=true to confirm you understand this.');
  }
  return getTickerSplits().test;
}

/**
 * Check if a ticker is in the test set
 */
export function isTestTicker(ticker: string): boolean {
  const { test } = getTickerSplits();
  return test.includes(ticker.toUpperCase());
}

/**
 * Check if a ticker is in the training set
 */
export function isTrainTicker(ticker: string): boolean {
  const { train } = getTickerSplits();
  return train.includes(ticker.toUpperCase());
}

/**
 * Check if a ticker is in the validation set
 */
export function isValidationTicker(ticker: string): boolean {
  const { validation } = getTickerSplits();
  return validation.includes(ticker.toUpperCase());
}

/**
 * Get tickers by split type
 */
export function getTickersBySplit(
  split: 'train' | 'validation' | 'test' | 'train+validation'
): string[] {
  const splits = getTickerSplits();

  switch (split) {
    case 'train':
      return splits.train;
    case 'validation':
      return splits.validation;
    case 'test':
      console.warn('⚠️  Accessing test tickers - ensure this is for FINAL evaluation only');
      return splits.test;
    case 'train+validation':
      return [...splits.train, ...splits.validation];
    default:
      return splits.train;
  }
}

// ============================================
// SPLIT INFO
// ============================================

export interface SplitInfo {
  split: 'train' | 'validation' | 'test' | 'train+validation';
  tickerCount: number;
  ratio: number;
  tickers: string[];
}

/**
 * Get detailed split information for display
 */
export function getSplitInfo(): {
  train: SplitInfo;
  validation: SplitInfo;
  test: SplitInfo;
  total: number;
  seed: number;
} {
  const splits = getTickerSplits();
  const total = splits.totalTickers;

  return {
    train: {
      split: 'train',
      tickerCount: splits.train.length,
      ratio: splits.train.length / total,
      tickers: splits.train,
    },
    validation: {
      split: 'validation',
      tickerCount: splits.validation.length,
      ratio: splits.validation.length / total,
      tickers: splits.validation,
    },
    test: {
      split: 'test',
      tickerCount: splits.test.length,
      ratio: splits.test.length / total,
      tickers: splits.test,
    },
    total,
    seed: splits.seed,
  };
}

/**
 * Format split info for display
 */
export function formatSplitInfo(): string {
  const info = getSplitInfo();
  const lines: string[] = [];

  lines.push('');
  lines.push('╔══════════════════════════════════════════════════════════╗');
  lines.push('║              TICKER UNIVERSE SPLITS                      ║');
  lines.push('╠══════════════════════════════════════════════════════════╣');
  lines.push(`║  Total Tickers: ${info.total.toString().padStart(3)}                                   ║`);
  lines.push(`║  Random Seed: ${info.seed}                                        ║`);
  lines.push('╠══════════════════════════════════════════════════════════╣');
  lines.push(`║  Train:      ${info.train.tickerCount.toString().padStart(3)} tickers (${(info.train.ratio * 100).toFixed(0).padStart(2)}%)                         ║`);
  lines.push(`║  Validation: ${info.validation.tickerCount.toString().padStart(3)} tickers (${(info.validation.ratio * 100).toFixed(0).padStart(2)}%)                         ║`);
  lines.push(`║  Test:       ${info.test.tickerCount.toString().padStart(3)} tickers (${(info.test.ratio * 100).toFixed(0).padStart(2)}%) [PROTECTED]              ║`);
  lines.push('╚══════════════════════════════════════════════════════════╝');

  lines.push('\nTrain Tickers:');
  lines.push(`  ${info.train.tickers.slice(0, 10).join(', ')}...`);

  lines.push('\nValidation Tickers:');
  lines.push(`  ${info.validation.tickers.slice(0, 10).join(', ')}...`);

  lines.push('\nTest Tickers (PROTECTED):');
  lines.push(`  ${info.test.tickers.slice(0, 5).join(', ')}... [${info.test.tickerCount - 5} more hidden]`);

  return lines.join('\n');
}

// ============================================
// UNIVERSE SIZE HELPERS
// ============================================

/**
 * Get a subset of train tickers by universe size
 * For quick testing with smaller datasets
 * Updated for expanded 500 ticker universe (Phase 5.1)
 */
export function getTrainUniverseBySize(
  size: 'small' | 'medium' | 'large' | 'full'
): string[] {
  const trainTickers = getTrainTickers();

  switch (size) {
    case 'small':
      return trainTickers.slice(0, 20);   // Quick testing
    case 'medium':
      return trainTickers.slice(0, 75);   // Standard runs
    case 'large':
      return trainTickers.slice(0, 150);  // Comprehensive
    case 'full':
      return trainTickers;                 // All ~300 train tickers
    default:
      return trainTickers.slice(0, 75);
  }
}

/**
 * Get a subset of validation tickers by universe size
 * Updated for expanded 500 ticker universe (Phase 5.1)
 */
export function getValidationUniverseBySize(
  size: 'small' | 'medium' | 'large' | 'full'
): string[] {
  const validationTickers = getValidationTickers();

  switch (size) {
    case 'small':
      return validationTickers.slice(0, 10);  // Quick testing
    case 'medium':
      return validationTickers.slice(0, 25);  // Standard runs
    case 'large':
      return validationTickers.slice(0, 50);  // Comprehensive
    case 'full':
      return validationTickers;                // All ~100 val tickers
    default:
      return validationTickers.slice(0, 25);
  }
}
