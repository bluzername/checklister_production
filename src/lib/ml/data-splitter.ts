/**
 * Data Splitting Utilities
 * Stratified splitting with reproducible seeding
 */

import { TrainingExample } from '../model/logistic';

// ============================================
// TYPES
// ============================================

export interface SplitResult {
  train: TrainingExample[];
  validation: TrainingExample[];
  test: TrainingExample[];
}

export interface SplitConfig {
  trainRatio: number;      // e.g., 0.6 for 60%
  validationRatio: number; // e.g., 0.2 for 20%
  testRatio: number;       // e.g., 0.2 for 20%
  seed?: number;           // For reproducibility
  stratify?: boolean;      // Default true
}

export interface SplitStats {
  train: { total: number; positive: number; negative: number; winRate: number };
  validation: { total: number; positive: number; negative: number; winRate: number };
  test: { total: number; positive: number; negative: number; winRate: number };
}

// ============================================
// SEEDED RANDOM
// ============================================

/**
 * Simple seeded random number generator (Mulberry32)
 * Provides reproducible random sequences
 */
function createSeededRandom(seed: number): () => number {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Shuffle array in place using Fisher-Yates with seeded random
 */
function shuffleArray<T>(array: T[], random: () => number): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ============================================
// SPLITTING FUNCTIONS
// ============================================

/**
 * Stratified split maintaining class balance across all splits
 *
 * @param examples - Training examples to split
 * @param config - Split configuration
 * @returns Object with train, validation, and test sets
 */
export function stratifiedSplit(
  examples: TrainingExample[],
  config: SplitConfig
): SplitResult {
  const {
    trainRatio,
    validationRatio,
    testRatio,
    seed = Date.now(),
    stratify = true,
  } = config;

  // Validate ratios
  const totalRatio = trainRatio + validationRatio + testRatio;
  if (Math.abs(totalRatio - 1.0) > 0.001) {
    throw new Error(`Split ratios must sum to 1.0, got ${totalRatio}`);
  }

  const random = createSeededRandom(seed);

  if (!stratify) {
    // Simple random split without stratification
    const shuffled = shuffleArray(examples, random);
    const trainEnd = Math.floor(shuffled.length * trainRatio);
    const valEnd = trainEnd + Math.floor(shuffled.length * validationRatio);

    return {
      train: shuffled.slice(0, trainEnd),
      validation: shuffled.slice(trainEnd, valEnd),
      test: shuffled.slice(valEnd),
    };
  }

  // Separate by class
  const positives = examples.filter(e => e.label === 1);
  const negatives = examples.filter(e => e.label === 0);

  // Shuffle each class independently
  const shuffledPositives = shuffleArray(positives, random);
  const shuffledNegatives = shuffleArray(negatives, random);

  // Split each class proportionally
  const posTrainEnd = Math.floor(shuffledPositives.length * trainRatio);
  const posValEnd = posTrainEnd + Math.floor(shuffledPositives.length * validationRatio);

  const negTrainEnd = Math.floor(shuffledNegatives.length * trainRatio);
  const negValEnd = negTrainEnd + Math.floor(shuffledNegatives.length * validationRatio);

  // Combine splits
  const train = [
    ...shuffledPositives.slice(0, posTrainEnd),
    ...shuffledNegatives.slice(0, negTrainEnd),
  ];

  const validation = [
    ...shuffledPositives.slice(posTrainEnd, posValEnd),
    ...shuffledNegatives.slice(negTrainEnd, negValEnd),
  ];

  const test = [
    ...shuffledPositives.slice(posValEnd),
    ...shuffledNegatives.slice(negValEnd),
  ];

  // Shuffle the combined splits to mix positives and negatives
  return {
    train: shuffleArray(train, random),
    validation: shuffleArray(validation, random),
    test: shuffleArray(test, random),
  };
}

/**
 * Simple train/validation split (no test set)
 * Backwards compatible with existing code
 */
export function trainValidationSplit(
  examples: TrainingExample[],
  trainRatio: number = 0.8,
  seed?: number,
  stratify: boolean = true
): { train: TrainingExample[]; validation: TrainingExample[] } {
  const result = stratifiedSplit(examples, {
    trainRatio,
    validationRatio: 1 - trainRatio,
    testRatio: 0,
    seed,
    stratify,
  });

  return {
    train: result.train,
    validation: [...result.validation, ...result.test], // Combine since test is empty
  };
}

// ============================================
// STATISTICS
// ============================================

/**
 * Calculate statistics for each split
 */
export function calculateSplitStats(split: SplitResult): SplitStats {
  const calcStats = (data: TrainingExample[]) => {
    const positive = data.filter(e => e.label === 1).length;
    const negative = data.filter(e => e.label === 0).length;
    return {
      total: data.length,
      positive,
      negative,
      winRate: data.length > 0 ? (positive / data.length) * 100 : 0,
    };
  };

  return {
    train: calcStats(split.train),
    validation: calcStats(split.validation),
    test: calcStats(split.test),
  };
}

/**
 * Verify class balance is maintained across splits
 * Returns true if all splits have win rate within tolerance of overall win rate
 */
export function verifyClassBalance(
  split: SplitResult,
  tolerancePercent: number = 2.0
): { balanced: boolean; details: string } {
  const allExamples = [...split.train, ...split.validation, ...split.test];
  const overallWinRate = (allExamples.filter(e => e.label === 1).length / allExamples.length) * 100;

  const stats = calculateSplitStats(split);
  const checks = [
    { name: 'train', winRate: stats.train.winRate },
    { name: 'validation', winRate: stats.validation.winRate },
    { name: 'test', winRate: stats.test.winRate },
  ].filter(c => c.winRate > 0); // Skip empty sets

  const failures: string[] = [];
  for (const check of checks) {
    const diff = Math.abs(check.winRate - overallWinRate);
    if (diff > tolerancePercent) {
      failures.push(`${check.name}: ${check.winRate.toFixed(1)}% (diff: ${diff.toFixed(1)}%)`);
    }
  }

  return {
    balanced: failures.length === 0,
    details: failures.length === 0
      ? `All splits within ${tolerancePercent}% of overall ${overallWinRate.toFixed(1)}% win rate`
      : `Imbalanced splits: ${failures.join(', ')}`,
  };
}

/**
 * Format split statistics for display
 */
export function formatSplitStats(stats: SplitStats): string {
  const lines: string[] = [];

  lines.push('┌─────────────────────────────────────────────────────┐');
  lines.push('│              DATA SPLIT STATISTICS                  │');
  lines.push('├──────────────┬─────────┬─────────┬─────────┬────────┤');
  lines.push('│    Split     │  Total  │   Wins  │  Losses │ WinRate│');
  lines.push('├──────────────┼─────────┼─────────┼─────────┼────────┤');

  const formatRow = (name: string, s: { total: number; positive: number; negative: number; winRate: number }) => {
    const total = s.total.toString().padStart(7);
    const pos = s.positive.toString().padStart(7);
    const neg = s.negative.toString().padStart(7);
    const wr = (s.winRate.toFixed(1) + '%').padStart(6);
    return `│ ${name.padEnd(12)} │${total} │${pos} │${neg} │${wr} │`;
  };

  lines.push(formatRow('Train', stats.train));
  lines.push(formatRow('Validation', stats.validation));
  if (stats.test.total > 0) {
    lines.push(formatRow('Test', stats.test));
  }

  lines.push('└──────────────┴─────────┴─────────┴─────────┴────────┘');

  return lines.join('\n');
}

// ============================================
// TIME-SERIES AWARE SPLITTING
// ============================================

/**
 * Time-series aware split that respects temporal ordering
 * Prevents future data leakage by splitting chronologically
 *
 * Note: Requires examples to have a timestamp or date field
 */
export function temporalSplit(
  examples: TrainingExample[],
  config: SplitConfig,
  dateExtractor: (example: TrainingExample) => Date
): SplitResult {
  const { trainRatio, validationRatio, testRatio } = config;

  // Validate ratios
  const totalRatio = trainRatio + validationRatio + testRatio;
  if (Math.abs(totalRatio - 1.0) > 0.001) {
    throw new Error(`Split ratios must sum to 1.0, got ${totalRatio}`);
  }

  // Sort by date (oldest first)
  const sorted = [...examples].sort((a, b) =>
    dateExtractor(a).getTime() - dateExtractor(b).getTime()
  );

  // Split chronologically
  const trainEnd = Math.floor(sorted.length * trainRatio);
  const valEnd = trainEnd + Math.floor(sorted.length * validationRatio);

  return {
    train: sorted.slice(0, trainEnd),
    validation: sorted.slice(trainEnd, valEnd),
    test: sorted.slice(valEnd),
  };
}

// ============================================
// K-FOLD GENERATION
// ============================================

export interface KFold {
  fold: number;
  train: TrainingExample[];
  validation: TrainingExample[];
}

/**
 * Generate k stratified folds for cross-validation
 */
export function generateStratifiedKFolds(
  examples: TrainingExample[],
  k: number,
  seed?: number
): KFold[] {
  const random = createSeededRandom(seed ?? Date.now());

  // Separate and shuffle by class
  const positives = shuffleArray(examples.filter(e => e.label === 1), random);
  const negatives = shuffleArray(examples.filter(e => e.label === 0), random);

  // Calculate fold sizes
  const posFoldSize = Math.floor(positives.length / k);
  const negFoldSize = Math.floor(negatives.length / k);

  const folds: KFold[] = [];

  for (let i = 0; i < k; i++) {
    // Get validation indices for this fold
    const posValStart = i * posFoldSize;
    const posValEnd = i === k - 1 ? positives.length : (i + 1) * posFoldSize;

    const negValStart = i * negFoldSize;
    const negValEnd = i === k - 1 ? negatives.length : (i + 1) * negFoldSize;

    // Validation set
    const valPositives = positives.slice(posValStart, posValEnd);
    const valNegatives = negatives.slice(negValStart, negValEnd);
    const validation = shuffleArray([...valPositives, ...valNegatives], random);

    // Training set (everything else)
    const trainPositives = [...positives.slice(0, posValStart), ...positives.slice(posValEnd)];
    const trainNegatives = [...negatives.slice(0, negValStart), ...negatives.slice(negValEnd)];
    const train = shuffleArray([...trainPositives, ...trainNegatives], random);

    folds.push({ fold: i + 1, train, validation });
  }

  return folds;
}
