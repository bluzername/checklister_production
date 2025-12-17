/**
 * Exit Level Calculator
 *
 * Calculates stop loss and take profit levels based on ATR and R-multiples.
 * Also provides position sizing recommendations based on account risk.
 */

// ============================================
// TYPES
// ============================================

export interface TradePlan {
  ticker: string;
  entry: number;
  stopLoss: number;
  stopDistance: number;
  stopPercent: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tp1Percent: number;
  tp2Percent: number;
  tp3Percent: number;
  riskPerShare: number;
  atr: number;
  atrPercent: number;
}

export interface PositionSize {
  shares: number;
  positionValue: number;
  maxLoss: number;
  riskPercent: number;
  tp1Profit: number;
  tp2Profit: number;
  tp3Profit: number;
  tp1RMultiple: number;
  tp2RMultiple: number;
  tp3RMultiple: number;
}

export interface ExitConfig {
  stopAtrMultiple: number;    // Default: 1.5 ATR for stop
  tp1RMultiple: number;       // Default: 2R for TP1
  tp2RMultiple: number;       // Default: 3R for TP2
  tp3RMultiple: number;       // Default: 4R for TP3
  minStopPercent: number;     // Minimum stop distance (default: 2%)
  maxStopPercent: number;     // Maximum stop distance (default: 10%)
}

// ============================================
// DEFAULT CONFIG
// ============================================

export const DEFAULT_EXIT_CONFIG: ExitConfig = {
  stopAtrMultiple: 1.5,
  tp1RMultiple: 2.0,
  tp2RMultiple: 3.0,
  tp3RMultiple: 4.0,
  minStopPercent: 0.02,     // 2%
  maxStopPercent: 0.10,     // 10%
};

// ============================================
// ATR CALCULATION
// ============================================

export interface OHLCBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export function calculateATR(data: OHLCBar[], period: number = 14): number {
  if (data.length < period + 1) {
    // Fallback: use average range if not enough data
    const avgRange = data.reduce((sum, bar) => sum + (bar.high - bar.low), 0) / data.length;
    return avgRange;
  }

  // Calculate True Ranges
  const trueRanges: number[] = [];
  for (let i = 1; i < data.length; i++) {
    const high = data[i].high;
    const low = data[i].low;
    const prevClose = data[i - 1].close;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }

  // Calculate ATR using simple moving average of last N periods
  const recentTRs = trueRanges.slice(-period);
  return recentTRs.reduce((sum, tr) => sum + tr, 0) / recentTRs.length;
}

export function calculateATRPercent(data: OHLCBar[], period: number = 14): number {
  const atr = calculateATR(data, period);
  const currentPrice = data[data.length - 1].close;
  return (atr / currentPrice) * 100;
}

// ============================================
// EXIT LEVEL CALCULATION
// ============================================

export function calculateExitLevels(
  ticker: string,
  entryPrice: number,
  atr: number,
  config: Partial<ExitConfig> = {}
): TradePlan {
  const fullConfig = { ...DEFAULT_EXIT_CONFIG, ...config };

  // Calculate stop distance from ATR
  let stopDistance = atr * fullConfig.stopAtrMultiple;
  const atrPercent = (atr / entryPrice) * 100;

  // Clamp stop distance to min/max percent
  const minStop = entryPrice * fullConfig.minStopPercent;
  const maxStop = entryPrice * fullConfig.maxStopPercent;
  stopDistance = Math.max(minStop, Math.min(maxStop, stopDistance));

  const stopLoss = entryPrice - stopDistance;
  const stopPercent = (stopDistance / entryPrice) * 100;

  // Calculate take profits based on R-multiples
  const riskPerShare = stopDistance;
  const tp1 = entryPrice + (riskPerShare * fullConfig.tp1RMultiple);
  const tp2 = entryPrice + (riskPerShare * fullConfig.tp2RMultiple);
  const tp3 = entryPrice + (riskPerShare * fullConfig.tp3RMultiple);

  return {
    ticker,
    entry: entryPrice,
    stopLoss,
    stopDistance,
    stopPercent,
    tp1,
    tp2,
    tp3,
    tp1Percent: ((tp1 - entryPrice) / entryPrice) * 100,
    tp2Percent: ((tp2 - entryPrice) / entryPrice) * 100,
    tp3Percent: ((tp3 - entryPrice) / entryPrice) * 100,
    riskPerShare,
    atr,
    atrPercent,
  };
}

export function calculateExitLevelsFromData(
  ticker: string,
  data: OHLCBar[],
  config: Partial<ExitConfig> = {}
): TradePlan {
  const entryPrice = data[data.length - 1].close;
  const atr = calculateATR(data);
  return calculateExitLevels(ticker, entryPrice, atr, config);
}

// ============================================
// POSITION SIZING
// ============================================

export function calculatePositionSize(
  tradePlan: TradePlan,
  accountSize: number,
  riskPercent: number = 0.01  // Default 1% risk per trade
): PositionSize {
  const maxRisk = accountSize * riskPercent;
  const shares = Math.floor(maxRisk / tradePlan.riskPerShare);
  const positionValue = shares * tradePlan.entry;
  const maxLoss = shares * tradePlan.riskPerShare;

  // Calculate profit at each TP level (partial exits)
  // TP1: 33% of shares, TP2: 33% of shares, TP3: 34% of shares
  const tp1Shares = Math.floor(shares * 0.33);
  const tp2Shares = Math.floor(shares * 0.33);
  const tp3Shares = shares - tp1Shares - tp2Shares;

  const tp1Profit = tp1Shares * (tradePlan.tp1 - tradePlan.entry);
  const tp2Profit = tp2Shares * (tradePlan.tp2 - tradePlan.entry);
  const tp3Profit = tp3Shares * (tradePlan.tp3 - tradePlan.entry);

  return {
    shares,
    positionValue,
    maxLoss,
    riskPercent,
    tp1Profit,
    tp2Profit,
    tp3Profit,
    tp1RMultiple: 2.0,  // From config
    tp2RMultiple: 3.0,
    tp3RMultiple: 4.0,
  };
}

// ============================================
// FORMATTING
// ============================================

export function formatTradePlan(
  tradePlan: TradePlan,
  positionSize?: PositionSize
): string {
  const lines: string[] = [];

  lines.push('TRADE PLAN:');
  lines.push(`  Entry: $${tradePlan.entry.toFixed(2)}`);
  lines.push(`  Stop Loss: $${tradePlan.stopLoss.toFixed(2)} (-${tradePlan.stopPercent.toFixed(1)}%)`);
  lines.push(`  TP1 (2R): $${tradePlan.tp1.toFixed(2)} (+${tradePlan.tp1Percent.toFixed(1)}%)`);
  lines.push(`  TP2 (3R): $${tradePlan.tp2.toFixed(2)} (+${tradePlan.tp2Percent.toFixed(1)}%)`);
  lines.push(`  TP3 (4R): $${tradePlan.tp3.toFixed(2)} (+${tradePlan.tp3Percent.toFixed(1)}%)`);
  lines.push('');
  lines.push(`  Risk per share: $${tradePlan.riskPerShare.toFixed(2)}`);
  lines.push(`  ATR: $${tradePlan.atr.toFixed(2)} (${tradePlan.atrPercent.toFixed(1)}%)`);

  if (positionSize) {
    lines.push('');
    lines.push(`POSITION SIZING (${(positionSize.riskPercent * 100).toFixed(0)}% risk):`);
    lines.push(`  Suggested shares: ${positionSize.shares}`);
    lines.push(`  Position value: $${positionSize.positionValue.toLocaleString()}`);
    lines.push(`  Max loss: $${positionSize.maxLoss.toFixed(0)}`);
    lines.push('');
    lines.push('  Profit potential (partial exits):');
    lines.push(`    TP1 (33%): +$${positionSize.tp1Profit.toFixed(0)}`);
    lines.push(`    TP2 (33%): +$${positionSize.tp2Profit.toFixed(0)}`);
    lines.push(`    TP3 (34%): +$${positionSize.tp3Profit.toFixed(0)}`);
    lines.push(`    Total if all TPs hit: +$${(positionSize.tp1Profit + positionSize.tp2Profit + positionSize.tp3Profit).toFixed(0)}`);
  }

  return lines.join('\n');
}

export function formatTradePlanCompact(tradePlan: TradePlan): string {
  return [
    `Entry: $${tradePlan.entry.toFixed(2)}`,
    `SL: $${tradePlan.stopLoss.toFixed(2)} (-${tradePlan.stopPercent.toFixed(1)}%)`,
    `TP1: $${tradePlan.tp1.toFixed(2)} | TP2: $${tradePlan.tp2.toFixed(2)} | TP3: $${tradePlan.tp3.toFixed(2)}`,
  ].join(' | ');
}
