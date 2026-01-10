/**
 * Simulator Regression Tests
 *
 * Deterministic tests to verify simulator correctness after changes.
 * Run with: npx ts-node --compiler-options '{"module":"commonjs"}' scripts/test-simulator-regression.ts
 *
 * Created: 2025-12-15 (B4: Add deterministic regression checks)
 */

import { TradeManager, ExitCheckResult } from '../src/lib/backtest/trade-manager';
import { BacktestTrade, BacktestConfig, ExitReason } from '../src/lib/backtest/types';
import { MarketRegime } from '../src/lib/market-regime/types';

// ============================================
// TEST UTILITIES
// ============================================

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passCount++;
    console.log(`  ✅ ${message}`);
  } else {
    failCount++;
    console.log(`  ❌ FAILED: ${message}`);
  }
}

function assertClose(actual: number, expected: number, tolerance: number, message: string): void {
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) {
    passCount++;
    console.log(`  ✅ ${message} (actual: ${actual.toFixed(4)}, expected: ${expected.toFixed(4)})`);
  } else {
    failCount++;
    console.log(`  ❌ FAILED: ${message} (actual: ${actual.toFixed(4)}, expected: ${expected.toFixed(4)}, diff: ${diff.toFixed(4)})`);
  }
}

// ============================================
// MOCK DATA & HELPERS
// ============================================

function createMockConfig(): BacktestConfig {
  return {
    name: 'Regression Test',
    startDate: '2024-01-01',
    endDate: '2024-01-31',
    initialCapital: 100000,
    maxOpenPositions: 5,
    riskPerTrade: 0.01, // 1% risk per trade
    maxTotalRisk: 0.05, // 5% max total portfolio risk
    entryThreshold: 60, // Min 60% probability to enter
    minRRRatio: 1.5, // Min 1.5:1 risk/reward
    adjustForRegime: false, // No regime adjustments for test
    tpRatios: [1.5, 2.5, 4.0], // R-multiples for TP1, TP2, TP3
    tpSizes: [0.33, 0.33, 0.34], // 33%, 33%, 34%
    slippagePercent: 0.05,
    commissionPerShare: 0.005,
    maxHoldingDays: 45,
    useTrailingStop: false,
    gapHandling: 'MARKET',
    universe: ['TEST'],
  };
}

function createMockTrade(overrides: Partial<BacktestTrade> = {}): BacktestTrade {
  const entryPrice = 100;
  const stopLoss = 95; // 5% risk
  const risk = entryPrice - stopLoss;

  return {
    tradeId: 'T1',
    ticker: 'TEST',
    signalDate: '2024-01-02',
    entryDate: '2024-01-02',
    entryPrice,
    entryProbability: 65,
    shares: 100,
    initialShares: 100,
    positionValue: 10000,
    stopLoss,
    tp1: entryPrice + risk * 1.5, // 107.5
    tp2: entryPrice + risk * 2.5, // 112.5
    tp3: entryPrice + risk * 4.0, // 120
    regime: 'BULL' as MarketRegime,
    sector: 'Technology',
    status: 'OPEN',
    partialExits: [],
    ...overrides,
  };
}

// ============================================
// TEST: TP Tranche Sizing
// ============================================

function testTPTrancheSizing(): void {
  console.log('\n📋 TEST: TP Tranche Sizing (33/33/34 split)');

  const config = createMockConfig();
  const tradeManager = new TradeManager(config);

  // Test with 100 shares initial
  const trade = createMockTrade({ shares: 100, initialShares: 100 });

  // TP1 should sell 33 shares (33% of 100)
  const tp1Result = tradeManager.checkExit(trade, 108, 99, 107, new Date('2024-01-05'));

  assert(tp1Result.isPartialExit === true, 'TP1 triggers partial exit');
  assert(tp1Result.partialShares === 33, `TP1 sells 33 shares (got: ${tp1Result.partialShares})`);
  assert(tp1Result.exitReason === 'TP1', 'Exit reason is TP1');
  assert(tp1Result.shouldExit === false, 'shouldExit is false for partial');

  // Simulate TP1 execution
  trade.partialExits!.push({
    date: '2024-01-05',
    price: 107.5,
    shares: 33,
    reason: 'TP1',
    pnl: (107.5 - 100) * 33,
  });
  trade.shares = 67; // Reduce remaining shares

  // TP2 should sell 33 shares (33% of 100 original, not current 67)
  const tp2Result = tradeManager.checkExit(trade, 113, 105, 112, new Date('2024-01-10'));

  assert(tp2Result.isPartialExit === true, 'TP2 triggers partial exit');
  assert(tp2Result.partialShares === 33, `TP2 sells 33 shares (got: ${tp2Result.partialShares})`);
  assert(tp2Result.exitReason === 'TP2', 'Exit reason is TP2');

  // Simulate TP2 execution
  trade.partialExits!.push({
    date: '2024-01-10',
    price: 112.5,
    shares: 33,
    reason: 'TP2',
    pnl: (112.5 - 100) * 33,
  });
  trade.shares = 34; // Reduce remaining shares

  // TP3 should be full exit with remaining 34 shares
  const tp3Result = tradeManager.checkExit(trade, 121, 115, 120, new Date('2024-01-15'));

  assert(tp3Result.shouldExit === true, 'TP3 triggers full exit');
  assert(tp3Result.exitReason === 'TP3', 'Exit reason is TP3');
  assertClose(tp3Result.exitPrice, 120, 0.01, 'TP3 exit price is correct');
}

// ============================================
// TEST: Stop Loss Priority
// ============================================

function testStopLossPriority(): void {
  console.log('\n📋 TEST: Stop Loss Priority');

  const config = createMockConfig();
  const tradeManager = new TradeManager(config);
  const trade = createMockTrade();

  // Stop loss should trigger before TP (low touches stop, even if high above TP)
  // Using low=95 exactly to avoid gap-through handling
  const result = tradeManager.checkExit(trade, 108, 95, 96, new Date('2024-01-05'));

  assert(result.shouldExit === true, 'Stop loss triggers full exit');
  assert(result.exitReason === 'STOP_LOSS', 'Exit reason is STOP_LOSS');
  assertClose(result.exitPrice, 95, 0.01, 'Stop loss price is respected');
}

// ============================================
// TEST: Time Exit
// ============================================

function testTimeExit(): void {
  console.log('\n📋 TEST: Time Exit (maxHoldingDays)');

  const config = createMockConfig();
  config.maxHoldingDays = 10; // Short holding period for test
  const tradeManager = new TradeManager(config);
  const trade = createMockTrade({ entryDate: '2024-01-01' });

  // Day 9: Should NOT exit yet
  const day9Result = tradeManager.checkExit(trade, 101, 99, 100, new Date('2024-01-10'));
  assert(day9Result.shouldExit === false, 'No exit at day 9');

  // Day 10: Should exit due to time
  const day10Result = tradeManager.checkExit(trade, 101, 99, 100, new Date('2024-01-11'));
  assert(day10Result.shouldExit === true, 'Time exit at day 10');
  assert(day10Result.exitReason === 'TIME_EXIT', 'Exit reason is TIME_EXIT');
}

// ============================================
// TEST: Partial Exit PnL Calculation
// ============================================

function testPartialExitPnL(): void {
  console.log('\n📋 TEST: Partial Exit PnL Calculation');

  const trade = createMockTrade();
  const entryPrice = 100;
  const tp1Price = 107.5;
  const tp2Price = 112.5;
  const finalExitPrice = 115; // Exit between TP2 and TP3

  // Simulate TP1 partial exit
  const tp1Shares = 33;
  const tp1Pnl = (tp1Price - entryPrice) * tp1Shares; // 7.5 * 33 = 247.5

  trade.partialExits!.push({
    date: '2024-01-05',
    price: tp1Price,
    shares: tp1Shares,
    reason: 'TP1',
    pnl: tp1Pnl,
  });
  trade.shares = 67;

  // Simulate TP2 partial exit
  const tp2Shares = 33;
  const tp2Pnl = (tp2Price - entryPrice) * tp2Shares; // 12.5 * 33 = 412.5

  trade.partialExits!.push({
    date: '2024-01-10',
    price: tp2Price,
    shares: tp2Shares,
    reason: 'TP2',
    pnl: tp2Pnl,
  });
  trade.shares = 34;

  // Final exit at $115
  const finalShares = 34;
  const finalPnl = (finalExitPrice - entryPrice) * finalShares; // 15 * 34 = 510

  // Calculate total realized PnL
  const partialPnl = trade.partialExits!.reduce((sum, p) => sum + p.pnl, 0);
  const totalPnl = partialPnl + finalPnl;

  assertClose(tp1Pnl, 247.5, 0.01, 'TP1 PnL is correct');
  assertClose(tp2Pnl, 412.5, 0.01, 'TP2 PnL is correct');
  assertClose(finalPnl, 510, 0.01, 'Final exit PnL is correct');
  assertClose(totalPnl, 1170, 0.01, 'Total realized PnL is correct');

  // Calculate blended R
  const risk = entryPrice - trade.stopLoss; // 5
  const totalExitValue = tp1Price * tp1Shares + tp2Price * tp2Shares + finalExitPrice * finalShares;
  const avgExitPrice = totalExitValue / trade.initialShares;
  const blendedR = (avgExitPrice - entryPrice) / risk;

  assertClose(avgExitPrice, 111.7, 0.1, 'Average exit price is correct');
  assertClose(blendedR, 2.34, 0.01, 'Blended R is correct');
}

// ============================================
// TEST: Gap-Through Stop Loss
// ============================================

function testGapThroughStopLoss(): void {
  console.log('\n📋 TEST: Gap-Through Stop Loss Handling');

  const config = createMockConfig();
  config.gapHandling = 'MARKET';
  config.maxSlippageR = 2.0;
  const tradeManager = new TradeManager(config);
  const trade = createMockTrade(); // Stop at 95, entry at 100

  // Gap down through stop to $92 (below -2R cap of $90)
  const result = tradeManager.checkExit(trade, 96, 88, 89, new Date('2024-01-05'));

  assert(result.shouldExit === true, 'Stop loss triggers on gap');
  assert(result.exitReason === 'STOP_LOSS', 'Exit reason is STOP_LOSS');

  // With maxSlippageR = 2.0 and risk = 5, min exit = 100 - 10 = 90
  // But gap was to 88, so should cap at 90
  assertClose(result.exitPrice, 90, 0.01, 'Exit price capped at -2R (maxSlippageR)');
}

// ============================================
// TEST: No Double TP Exits
// ============================================

function testNoDoubleTpExits(): void {
  console.log('\n📋 TEST: No Double TP Exits');

  const config = createMockConfig();
  const tradeManager = new TradeManager(config);
  const trade = createMockTrade();

  // First TP1 hit - should trigger
  const firstResult = tradeManager.checkExit(trade, 108, 99, 107, new Date('2024-01-05'));
  assert(firstResult.isPartialExit === true, 'First TP1 hit triggers exit');

  // Simulate TP1 was taken
  trade.partialExits!.push({
    date: '2024-01-05',
    price: 107.5,
    shares: 33,
    reason: 'TP1',
    pnl: 247.5,
  });
  trade.shares = 67;

  // Second TP1 hit - should NOT trigger (already taken)
  const secondResult = tradeManager.checkExit(trade, 108, 99, 107, new Date('2024-01-06'));

  assert(secondResult.isPartialExit !== true || secondResult.exitReason !== 'TP1',
    'TP1 does not trigger again after already taken');
}

// ============================================
// MAIN TEST RUNNER
// ============================================

async function runTests(): Promise<void> {
  console.log('═'.repeat(60));
  console.log('SIMULATOR REGRESSION TESTS');
  console.log('═'.repeat(60));

  try {
    testTPTrancheSizing();
    testStopLossPriority();
    testTimeExit();
    testPartialExitPnL();
    testGapThroughStopLoss();
    testNoDoubleTpExits();

    console.log('\n' + '═'.repeat(60));
    console.log(`RESULTS: ${passCount} passed, ${failCount} failed`);
    console.log('═'.repeat(60));

    if (failCount > 0) {
      console.log('\n❌ REGRESSION TEST FAILED');
      process.exit(1);
    } else {
      console.log('\n✅ ALL REGRESSION TESTS PASSED');
      process.exit(0);
    }
  } catch (error) {
    console.error('\n❌ TEST ERROR:', error);
    process.exit(1);
  }
}

runTests();
