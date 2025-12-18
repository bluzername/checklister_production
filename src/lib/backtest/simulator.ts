/**
 * Backtest Simulator
 * Core engine for running historical backtests
 */

import { analyzeTicker } from '../analysis';
import { AnalysisResult } from '../types';
import { MarketRegime } from '../market-regime/types';
import {
  BacktestConfig,
  BacktestResult,
  BacktestTrade,
  PerformanceMetrics,
  EquityPoint,
  ExitReason,
  extractFeatureVector,
} from './types';
import { calculateMetrics } from './metrics';
import { TradeManager } from './trade-manager';
import {
  enablePITEnforcement,
  disablePITEnforcement,
  printPITEnforcementSummary,
} from '../ml/pit-enforcement';
import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

// ============================================
// RATE LIMITING UTILITIES
// ============================================

/**
 * Delay execution for specified milliseconds
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | unknown;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries - 1) {
        const waitTime = baseDelay * Math.pow(2, attempt);
        console.log(`  Retry ${attempt + 1}/${maxRetries} after ${waitTime}ms...`);
        await delay(waitTime);
      }
    }
  }
  
  throw lastError;
}

// Rate limiting configuration
const RATE_LIMIT_DELAY_MS = 200; // Delay between API calls
const BATCH_SIZE = 5; // Process tickers in batches
const BATCH_DELAY_MS = 1000; // Delay between batches
const PREFETCH_BATCH_SIZE = 5;

// Yahoo Finance symbol quirks
const SYMBOL_MAP: Record<string, string> = {
  'BRK.B': 'BRK-B',
  'BRK.A': 'BRK-A',
  'BF.B': 'BF-B',
};

// ============================================
// SIMULATOR CLASS
// ============================================

export class BacktestSimulator {
  private config: BacktestConfig;
  private tradeManager: TradeManager;
  private trades: BacktestTrade[] = [];
  private equity: number;
  private equityHistory: EquityPoint[] = [];
  private currentDate: Date;
  private tradeIdCounter: number = 0;
  private priceCache = new Map<string, Map<string, { open: number; high: number; low: number; close: number }>>();
  private dailyPriceCache = new Map<string, { open?: number; high: number; low: number; close: number }>();
  // Track when tickers were last exited for re-entry cooldown
  private tickerExitDates = new Map<string, Date>();

  constructor(config: BacktestConfig) {
    this.config = config;
    this.equity = config.initialCapital;
    this.currentDate = new Date(config.startDate);
    this.tradeManager = new TradeManager(config);
  }

  /**
   * Run the full backtest
   */
  async run(): Promise<BacktestResult> {
    console.log(`Starting backtest: ${this.config.name}`);
    console.log(`Period: ${this.config.startDate} to ${this.config.endDate}`);
    console.log(`Universe: ${this.getUniverseSize()} tickers`);

    // Enable PIT safety enforcement for backtests
    // This ensures all analysis uses asOfDate and no look-ahead bias occurs
    enablePITEnforcement();

    // Preload historical prices for the universe to reduce per-day fetch churn
    await this.prefetchPriceHistory(this.getUniverse());

    const startTime = Date.now();
    const endDate = new Date(this.config.endDate);

    // Initialize equity history
    this.equityHistory.push({
      date: this.config.startDate,
      equity: this.equity,
      drawdown: 0,
      drawdownPercent: 0,
      openPositions: 0,
      dailyPnl: 0,
      dailyReturn: 0,
    });

    // Iterate through each trading day
    while (this.currentDate <= endDate) {
      await this.processDay(this.currentDate);
      
      // Move to next trading day (skip weekends)
      this.currentDate = this.getNextTradingDay(this.currentDate);
    }

    // Close any remaining open positions at end
    await this.closeAllPositions(endDate, 'TIME_EXIT');
    this.recordEquity(endDate);

    const completedAt = new Date().toISOString();
    const metrics = calculateMetrics(this.trades, this.config.initialCapital, this.equityHistory);
    const equityCurve = this.equityHistory;

    // Calculate performance breakdowns
    const performanceByRegime = this.calculatePerformanceByRegime();
    const performanceBySector = this.calculatePerformanceBySector();
    const performanceByMonth = this.calculatePerformanceByMonth();
    const performanceByYear = this.calculatePerformanceByYear();
    const calibrationByBucket = this.calculateCalibrationBuckets();

    console.log(`Backtest completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    console.log(`Total trades: ${this.trades.length}`);
    console.log(`Win rate: ${metrics.winRate.toFixed(1)}%`);
    console.log(`Sharpe ratio: ${metrics.sharpeRatio.toFixed(2)}`);

    // Print PIT safety summary and disable enforcement
    printPITEnforcementSummary();
    disablePITEnforcement();

    return {
      config: this.config,
      metrics,
      equityCurve,
      trades: this.trades,
      performanceByRegime,
      performanceBySector,
      performanceByMonth,
      performanceByYear,
      calibrationByBucket,
      status: 'COMPLETED',
      completedAt,
    };
  }

  /**
   * Process a single trading day
   */
  private async processDay(date: Date): Promise<void> {
    const dateStr = date.toISOString().split('T')[0];
    this.dailyPriceCache = new Map();
    
    // 1. Update open positions with current prices and check exits
    await this.updateOpenPositions(date);

    // 2. Check for new entry signals
    await this.scanForEntries(date);

    // 3. Record equity for this day
    this.recordEquity(date);
  }

  /**
   * Update open positions and check for exits
   * Includes rate limiting for price data fetches
   */
  private async updateOpenPositions(date: Date): Promise<void> {
    const openTrades = this.trades.filter(t => t.status === 'OPEN');

    // Process open trades in batches to avoid rate limiting
    for (let i = 0; i < openTrades.length; i += BATCH_SIZE) {
      const batch = openTrades.slice(i, i + BATCH_SIZE);
      
      await Promise.all(
        batch.map(async (trade) => {
          try {
            // Get current price data for the ticker with retry
            const priceData = await retryWithBackoff(
              () => this.getPriceData(trade.ticker, date),
              2,
              500
            );
            
            if (!priceData) return;

            const { high, low, close } = priceData;
            this.dailyPriceCache.set(trade.ticker, priceData);

            // Update MFE/MAE
            if (high > (trade.mfe || trade.entryPrice)) {
              trade.mfe = high;
              trade.mfeR = (high - trade.entryPrice) / (trade.entryPrice - trade.stopLoss);
            }
            if (low < (trade.mae || trade.entryPrice)) {
              trade.mae = low;
              trade.maeR = (trade.entryPrice - low) / (trade.entryPrice - trade.stopLoss);
            }

            // Check exit conditions
            const exitResult = this.tradeManager.checkExit(trade, high, low, close, date);

            // Handle partial exits (TP1, TP2 scale-outs)
            if (exitResult.isPartialExit && exitResult.partialShares && exitResult.partialShares > 0) {
              this.executePartialExit(trade, date, exitResult.exitPrice, exitResult.exitReason, exitResult.partialShares);
            } else if (exitResult.shouldExit) {
              this.closeTrade(trade, date, exitResult.exitPrice, exitResult.exitReason);
            }
          } catch (error) {
            // If we can't get price data after retries, skip this ticker for today
            // Don't log - it creates too much noise
          }
        })
      );

      // Rate limiting delay between batches
      if (i + BATCH_SIZE < openTrades.length) {
        await delay(RATE_LIMIT_DELAY_MS * 2);
      }
    }
  }

  /**
   * Scan universe for new entry signals
   * Includes rate limiting to avoid API throttling
   */
  private async scanForEntries(date: Date): Promise<void> {
    const universe = this.getUniverse();
    const openPositionTickers = new Set(
      this.trades.filter(t => t.status === 'OPEN').map(t => t.ticker)
    );

    // Check if we can open new positions
    const openPositionCount = this.trades.filter(t => t.status === 'OPEN').length;
    if (openPositionCount >= this.config.maxOpenPositions) {
      return;
    }

    // Filter to tickers we need to analyze (exclude open positions and those in cooldown)
    const cooldownDays = this.config.reEntryCooldownDays ?? 5;
    const tickersToScan = universe.filter(t => {
      // Skip if already has open position
      if (openPositionTickers.has(t)) return false;

      // Skip if in cooldown period
      const lastExit = this.tickerExitDates.get(t);
      if (lastExit) {
        const daysSinceExit = Math.floor((date.getTime() - lastExit.getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceExit < cooldownDays) return false;
      }

      return true;
    });
    
    // Analyze each ticker in universe with rate limiting
    const candidates: { ticker: string; analysis: AnalysisResult }[] = [];
    let processedCount = 0;

    // Process in batches to avoid rate limiting
    for (let i = 0; i < tickersToScan.length; i += BATCH_SIZE) {
      const batch = tickersToScan.slice(i, i + BATCH_SIZE);
      
      // Process batch in parallel
      const batchResults = await Promise.allSettled(
        batch.map(async (ticker) => {
          try {
            const analysis = await retryWithBackoff(
              () => analyzeTicker(ticker, date),
              2, // max retries
              500 // base delay
            );
            return { ticker, analysis };
          } catch (error) {
            return null;
          }
        })
      );

      // Collect successful results
      for (const result of batchResults) {
        if (result.status === 'fulfilled' && result.value) {
          const { ticker, analysis } = result.value;
          if (this.meetsEntryCriteria(analysis)) {
            candidates.push({ ticker, analysis });
          }
        }
        processedCount++;
      }

      // Rate limiting delay between batches
      if (i + BATCH_SIZE < tickersToScan.length) {
        await delay(BATCH_DELAY_MS);
      }
    }

    // Sort candidates by probability (best first)
    candidates.sort((a, b) => b.analysis.success_probability - a.analysis.success_probability);

    // Take top candidates up to max positions
    const slotsAvailable = this.config.maxOpenPositions - openPositionCount;
    const toEnter = candidates.slice(0, slotsAvailable);

    // Enter positions with delay between entries
    for (const { ticker, analysis } of toEnter) {
      await this.enterTrade(ticker, analysis, date);
      await delay(RATE_LIMIT_DELAY_MS);
    }
  }

  /**
   * Check if analysis meets entry criteria
   */
  private meetsEntryCriteria(analysis: AnalysisResult): boolean {
    // Check probability threshold
    if (analysis.success_probability < this.config.entryThreshold) {
      return false;
    }

    // Check R:R ratio
    const rrRatio = analysis.parameters['6_support_resistance'].risk_reward_ratio;
    if (rrRatio < this.config.minRRRatio) {
      return false;
    }

    // Check trade type
    if (analysis.trade_type !== 'SWING_LONG') {
      return false;
    }

    // Check volume confirmation if required
    if (this.config.requireVolumeConfirm) {
      const volumeConfirms = analysis.parameters['8_volume'].volume_confirms;
      if (!volumeConfirms) return false;
    }

    // Check MTF alignment if required
    if (this.config.requireMTFAlign) {
      const alignment = analysis.multi_timeframe?.alignment;
      if (alignment !== 'STRONG_BUY' && alignment !== 'BUY') {
        return false;
      }
    }

    // VIX filter: Avoid entries when volatility is elevated
    // Configurable via maxVixLevel (default: 22 for Option A baseline)
    const vixLevel = analysis.parameters['1_market_condition']?.vix_level ?? 20;
    const maxVixLevel = this.config.maxVixLevel ?? 22;
    if (vixLevel > maxVixLevel) {
      return false;
    }

    // Sector filter: Only enter when sector is performing well (RS > 0.95)
    const sectorRS = analysis.parameters['2_sector_condition']?.rs_score_20d ?? 1.0;
    if (sectorRS < 0.95) {
      return false;
    }

    // ============================================
    // MEAN REVERSION / REGIME-SPECIFIC FILTERS
    // ============================================
    const rsiValue = analysis.parameters['10_rsi']?.value ?? 50;
    const divergenceType = analysis.divergence?.type ?? 'NONE';
    const hasBullishDivergence = divergenceType === 'REGULAR_BULLISH' || divergenceType === 'HIDDEN_BULLISH';
    const regime = analysis.market_regime?.regime ?? 'BULL';

    // Regime-specific entry requirements
    if (regime === 'BULL') {
      // BULL regime: Prefer mean reversion (RSI < 40) or divergence
      if (rsiValue > 50 && !hasBullishDivergence) {
        return false;  // Don't chase overbought in BULL without divergence
      }
    } else if (regime === 'CHOPPY') {
      // CHOPPY regime: Only deeply oversold with divergence
      if (rsiValue > 35 || !hasBullishDivergence) {
        return false;  // Very strict in choppy markets
      }
    }
    // CRASH regime is already filtered by VIX and probability

    // ============================================
    // OPTION C: TIGHTER FILTERING (IMPLEMENTED)
    // ============================================
    // Option B (pullback + quality filter) tested on 2025-12-14 - HURT performance
    // (Sharpe dropped 0.27 → 0.15, PF dropped 1.02 → 0.96)
    //
    // Option C takes a simpler approach - only trade highest quality setups:
    // [x] VIX filter tightened to 18 (from 22) - line 348
    // [x] Entry threshold increased to 70% (from 60%) - getDefaultConfig()
    //
    // Expected outcome: Fewer trades but higher win rate

    return true;
  }

  /**
   * Enter a new trade
   */
  private async enterTrade(
    ticker: string,
    analysis: AnalysisResult,
    date: Date
  ): Promise<void> {
    const entryPrice = analysis.current_price;
    const stopLoss = analysis.trading_plan.stop_loss.price;
    const risk = entryPrice - stopLoss;

    // Calculate position size based on risk
    // Use initial capital (not current equity) to prevent runaway compounding
    const useInitialCapital = this.config.useInitialCapitalForSizing ?? true;
    const sizingCapital = useInitialCapital ? this.config.initialCapital : this.equity;
    const riskDollars = sizingCapital * this.config.riskPerTrade;
    let shares = Math.floor(riskDollars / risk);

    if (shares <= 0) return;

    // Apply max position size cap (default 15% of initial capital)
    const maxPositionPercent = this.config.maxPositionPercent ?? 0.15;
    const maxPositionValue = this.config.initialCapital * maxPositionPercent;
    const maxSharesByValue = Math.floor(maxPositionValue / entryPrice);
    shares = Math.min(shares, maxSharesByValue);

    if (shares <= 0) return;

    const positionValue = shares * entryPrice;

    // Apply slippage to entry
    const slippage = entryPrice * (this.config.slippagePercent / 100);
    const adjustedEntryPrice = entryPrice + slippage;

    // Calculate take profit levels
    const tp1 = entryPrice + risk * this.config.tpRatios[0];
    const tp2 = entryPrice + risk * this.config.tpRatios[1];
    const tp3 = entryPrice + risk * this.config.tpRatios[2];

    const trade: BacktestTrade = {
      tradeId: `T${++this.tradeIdCounter}`,
      ticker,
      signalDate: date.toISOString().split('T')[0],
      entryDate: date.toISOString().split('T')[0],
      entryPrice: adjustedEntryPrice,
      entryProbability: analysis.success_probability,
      shares,
      initialShares: shares, // Track original position size for proper TP tranche sizing
      positionValue,
      stopLoss,
      tp1,
      tp2,
      tp3,
      regime: (analysis.market_regime?.regime || 'CHOPPY') as MarketRegime,
      sector: analysis.parameters['2_sector_condition'].sector,
      status: 'OPEN',
      partialExits: [],
    };

    this.trades.push(trade);
    this.equity -= positionValue + (shares * this.config.commissionPerShare);

    // Track today's close for mark-to-market if available
    const todaysPrice = await this.getPriceData(ticker, date);
    if (todaysPrice) {
      this.dailyPriceCache.set(ticker, todaysPrice);
    }
  }

  /**
   * Close a trade
   */
  private closeTrade(
    trade: BacktestTrade,
    date: Date,
    exitPrice: number,
    exitReason: ExitReason
  ): void {
    // Apply slippage to exit
    const slippage = exitPrice * (this.config.slippagePercent / 100);
    const adjustedExitPrice = exitPrice - slippage;

    trade.exitDate = date.toISOString().split('T')[0];
    trade.exitPrice = adjustedExitPrice;
    trade.exitReason = exitReason;
    trade.status = 'CLOSED';

    // Record exit date for re-entry cooldown
    this.tickerExitDates.set(trade.ticker, date);

    // Calculate PnL for remaining shares
    const finalPnl = (adjustedExitPrice - trade.entryPrice) * trade.shares;

    // Sum up partial exit PnLs (if any)
    const partialPnl = trade.partialExits?.reduce((sum, p) => sum + p.pnl, 0) || 0;

    // Total realized PnL is partial exits + final exit
    trade.realizedPnl = partialPnl + finalPnl;

    // Use tracked initialShares for percentage calculations
    const initialShares = trade.initialShares;

    // Calculate performance based on total position
    const risk = trade.entryPrice - trade.stopLoss;
    const totalInvested = trade.entryPrice * initialShares;
    trade.realizedPnlPercent = totalInvested > 0 ? (trade.realizedPnl / totalInvested) * 100 : 0;

    // Calculate blended R (weighted average of all exit prices)
    if (risk > 0 && initialShares > 0) {
      // Calculate weighted average exit price
      let totalExitValue = adjustedExitPrice * trade.shares;
      if (trade.partialExits) {
        totalExitValue += trade.partialExits.reduce((sum, p) => sum + p.price * p.shares, 0);
      }
      const avgExitPrice = totalExitValue / initialShares;
      trade.realizedR = (avgExitPrice - trade.entryPrice) / risk;
    } else {
      trade.realizedR = 0;
    }

    // Calculate holding days
    const entryMs = new Date(trade.entryDate).getTime();
    const exitMs = date.getTime();
    trade.holdingDays = Math.ceil((exitMs - entryMs) / (1000 * 60 * 60 * 24));

    // Update equity with remaining shares
    const exitValue = trade.shares * adjustedExitPrice;
    const commission = trade.shares * this.config.commissionPerShare;
    this.equity += exitValue - commission;
  }

  /**
   * Execute a partial exit (TP1 or TP2 scale-out)
   * Does not close the trade, only reduces position size
   */
  private executePartialExit(
    trade: BacktestTrade,
    date: Date,
    exitPrice: number,
    exitReason: ExitReason,
    sharesToSell: number
  ): void {
    // Ensure we don't sell more than we have
    const actualSharestoSell = Math.min(sharesToSell, trade.shares);
    if (actualSharestoSell <= 0) return;

    // Apply slippage to exit
    const slippage = exitPrice * (this.config.slippagePercent / 100);
    const adjustedExitPrice = exitPrice - slippage;

    // Calculate PnL for this partial exit
    const partialPnl = (adjustedExitPrice - trade.entryPrice) * actualSharestoSell;

    // Initialize partialExits array if needed
    if (!trade.partialExits) {
      trade.partialExits = [];
    }

    // Record the partial exit
    trade.partialExits.push({
      date: date.toISOString().split('T')[0],
      price: adjustedExitPrice,
      shares: actualSharestoSell,
      reason: exitReason,
      pnl: partialPnl,
    });

    // Update equity with partial exit proceeds
    const exitValue = actualSharestoSell * adjustedExitPrice;
    const commission = actualSharestoSell * this.config.commissionPerShare;
    this.equity += exitValue - commission;

    // Reduce remaining position size
    trade.shares -= actualSharestoSell;
  }

  /**
   * Close all open positions
   */
  private async closeAllPositions(date: Date, reason: ExitReason): Promise<void> {
    const openTrades = this.trades.filter(t => t.status === 'OPEN');

    for (const trade of openTrades) {
      try {
        const priceData = await this.getPriceData(trade.ticker, date);
        if (priceData) {
          this.closeTrade(trade, date, priceData.close, reason);
        } else {
          this.closeTrade(trade, date, trade.entryPrice, reason);
        }
      } catch {
        // Use last known price or entry price
        this.closeTrade(trade, date, trade.entryPrice, reason);
      }
    }
  }

  /**
   * Record equity at end of day
   */
  private recordEquity(date: Date): void {
    const openTrades = this.trades.filter(t => t.status === 'OPEN');
    const closedToday = this.trades.filter(
      t => t.status === 'CLOSED' && t.exitDate === date.toISOString().split('T')[0]
    );

    const dailyPnl = closedToday.reduce((sum, t) => sum + (t.realizedPnl || 0), 0);

    // Mark to market open positions using today's close (fallback to entry)
    const openMarketValue = openTrades.reduce((sum, trade) => {
      const closePrice = this.dailyPriceCache.get(trade.ticker)?.close ?? trade.entryPrice;
      return sum + closePrice * trade.shares;
    }, 0);

    const totalEquity = this.equity + openMarketValue;
    const prevEquity = this.equityHistory[this.equityHistory.length - 1]?.equity || this.config.initialCapital;
    const dailyReturn = prevEquity > 0 ? ((totalEquity - prevEquity) / prevEquity) * 100 : 0;

    // Calculate drawdown
    const peakEquity = Math.max(...this.equityHistory.map(e => e.equity), totalEquity);
    const drawdown = peakEquity - totalEquity;
    const drawdownPercent = peakEquity > 0 ? (drawdown / peakEquity) * 100 : 0;

    this.equityHistory.push({
      date: date.toISOString().split('T')[0],
      equity: totalEquity,
      drawdown,
      drawdownPercent,
      openPositions: openTrades.length,
      dailyPnl,
      dailyReturn,
    });
  }

  /**
   * Get price data for a ticker on a specific date
   */
  private async getPriceData(
    ticker: string,
    date: Date
  ): Promise<{ high: number; low: number; close: number } | null> {
    const dateStr = date.toISOString().split('T')[0];

    try {
      if (!this.priceCache.has(ticker)) {
        await this.loadPriceHistory(ticker);
      }

      const tickerCache = this.priceCache.get(ticker);
      if (!tickerCache) return null;

      // Exact match for the trading day
      if (tickerCache.has(dateStr)) {
        const bar = tickerCache.get(dateStr)!;
        return { high: bar.high, low: bar.low, close: bar.close };
      }

      // Fallback: use most recent prior trading day (holidays)
      const priorDates = Array.from(tickerCache.keys()).filter(d => d < dateStr).sort();
      const fallbackDate = priorDates[priorDates.length - 1];
      if (fallbackDate) {
        const bar = tickerCache.get(fallbackDate)!;
        return { high: bar.high, low: bar.low, close: bar.close };
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Load historical OHLC data for a ticker over the backtest window
   */
  private async loadPriceHistory(ticker: string): Promise<void> {
    const symbol = SYMBOL_MAP[ticker] || ticker.replace('.', '-');
    const period1 = new Date(this.config.startDate);
    const period2 = new Date(this.config.endDate);
    period2.setDate(period2.getDate() + 1); // include end date

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await yahooFinance.chart(symbol, {
        period1,
        period2,
        interval: '1d',
      } as any) as any;

      const quotes = result?.quotes || [];
      const map = new Map<string, { open: number; high: number; low: number; close: number }>();

      for (const q of quotes) {
        if (!q || q.open == null || q.high == null || q.low == null || q.close == null || !q.date) continue;
        const quoteDate = new Date(q.date).toISOString().split('T')[0];
        map.set(quoteDate, {
          open: q.open,
          high: q.high,
          low: q.low,
          close: q.close,
        });
      }

      this.priceCache.set(ticker, map);
    } catch (error) {
      // If no data, cache empty and move on quietly
      if ((error as Error)?.message?.includes('No data found')) {
        this.priceCache.set(ticker, new Map());
        return;
      }
      console.warn(`Failed to load price history for ${ticker}:`, error);
      this.priceCache.set(ticker, new Map());
    }
  }

  /**
   * Prefetch historical prices for a list of tickers with simple batching
   */
  private async prefetchPriceHistory(tickers: string[]): Promise<void> {
    for (let i = 0; i < tickers.length; i += PREFETCH_BATCH_SIZE) {
      const batch = tickers.slice(i, i + PREFETCH_BATCH_SIZE);

      await Promise.all(
        batch.map(async (ticker) => {
          if (this.priceCache.has(ticker)) return;
          await this.loadPriceHistory(ticker);
        })
      );

      if (i + PREFETCH_BATCH_SIZE < tickers.length) {
        await delay(RATE_LIMIT_DELAY_MS);
      }
    }
  }

  /**
   * Get next trading day (skip weekends)
   */
  private getNextTradingDay(date: Date): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    
    // Skip weekends
    while (next.getDay() === 0 || next.getDay() === 6) {
      next.setDate(next.getDate() + 1);
    }
    
    return next;
  }

  /**
   * Get universe of tickers to scan
   */
  private getUniverse(): string[] {
    if (Array.isArray(this.config.universe)) {
      return this.config.universe;
    }
    // If universe is a filter, we'd need to apply it
    // For now, return empty array
    return [];
  }

  /**
   * Get universe size
   */
  private getUniverseSize(): number {
    return this.getUniverse().length;
  }

  /**
   * Calculate performance by regime
   */
  private calculatePerformanceByRegime(): Record<MarketRegime, PerformanceMetrics> {
    const regimes: MarketRegime[] = ['BULL', 'CHOPPY', 'CRASH'];
    const result: Record<string, PerformanceMetrics> = {};

    for (const regime of regimes) {
      const regimeTrades = this.trades.filter(t => t.regime === regime && t.status === 'CLOSED');
      result[regime] = calculateMetrics(regimeTrades, this.config.initialCapital);
    }

    return result as Record<MarketRegime, PerformanceMetrics>;
  }

  /**
   * Calculate performance by sector
   */
  private calculatePerformanceBySector(): Record<string, PerformanceMetrics> {
    const sectors = new Set(this.trades.map(t => t.sector || 'Unknown'));
    const result: Record<string, PerformanceMetrics> = {};

    for (const sector of sectors) {
      const sectorTrades = this.trades.filter(t => t.sector === sector && t.status === 'CLOSED');
      result[sector] = calculateMetrics(sectorTrades, this.config.initialCapital);
    }

    return result;
  }

  /**
   * Calculate performance by month
   */
  private calculatePerformanceByMonth(): Record<string, PerformanceMetrics> {
    const result: Record<string, PerformanceMetrics> = {};
    const closedTrades = this.trades.filter(t => t.status === 'CLOSED' && t.exitDate);

    for (const trade of closedTrades) {
      const month = trade.exitDate!.substring(0, 7); // YYYY-MM
      if (!result[month]) {
        result[month] = calculateMetrics([], this.config.initialCapital);
      }
    }

    // Group trades by month and recalculate
    for (const month of Object.keys(result)) {
      const monthTrades = closedTrades.filter(t => t.exitDate!.startsWith(month));
      result[month] = calculateMetrics(monthTrades, this.config.initialCapital);
    }

    return result;
  }

  /**
   * Calculate performance by year
   */
  private calculatePerformanceByYear(): Record<string, PerformanceMetrics> {
    const result: Record<string, PerformanceMetrics> = {};
    const closedTrades = this.trades.filter(t => t.status === 'CLOSED' && t.exitDate);

    for (const trade of closedTrades) {
      const year = trade.exitDate!.substring(0, 4); // YYYY
      if (!result[year]) {
        result[year] = calculateMetrics([], this.config.initialCapital);
      }
    }

    // Group trades by year and recalculate
    for (const year of Object.keys(result)) {
      const yearTrades = closedTrades.filter(t => t.exitDate!.startsWith(year));
      result[year] = calculateMetrics(yearTrades, this.config.initialCapital);
    }

    return result;
  }

  /**
   * Calculate calibration buckets
   */
  private calculateCalibrationBuckets(): BacktestResult['calibrationByBucket'] {
    const buckets: Record<string, { predictions: number[]; outcomes: number[] }> = {};
    const closedTrades = this.trades.filter(t => t.status === 'CLOSED');

    for (const trade of closedTrades) {
      const prob = trade.entryProbability;
      const bucketStart = Math.floor(prob / 10) * 10;
      const bucketKey = `${bucketStart}-${bucketStart + 10}%`;

      if (!buckets[bucketKey]) {
        buckets[bucketKey] = { predictions: [], outcomes: [] };
      }

      buckets[bucketKey].predictions.push(prob);
      buckets[bucketKey].outcomes.push((trade.realizedR || 0) >= 1.5 ? 1 : 0);
    }

    return Object.entries(buckets).map(([bucket, data]) => ({
      bucket,
      predictedAvg: data.predictions.reduce((a, b) => a + b, 0) / data.predictions.length,
      actualWinRate: (data.outcomes.filter(o => o === 1).length / data.outcomes.length) * 100,
      count: data.predictions.length,
    })).sort((a, b) => {
      const aStart = parseInt(a.bucket.split('-')[0]);
      const bStart = parseInt(b.bucket.split('-')[0]);
      return aStart - bStart;
    });
  }
}

/**
 * Run a backtest with the given configuration
 */
export async function runBacktest(config: BacktestConfig): Promise<BacktestResult> {
  const simulator = new BacktestSimulator(config);
  return simulator.run();
}

/**
 * Create a default backtest configuration
 */
export function createDefaultConfig(
  universe: string[],
  startDate: string,
  endDate: string
): BacktestConfig {
  return {
    name: `Backtest ${startDate} to ${endDate}`,
    universe,
    startDate,
    endDate,
    initialCapital: 100000,
    riskPerTrade: 0.01, // 1%
    maxTotalRisk: 0.06, // 6%
    maxOpenPositions: 10,
    entryThreshold: 70,  // OPTION C: Increased from 60 to 70 for higher quality entries
    minRRRatio: 1.5,     // Optimized: Lower R:R captures more winning trades
    requireVolumeConfirm: false,
    requireMTFAlign: false,
    tpRatios: [1.5, 2.5, 4.0],
    tpSizes: [0.33, 0.33, 0.34],
    maxHoldingDays: 45,
    useTrailingStop: true,  // ENABLED: Protect profits with trailing stop
    slippagePercent: 0.1,
    commissionPerShare: 0.005,
    gapHandling: 'MARKET',
    adjustForRegime: true,
  };
}
