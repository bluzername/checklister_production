/**
 * Walk-Forward Optimization Framework
 * For robust out-of-sample parameter tuning
 */

import {
  BacktestConfig,
  BacktestResult,
  WalkForwardConfig,
  WalkForwardPeriod,
  WalkForwardResult,
  PerformanceMetrics,
} from './types';
import { runBacktest, createDefaultConfig } from './simulator';

// ============================================
// WALK-FORWARD OPTIMIZATION
// ============================================

/**
 * Run walk-forward optimization
 * 
 * Process:
 * 1. Split data into train/validate/test periods
 * 2. For each train period, find optimal parameters
 * 3. Validate on validation period
 * 4. Test final parameters on test period
 */
export async function runWalkForward(
  config: WalkForwardConfig,
  universe: string[]
): Promise<WalkForwardResult> {
  console.log('Starting Walk-Forward Optimization');
  console.log(`Periods: ${config.periods.length}`);
  console.log(`Parameters to optimize: ${Object.keys(config.parameterRanges).length}`);

  const periodResults: WalkForwardResult['periods'] = [];
  let bestParams: Partial<BacktestConfig> = {};

  // Process each period
  for (const period of config.periods) {
    console.log(`\nProcessing ${period.type} period: ${period.name} (${period.startDate} to ${period.endDate})`);

    if (period.type === 'TRAIN') {
      // Optimize parameters on training data
      const optimizationResult = await optimizeParameters(
        universe,
        period.startDate,
        period.endDate,
        config.parameterRanges,
        config.optimizationMetric
      );

      bestParams = optimizationResult.bestParams;
      
      periodResults.push({
        period,
        result: optimizationResult.result,
        bestParams,
      });

      console.log(`Best params found: ${JSON.stringify(bestParams)}`);
    } else {
      // Validate or test with best params
      const backtestConfig = createDefaultConfig(universe, period.startDate, period.endDate);
      const configWithParams = { ...backtestConfig, ...bestParams, name: `${period.type}: ${period.name}` };
      
      const result = await runBacktest(configWithParams);
      
      periodResults.push({
        period,
        result,
      });
    }
  }

  // Calculate out-of-sample metrics (from validate + test periods)
  const oosResults = periodResults
    .filter(p => p.period.type !== 'TRAIN')
    .map(p => p.result);
  
  const outOfSampleMetrics = aggregateMetrics(oosResults);

  console.log('\n=== Walk-Forward Optimization Complete ===');
  console.log(`Out-of-sample Win Rate: ${outOfSampleMetrics.winRate.toFixed(1)}%`);
  console.log(`Out-of-sample Sharpe: ${outOfSampleMetrics.sharpeRatio.toFixed(2)}`);

  return {
    config,
    periods: periodResults,
    optimalParams: bestParams,
    outOfSampleMetrics,
  };
}

/**
 * Optimize parameters using grid search
 */
async function optimizeParameters(
  universe: string[],
  startDate: string,
  endDate: string,
  parameterRanges: WalkForwardConfig['parameterRanges'],
  optimizationMetric: WalkForwardConfig['optimizationMetric']
): Promise<{ bestParams: Partial<BacktestConfig>; result: BacktestResult }> {
  // Generate all parameter combinations
  const combinations = generateParameterCombinations(parameterRanges);
  
  console.log(`Testing ${combinations.length} parameter combinations...`);

  let bestScore = -Infinity;
  let bestParams: Partial<BacktestConfig> = {};
  let bestResult: BacktestResult | null = null;

  // Test each combination
  for (let i = 0; i < combinations.length; i++) {
    const params = combinations[i];
    
    if (i % 10 === 0) {
      console.log(`  Progress: ${i}/${combinations.length}`);
    }

    try {
      const config = createDefaultConfig(universe, startDate, endDate);
      const configWithParams = {
        ...config,
        ...params,
        name: `Optimization Run ${i + 1}`,
      };

      const result = await runBacktest(configWithParams);
      const score = getMetricScore(result.metrics, optimizationMetric);

      if (score > bestScore) {
        bestScore = score;
        bestParams = params;
        bestResult = result;
      }
    } catch (error) {
      console.warn(`  Combination ${i} failed:`, error);
    }
  }

  if (!bestResult) {
    throw new Error('No valid parameter combinations found');
  }

  return { bestParams, result: bestResult };
}

/**
 * Generate all combinations of parameters
 */
function generateParameterCombinations(
  ranges: WalkForwardConfig['parameterRanges']
): Partial<BacktestConfig>[] {
  const combinations: Partial<BacktestConfig>[] = [];

  // Get all parameter names and their values
  const paramNames = Object.keys(ranges) as (keyof WalkForwardConfig['parameterRanges'])[];
  const paramValues = paramNames.map(name => ranges[name] || []);

  // Generate Cartesian product
  function generateCombos(index: number, current: Partial<BacktestConfig>): void {
    if (index === paramNames.length) {
      combinations.push({ ...current });
      return;
    }

    const paramName = paramNames[index];
    const values = paramValues[index];

    for (const value of values) {
      generateCombos(index + 1, { ...current, [paramName]: value });
    }
  }

  generateCombos(0, {});
  return combinations;
}

/**
 * Get score for optimization metric
 */
function getMetricScore(
  metrics: PerformanceMetrics,
  metric: WalkForwardConfig['optimizationMetric']
): number {
  switch (metric) {
    case 'sharpe':
      return metrics.sharpeRatio;
    case 'sortino':
      return metrics.sortinoRatio;
    case 'profitFactor':
      return metrics.profitFactor;
    case 'expectancy':
      return metrics.expectancy;
    default:
      return metrics.sharpeRatio;
  }
}

/**
 * Aggregate metrics from multiple backtest results
 */
function aggregateMetrics(results: BacktestResult[]): PerformanceMetrics {
  if (results.length === 0) {
    return createEmptyMetrics();
  }

  const allTrades = results.flatMap(r => r.trades);
  const totalPnl = results.reduce((sum, r) => sum + r.metrics.totalPnl, 0);
  const totalTrades = results.reduce((sum, r) => sum + r.metrics.totalTrades, 0);
  const winners = results.reduce((sum, r) => sum + r.metrics.winners, 0);
  const losers = results.reduce((sum, r) => sum + r.metrics.losers, 0);

  // Weighted averages
  const weightedSharpe = results.reduce((sum, r) => sum + r.metrics.sharpeRatio * r.metrics.totalTrades, 0) / totalTrades;
  const weightedSortino = results.reduce((sum, r) => sum + r.metrics.sortinoRatio * r.metrics.totalTrades, 0) / totalTrades;

  // Max drawdown is the worst across all periods
  const maxDrawdownPercent = Math.max(...results.map(r => r.metrics.maxDrawdownPercent));

  return {
    totalTrades,
    winners,
    losers,
    winRate: totalTrades > 0 ? (winners / totalTrades) * 100 : 0,
    totalPnl,
    totalPnlPercent: 0, // Would need initial capital
    avgPnlPerTrade: totalTrades > 0 ? totalPnl / totalTrades : 0,
    avgWin: winners > 0 ? allTrades.filter(t => (t.realizedPnl || 0) > 0).reduce((s, t) => s + (t.realizedPnl || 0), 0) / winners : 0,
    avgLoss: losers > 0 ? Math.abs(allTrades.filter(t => (t.realizedPnl || 0) <= 0).reduce((s, t) => s + (t.realizedPnl || 0), 0)) / losers : 0,
    avgR: totalTrades > 0 ? allTrades.reduce((s, t) => s + (t.realizedR || 0), 0) / totalTrades : 0,
    avgWinR: 0,
    avgLossR: 0,
    expectancy: 0,
    profitFactor: 0,
    maxDrawdown: 0,
    maxDrawdownPercent,
    maxDrawdownDuration: 0,
    sharpeRatio: weightedSharpe,
    sortinoRatio: weightedSortino,
    calmarRatio: 0,
    avgHoldingDays: totalTrades > 0 ? allTrades.reduce((s, t) => s + (t.holdingDays || 0), 0) / totalTrades : 0,
    rDistribution: [],
  };
}

function createEmptyMetrics(): PerformanceMetrics {
  return {
    totalTrades: 0,
    winners: 0,
    losers: 0,
    winRate: 0,
    totalPnl: 0,
    totalPnlPercent: 0,
    avgPnlPerTrade: 0,
    avgWin: 0,
    avgLoss: 0,
    avgR: 0,
    avgWinR: 0,
    avgLossR: 0,
    expectancy: 0,
    profitFactor: 0,
    maxDrawdown: 0,
    maxDrawdownPercent: 0,
    maxDrawdownDuration: 0,
    sharpeRatio: 0,
    sortinoRatio: 0,
    calmarRatio: 0,
    avgHoldingDays: 0,
    rDistribution: [],
  };
}

// ============================================
// PREDEFINED WALK-FORWARD CONFIGURATIONS
// ============================================

/**
 * Create standard 3-period walk-forward configuration
 */
export function createStandardWalkForward(
  trainStart: string,
  trainEnd: string,
  validateStart: string,
  validateEnd: string,
  testStart: string,
  testEnd: string
): WalkForwardConfig {
  return {
    periods: [
      { name: 'Training', type: 'TRAIN', startDate: trainStart, endDate: trainEnd },
      { name: 'Validation', type: 'VALIDATE', startDate: validateStart, endDate: validateEnd },
      { name: 'Test', type: 'TEST', startDate: testStart, endDate: testEnd },
    ],
    parameterRanges: {
      entryThreshold: [60, 65, 70, 75],
      minRRRatio: [1.5, 2.0, 2.5, 3.0],
      maxHoldingDays: [20, 30, 45],
    },
    optimizationMetric: 'sharpe',
  };
}

/**
 * Create rolling walk-forward configuration
 * For continuous optimization with rolling windows
 */
export function createRollingWalkForward(
  startYear: number,
  endYear: number,
  trainYears: number = 3,
  testMonths: number = 6
): WalkForwardConfig {
  const periods: WalkForwardPeriod[] = [];
  
  let currentYear = startYear;
  let periodNum = 1;

  while (currentYear + trainYears <= endYear) {
    const trainStart = `${currentYear}-01-01`;
    const trainEnd = `${currentYear + trainYears - 1}-12-31`;
    
    const testStartYear = currentYear + trainYears;
    const testStartMonth = 1;
    const testEndMonth = testStartMonth + testMonths - 1;
    
    const testStart = `${testStartYear}-${String(testStartMonth).padStart(2, '0')}-01`;
    const testEnd = `${testStartYear}-${String(testEndMonth).padStart(2, '0')}-28`;

    periods.push({
      name: `Train ${periodNum}`,
      type: 'TRAIN',
      startDate: trainStart,
      endDate: trainEnd,
    });

    periods.push({
      name: `Test ${periodNum}`,
      type: 'TEST',
      startDate: testStart,
      endDate: testEnd,
    });

    currentYear++;
    periodNum++;
  }

  return {
    periods,
    parameterRanges: {
      entryThreshold: [60, 65, 70],
      minRRRatio: [2.0, 2.5],
      maxHoldingDays: [30, 45],
    },
    optimizationMetric: 'sharpe',
  };
}

// Export
export type { WalkForwardConfig, WalkForwardResult, WalkForwardPeriod };







