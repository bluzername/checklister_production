/**
 * Metrics Calculator
 * Calculates performance metrics for backtests
 */

import { BacktestTrade, PerformanceMetrics, EquityPoint } from './types';

/**
 * Calculate comprehensive performance metrics from trades
 */
export function calculateMetrics(
  trades: BacktestTrade[],
  initialCapital: number,
  equityHistory?: EquityPoint[]
): PerformanceMetrics {
  const closedTrades = trades.filter(t => t.status === 'CLOSED');
  
  if (closedTrades.length === 0) {
    return getEmptyMetrics();
  }

  // Basic counts
  const winners = closedTrades.filter(t => (t.realizedPnl || 0) > 0);
  const losers = closedTrades.filter(t => (t.realizedPnl || 0) <= 0);
  const winRate = (winners.length / closedTrades.length) * 100;

  // PnL calculations
  const totalPnlFromTrades = closedTrades.reduce((sum, t) => sum + (t.realizedPnl || 0), 0);
  const totalPnl = equityHistory && equityHistory.length > 0
    ? equityHistory[equityHistory.length - 1].equity - initialCapital
    : totalPnlFromTrades;
  const totalPnlPercent = (totalPnl / initialCapital) * 100;
  const avgPnlPerTrade = closedTrades.length > 0 ? totalPnl / closedTrades.length : 0;

  const avgWin = winners.length > 0
    ? winners.reduce((sum, t) => sum + (t.realizedPnl || 0), 0) / winners.length
    : 0;
  const avgLoss = losers.length > 0
    ? Math.abs(losers.reduce((sum, t) => sum + (t.realizedPnl || 0), 0) / losers.length)
    : 0;

  // R calculations
  const avgR = closedTrades.reduce((sum, t) => sum + (t.realizedR || 0), 0) / closedTrades.length;
  const avgWinR = winners.length > 0
    ? winners.reduce((sum, t) => sum + (t.realizedR || 0), 0) / winners.length
    : 0;
  const avgLossR = losers.length > 0
    ? Math.abs(losers.reduce((sum, t) => sum + (t.realizedR || 0), 0) / losers.length)
    : 0;

  // Expectancy: (Win% × AvgWin) - (Loss% × AvgLoss)
  const winPct = winners.length / closedTrades.length;
  const lossPct = losers.length / closedTrades.length;
  const expectancy = (winPct * avgWin) - (lossPct * avgLoss);

  // Profit factor: Gross Profit / Gross Loss
  const grossProfit = winners.reduce((sum, t) => sum + (t.realizedPnl || 0), 0);
  const grossLoss = Math.abs(losers.reduce((sum, t) => sum + (t.realizedPnl || 0), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Drawdown calculations
  const { maxDrawdown, maxDrawdownPercent, maxDrawdownDuration } = calculateDrawdown(closedTrades, initialCapital, equityHistory);

  // Risk-adjusted returns
  const dailyReturns = calculateDailyReturns(closedTrades, initialCapital, equityHistory);
  const sharpeRatio = calculateSharpeRatio(dailyReturns);
  const sortinoRatio = calculateSortinoRatio(dailyReturns);
  
  // Calmar ratio: Annualized return / Max drawdown
  const annualizedReturn = calculateAnnualizedReturn(totalPnlPercent, closedTrades, equityHistory);
  const calmarRatio = maxDrawdownPercent > 0 ? annualizedReturn / maxDrawdownPercent : 0;

  // Holding time
  const avgHoldingDays = closedTrades.reduce((sum, t) => sum + (t.holdingDays || 0), 0) / closedTrades.length;

  // R distribution
  const rDistribution = calculateRDistribution(closedTrades);

  return {
    totalTrades: closedTrades.length,
    winners: winners.length,
    losers: losers.length,
    winRate,
    totalPnl,
    totalPnlPercent,
    avgPnlPerTrade,
    avgWin,
    avgLoss,
    avgR,
    avgWinR,
    avgLossR,
    expectancy,
    profitFactor,
    maxDrawdown,
    maxDrawdownPercent,
    maxDrawdownDuration,
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    avgHoldingDays,
    rDistribution,
  };
}

/**
 * Return empty metrics object
 */
function getEmptyMetrics(): PerformanceMetrics {
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

/**
 * Calculate maximum drawdown
 */
function calculateDrawdown(
  trades: BacktestTrade[],
  initialCapital: number,
  equityHistory?: EquityPoint[]
): { maxDrawdown: number; maxDrawdownPercent: number; maxDrawdownDuration: number } {
  if (equityHistory && equityHistory.length > 1) {
    const sorted = [...equityHistory].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    let peakEquity = initialCapital;
    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;
    let maxDrawdownDuration = 0;
    let drawdownStart: Date | null = null;

    for (const point of sorted) {
      const equity = point.equity;
      if (equity > peakEquity) {
        peakEquity = equity;
        if (drawdownStart) {
          const duration = Math.ceil((new Date(point.date).getTime() - drawdownStart.getTime()) / (1000 * 60 * 60 * 24));
          maxDrawdownDuration = Math.max(maxDrawdownDuration, duration);
          drawdownStart = null;
        }
      } else {
        if (!drawdownStart) {
          drawdownStart = new Date(point.date);
        }
        const currentDrawdown = peakEquity - equity;
        const currentDrawdownPct = (currentDrawdown / peakEquity) * 100;
        if (currentDrawdown > maxDrawdown) {
          maxDrawdown = currentDrawdown;
          maxDrawdownPercent = currentDrawdownPct;
        }
      }
    }

    return { maxDrawdown, maxDrawdownPercent, maxDrawdownDuration };
  }

  if (trades.length === 0) {
    return { maxDrawdown: 0, maxDrawdownPercent: 0, maxDrawdownDuration: 0 };
  }

  // Sort trades by exit date
  const sortedTrades = [...trades]
    .filter(t => t.exitDate)
    .sort((a, b) => new Date(a.exitDate!).getTime() - new Date(b.exitDate!).getTime());

  let equity = initialCapital;
  let peakEquity = initialCapital;
  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;
  
  let drawdownStartDate: Date | null = null;
  let maxDrawdownDuration = 0;
  let currentDrawdownDuration = 0;

  for (const trade of sortedTrades) {
    equity += trade.realizedPnl || 0;

    if (equity > peakEquity) {
      peakEquity = equity;
      if (drawdownStartDate) {
        const exitDate = new Date(trade.exitDate!);
        currentDrawdownDuration = Math.ceil(
          (exitDate.getTime() - drawdownStartDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        maxDrawdownDuration = Math.max(maxDrawdownDuration, currentDrawdownDuration);
        drawdownStartDate = null;
      }
    } else {
      if (!drawdownStartDate) {
        drawdownStartDate = new Date(trade.exitDate!);
      }
      const currentDrawdown = peakEquity - equity;
      const currentDrawdownPct = (currentDrawdown / peakEquity) * 100;
      
      if (currentDrawdown > maxDrawdown) {
        maxDrawdown = currentDrawdown;
        maxDrawdownPercent = currentDrawdownPct;
      }
    }
  }

  return { maxDrawdown, maxDrawdownPercent, maxDrawdownDuration };
}

/**
 * Calculate daily returns from trades or mark-to-market equity
 */
function calculateDailyReturns(
  trades: BacktestTrade[],
  initialCapital: number,
  equityHistory?: EquityPoint[]
): number[] {
  if (equityHistory && equityHistory.length > 1) {
    const sorted = [...equityHistory].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const returns: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1].equity;
      const curr = sorted[i].equity;
      if (prev === 0) continue;
      returns.push(((curr - prev) / prev) * 100);
    }
    return returns;
  }

  if (trades.length === 0) return [];

  // Group trades by exit date
  const tradesByDate = new Map<string, BacktestTrade[]>();
  
  for (const trade of trades) {
    if (trade.exitDate) {
      const existing = tradesByDate.get(trade.exitDate) || [];
      existing.push(trade);
      tradesByDate.set(trade.exitDate, existing);
    }
  }

  // Calculate daily returns
  const dailyReturns: number[] = [];
  let equity = initialCapital;

  const sortedDates = Array.from(tradesByDate.keys()).sort();
  
  for (const date of sortedDates) {
    const dayTrades = tradesByDate.get(date) || [];
    const dayPnl = dayTrades.reduce((sum, t) => sum + (t.realizedPnl || 0), 0);
    const dayReturn = (dayPnl / equity) * 100;
    dailyReturns.push(dayReturn);
    equity += dayPnl;
  }

  return dailyReturns;
}

/**
 * Calculate Sharpe Ratio
 * Sharpe = (Mean Return - Risk Free Rate) / Std Dev of Returns
 * Assuming risk-free rate = 0 for simplicity
 */
function calculateSharpeRatio(dailyReturns: number[]): number {
  if (dailyReturns.length < 2) return 0;

  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / dailyReturns.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;

  // Annualize: multiply by sqrt(252) for daily data
  const annualizedSharpe = (mean / stdDev) * Math.sqrt(252);
  return annualizedSharpe;
}

/**
 * Calculate Sortino Ratio
 * Sortino = (Mean Return - Risk Free Rate) / Downside Deviation
 * Only considers negative returns for volatility
 */
function calculateSortinoRatio(dailyReturns: number[]): number {
  if (dailyReturns.length < 2) return 0;

  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  
  // Calculate downside deviation (only negative returns)
  const negativeReturns = dailyReturns.filter(r => r < 0);
  if (negativeReturns.length === 0) return Infinity;

  const downsideVariance = negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length;
  const downsideDeviation = Math.sqrt(downsideVariance);

  if (downsideDeviation === 0) return 0;

  // Annualize
  const annualizedSortino = (mean / downsideDeviation) * Math.sqrt(252);
  return annualizedSortino;
}

/**
 * Calculate annualized return
 */
function calculateAnnualizedReturn(
  totalReturnPct: number,
  trades: BacktestTrade[],
  equityHistory?: EquityPoint[]
): number {
  const dateRange: number[] = [];

  if (equityHistory && equityHistory.length > 1) {
    const sorted = [...equityHistory].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    dateRange.push(new Date(sorted[0].date).getTime());
    dateRange.push(new Date(sorted[sorted.length - 1].date).getTime());
  } else {
    const dates = trades
      .filter(t => t.entryDate && t.exitDate)
      .flatMap(t => [new Date(t.entryDate), new Date(t.exitDate!)]);
    dates.forEach(d => dateRange.push(d.getTime()));
  }

  if (dateRange.length < 2) return totalReturnPct;

  const minDate = Math.min(...dateRange);
  const maxDate = Math.max(...dateRange);
  const tradingDays = (maxDate - minDate) / (1000 * 60 * 60 * 24);
  const years = tradingDays / 365;

  if (years <= 0) return totalReturnPct;

  // CAGR = ((1 + total_return)^(1/years)) - 1
  const totalReturn = totalReturnPct / 100;
  const cagr = Math.pow(1 + totalReturn, 1 / years) - 1;
  return cagr * 100;
}

/**
 * Calculate R distribution buckets
 */
function calculateRDistribution(trades: BacktestTrade[]): PerformanceMetrics['rDistribution'] {
  const buckets = [
    { label: '< -2R', min: -Infinity, max: -2 },
    { label: '-2R to -1R', min: -2, max: -1 },
    { label: '-1R to 0R', min: -1, max: 0 },
    { label: '0R to 1R', min: 0, max: 1 },
    { label: '1R to 2R', min: 1, max: 2 },
    { label: '2R to 3R', min: 2, max: 3 },
    { label: '3R to 4R', min: 3, max: 4 },
    { label: '> 4R', min: 4, max: Infinity },
  ];

  const distribution = buckets.map(bucket => {
    const count = trades.filter(t => {
      const r = t.realizedR || 0;
      return r >= bucket.min && r < bucket.max;
    }).length;

    return {
      bucket: bucket.label,
      count,
      percent: trades.length > 0 ? (count / trades.length) * 100 : 0,
    };
  });

  return distribution;
}

/**
 * Calculate equity curve from trades
 */
export function calculateEquityCurve(
  trades: BacktestTrade[],
  initialCapital: number
): EquityPoint[] {
  if (trades.length === 0) {
    return [{
      date: new Date().toISOString().split('T')[0],
      equity: initialCapital,
      drawdown: 0,
      drawdownPercent: 0,
      openPositions: 0,
      dailyPnl: 0,
      dailyReturn: 0,
    }];
  }

  // Get all unique dates
  const allDates = new Set<string>();
  trades.forEach(t => {
    if (t.entryDate) allDates.add(t.entryDate);
    if (t.exitDate) allDates.add(t.exitDate);
  });

  const sortedDates = Array.from(allDates).sort();
  const equityCurve: EquityPoint[] = [];
  
  let equity = initialCapital;
  let peakEquity = initialCapital;

  for (const date of sortedDates) {
    // Calculate trades that closed on this date
    const closedToday = trades.filter(t => t.exitDate === date && t.status === 'CLOSED');
    const openOnDate = trades.filter(t => {
      const entry = t.entryDate;
      const exit = t.exitDate;
      return entry <= date && (!exit || exit >= date);
    });

    const dailyPnl = closedToday.reduce((sum, t) => sum + (t.realizedPnl || 0), 0);
    const prevEquity = equity;
    equity += dailyPnl;

    if (equity > peakEquity) {
      peakEquity = equity;
    }

    const drawdown = peakEquity - equity;
    const drawdownPercent = peakEquity > 0 ? (drawdown / peakEquity) * 100 : 0;
    const dailyReturn = prevEquity > 0 ? (dailyPnl / prevEquity) * 100 : 0;

    equityCurve.push({
      date,
      equity,
      drawdown,
      drawdownPercent,
      openPositions: openOnDate.filter(t => t.status === 'OPEN' || !t.exitDate || t.exitDate > date).length,
      dailyPnl,
      dailyReturn,
    });
  }

  return equityCurve;
}

/**
 * Calculate monthly returns
 */
export function calculateMonthlyReturns(
  trades: BacktestTrade[],
  initialCapital: number
): { month: string; return: number; trades: number }[] {
  const closedTrades = trades.filter(t => t.status === 'CLOSED' && t.exitDate);
  
  // Group by month
  const byMonth = new Map<string, BacktestTrade[]>();
  
  for (const trade of closedTrades) {
    const month = trade.exitDate!.substring(0, 7); // YYYY-MM
    const existing = byMonth.get(month) || [];
    existing.push(trade);
    byMonth.set(month, existing);
  }

  // Calculate returns
  const monthlyReturns: { month: string; return: number; trades: number }[] = [];
  let runningCapital = initialCapital;

  const sortedMonths = Array.from(byMonth.keys()).sort();
  
  for (const month of sortedMonths) {
    const monthTrades = byMonth.get(month) || [];
    const monthPnl = monthTrades.reduce((sum, t) => sum + (t.realizedPnl || 0), 0);
    const monthReturn = (monthPnl / runningCapital) * 100;
    
    monthlyReturns.push({
      month,
      return: monthReturn,
      trades: monthTrades.length,
    });
    
    runningCapital += monthPnl;
  }

  return monthlyReturns;
}

/**
 * Calculate win streak statistics
 */
export function calculateStreaks(trades: BacktestTrade[]): {
  maxWinStreak: number;
  maxLossStreak: number;
  currentStreak: number;
  currentStreakType: 'WIN' | 'LOSS' | 'NONE';
} {
  const closedTrades = trades
    .filter(t => t.status === 'CLOSED' && t.exitDate)
    .sort((a, b) => new Date(a.exitDate!).getTime() - new Date(b.exitDate!).getTime());

  if (closedTrades.length === 0) {
    return { maxWinStreak: 0, maxLossStreak: 0, currentStreak: 0, currentStreakType: 'NONE' };
  }

  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let currentStreak = 0;
  let lastWasWin: boolean | null = null;

  for (const trade of closedTrades) {
    const isWin = (trade.realizedPnl || 0) > 0;

    if (lastWasWin === null) {
      currentStreak = 1;
      lastWasWin = isWin;
    } else if (isWin === lastWasWin) {
      currentStreak++;
    } else {
      // Streak broken
      if (lastWasWin) {
        maxWinStreak = Math.max(maxWinStreak, currentStreak);
      } else {
        maxLossStreak = Math.max(maxLossStreak, currentStreak);
      }
      currentStreak = 1;
      lastWasWin = isWin;
    }
  }

  // Final streak
  if (lastWasWin !== null) {
    if (lastWasWin) {
      maxWinStreak = Math.max(maxWinStreak, currentStreak);
    } else {
      maxLossStreak = Math.max(maxLossStreak, currentStreak);
    }
  }

  return {
    maxWinStreak,
    maxLossStreak,
    currentStreak,
    currentStreakType: lastWasWin === null ? 'NONE' : lastWasWin ? 'WIN' : 'LOSS',
  };
}



