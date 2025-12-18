/**
 * Trade Labeling
 * Functions to label historical trades for ML model training
 *
 * NOTE: This module provides two labeling approaches:
 * 1. labelTrade() - Original simple forward-sim (legacy, deprecated)
 * 2. labelTradeWithEngine() - Uses TradeManager for consistency with backtest simulator
 *
 * Use labelTradeWithEngine() for new code to ensure label/backtest alignment.
 */

import YahooFinance from 'yahoo-finance2';
import { TradeManager, ExitCheckResult } from '../backtest/trade-manager';
import { BacktestConfig, BacktestTrade, ExitReason } from '../backtest/types';
import { MarketRegime } from '../market-regime/types';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

/**
 * Label trade result for model training
 */
export interface TradeLabelResult {
  label: 0 | 1;
  realizedR: number;
  exitPrice: number;
  exitDate: string;
  exitReason: 'TP1' | 'TP2' | 'TP3' | 'STOP_LOSS' | 'TIME_EXIT' | 'MFE_TRACKING';
  maxFavorableExcursion: number;
  maxAdverseExcursion: number;
  mfeR: number;
  maeR: number;
  holdingDays: number;
}

/**
 * Label a trade by simulating forward from entry
 * 
 * @param ticker - Stock ticker symbol
 * @param entryDate - Date of entry
 * @param entryPrice - Entry price
 * @param stopLoss - Stop loss price
 * @param targetR - R multiple to consider a "win" (default 1.5)
 * @param maxHoldingDays - Maximum days to hold (default 45)
 */
export async function labelTrade(
  ticker: string,
  entryDate: string,
  entryPrice: number,
  stopLoss: number,
  targetR: number = 1.5,
  maxHoldingDays: number = 45
): Promise<TradeLabelResult | null> {
  try {
    const risk = entryPrice - stopLoss;
    if (risk <= 0) {
      console.warn(`Invalid risk for ${ticker}: entry ${entryPrice}, stop ${stopLoss}`);
      return null;
    }

    const targetPrice = entryPrice + (risk * targetR);

    // Fetch forward price data
    const startDate = new Date(entryDate);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + maxHoldingDays + 5); // Buffer for weekends

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const historical = await yahooFinance.chart(ticker, {
      period1: startDate,
      period2: endDate,
      interval: '1d'
    }) as any;

    if (!historical || !historical.quotes || historical.quotes.length === 0) {
      return null;
    }

    // Filter quotes after entry date
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const forwardQuotes = historical.quotes.filter((q: any) => {
      const quoteDate = new Date(q.date);
      return quoteDate > startDate && q.close != null;
    });

    if (forwardQuotes.length === 0) {
      return null;
    }

    // Track through price history
    let maxPrice = entryPrice;
    let minPrice = entryPrice;
    let exitPrice = entryPrice;
    let exitDate = entryDate;
    let exitReason: TradeLabelResult['exitReason'] = 'TIME_EXIT';
    let holdingDays = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const quote of forwardQuotes) {
      holdingDays++;
      const high = quote.high as number;
      const low = quote.low as number;
      const close = quote.close as number;
      const quoteDate = new Date(quote.date).toISOString().split('T')[0];

      // Update MFE/MAE
      maxPrice = Math.max(maxPrice, high);
      minPrice = Math.min(minPrice, low);

      // Check stop loss
      if (low <= stopLoss) {
        exitPrice = stopLoss;
        exitDate = quoteDate;
        exitReason = 'STOP_LOSS';
        break;
      }

      // Check target (1.5R for TP1, 2.5R for TP2, 4R for TP3)
      if (high >= targetPrice) {
        exitPrice = targetPrice;
        exitDate = quoteDate;
        
        // Determine which TP was hit
        const r2 = entryPrice + (risk * 2.5);
        const r4 = entryPrice + (risk * 4.0);
        
        if (high >= r4) {
          exitReason = 'TP3';
          exitPrice = r4;
        } else if (high >= r2) {
          exitReason = 'TP2';
          exitPrice = r2;
        } else {
          exitReason = 'TP1';
        }
        break;
      }

      // Check max holding days
      if (holdingDays >= maxHoldingDays) {
        exitPrice = close;
        exitDate = quoteDate;
        exitReason = 'TIME_EXIT';
        break;
      }
    }

    // Calculate metrics
    const realizedR = (exitPrice - entryPrice) / risk;
    const mfeR = (maxPrice - entryPrice) / risk;
    const maeR = (entryPrice - minPrice) / risk;
    const label = realizedR >= targetR ? 1 : 0;

    return {
      label,
      realizedR,
      exitPrice,
      exitDate,
      exitReason,
      maxFavorableExcursion: maxPrice,
      maxAdverseExcursion: minPrice,
      mfeR,
      maeR,
      holdingDays,
    };
  } catch (error) {
    console.error(`Error labeling trade for ${ticker}:`, error);
    return null;
  }
}

/**
 * Batch label multiple trades
 */
export async function batchLabelTrades(
  trades: {
    ticker: string;
    entryDate: string;
    entryPrice: number;
    stopLoss: number;
  }[],
  targetR: number = 1.5,
  maxHoldingDays: number = 45,
  concurrency: number = 3
): Promise<(TradeLabelResult | null)[]> {
  const results: (TradeLabelResult | null)[] = [];

  // Process in batches
  for (let i = 0; i < trades.length; i += concurrency) {
    const batch = trades.slice(i, i + concurrency);
    
    const batchResults = await Promise.all(
      batch.map(trade =>
        labelTrade(
          trade.ticker,
          trade.entryDate,
          trade.entryPrice,
          trade.stopLoss,
          targetR,
          maxHoldingDays
        )
      )
    );

    results.push(...batchResults);

    // Rate limiting
    if (i + concurrency < trades.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return results;
}

/**
 * Calculate label statistics from a set of labeled trades
 */
export function calculateLabelStats(labels: TradeLabelResult[]): {
  totalTrades: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  avgR: number;
  avgWinR: number;
  avgLossR: number;
  avgMFE: number;
  avgMAE: number;
  avgHoldingDays: number;
  exitReasonDistribution: Record<string, number>;
} {
  if (labels.length === 0) {
    return {
      totalTrades: 0,
      winCount: 0,
      lossCount: 0,
      winRate: 0,
      avgR: 0,
      avgWinR: 0,
      avgLossR: 0,
      avgMFE: 0,
      avgMAE: 0,
      avgHoldingDays: 0,
      exitReasonDistribution: {},
    };
  }

  const winners = labels.filter(l => l.label === 1);
  const losers = labels.filter(l => l.label === 0);

  const exitReasonDistribution: Record<string, number> = {};
  for (const label of labels) {
    exitReasonDistribution[label.exitReason] = (exitReasonDistribution[label.exitReason] || 0) + 1;
  }

  return {
    totalTrades: labels.length,
    winCount: winners.length,
    lossCount: losers.length,
    winRate: (winners.length / labels.length) * 100,
    avgR: labels.reduce((s, l) => s + l.realizedR, 0) / labels.length,
    avgWinR: winners.length > 0 ? winners.reduce((s, l) => s + l.realizedR, 0) / winners.length : 0,
    avgLossR: losers.length > 0 ? Math.abs(losers.reduce((s, l) => s + l.realizedR, 0) / losers.length) : 0,
    avgMFE: labels.reduce((s, l) => s + l.mfeR, 0) / labels.length,
    avgMAE: labels.reduce((s, l) => s + l.maeR, 0) / labels.length,
    avgHoldingDays: labels.reduce((s, l) => s + l.holdingDays, 0) / labels.length,
    exitReasonDistribution,
  };
}

/**
 * Analyze optimal exit by looking at MFE distribution
 */
export function analyzeOptimalExit(labels: TradeLabelResult[]): {
  optimalTP1: number;
  optimalTP2: number;
  optimalTP3: number;
  mfeDistribution: { r: number; percentReached: number }[];
} {
  if (labels.length === 0) {
    return {
      optimalTP1: 1.5,
      optimalTP2: 2.5,
      optimalTP3: 4.0,
      mfeDistribution: [],
    };
  }

  // Sort by MFE
  const sortedByMFE = [...labels].sort((a, b) => a.mfeR - b.mfeR);
  
  // Calculate what percent of trades reached each R level
  const rLevels = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0, 6.0];
  const mfeDistribution = rLevels.map(r => ({
    r,
    percentReached: (labels.filter(l => l.mfeR >= r).length / labels.length) * 100,
  }));

  // Find optimal TP levels based on MFE distribution
  // TP1: ~70% of winners reach this (quick profit lock-in)
  // TP2: ~40% of winners reach this (good extension)
  // TP3: ~15% of winners reach this (runner target)
  
  let optimalTP1 = 1.5;
  let optimalTP2 = 2.5;
  let optimalTP3 = 4.0;

  for (const point of mfeDistribution) {
    if (point.percentReached >= 70 && point.r > optimalTP1) {
      optimalTP1 = point.r;
    }
    if (point.percentReached >= 40 && point.r > optimalTP2) {
      optimalTP2 = point.r;
    }
    if (point.percentReached >= 15 && point.r > optimalTP3) {
      optimalTP3 = point.r;
    }
  }

  // Fallback to reasonable defaults
  optimalTP1 = Math.max(1.0, Math.min(optimalTP1, 2.0));
  optimalTP2 = Math.max(optimalTP1 + 0.5, Math.min(optimalTP2, 3.5));
  optimalTP3 = Math.max(optimalTP2 + 0.5, Math.min(optimalTP3, 6.0));

  return {
    optimalTP1,
    optimalTP2,
    optimalTP3,
    mfeDistribution,
  };
}

// ============================================
// ENGINE-BASED LABELING (Recommended)
// ============================================

/**
 * Extended label result with partial exit tracking
 * Matches the simulator's output format for consistency
 */
export interface EngineLabelResult {
  label: 0 | 1;
  realizedR: number;              // Blended R across all exits
  exitPrice: number;              // Final exit price (or blended avg)
  exitDate: string;
  exitReason: ExitReason;         // Final exit reason
  maxFavorableExcursion: number;
  maxAdverseExcursion: number;
  mfeR: number;
  maeR: number;
  holdingDays: number;

  // Partial exit tracking (matches simulator)
  partialExits: {
    date: string;
    price: number;
    shares: number;
    reason: string;
    pnl: number;
  }[];

  // Additional metrics
  blendedExitPrice: number;       // Weighted average exit price
  totalPnl: number;               // Total P&L across all exits
}

/**
 * Default config for labeling (matches typical backtest config)
 */
const DEFAULT_LABEL_CONFIG: Partial<BacktestConfig> = {
  tpRatios: [1.5, 2.5, 4.0],
  tpSizes: [0.33, 0.33, 0.34],
  maxHoldingDays: 45,
  gapHandling: 'MARKET',
  maxSlippageR: 2.0,
  slippagePercent: 0.05,
  commissionPerShare: 0.005,
  useTrailingStop: false,
};

/**
 * Label a trade using the TradeManager engine
 *
 * This function uses the SAME exit logic as the backtest simulator,
 * ensuring that labeled examples match backtest results.
 *
 * Key differences from legacy labelTrade():
 * - Supports partial exits (TP1: 33%, TP2: 33%, TP3: 34%)
 * - Handles gap-through stops with maxSlippageR cap
 * - Calculates blended R from weighted average exits
 * - Uses configurable TP ratios and sizes
 *
 * @param ticker - Stock ticker symbol
 * @param entryDate - Date of entry (YYYY-MM-DD)
 * @param entryPrice - Entry price
 * @param stopLoss - Stop loss price
 * @param config - Optional config overrides for TP levels, holding days, etc.
 * @param targetRForLabel - R multiple to consider a "win" for binary label (default 1.0)
 */
export async function labelTradeWithEngine(
  ticker: string,
  entryDate: string,
  entryPrice: number,
  stopLoss: number,
  config: Partial<BacktestConfig> = {},
  targetRForLabel: number = 1.0
): Promise<EngineLabelResult | null> {
  try {
    const risk = entryPrice - stopLoss;
    if (risk <= 0) {
      console.warn(`Invalid risk for ${ticker}: entry ${entryPrice}, stop ${stopLoss}`);
      return null;
    }

    // Merge default config with overrides
    const fullConfig: BacktestConfig = {
      name: 'Labeling',
      startDate: entryDate,
      endDate: entryDate, // Not used by TradeManager
      initialCapital: 100000,
      maxOpenPositions: 1,
      riskPerTrade: 0.01,
      maxTotalRisk: 0.05,
      entryThreshold: 0,
      minRRRatio: 0,
      adjustForRegime: false,
      universe: [ticker],
      ...DEFAULT_LABEL_CONFIG,
      ...config,
    } as BacktestConfig;

    // Calculate TP levels
    const tp1 = entryPrice + risk * fullConfig.tpRatios[0];
    const tp2 = entryPrice + risk * fullConfig.tpRatios[1];
    const tp3 = entryPrice + risk * fullConfig.tpRatios[2];

    // Create TradeManager
    const tradeManager = new TradeManager(fullConfig);

    // Create initial trade object
    const initialShares = 100; // Use 100 for easy percentage math
    const trade: BacktestTrade = {
      tradeId: 'L1',
      ticker,
      signalDate: entryDate,
      entryDate,
      entryPrice,
      entryProbability: 0,
      shares: initialShares,
      initialShares,
      positionValue: entryPrice * initialShares,
      stopLoss,
      tp1,
      tp2,
      tp3,
      regime: 'CHOPPY' as MarketRegime,
      sector: 'Unknown',
      status: 'OPEN',
      partialExits: [],
    };

    // Fetch forward price data
    const startDate = new Date(entryDate);
    const endDate = new Date(startDate);
    const maxDays = fullConfig.maxHoldingDays || 45;
    endDate.setDate(endDate.getDate() + maxDays + 10); // Buffer for weekends

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const historical = await yahooFinance.chart(ticker, {
      period1: startDate,
      period2: endDate,
      interval: '1d'
    }) as any;

    if (!historical || !historical.quotes || historical.quotes.length === 0) {
      return null;
    }

    // Filter quotes after entry date
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const forwardQuotes = historical.quotes.filter((q: any) => {
      const quoteDate = new Date(q.date);
      return quoteDate > startDate && q.close != null;
    });

    if (forwardQuotes.length === 0) {
      return null;
    }

    // Track through price history using TradeManager
    let maxPrice = entryPrice;
    let minPrice = entryPrice;
    let finalExitPrice = entryPrice;
    let finalExitDate = entryDate;
    let finalExitReason: ExitReason = 'TIME_EXIT';
    let holdingDays = 0;
    let tradeExited = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const quote of forwardQuotes) {
      if (tradeExited || trade.shares <= 0) break;

      holdingDays++;
      const high = quote.high as number;
      const low = quote.low as number;
      const close = quote.close as number;
      const quoteDate = new Date(quote.date);
      const quoteDateStr = quoteDate.toISOString().split('T')[0];

      // Update MFE/MAE
      maxPrice = Math.max(maxPrice, high);
      minPrice = Math.min(minPrice, low);

      // Use TradeManager to check exit
      const exitResult = tradeManager.checkExit(trade, high, low, close, quoteDate);

      // Handle partial exits
      if (exitResult.isPartialExit && exitResult.partialShares && exitResult.partialShares > 0) {
        const sharesToSell = Math.min(exitResult.partialShares, trade.shares);
        const partialPnl = (exitResult.exitPrice - entryPrice) * sharesToSell;

        trade.partialExits!.push({
          date: quoteDateStr,
          price: exitResult.exitPrice,
          shares: sharesToSell,
          reason: exitResult.exitReason,
          pnl: partialPnl,
        });

        trade.shares -= sharesToSell;

        // If this was the last shares, record as final exit
        if (trade.shares <= 0) {
          finalExitPrice = exitResult.exitPrice;
          finalExitDate = quoteDateStr;
          finalExitReason = exitResult.exitReason;
          tradeExited = true;
        }
      }
      // Handle full exits
      else if (exitResult.shouldExit) {
        // Record final exit
        const remainingPnl = (exitResult.exitPrice - entryPrice) * trade.shares;

        if (trade.shares > 0) {
          trade.partialExits!.push({
            date: quoteDateStr,
            price: exitResult.exitPrice,
            shares: trade.shares,
            reason: exitResult.exitReason,
            pnl: remainingPnl,
          });
        }

        finalExitPrice = exitResult.exitPrice;
        finalExitDate = quoteDateStr;
        finalExitReason = exitResult.exitReason;
        trade.shares = 0;
        tradeExited = true;
      }
    }

    // If trade didn't exit, force time exit at last available price
    if (!tradeExited && trade.shares > 0) {
      const lastQuote = forwardQuotes[forwardQuotes.length - 1];
      const lastClose = lastQuote.close as number;
      const lastDate = new Date(lastQuote.date).toISOString().split('T')[0];

      trade.partialExits!.push({
        date: lastDate,
        price: lastClose,
        shares: trade.shares,
        reason: 'TIME_EXIT',
        pnl: (lastClose - entryPrice) * trade.shares,
      });

      finalExitPrice = lastClose;
      finalExitDate = lastDate;
      finalExitReason = 'TIME_EXIT';
    }

    // Calculate blended metrics (same as simulator)
    const partialExits = trade.partialExits || [];
    let totalExitValue = 0;
    let totalShares = 0;
    let totalPnl = 0;

    for (const exit of partialExits) {
      totalExitValue += exit.price * exit.shares;
      totalShares += exit.shares;
      totalPnl += exit.pnl;
    }

    const blendedExitPrice = totalShares > 0 ? totalExitValue / totalShares : entryPrice;
    const realizedR = risk > 0 ? (blendedExitPrice - entryPrice) / risk : 0;
    const mfeR = risk > 0 ? (maxPrice - entryPrice) / risk : 0;
    const maeR = risk > 0 ? (entryPrice - minPrice) / risk : 0;
    const label = realizedR >= targetRForLabel ? 1 : 0;

    return {
      label,
      realizedR,
      exitPrice: finalExitPrice,
      exitDate: finalExitDate,
      exitReason: finalExitReason,
      maxFavorableExcursion: maxPrice,
      maxAdverseExcursion: minPrice,
      mfeR,
      maeR,
      holdingDays,
      partialExits,
      blendedExitPrice,
      totalPnl,
    };
  } catch (error) {
    console.error(`Error labeling trade for ${ticker} with engine:`, error);
    return null;
  }
}

/**
 * Batch label trades using the engine-based approach
 */
export async function batchLabelTradesWithEngine(
  trades: {
    ticker: string;
    entryDate: string;
    entryPrice: number;
    stopLoss: number;
  }[],
  config: Partial<BacktestConfig> = {},
  targetRForLabel: number = 1.0,
  concurrency: number = 3
): Promise<(EngineLabelResult | null)[]> {
  const results: (EngineLabelResult | null)[] = [];

  // Process in batches
  for (let i = 0; i < trades.length; i += concurrency) {
    const batch = trades.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(trade =>
        labelTradeWithEngine(
          trade.ticker,
          trade.entryDate,
          trade.entryPrice,
          trade.stopLoss,
          config,
          targetRForLabel
        )
      )
    );

    results.push(...batchResults);

    // Rate limiting
    if (i + concurrency < trades.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return results;
}

/**
 * Calculate label statistics from engine-labeled trades
 */
export function calculateEngineLabelStats(labels: EngineLabelResult[]): {
  totalTrades: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  avgR: number;
  avgWinR: number;
  avgLossR: number;
  avgMFE: number;
  avgMAE: number;
  avgHoldingDays: number;
  exitReasonDistribution: Record<string, number>;
  partialExitStats: {
    avgTP1Exits: number;
    avgTP2Exits: number;
    avgPartialExitsPerTrade: number;
  };
} {
  if (labels.length === 0) {
    return {
      totalTrades: 0,
      winCount: 0,
      lossCount: 0,
      winRate: 0,
      avgR: 0,
      avgWinR: 0,
      avgLossR: 0,
      avgMFE: 0,
      avgMAE: 0,
      avgHoldingDays: 0,
      exitReasonDistribution: {},
      partialExitStats: {
        avgTP1Exits: 0,
        avgTP2Exits: 0,
        avgPartialExitsPerTrade: 0,
      },
    };
  }

  const winners = labels.filter(l => l.label === 1);
  const losers = labels.filter(l => l.label === 0);

  const exitReasonDistribution: Record<string, number> = {};
  let totalTP1 = 0;
  let totalTP2 = 0;
  let totalPartials = 0;

  for (const label of labels) {
    exitReasonDistribution[label.exitReason] = (exitReasonDistribution[label.exitReason] || 0) + 1;

    for (const partial of label.partialExits) {
      totalPartials++;
      if (partial.reason === 'TP1') totalTP1++;
      if (partial.reason === 'TP2') totalTP2++;
    }
  }

  return {
    totalTrades: labels.length,
    winCount: winners.length,
    lossCount: losers.length,
    winRate: (winners.length / labels.length) * 100,
    avgR: labels.reduce((s, l) => s + l.realizedR, 0) / labels.length,
    avgWinR: winners.length > 0 ? winners.reduce((s, l) => s + l.realizedR, 0) / winners.length : 0,
    avgLossR: losers.length > 0 ? Math.abs(losers.reduce((s, l) => s + l.realizedR, 0) / losers.length) : 0,
    avgMFE: labels.reduce((s, l) => s + l.mfeR, 0) / labels.length,
    avgMAE: labels.reduce((s, l) => s + l.maeR, 0) / labels.length,
    avgHoldingDays: labels.reduce((s, l) => s + l.holdingDays, 0) / labels.length,
    exitReasonDistribution,
    partialExitStats: {
      avgTP1Exits: totalTP1 / labels.length,
      avgTP2Exits: totalTP2 / labels.length,
      avgPartialExitsPerTrade: totalPartials / labels.length,
    },
  };
}







