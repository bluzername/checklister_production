/**
 * Historical Store Service
 * Manages storage and retrieval of analysis snapshots and trade outcomes
 * for backtesting and model training.
 */

import { createClient, isSupabaseConfigured } from '../supabase/server';
import { AnalysisResult } from '../types';
import { MarketRegime } from '../market-regime/types';
import {
  AnalysisSnapshot,
  TradeOutcome,
  PredictionLog,
  FeatureVector,
  ExitReason,
  extractFeatureVector,
  getMarketCapBucket,
} from './types';

const MODEL_VERSION = 'v1.0';

// ============================================
// ANALYSIS SNAPSHOTS
// ============================================

/**
 * Store an analysis snapshot for a ticker on a specific date
 */
export async function storeAnalysisSnapshot(
  ticker: string,
  analysisDate: string,
  result: AnalysisResult
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    if (!isSupabaseConfigured()) {
      return { success: false, error: 'Database not configured' };
    }

    const supabase = await createClient();
    const featureVector = extractFeatureVector(result);

    const snapshot: Omit<AnalysisSnapshot, 'id' | 'created_at'> = {
      ticker: ticker.toUpperCase(),
      analysis_date: analysisDate,
      analysis_result: result,
      feature_vector: featureVector,
      success_probability: result.success_probability,
      regime: (result.market_regime?.regime ?? 'CHOPPY') as MarketRegime,
      trade_type: result.trade_type,
      recommendation: result.recommendation,
      current_price: result.current_price,
      rsi_value: result.parameters['10_rsi'].value,
      atr_percent: (result.parameters['6_support_resistance'].atr / result.current_price) * 100,
      rvol: result.parameters['4_catalyst'].rvol,
      model_version: MODEL_VERSION,
    };

    const { data, error } = await supabase
      .from('analysis_snapshots')
      .upsert(snapshot, { onConflict: 'ticker,analysis_date' })
      .select('id')
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, id: data.id };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get analysis snapshot for a ticker on a specific date
 */
export async function getAnalysisSnapshot(
  ticker: string,
  analysisDate: string
): Promise<{ success: boolean; data?: AnalysisSnapshot; error?: string }> {
  try {
    if (!isSupabaseConfigured()) {
      return { success: false, error: 'Database not configured' };
    }

    const supabase = await createClient();

    const { data, error } = await supabase
      .from('analysis_snapshots')
      .select('*')
      .eq('ticker', ticker.toUpperCase())
      .eq('analysis_date', analysisDate)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: false, error: 'Snapshot not found' };
      }
      return { success: false, error: error.message };
    }

    return { success: true, data: data as AnalysisSnapshot };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get analysis snapshots for a date range
 */
export async function getSnapshotsInRange(
  ticker: string,
  startDate: string,
  endDate: string
): Promise<{ success: boolean; data?: AnalysisSnapshot[]; error?: string }> {
  try {
    if (!isSupabaseConfigured()) {
      return { success: false, error: 'Database not configured' };
    }

    const supabase = await createClient();

    const { data, error } = await supabase
      .from('analysis_snapshots')
      .select('*')
      .eq('ticker', ticker.toUpperCase())
      .gte('analysis_date', startDate)
      .lte('analysis_date', endDate)
      .order('analysis_date', { ascending: true });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data as AnalysisSnapshot[] };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get all snapshots meeting entry criteria for backtesting
 */
export async function getEntrySignals(
  startDate: string,
  endDate: string,
  minProbability: number = 60,
  regime?: MarketRegime
): Promise<{ success: boolean; data?: AnalysisSnapshot[]; error?: string }> {
  try {
    if (!isSupabaseConfigured()) {
      return { success: false, error: 'Database not configured' };
    }

    const supabase = await createClient();

    let query = supabase
      .from('analysis_snapshots')
      .select('*')
      .gte('analysis_date', startDate)
      .lte('analysis_date', endDate)
      .gte('success_probability', minProbability)
      .in('trade_type', ['SWING_LONG']);

    if (regime) {
      query = query.eq('regime', regime);
    }

    const { data, error } = await query.order('analysis_date', { ascending: true });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data as AnalysisSnapshot[] };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ============================================
// TRADE OUTCOMES
// ============================================

/**
 * Create a trade outcome record when entering a trade
 */
export async function createTradeOutcome(
  snapshotId: string,
  ticker: string,
  entryDate: string,
  entryPrice: number,
  stopLoss: number,
  regime: MarketRegime,
  sector?: string,
  marketCapBillions?: number,
  positionShares?: number,
  positionDollars?: number,
  isPaperTrade: boolean = true,
  userId?: string
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    if (!isSupabaseConfigured()) {
      return { success: false, error: 'Database not configured' };
    }

    const supabase = await createClient();

    const outcome: Omit<TradeOutcome, 'id' | 'created_at' | 'updated_at'> = {
      snapshot_id: snapshotId,
      ticker: ticker.toUpperCase(),
      entry_date: entryDate,
      entry_price: entryPrice,
      stop_loss: stopLoss,
      position_size_shares: positionShares,
      position_size_dollars: positionDollars,
      regime_at_entry: regime,
      sector,
      market_cap_bucket: marketCapBillions ? getMarketCapBucket(marketCapBillions) : undefined,
      is_paper_trade: isPaperTrade,
      user_id: userId,
      target_r_threshold: 1.5,
    };

    const { data, error } = await supabase
      .from('trade_outcomes')
      .insert(outcome)
      .select('id')
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, id: data.id };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Close a trade outcome with exit details
 */
export async function closeTradeOutcome(
  outcomeId: string,
  exitDate: string,
  exitPrice: number,
  exitReason: ExitReason,
  mfe?: number,
  mae?: number
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!isSupabaseConfigured()) {
      return { success: false, error: 'Database not configured' };
    }

    const supabase = await createClient();

    // First get the trade to calculate metrics
    const { data: trade, error: fetchError } = await supabase
      .from('trade_outcomes')
      .select('entry_date, entry_price, stop_loss, target_r_threshold')
      .eq('id', outcomeId)
      .single();

    if (fetchError || !trade) {
      return { success: false, error: fetchError?.message || 'Trade not found' };
    }

    // Calculate metrics
    const risk = trade.entry_price - trade.stop_loss;
    const realizedPnl = exitPrice - trade.entry_price;
    const realizedR = risk > 0 ? realizedPnl / risk : 0;
    const realizedPnlPercent = (realizedPnl / trade.entry_price) * 100;
    
    const entryMs = new Date(trade.entry_date).getTime();
    const exitMs = new Date(exitDate).getTime();
    const holdingDays = Math.ceil((exitMs - entryMs) / (1000 * 60 * 60 * 24));
    
    const mfeR = mfe && risk > 0 ? (mfe - trade.entry_price) / risk : undefined;
    const maeR = mae && risk > 0 ? (trade.entry_price - mae) / risk : undefined;
    
    const label = realizedR >= trade.target_r_threshold ? 1 : 0;

    const { error } = await supabase
      .from('trade_outcomes')
      .update({
        exit_date: exitDate,
        exit_price: exitPrice,
        exit_reason: exitReason,
        realized_r: realizedR,
        realized_pnl: realizedPnl,
        realized_pnl_percent: realizedPnlPercent,
        holding_days: holdingDays,
        max_favorable_excursion: mfe,
        max_adverse_excursion: mae,
        mfe_r: mfeR,
        mae_r: maeR,
        label,
      })
      .eq('id', outcomeId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get trade outcomes for model training
 */
export async function getTradeOutcomes(
  filters?: {
    startDate?: string;
    endDate?: string;
    regime?: MarketRegime;
    sector?: string;
    onlyClosed?: boolean;
    onlyLabeled?: boolean;
  }
): Promise<{ success: boolean; data?: TradeOutcome[]; error?: string }> {
  try {
    if (!isSupabaseConfigured()) {
      return { success: false, error: 'Database not configured' };
    }

    const supabase = await createClient();

    let query = supabase.from('trade_outcomes').select('*');

    if (filters?.startDate) {
      query = query.gte('entry_date', filters.startDate);
    }
    if (filters?.endDate) {
      query = query.lte('entry_date', filters.endDate);
    }
    if (filters?.regime) {
      query = query.eq('regime_at_entry', filters.regime);
    }
    if (filters?.sector) {
      query = query.eq('sector', filters.sector);
    }
    if (filters?.onlyClosed) {
      query = query.not('exit_date', 'is', null);
    }
    if (filters?.onlyLabeled) {
      query = query.not('label', 'is', null);
    }

    const { data, error } = await query.order('entry_date', { ascending: true });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data as TradeOutcome[] };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get training data: snapshots with their outcomes
 */
export async function getTrainingData(
  startDate: string,
  endDate: string
): Promise<{
  success: boolean;
  data?: { snapshot: AnalysisSnapshot; outcome: TradeOutcome }[];
  error?: string;
}> {
  try {
    if (!isSupabaseConfigured()) {
      return { success: false, error: 'Database not configured' };
    }

    const supabase = await createClient();

    const { data, error } = await supabase
      .from('trade_outcomes')
      .select(`
        *,
        analysis_snapshots (*)
      `)
      .gte('entry_date', startDate)
      .lte('entry_date', endDate)
      .not('label', 'is', null)
      .order('entry_date', { ascending: true });

    if (error) {
      return { success: false, error: error.message };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const trainingData = data.map((item: any) => ({
      snapshot: item.analysis_snapshots as AnalysisSnapshot,
      outcome: {
        ...item,
        analysis_snapshots: undefined,
      } as TradeOutcome,
    }));

    return { success: true, data: trainingData };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ============================================
// PREDICTION LOGGING
// ============================================

/**
 * Log a prediction for calibration monitoring
 */
export async function logPrediction(
  ticker: string,
  predictionDate: string,
  predictedProbability: number,
  confidenceRating: string,
  featureVector: FeatureVector,
  regime: MarketRegime,
  predictedR?: number
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    if (!isSupabaseConfigured()) {
      return { success: false, error: 'Database not configured' };
    }

    const supabase = await createClient();

    const log: Omit<PredictionLog, 'id' | 'created_at'> = {
      ticker: ticker.toUpperCase(),
      prediction_date: predictionDate,
      predicted_probability: predictedProbability,
      predicted_r: predictedR,
      confidence_rating: confidenceRating,
      feature_vector: featureVector,
      regime,
      model_version: MODEL_VERSION,
    };

    const { data, error } = await supabase
      .from('prediction_logs')
      .insert(log)
      .select('id')
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, id: data.id };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Update prediction with actual outcome
 */
export async function updatePredictionOutcome(
  predictionId: string,
  actualOutcome: 0 | 1,
  actualR: number,
  outcomeDate: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!isSupabaseConfigured()) {
      return { success: false, error: 'Database not configured' };
    }

    const supabase = await createClient();

    const { error } = await supabase
      .from('prediction_logs')
      .update({
        actual_outcome: actualOutcome,
        actual_r: actualR,
        outcome_date: outcomeDate,
      })
      .eq('id', predictionId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get calibration data: predictions grouped by probability bucket
 */
export async function getCalibrationData(): Promise<{
  success: boolean;
  data?: {
    bucket: string;
    predictedAvg: number;
    actualWinRate: number;
    count: number;
  }[];
  error?: string;
}> {
  try {
    if (!isSupabaseConfigured()) {
      return { success: false, error: 'Database not configured' };
    }

    const supabase = await createClient();

    // Get all predictions with outcomes
    const { data, error } = await supabase
      .from('prediction_logs')
      .select('predicted_probability, actual_outcome')
      .not('actual_outcome', 'is', null);

    if (error) {
      return { success: false, error: error.message };
    }

    // Group by 10% buckets
    const buckets: Record<string, { predictions: number[]; outcomes: number[] }> = {};
    
    for (const row of data) {
      const bucketStart = Math.floor(row.predicted_probability / 10) * 10;
      const bucketKey = `${bucketStart}-${bucketStart + 10}%`;
      
      if (!buckets[bucketKey]) {
        buckets[bucketKey] = { predictions: [], outcomes: [] };
      }
      
      buckets[bucketKey].predictions.push(row.predicted_probability);
      buckets[bucketKey].outcomes.push(row.actual_outcome);
    }

    const calibrationData = Object.entries(buckets).map(([bucket, data]) => ({
      bucket,
      predictedAvg: data.predictions.reduce((a, b) => a + b, 0) / data.predictions.length,
      actualWinRate: (data.outcomes.filter(o => o === 1).length / data.outcomes.length) * 100,
      count: data.predictions.length,
    }));

    // Sort by bucket
    calibrationData.sort((a, b) => {
      const aStart = parseInt(a.bucket.split('-')[0]);
      const bStart = parseInt(b.bucket.split('-')[0]);
      return aStart - bStart;
    });

    return { success: true, data: calibrationData };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ============================================
// STATISTICS
// ============================================

/**
 * Get snapshot statistics
 */
export async function getSnapshotStats(): Promise<{
  success: boolean;
  data?: {
    totalSnapshots: number;
    uniqueTickers: number;
    dateRange: { start: string; end: string };
    byRegime: Record<string, number>;
  };
  error?: string;
}> {
  try {
    if (!isSupabaseConfigured()) {
      return { success: false, error: 'Database not configured' };
    }

    const supabase = await createClient();

    // Get total count
    const { count: totalSnapshots } = await supabase
      .from('analysis_snapshots')
      .select('*', { count: 'exact', head: true });

    // Get unique tickers
    const { data: tickerData } = await supabase
      .from('analysis_snapshots')
      .select('ticker');
    
    const uniqueTickers = new Set(tickerData?.map(t => t.ticker)).size;

    // Get date range
    const { data: dateRangeData } = await supabase
      .from('analysis_snapshots')
      .select('analysis_date')
      .order('analysis_date', { ascending: true })
      .limit(1);
    
    const { data: endDateData } = await supabase
      .from('analysis_snapshots')
      .select('analysis_date')
      .order('analysis_date', { ascending: false })
      .limit(1);

    // Get by regime
    const { data: regimeData } = await supabase
      .from('analysis_snapshots')
      .select('regime');
    
    const byRegime: Record<string, number> = {};
    regimeData?.forEach(r => {
      byRegime[r.regime] = (byRegime[r.regime] || 0) + 1;
    });

    return {
      success: true,
      data: {
        totalSnapshots: totalSnapshots || 0,
        uniqueTickers,
        dateRange: {
          start: dateRangeData?.[0]?.analysis_date || '',
          end: endDateData?.[0]?.analysis_date || '',
        },
        byRegime,
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get trade outcome statistics
 */
export async function getOutcomeStats(): Promise<{
  success: boolean;
  data?: {
    totalTrades: number;
    closedTrades: number;
    winRate: number;
    avgR: number;
    profitFactor: number;
    avgHoldingDays: number;
    byRegime: Record<string, { count: number; winRate: number; avgR: number }>;
  };
  error?: string;
}> {
  try {
    if (!isSupabaseConfigured()) {
      return { success: false, error: 'Database not configured' };
    }

    const supabase = await createClient();

    const { data: outcomes, error } = await supabase
      .from('trade_outcomes')
      .select('*');

    if (error) {
      return { success: false, error: error.message };
    }

    const closedTrades = outcomes?.filter(o => o.exit_date) || [];
    const winners = closedTrades.filter(o => o.realized_r > 0);
    const losers = closedTrades.filter(o => o.realized_r <= 0);

    const totalR = closedTrades.reduce((sum, o) => sum + (o.realized_r || 0), 0);
    const grossProfit = winners.reduce((sum, o) => sum + (o.realized_r || 0), 0);
    const grossLoss = Math.abs(losers.reduce((sum, o) => sum + (o.realized_r || 0), 0));
    const totalHoldingDays = closedTrades.reduce((sum, o) => sum + (o.holding_days || 0), 0);

    // By regime
    const byRegime: Record<string, { count: number; winRate: number; avgR: number }> = {};
    const regimeGroups = new Map<string, typeof closedTrades>();
    
    closedTrades.forEach(trade => {
      const regime = trade.regime_at_entry || 'UNKNOWN';
      if (!regimeGroups.has(regime)) {
        regimeGroups.set(regime, []);
      }
      regimeGroups.get(regime)!.push(trade);
    });

    regimeGroups.forEach((trades, regime) => {
      const regimeWinners = trades.filter(t => t.realized_r > 0);
      const regimeTotalR = trades.reduce((sum, t) => sum + (t.realized_r || 0), 0);
      
      byRegime[regime] = {
        count: trades.length,
        winRate: trades.length > 0 ? (regimeWinners.length / trades.length) * 100 : 0,
        avgR: trades.length > 0 ? regimeTotalR / trades.length : 0,
      };
    });

    return {
      success: true,
      data: {
        totalTrades: outcomes?.length || 0,
        closedTrades: closedTrades.length,
        winRate: closedTrades.length > 0 ? (winners.length / closedTrades.length) * 100 : 0,
        avgR: closedTrades.length > 0 ? totalR / closedTrades.length : 0,
        profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
        avgHoldingDays: closedTrades.length > 0 ? totalHoldingDays / closedTrades.length : 0,
        byRegime,
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}







