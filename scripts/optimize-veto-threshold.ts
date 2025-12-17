/**
 * Veto Threshold Grid Search & Algorithm Comparison
 *
 * 1. Grid search veto thresholds to find optimal
 * 2. Compare veto-based vs heuristics-based algorithms
 * 3. Output recommendation for production
 */

import * as fs from 'fs';
import YahooFinance from 'yahoo-finance2';
import {
  evaluateVeto,
  loadVetoModel,
  calculateExitLevels,
  DEFAULT_VETO_CONFIG,
  type VetoResult,
  type TradePlan,
} from '../src/lib/trade-plan';

// ============================================
// CONFIGURATION
// ============================================

const INSIDER_TICKERS = [
  'AVGO', 'ACWI', 'NEXT', 'SMMT', 'FTNT', 'SONO', 'LLY', 'HEI', 'EUAD',
  'XLI', 'ETHA', 'TOPT', 'MRK', 'SIVR', 'CGON', 'AMZN', 'IVW', 'BLK', 'DECK',
  'DLO', 'SN', 'ACN', 'GOOG', 'CRM', 'ISRG', 'TOST', 'MSFT', 'RBLX', 'TLN',
  'RIG', 'MSTR', 'NU', 'DIG', 'PYPL', 'IBIT', 'APLD', 'SFNC', 'ITA',
  'RPD', 'AMD', 'UPS', 'NEE', 'D', 'INTC', 'DLR', 'VRT', 'FOUR',
  'DUOL', 'CCJ', 'EQIX', 'AUR', 'TPC', 'CEG', 'VRCA', 'BWXT'
];

// Grid search thresholds
const VETO_THRESHOLDS = [0.50, 0.52, 0.54, 0.56, 0.58, 0.60, 0.65, 0.70];

// Heuristics score threshold (from production)
const HEURISTICS_BUY_THRESHOLD = 50; // Score >= 50% = BUY

interface PriceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TradeSignal {
  ticker: string;
  signalDate: string;
  signalIndex: number;
  features: Record<string, number>;
  heuristicsScore: number;
  pLoss: number;
  outcome: {
    exitType: 'STOP_LOSS' | 'TP1' | 'TP2' | 'TP3' | 'TIME_EXIT';
    realizedR: number;
    pnlPercent: number;
  };
}

interface ThresholdResult {
  threshold: number;
  totalTrades: number;
  vetoedTrades: number;
  vetoRate: number;
  nonVetoedWinRate: number;
  nonVetoedAvgR: number;
  vetoPrecision: number;
  timingValue: number;
  profitFactor: number;
}

interface AlgorithmResult {
  name: string;
  totalTrades: number;
  takenTrades: number;
  filterRate: number;
  winRate: number;
  avgR: number;
  totalR: number;
  profitFactor: number;
  maxDrawdownR: number;
}

// ============================================
// YAHOO FINANCE DATA FETCHING
// ============================================

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

async function fetchPriceData(ticker: string, startDate: Date, endDate: Date): Promise<PriceBar[]> {
  try {
    const result = await yahooFinance.chart(ticker, {
      period1: startDate.toISOString().split('T')[0],
      period2: endDate.toISOString().split('T')[0],
      interval: '1d',
    }) as { quotes: Array<{ date: Date; open: number | null; high: number | null; low: number | null; close: number | null; volume?: number }> };

    return result.quotes
      .filter((q: { open: number | null; high: number | null; low: number | null; close: number | null }) =>
        q.open !== null && q.high !== null && q.low !== null && q.close !== null)
      .map((q: { date: Date; open: number | null; high: number | null; low: number | null; close: number | null; volume?: number }) => ({
        date: q.date.toISOString().split('T')[0],
        open: q.open!,
        high: q.high!,
        low: q.low!,
        close: q.close!,
        volume: q.volume || 0,
      }));
  } catch (error) {
    return [];
  }
}

// ============================================
// FEATURE COMPUTATION
// ============================================

function computeFeatures(data: PriceBar[], signalIndex: number, spyData: PriceBar[]): Record<string, number> {
  const relevantData = data.slice(0, signalIndex + 1);
  if (relevantData.length < 60) return {};

  const current = relevantData[relevantData.length - 1];
  const prices = relevantData.map(d => d.close);

  const sma20 = prices.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const sma50 = prices.slice(-50).reduce((a, b) => a + b, 0) / 50;
  const sma200 = prices.length >= 200 ? prices.slice(-200).reduce((a, b) => a + b, 0) / 200 : sma50;
  const ema9 = computeEMA(prices, 9);
  const ema21 = computeEMA(prices, 21);
  const rsi14 = computeRSI(prices, 14);
  const atr14 = computeATRFromBars(relevantData, 14);
  const atrPercent = (atr14 / current.close) * 100;

  const momentum5 = prices.length >= 6 ? ((current.close / prices[prices.length - 6]) - 1) * 100 : 0;
  const momentum10 = prices.length >= 11 ? ((current.close / prices[prices.length - 11]) - 1) * 100 : 0;
  const momentum20 = prices.length >= 21 ? ((current.close / prices[prices.length - 21]) - 1) * 100 : 0;

  const high52w = Math.max(...prices.slice(-252));
  const low52w = Math.min(...prices.slice(-252));
  const pullbackFromHigh = ((high52w - current.close) / high52w) * 100;
  const range52w = high52w - low52w;
  const rangePosition = range52w > 0 ? ((current.close - low52w) / range52w) * 100 : 50;

  const volumes = relevantData.map(d => d.volume);
  const avgVolume20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volumeRatio = avgVolume20 > 0 ? current.volume / avgVolume20 : 1;

  let spyMomentum = 0;
  let relativeStrength = 0;
  if (spyData.length >= 21) {
    const spyPrices = spyData.map(d => d.close);
    const spyCurrent = spyPrices[spyPrices.length - 1];
    const spy20DaysAgo = spyPrices[spyPrices.length - 21];
    spyMomentum = ((spyCurrent / spy20DaysAgo) - 1) * 100;
    relativeStrength = momentum20 - spyMomentum;
  }

  const aboveSma20 = current.close > sma20 ? 1 : 0;
  const aboveSma50 = current.close > sma50 ? 1 : 0;
  const aboveSma200 = current.close > sma200 ? 1 : 0;
  const ema9VsEma21 = ((ema9 / ema21) - 1) * 100;
  const isBullish = ema9 > ema21 ? 1 : 0;
  const pullbackInUptrend = (aboveSma50 === 1 && pullbackFromHigh > 5 && pullbackFromHigh < 15) ? 1 : 0;

  const clipMomentum = (val: number) => Math.max(-50, Math.min(100, val));

  return {
    rsi14,
    atrPercent,
    momentum5: clipMomentum(momentum5),
    momentum10: clipMomentum(momentum10),
    momentum20: clipMomentum(momentum20),
    pullbackFromHigh,
    rangePosition,
    volumeRatio: Math.min(5, volumeRatio),
    aboveSma20,
    aboveSma50,
    aboveSma200,
    ema9VsEma21,
    isBullish,
    spyMomentum,
    relativeStrength,
    pullbackInUptrend,
    priceVsSma20: ((current.close / sma20) - 1) * 100,
    priceVsSma50: ((current.close / sma50) - 1) * 100,
  };
}

// ============================================
// HEURISTICS SCORE (Simplified 10-point system)
// ============================================

function computeHeuristicsScore(features: Record<string, number>): number {
  let totalScore = 0;

  // 1. Market Condition (SPY momentum as proxy)
  const marketScore = features.spyMomentum > 2 ? 10 :
    features.spyMomentum > 0 ? 7 :
    features.spyMomentum > -2 ? 5 : 3;
  totalScore += marketScore;

  // 2. Relative Strength
  const rsScore = features.relativeStrength > 5 ? 10 :
    features.relativeStrength > 2 ? 8 :
    features.relativeStrength > 0 ? 6 :
    features.relativeStrength > -2 ? 4 : 2;
  totalScore += rsScore;

  // 3. Trend Structure (above SMAs)
  const trendScore = (features.aboveSma200 * 3) + (features.aboveSma50 * 4) + (features.aboveSma20 * 3);
  totalScore += trendScore;

  // 4. Volume
  const volumeScore = features.volumeRatio > 2 ? 10 :
    features.volumeRatio > 1.5 ? 8 :
    features.volumeRatio > 1 ? 6 :
    features.volumeRatio > 0.7 ? 4 : 2;
  totalScore += volumeScore;

  // 5. Momentum
  const momScore = features.momentum20 > 10 ? 10 :
    features.momentum20 > 5 ? 8 :
    features.momentum20 > 0 ? 6 :
    features.momentum20 > -5 ? 4 : 2;
  totalScore += momScore;

  // 6. RSI (not overbought/oversold)
  const rsiScore = (features.rsi14 > 30 && features.rsi14 < 70) ? 8 :
    (features.rsi14 > 40 && features.rsi14 < 60) ? 10 :
    features.rsi14 < 30 ? 6 : 3; // Oversold can be opportunity
  totalScore += rsiScore;

  // 7. Pullback in Uptrend
  const pullbackScore = features.pullbackInUptrend ? 10 :
    features.pullbackFromHigh < 5 ? 7 :
    features.pullbackFromHigh < 15 ? 8 :
    features.pullbackFromHigh < 25 ? 5 : 3;
  totalScore += pullbackScore;

  // 8. EMA Alignment
  const emaScore = features.isBullish ? (features.ema9VsEma21 > 2 ? 10 : 8) : 4;
  totalScore += emaScore;

  // 9. 52-week Range Position
  const rangeScore = features.rangePosition > 80 ? 6 : // Near highs - less upside
    features.rangePosition > 50 ? 8 :
    features.rangePosition > 30 ? 7 : 5;
  totalScore += rangeScore;

  // 10. Volatility (ATR)
  const volScore = features.atrPercent < 2 ? 8 :
    features.atrPercent < 4 ? 7 :
    features.atrPercent < 6 ? 5 : 3;
  totalScore += volScore;

  // Return as percentage (0-100)
  return totalScore; // Max is 100
}

// ============================================
// TRADE SIMULATION
// ============================================

function simulateTrade(
  data: PriceBar[],
  signalIndex: number,
  entryPrice: number,
  atr: number,
  maxHoldingDays: number = 45
): { exitType: TradeSignal['outcome']['exitType']; realizedR: number; pnlPercent: number } {
  const stopMultiple = 1.5;
  const stopDistance = atr * stopMultiple;
  const stopLoss = entryPrice - stopDistance;
  const tp1 = entryPrice + (stopDistance * 2);
  const tp2 = entryPrice + (stopDistance * 3);
  const tp3 = entryPrice + (stopDistance * 4);

  for (let i = signalIndex + 1; i < Math.min(signalIndex + 1 + maxHoldingDays, data.length); i++) {
    const bar = data[i];

    if (bar.low <= stopLoss) {
      const exitPrice = Math.min(bar.open, stopLoss);
      return {
        exitType: 'STOP_LOSS',
        realizedR: (exitPrice - entryPrice) / stopDistance,
        pnlPercent: ((exitPrice - entryPrice) / entryPrice) * 100,
      };
    }

    if (bar.high >= tp3) {
      return { exitType: 'TP3', realizedR: 4, pnlPercent: ((tp3 - entryPrice) / entryPrice) * 100 };
    }
    if (bar.high >= tp2) {
      return { exitType: 'TP2', realizedR: 3, pnlPercent: ((tp2 - entryPrice) / entryPrice) * 100 };
    }
    if (bar.high >= tp1) {
      return { exitType: 'TP1', realizedR: 2, pnlPercent: ((tp1 - entryPrice) / entryPrice) * 100 };
    }
  }

  const exitIndex = Math.min(signalIndex + maxHoldingDays, data.length - 1);
  const exitPrice = data[exitIndex].close;
  return {
    exitType: 'TIME_EXIT',
    realizedR: (exitPrice - entryPrice) / stopDistance,
    pnlPercent: ((exitPrice - entryPrice) / entryPrice) * 100,
  };
}

function computeEMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1];
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function computeRSI(prices: number[], period: number): number {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function computeATRFromBars(data: PriceBar[], period: number): number {
  if (data.length < period + 1) {
    return data.reduce((sum, bar) => sum + (bar.high - bar.low), 0) / data.length;
  }
  const trueRanges: number[] = [];
  for (let i = 1; i < data.length; i++) {
    const tr = Math.max(
      data[i].high - data[i].low,
      Math.abs(data[i].high - data[i - 1].close),
      Math.abs(data[i].low - data[i - 1].close)
    );
    trueRanges.push(tr);
  }
  return trueRanges.slice(-period).reduce((sum, tr) => sum + tr, 0) / period;
}

// ============================================
// MAIN GRID SEARCH
// ============================================

async function runGridSearch(): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('VETO THRESHOLD GRID SEARCH & ALGORITHM COMPARISON');
  console.log('='.repeat(80));

  // Calculate date range
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 9); // 9 months for buffer

  console.log(`\nDate range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
  console.log(`Tickers: ${INSIDER_TICKERS.length}`);
  console.log(`Thresholds to test: ${VETO_THRESHOLDS.join(', ')}`);

  // Load veto model
  console.log('\nLoading veto model...');
  loadVetoModel(DEFAULT_VETO_CONFIG.modelPath);

  // Fetch SPY data
  console.log('Fetching SPY data...');
  const spyData = await fetchPriceData('SPY', startDate, endDate);
  console.log(`  Got ${spyData.length} SPY bars`);

  // Collect all trade signals
  const signals: TradeSignal[] = [];
  const signalsPerTicker = 3;

  console.log('\nGenerating trade signals...\n');

  for (const ticker of INSIDER_TICKERS) {
    process.stdout.write(`  ${ticker}... `);

    const data = await fetchPriceData(ticker, startDate, endDate);
    if (data.length < 100) {
      console.log('SKIP');
      continue;
    }

    // Generate signal dates
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - 6);
    const startIdx = data.findIndex(d => new Date(d.date) >= cutoffDate);
    const endIdx = data.length - 50;

    if (startIdx < 0 || endIdx <= startIdx) {
      console.log('SKIP');
      continue;
    }

    const step = Math.floor((endIdx - startIdx) / (signalsPerTicker + 1));
    let tickerSignals = 0;

    for (let i = 1; i <= signalsPerTicker; i++) {
      const signalIndex = startIdx + step * i;
      const signalBar = data[signalIndex];

      const features = computeFeatures(data, signalIndex, spyData);
      if (Object.keys(features).length === 0) continue;

      const vetoResult = evaluateVeto(features, ticker, signalBar.date);
      const heuristicsScore = computeHeuristicsScore(features);
      const atr = computeATRFromBars(data.slice(0, signalIndex + 1), 14);
      const outcome = simulateTrade(data, signalIndex, signalBar.close, atr);

      signals.push({
        ticker,
        signalDate: signalBar.date,
        signalIndex,
        features,
        heuristicsScore,
        pLoss: vetoResult.pLoss,
        outcome,
      });

      tickerSignals++;
    }

    console.log(`${tickerSignals} signals`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  console.log(`\nTotal signals: ${signals.length}`);

  // ============================================
  // GRID SEARCH ANALYSIS
  // ============================================

  console.log('\n' + '='.repeat(80));
  console.log('PART 1: VETO THRESHOLD GRID SEARCH');
  console.log('='.repeat(80));

  const thresholdResults: ThresholdResult[] = [];

  // Baseline (no veto)
  const baselineWins = signals.filter(s => s.outcome.realizedR > 0).length;
  const baselineWinRate = baselineWins / signals.length;
  const baselineAvgR = signals.reduce((sum, s) => sum + s.outcome.realizedR, 0) / signals.length;

  console.log(`\nBaseline (no veto):`);
  console.log(`  Trades: ${signals.length}`);
  console.log(`  Win Rate: ${(baselineWinRate * 100).toFixed(1)}%`);
  console.log(`  Avg R: ${baselineAvgR.toFixed(3)}`);

  console.log(`\n${'Threshold'.padEnd(12)} ${'Veto Rate'.padStart(10)} ${'Win Rate'.padStart(10)} ${'Avg R'.padStart(10)} ${'Precision'.padStart(10)} ${'Timing Val'.padStart(12)} ${'PF'.padStart(8)}`);
  console.log('─'.repeat(80));

  for (const threshold of VETO_THRESHOLDS) {
    const vetoed = signals.filter(s => s.pLoss > threshold);
    const notVetoed = signals.filter(s => s.pLoss <= threshold);

    const vetoRate = vetoed.length / signals.length;
    const vetoPrecision = vetoed.length > 0
      ? vetoed.filter(s => s.outcome.realizedR <= 0).length / vetoed.length
      : 0;

    const nvWins = notVetoed.filter(s => s.outcome.realizedR > 0).length;
    const nvWinRate = notVetoed.length > 0 ? nvWins / notVetoed.length : 0;
    const nvAvgR = notVetoed.length > 0
      ? notVetoed.reduce((sum, s) => sum + s.outcome.realizedR, 0) / notVetoed.length
      : 0;

    const grossProfit = notVetoed.filter(s => s.outcome.realizedR > 0)
      .reduce((sum, s) => sum + s.outcome.realizedR, 0);
    const grossLoss = Math.abs(notVetoed.filter(s => s.outcome.realizedR <= 0)
      .reduce((sum, s) => sum + s.outcome.realizedR, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : Infinity;

    const timingValue = nvAvgR - baselineAvgR;

    thresholdResults.push({
      threshold,
      totalTrades: signals.length,
      vetoedTrades: vetoed.length,
      vetoRate,
      nonVetoedWinRate: nvWinRate,
      nonVetoedAvgR: nvAvgR,
      vetoPrecision,
      timingValue,
      profitFactor,
    });

    console.log(
      `${(threshold * 100).toFixed(0)}%`.padEnd(12) +
      `${(vetoRate * 100).toFixed(1)}%`.padStart(10) +
      `${(nvWinRate * 100).toFixed(1)}%`.padStart(10) +
      `${nvAvgR.toFixed(3)}`.padStart(10) +
      `${(vetoPrecision * 100).toFixed(1)}%`.padStart(10) +
      `${timingValue > 0 ? '+' : ''}${timingValue.toFixed(3)}R`.padStart(12) +
      `${profitFactor === Infinity ? '∞' : profitFactor.toFixed(2)}`.padStart(8)
    );
  }

  // Find optimal threshold
  const optimalByAvgR = [...thresholdResults].sort((a, b) => b.nonVetoedAvgR - a.nonVetoedAvgR)[0];
  const optimalByWinRate = [...thresholdResults].sort((a, b) => b.nonVetoedWinRate - a.nonVetoedWinRate)[0];
  const optimalByTimingValue = [...thresholdResults].sort((a, b) => b.timingValue - a.timingValue)[0];

  // Balanced optimal: best timing value with reasonable veto rate (<40%)
  const balancedCandidates = thresholdResults.filter(r => r.vetoRate < 0.40);
  const optimalBalanced = balancedCandidates.sort((a, b) => b.timingValue - a.timingValue)[0];

  console.log(`\n${'─'.repeat(80)}`);
  console.log('OPTIMAL THRESHOLDS:');
  console.log(`  Best by Avg R:       ${(optimalByAvgR.threshold * 100).toFixed(0)}% (Avg R: ${optimalByAvgR.nonVetoedAvgR.toFixed(3)})`);
  console.log(`  Best by Win Rate:    ${(optimalByWinRate.threshold * 100).toFixed(0)}% (Win: ${(optimalByWinRate.nonVetoedWinRate * 100).toFixed(1)}%)`);
  console.log(`  Best by Timing Val:  ${(optimalByTimingValue.threshold * 100).toFixed(0)}% (Value: +${optimalByTimingValue.timingValue.toFixed(3)}R)`);
  console.log(`  RECOMMENDED:         ${(optimalBalanced.threshold * 100).toFixed(0)}% (balanced: good value, reasonable filter rate)`);

  const OPTIMAL_THRESHOLD = optimalBalanced.threshold;

  // ============================================
  // ALGORITHM COMPARISON
  // ============================================

  console.log('\n' + '='.repeat(80));
  console.log('PART 2: ALGORITHM COMPARISON');
  console.log('='.repeat(80));

  const algorithms: AlgorithmResult[] = [];

  // 1. No Filter (Baseline)
  const baselineResult = computeAlgorithmMetrics(signals, 'No Filter (Baseline)', () => true);
  algorithms.push(baselineResult);

  // 2. Heuristics-based (Score >= 50%)
  const heuristicsResult = computeAlgorithmMetrics(
    signals,
    `Heuristics (Score >= ${HEURISTICS_BUY_THRESHOLD}%)`,
    (s) => s.heuristicsScore >= HEURISTICS_BUY_THRESHOLD
  );
  algorithms.push(heuristicsResult);

  // 3. Heuristics-based (Score >= 60%)
  const heuristics60Result = computeAlgorithmMetrics(
    signals,
    'Heuristics (Score >= 60%)',
    (s) => s.heuristicsScore >= 60
  );
  algorithms.push(heuristics60Result);

  // 4. Heuristics-based (Score >= 70%)
  const heuristics70Result = computeAlgorithmMetrics(
    signals,
    'Heuristics (Score >= 70%)',
    (s) => s.heuristicsScore >= 70
  );
  algorithms.push(heuristics70Result);

  // 5. Veto-based (Optimal threshold)
  const vetoResult = computeAlgorithmMetrics(
    signals,
    `Veto-Based (P(loss) <= ${(OPTIMAL_THRESHOLD * 100).toFixed(0)}%)`,
    (s) => s.pLoss <= OPTIMAL_THRESHOLD
  );
  algorithms.push(vetoResult);

  // 6. Combined: Heuristics + Veto
  const combinedResult = computeAlgorithmMetrics(
    signals,
    'Combined (Heuristics >= 50% AND Veto Pass)',
    (s) => s.heuristicsScore >= HEURISTICS_BUY_THRESHOLD && s.pLoss <= OPTIMAL_THRESHOLD
  );
  algorithms.push(combinedResult);

  // Print comparison table
  console.log(`\n${'Algorithm'.padEnd(40)} ${'Taken'.padStart(8)} ${'Filter%'.padStart(8)} ${'WinRate'.padStart(8)} ${'AvgR'.padStart(8)} ${'TotalR'.padStart(10)} ${'PF'.padStart(6)}`);
  console.log('─'.repeat(90));

  for (const alg of algorithms) {
    console.log(
      `${alg.name.padEnd(40)} ` +
      `${alg.takenTrades.toString().padStart(8)} ` +
      `${(alg.filterRate * 100).toFixed(1)}%`.padStart(8) + ' ' +
      `${(alg.winRate * 100).toFixed(1)}%`.padStart(8) + ' ' +
      `${alg.avgR.toFixed(3)}`.padStart(8) + ' ' +
      `${alg.totalR.toFixed(2)}`.padStart(10) + ' ' +
      `${alg.profitFactor === Infinity ? '∞' : alg.profitFactor.toFixed(2)}`.padStart(6)
    );
  }

  // ============================================
  // FINAL VERDICT
  // ============================================

  console.log('\n' + '='.repeat(80));
  console.log('VERDICT');
  console.log('='.repeat(80));

  // Determine winner
  const rankedByAvgR = [...algorithms].sort((a, b) => b.avgR - a.avgR);
  const rankedByTotalR = [...algorithms].sort((a, b) => b.totalR - a.totalR);
  const rankedByWinRate = [...algorithms].sort((a, b) => b.winRate - a.winRate);

  console.log('\nRankings:');
  console.log(`  By Avg R:     1. ${rankedByAvgR[0].name} (${rankedByAvgR[0].avgR.toFixed(3)})`);
  console.log(`                2. ${rankedByAvgR[1].name} (${rankedByAvgR[1].avgR.toFixed(3)})`);
  console.log(`  By Total R:   1. ${rankedByTotalR[0].name} (${rankedByTotalR[0].totalR.toFixed(2)})`);
  console.log(`                2. ${rankedByTotalR[1].name} (${rankedByTotalR[1].totalR.toFixed(2)})`);
  console.log(`  By Win Rate:  1. ${rankedByWinRate[0].name} (${(rankedByWinRate[0].winRate * 100).toFixed(1)}%)`);
  console.log(`                2. ${rankedByWinRate[1].name} (${(rankedByWinRate[1].winRate * 100).toFixed(1)}%)`);

  // Compare veto vs heuristics directly
  const vetoWins = vetoResult.avgR > heuristicsResult.avgR;
  const vetoWinsWinRate = vetoResult.winRate > heuristicsResult.winRate;
  const vetoWinsPF = vetoResult.profitFactor > heuristicsResult.profitFactor;

  console.log('\n' + '─'.repeat(80));
  console.log('VETO vs HEURISTICS HEAD-TO-HEAD:');
  console.log('─'.repeat(80));
  console.log(`  Avg R:        Veto ${vetoResult.avgR.toFixed(3)} vs Heuristics ${heuristicsResult.avgR.toFixed(3)} → ${vetoWins ? 'VETO WINS' : 'HEURISTICS WINS'}`);
  console.log(`  Win Rate:     Veto ${(vetoResult.winRate * 100).toFixed(1)}% vs Heuristics ${(heuristicsResult.winRate * 100).toFixed(1)}% → ${vetoWinsWinRate ? 'VETO WINS' : 'HEURISTICS WINS'}`);
  console.log(`  Profit Factor: Veto ${vetoResult.profitFactor.toFixed(2)} vs Heuristics ${heuristicsResult.profitFactor.toFixed(2)} → ${vetoWinsPF ? 'VETO WINS' : 'HEURISTICS WINS'}`);

  const vetoOverallWins = [vetoWins, vetoWinsWinRate, vetoWinsPF].filter(x => x).length >= 2;

  console.log('\n' + '='.repeat(80));
  if (vetoOverallWins) {
    console.log('  ✅ RECOMMENDATION: USE VETO-BASED SYSTEM');
    console.log(`     Optimal threshold: P(loss) <= ${(OPTIMAL_THRESHOLD * 100).toFixed(0)}%`);
    console.log(`     Improvement over heuristics:`);
    console.log(`       - Avg R: ${vetoResult.avgR > heuristicsResult.avgR ? '+' : ''}${(vetoResult.avgR - heuristicsResult.avgR).toFixed(3)}`);
    console.log(`       - Win Rate: ${vetoResult.winRate > heuristicsResult.winRate ? '+' : ''}${((vetoResult.winRate - heuristicsResult.winRate) * 100).toFixed(1)}pp`);
  } else {
    console.log('  ⚠️ RECOMMENDATION: KEEP HEURISTICS-BASED SYSTEM');
    console.log(`     Heuristics performs better or equally well.`);
    console.log(`     Consider using Combined approach for best of both.`);
  }
  console.log('='.repeat(80));

  // Save results
  const outputPath = 'results/veto-optimization.json';
  fs.mkdirSync('results', { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify({
    gridSearch: {
      thresholds: thresholdResults,
      optimal: OPTIMAL_THRESHOLD,
    },
    algorithms: algorithms,
    recommendation: vetoOverallWins ? 'VETO' : 'HEURISTICS',
    optimalVetoThreshold: OPTIMAL_THRESHOLD,
  }, null, 2));

  console.log(`\nResults saved to: ${outputPath}`);
}

function computeAlgorithmMetrics(
  signals: TradeSignal[],
  name: string,
  filter: (s: TradeSignal) => boolean
): AlgorithmResult {
  const taken = signals.filter(filter);
  const wins = taken.filter(s => s.outcome.realizedR > 0);
  const losses = taken.filter(s => s.outcome.realizedR <= 0);

  const totalR = taken.reduce((sum, s) => sum + s.outcome.realizedR, 0);
  const grossProfit = wins.reduce((sum, s) => sum + s.outcome.realizedR, 0);
  const grossLoss = Math.abs(losses.reduce((sum, s) => sum + s.outcome.realizedR, 0));

  // Compute max drawdown
  let maxDD = 0;
  let peak = 0;
  let cumR = 0;
  for (const t of taken) {
    cumR += t.outcome.realizedR;
    if (cumR > peak) peak = cumR;
    const dd = peak - cumR;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    name,
    totalTrades: signals.length,
    takenTrades: taken.length,
    filterRate: 1 - (taken.length / signals.length),
    winRate: taken.length > 0 ? wins.length / taken.length : 0,
    avgR: taken.length > 0 ? totalR / taken.length : 0,
    totalR,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : Infinity,
    maxDrawdownR: maxDD,
  };
}

runGridSearch().catch(console.error);
