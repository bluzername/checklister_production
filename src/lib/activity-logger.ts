import { createClient, isSupabaseConfigured } from '@/lib/supabase/server';
import { AnalysisResult, TradingPlan, VetoAnalysis } from '@/lib/types';

// Activity log operation types
export type ActivityOperation =
  // Portfolio operations
  | 'ADD_POSITION'
  | 'DELETE_POSITION'
  | 'UPDATE_POSITION'
  | 'RECORD_SELL'
  // Watchlist operations
  | 'ADD_WATCHLIST'
  | 'REMOVE_WATCHLIST'
  | 'UPDATE_WATCHLIST'
  // Analysis operations
  | 'ANALYZE_TICKER'
  | 'ANALYZE_PORTFOLIO'
  | 'ANALYZE_WATCHLIST'
  | 'ANALYZE_POSITION'
  | 'ANALYZE_WATCHLIST_ITEM'
  // Trade plan operations
  | 'VIEW_TRADE_PLAN'
  | 'EXECUTE_TRADE_PLAN';

export type ActivityCategory = 'PORTFOLIO' | 'WATCHLIST' | 'ANALYSIS';

export interface ActivityLogEntry {
  // Core identifiers
  user_id: string;
  operation: ActivityOperation;
  category: ActivityCategory;
  ticker?: string;

  // Position/Trade details
  position_id?: string;
  buy_price?: number;
  quantity?: number;
  sell_price?: number;
  shares_sold?: number;
  price_level?: string;  // stop_loss, pt1, pt2, pt3

  // Market context
  market_price?: number;

  // Algorithm context
  algorithm_context?: Partial<AnalysisResult>;
  success_probability?: number;
  trade_type?: string;
  recommended_action?: string;

  // Trading plan
  trading_plan?: Partial<TradingPlan>;

  // Veto analysis
  veto_analysis?: Partial<VetoAnalysis>;
  was_vetoed?: boolean;
  veto_probability?: number;

  // Technical indicators
  rsi_value?: number;
  atr_percent?: number;
  rvol?: number;
  market_regime?: string;

  // Notes
  notes?: string;

  // Session tracking
  session_id?: string;
}

/**
 * Log a user activity to the database for performance tracking and analysis.
 * This is a fire-and-forget operation - errors are logged but don't block the main operation.
 */
export async function logActivity(entry: ActivityLogEntry): Promise<void> {
  try {
    if (!isSupabaseConfigured()) {
      console.log('[ActivityLogger] Supabase not configured, skipping log');
      return;
    }

    const supabase = await createClient();

    // Prepare the log entry, extracting relevant data from analysis
    const logData: Record<string, unknown> = {
      user_id: entry.user_id,
      operation: entry.operation,
      category: entry.category,
      ticker: entry.ticker,
      position_id: entry.position_id,
      buy_price: entry.buy_price,
      quantity: entry.quantity,
      sell_price: entry.sell_price,
      shares_sold: entry.shares_sold,
      price_level: entry.price_level,
      market_price: entry.market_price,
      success_probability: entry.success_probability,
      trade_type: entry.trade_type,
      recommended_action: entry.recommended_action,
      rsi_value: entry.rsi_value,
      atr_percent: entry.atr_percent,
      rvol: entry.rvol,
      market_regime: entry.market_regime,
      notes: entry.notes,
      session_id: entry.session_id,

      // JSONB fields - store full context for later analysis
      algorithm_context: entry.algorithm_context ? sanitizeForJson(entry.algorithm_context) : {},
      trading_plan: entry.trading_plan ? sanitizeForJson(entry.trading_plan) : {},
      veto_analysis: entry.veto_analysis ? sanitizeForJson(entry.veto_analysis) : {},
      was_vetoed: entry.was_vetoed ?? false,
      veto_probability: entry.veto_probability,
    };

    // Remove undefined values
    const cleanedData = Object.fromEntries(
      Object.entries(logData).filter(([, v]) => v !== undefined)
    );

    const { error } = await supabase
      .from('user_activity_logs')
      .insert(cleanedData);

    if (error) {
      // Log error but don't throw - this is non-critical
      console.error('[ActivityLogger] Failed to log activity:', error.message);
    } else {
      console.log(`[ActivityLogger] Logged: ${entry.operation} ${entry.ticker || ''}`);
    }
  } catch (error) {
    // Log error but don't throw - this is non-critical
    console.error('[ActivityLogger] Error logging activity:', error);
  }
}

/**
 * Extract relevant data from AnalysisResult for logging.
 * This creates a verbose snapshot of the analysis at the time of the action.
 */
export function extractAlgorithmContext(analysis: AnalysisResult): Partial<ActivityLogEntry> {
  return {
    market_price: analysis.current_price,
    success_probability: analysis.success_probability,
    trade_type: analysis.trade_type,
    recommended_action: analysis.recommendation,

    // Technical indicators
    rsi_value: analysis.parameters['10_rsi']?.value,
    atr_percent: analysis.parameters['6_support_resistance']?.atr
      ? (analysis.parameters['6_support_resistance'].atr / analysis.current_price) * 100
      : undefined,
    rvol: analysis.parameters['4_catalyst']?.rvol,
    market_regime: analysis.market_regime?.regime,

    // Full context for later analysis - stored as generic object for JSONB flexibility
    algorithm_context: {
      ticker: analysis.ticker,
      timestamp: analysis.timestamp,
      current_price: analysis.current_price,
      timeframe: analysis.timeframe,
      trade_type: analysis.trade_type,
      success_probability: analysis.success_probability,
      confidence_rating: analysis.confidence_rating,
      recommendation: analysis.recommendation,
      market_regime: analysis.market_regime,
      regime_thresholds: analysis.regime_thresholds,
      multi_timeframe: analysis.multi_timeframe,
      volume_profile: analysis.volume_profile,
      divergence: analysis.divergence,
      adaptive_rsi: analysis.adaptive_rsi,
      // Store full parameters as-is for complete logging
      parameters: analysis.parameters,
      risk_analysis: analysis.risk_analysis,
      qualitative_assessment: analysis.qualitative_assessment,
    },

    // Trading plan
    trading_plan: analysis.trading_plan,

    // Veto analysis
    veto_analysis: analysis.veto_analysis,
    was_vetoed: analysis.veto_analysis?.vetoed,
    veto_probability: analysis.veto_analysis?.pLoss,
  };
}

/**
 * Sanitize an object for JSON storage (remove circular references, undefined values, etc.)
 */
function sanitizeForJson(obj: unknown): unknown {
  try {
    // Use JSON stringify/parse to remove non-serializable values
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return {};
  }
}

/**
 * Log portfolio operation with full context
 */
export async function logPortfolioOperation(
  userId: string,
  operation: ActivityOperation,
  ticker: string,
  details: {
    position_id?: string;
    buy_price?: number;
    quantity?: number;
    sell_price?: number;
    shares_sold?: number;
    price_level?: string;
    notes?: string;
  },
  analysis?: AnalysisResult | null,
  recommendedAction?: string
): Promise<void> {
  const entry: ActivityLogEntry = {
    user_id: userId,
    operation,
    category: 'PORTFOLIO',
    ticker,
    ...details,
    recommended_action: recommendedAction,
  };

  // Add analysis context if available
  if (analysis) {
    const algoContext = extractAlgorithmContext(analysis);
    Object.assign(entry, algoContext);
  }

  await logActivity(entry);
}

/**
 * Log watchlist operation with full context
 */
export async function logWatchlistOperation(
  userId: string,
  operation: ActivityOperation,
  ticker: string,
  details: {
    notes?: string;
  },
  analysis?: AnalysisResult | null
): Promise<void> {
  const entry: ActivityLogEntry = {
    user_id: userId,
    operation,
    category: 'WATCHLIST',
    ticker,
    ...details,
  };

  // Add analysis context if available
  if (analysis) {
    const algoContext = extractAlgorithmContext(analysis);
    Object.assign(entry, algoContext);
  }

  await logActivity(entry);
}

/**
 * Log analysis request
 */
export async function logAnalysisOperation(
  userId: string,
  operation: ActivityOperation,
  ticker: string,
  analysis: AnalysisResult
): Promise<void> {
  const entry: ActivityLogEntry = {
    user_id: userId,
    operation,
    category: 'ANALYSIS',
    ticker,
    ...extractAlgorithmContext(analysis),
  };

  await logActivity(entry);
}

/**
 * Update outcome for a previous activity log entry
 * Call this when a position is closed to track actual results vs predictions
 */
export async function updateActivityOutcome(
  positionId: string,
  outcome: {
    outcome_price: number;
    outcome_date: Date;
    realized_pnl: number;
    realized_pnl_percent: number;
    outcome_status: 'WIN' | 'LOSS' | 'CANCELLED';
  }
): Promise<void> {
  try {
    if (!isSupabaseConfigured()) return;

    const supabase = await createClient();

    const { error } = await supabase
      .from('user_activity_logs')
      .update({
        outcome_price: outcome.outcome_price,
        outcome_date: outcome.outcome_date.toISOString(),
        realized_pnl: outcome.realized_pnl,
        realized_pnl_percent: outcome.realized_pnl_percent,
        outcome_status: outcome.outcome_status,
      })
      .eq('position_id', positionId)
      .eq('operation', 'ADD_POSITION');

    if (error) {
      console.error('[ActivityLogger] Failed to update outcome:', error.message);
    } else {
      console.log(`[ActivityLogger] Updated outcome for position ${positionId}`);
    }
  } catch (error) {
    console.error('[ActivityLogger] Error updating outcome:', error);
  }
}
