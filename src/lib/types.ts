export type TradeType = 'SWING_LONG' | 'SWING_SHORT' | 'HOLD' | 'AVOID';
export type MarketStatus = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type FundamentalStatus = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
export type TrendStatus = 'UPTREND' | 'DOWNTREND' | 'CONSOLIDATION';
export type MomentumStatus = 'OVERBOUGHT' | 'OVERSOLD' | 'NEUTRAL' | 'OPTIMAL' | 'OPTIMAL_BUY' | 'EXTREME';
export type PatternType = 'BULL_FLAG' | 'GAP_UP' | 'BREAKOUT' | 'NONE';
export type SectorRank = 'TOP_3' | 'MIDDLE' | 'BOTTOM_3';

export interface ParameterScore {
  score: number;
  rationale: string;
}

// 1. Market Condition (The "Tide")
export interface MarketCondition extends ParameterScore {
  status: MarketStatus;
  spx_trend: string;
  spx_price: number;
  spx_sma50: number;
  spx_sma200: number;
  golden_cross: boolean;        // 50 SMA > 200 SMA
  vix_level?: number;           // Optional VIX filter
  vix_safe?: boolean;           // VIX < 25
}

// 2. Sector Condition (Relative Strength)
export interface SectorCondition extends ParameterScore {
  sector: string;
  sector_etf: string;           // XLK, XLF, etc.
  rs_score_20d: number;         // Relative Strength vs SPY (20 days)
  rs_score_60d: number;         // Relative Strength vs SPY (60 days)
  sector_rank: SectorRank;      // Top 3, Middle, Bottom 3
  outperforming: boolean;       // RS > 1.0
  status: string;
}

// 3. Company & Fundamental Condition
export interface CompanyCondition extends ParameterScore {
  status: FundamentalStatus;
  earnings_surprise: boolean;   // EPS reported > EPS expected
  revenue_growth_qoq: number;   // Quarter-over-Quarter %
  meets_growth_threshold: boolean; // Growth > 20%
  sentiment_score: number;      // NLP sentiment 0-1
  market_cap: number;
  earnings_status: string;
  guidance: string;
}

// 4. Actual Game Changer (Catalyst & RVOL)
export interface Catalyst extends ParameterScore {
  present: boolean;
  has_catalyst: boolean;
  rvol: number;                 // Relative Volume (vs 30-day avg)
  rvol_threshold_met: boolean;  // RVOL >= 1.5
  catalyst_keywords: string[];  // Detected keywords
  catalyst_type: string;
  strength: string;
  timeframe: string;
}

// 5. Patterns & Gaps
export interface PatternsGaps extends ParameterScore {
  pattern: PatternType | string;
  gap_detected: boolean;
  gap_percent: number;          // Gap size in %
  bull_flag_detected: boolean;
  pole_gain: number;            // Bull flag pole % gain
  consolidation_days: number;   // Days in consolidation
  gap_status: string;
}

// 6. Support, Resistance & Stabilizations
export interface SupportResistance extends ParameterScore {
  support_zones: number[];
  resistance_zones: number[];
  near_ema20: boolean;          // Within 2-3% of 20 EMA
  near_ema50: boolean;          // Within 2-3% of 50 EMA
  swing_low: number;            // Lowest low of last 10 days
  atr: number;                  // Average True Range
  stop_loss_level: number;      // Swing Low - 1% ATR
  take_profit_level: number;    // Entry + 2x Risk
  risk_reward_ratio: number;    // Calculated R:R
  rr_passes: boolean;           // R:R > 2.0
}

// 7. Price Action (Trend Structure)
export interface PriceMovement extends ParameterScore {
  trend: TrendStatus;
  recent_higher_lows: boolean;
  recent_higher_highs: boolean;
  hammer_detected: boolean;     // Reversal candle at support
  candle_confirmation: string;  // Hammer, Engulfing, etc.
}

// 8. Volume (The "Lie Detector")
export interface Volume extends ParameterScore {
  status: string;
  volume_trend: string;
  current_volume: number;
  avg_volume: number;
  accumulation_days: number;    // Green days with above-avg volume
  distribution_days: number;    // Red days with below-avg volume
  volume_sma5_rising: boolean;  // 5-day volume SMA trending up
  volume_confirms: boolean;     // Overall confirmation
}

// 9. Averages & Fibonacci
export interface MAFibonacci extends ParameterScore {
  ma_20: number;
  ma_50: number;
  ma_100: number;
  ma_200: number;
  ema_8: number;
  ema_20: number;
  alignment: string;
  price_above_200sma: boolean;
  price_above_20ema: boolean;
  fib_levels: {
    level_382: number;
    level_500: number;
    level_618: number;
  };
  in_fib_buy_zone: boolean;     // Price at 0.382, 0.5, or 0.618
  fib_level_current: string;
}

// 10. RSI (Relative Strength Index)
export interface RSI extends ParameterScore {
  value: number;
  status: MomentumStatus;
  in_bull_range: boolean;       // RSI between 40-90
  dip_buy_signal: boolean;      // RSI touched 40-50 and bouncing
  positive_momentum: boolean;   // RSI > 50
  overextended: boolean;        // RSI > 75 (caution)
  optimal_range: boolean;       // RSI between 45-70
}

// 11. Soft Signals (Insider + Congress Trades from Quiver Quantitative)
export type SoftSignalStrength = 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';

export interface SoftSignals extends ParameterScore {
  insider_buys: number;
  insider_sells: number;
  insider_buy_ratio: number;
  insider_net_value: number;
  insider_top_buyer: string | null;
  insider_recent: boolean;      // Activity in last 30 days
  congress_buys: number;
  congress_sells: number;
  congress_bipartisan: boolean; // Both parties buying
  congress_recent: boolean;     // Activity in last 30 days
  signal_strength: SoftSignalStrength;
}

export interface AnalysisParameters {
  "1_market_condition": MarketCondition;
  "2_sector_condition": SectorCondition;
  "3_company_condition": CompanyCondition;
  "4_catalyst": Catalyst;
  "5_patterns_gaps": PatternsGaps;
  "6_support_resistance": SupportResistance;
  "7_price_movement": PriceMovement;
  "8_volume": Volume;
  "9_ma_fibonacci": MAFibonacci;
  "10_rsi": RSI;
  "11_soft_signals": SoftSignals;
}

export interface TakeProfitLevel {
  batch: number;
  quantity_percent: number;
  target_price: number;
  rationale: string;
}

export interface TradingPlan {
  signal: string;
  entry: {
    method: string;
    primary_price: number;
    secondary_price?: number;
    rationale: string;
  };
  stop_loss: {
    price: number;
    rationale: string;
    position_above_sl_percentage: number;
  };
  risk_reward_ratio: string; // e.g. "1.0 / 2.2"
  take_profit_levels: TakeProfitLevel[];
  total_tp_average: number;
  profit_if_hits_average_tp: number;
  profit_percentage: number;
  
  // Position sizing (optional - requires portfolio context)
  position_sizing?: {
    recommended_shares: number;
    position_risk_dollars: number;
    portfolio_risk_percent: number;
    position_value: number;
    max_position_value?: number;
    sizing_method: 'FIXED_RISK' | 'KELLY' | 'REGIME_ADJUSTED';
    warnings?: string[];
  };
}

export interface RiskAnalysis {
  downside_risk: string;
  risk_per_unit: number;
  max_loss_percentage: number;
  volatility_assessment: string;
  key_risk_factors: string[];
}

export interface QualitativeAssessment {
  setup_quality: string;
  setup_description: string;
  follow_through_probability: string;
  next_catalyst: string;
  monitoring_points: string[];
}

// Veto System (ML-based timing filter)
export interface VetoAnalysis {
  vetoed: boolean;
  pLoss: number;              // P(loss) from ML model
  pWin: number;               // P(win) = 1 - pLoss
  verdict: 'PROCEED' | 'CAUTION' | 'VETO';
  confidence: 'low' | 'medium' | 'high' | 'very_high';
  reasons: string[];
}

export interface AnalysisResult {
  ticker: string;
  timestamp: string;
  current_price: number;
  timeframe: string;
  trade_type: TradeType;
  parameters: AnalysisParameters;
  success_probability: number;
  confidence_rating: string;
  recommendation: string;
  trading_plan: TradingPlan;

  // ML-based Veto System (replaces heuristics for timing)
  veto_analysis?: VetoAnalysis;
  risk_analysis: RiskAnalysis;
  qualitative_assessment: QualitativeAssessment;
  disclaimers: string[];
  chart_data: {
    date: string;
    price: number;
    sma20?: number;
    sma50?: number;
    ema8?: number;
  }[];
  
  // Phase 1: Market Regime Context
  market_regime?: {
    regime: 'BULL' | 'CHOPPY' | 'CRASH';
    confidence: number;
    details: {
      spyAbove50SMA: boolean;
      spyAbove200SMA: boolean;
      vixLevel: number;
      trendStrength: number;
      volatilityEnvironment: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
    };
  };
  regime_thresholds?: {
    minEntryScore: number;
    minRRRatio: number;
    requireVolumeConfirm: boolean;
    requireMultiTimeframe: boolean;
    allowShorts: boolean;
    description: string;
  };
  regime_adjusted?: boolean;
  original_score?: number; // Score before regime adjustment
  
  // Phase 2: Multi-Timeframe Analysis
  multi_timeframe?: {
    daily_score: number;
    hour4_score: number;
    combined_score: number;
    alignment: 'STRONG_BUY' | 'BUY' | 'CONSIDER' | 'SKIP';
    macd_4h_status: 'POSITIVE' | 'TURNING_POSITIVE' | 'NEGATIVE';
    rsi_4h: number;
    resistance_4h: number;
    support_4h: number;
  };
  
  // Phase 3: Volume Profile (enhanced)
  volume_profile?: {
    rvol: number;
    obv_trending: boolean;
    obv_value: number;
    cmf_value: number;
    cmf_positive: boolean;
    interpretation: string;
  };
  
  // Phase 4: Divergence Detection
  divergence?: {
    type: 'REGULAR_BULLISH' | 'REGULAR_BEARISH' | 'HIDDEN_BULLISH' | 'HIDDEN_BEARISH' | 'NONE';
    indicator: 'RSI' | 'MACD';
    strength: number;
    implication: 'ENTRY_SIGNAL' | 'EXIT_SIGNAL' | 'NEUTRAL';
  };
  adaptive_rsi?: {
    value: number;
    oversold_threshold: number;
    overbought_threshold: number;
    in_optimal_range: boolean;
  };
}

// Portfolio & Watchlist Types
export type PortfolioAction = 
  | 'HOLD'
  | 'TAKE_PROFIT'      // In profit, good time to sell some
  | 'SELL_ALL'         // Hit major target or should exit completely  
  | 'ADD_MORE'         // Good setup, price dipped - average down
  | 'STOP_LOSS'        // Hit stop loss level, exit to limit losses
  | 'CUT_LOSS';        // Position deteriorated, consider exiting

// Track sells at each price level
export interface PriceLevelSell {
  shares_sold: number;
  sell_price: number;
  sell_date: string;
}

export interface PositionSells {
  stop_loss?: PriceLevelSell;
  pt1?: PriceLevelSell;
  pt2?: PriceLevelSell;
  pt3?: PriceLevelSell;
}

export interface PortfolioPosition {
  id: string;
  user_id: string;
  ticker: string;
  buy_price: number;
  quantity: number;
  date_added: string;
  notes?: string;
  // Track partial sells at different price levels (stored as JSON in DB)
  sells?: PositionSells;
  // Computed fields (not stored in DB)
  current_price?: number;
  action?: PortfolioAction;
  profit_loss?: number;
  profit_loss_percent?: number;
  analysis?: AnalysisResult;
  remaining_shares?: number;
}

// Watchlist source tracking
export type WatchlistSource = 'manual' | 'politician_trading' | 'insider_activity' | 'scanner';

export interface WatchlistItem {
  id: string;
  user_id: string;
  ticker: string;
  date_added: string;
  notes?: string;
  source?: WatchlistSource;  // Where this item came from
  // Computed fields
  current_price?: number;
  score?: number;
  is_good_entry?: boolean;
  analysis?: AnalysisResult;
  // Staleness tracking (computed from date_added)
  days_in_watchlist?: number;    // Days since added
  staleness_percent?: number;    // 0-100, capped at 100 for 45+ days
}
