-- Migration: Create user_activity_logs table
-- Purpose: Track all user operations for performance analysis and algorithm evaluation
--
-- INSTRUCTIONS:
-- 1. Go to your Supabase Dashboard
-- 2. Navigate to SQL Editor
-- 3. Run this entire script
--
-- This creates a comprehensive logging table for:
-- - Portfolio operations (add position, delete position, record sells)
-- - Watchlist operations (add to watchlist, remove from watchlist)
-- - Analysis requests (analyze ticker, analyze portfolio, analyze watchlist)
-- - Algorithm recommendations at the time of each action

-- ============================================
-- USER ACTIVITY LOGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS user_activity_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Core identifiers
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Operation details
  operation VARCHAR(50) NOT NULL,  -- ADD_POSITION, DELETE_POSITION, RECORD_SELL, ADD_WATCHLIST, REMOVE_WATCHLIST, ANALYZE_TICKER, etc.
  category VARCHAR(20) NOT NULL,   -- PORTFOLIO, WATCHLIST, ANALYSIS
  ticker VARCHAR(20),

  -- Position/Trade details (for portfolio operations)
  position_id UUID,
  buy_price DECIMAL(12,4),
  quantity DECIMAL(12,4),
  sell_price DECIMAL(12,4),
  shares_sold DECIMAL(12,4),
  price_level VARCHAR(20),         -- stop_loss, pt1, pt2, pt3

  -- Market context at time of operation
  market_price DECIMAL(12,4),      -- Current market price at time of action

  -- Algorithm context (what the system recommended at the time)
  algorithm_context JSONB DEFAULT '{}',  -- Full analysis snapshot
  success_probability DECIMAL(5,2),
  trade_type VARCHAR(20),          -- SWING_LONG, SWING_SHORT, HOLD, AVOID
  recommended_action VARCHAR(50),  -- HOLD, TAKE_PROFIT, SELL_ALL, ADD_MORE, STOP_LOSS, CUT_LOSS

  -- Trading plan at time of action
  trading_plan JSONB DEFAULT '{}', -- Entry, stop loss, take profit levels

  -- Veto analysis (if applicable)
  veto_analysis JSONB DEFAULT '{}',
  was_vetoed BOOLEAN DEFAULT false,
  veto_probability DECIMAL(5,4),

  -- Technical indicators at time of action
  rsi_value DECIMAL(5,2),
  atr_percent DECIMAL(8,4),
  rvol DECIMAL(8,4),
  market_regime VARCHAR(20),       -- BULL, CHOPPY, CRASH

  -- User notes
  notes TEXT,

  -- Outcome tracking (filled later for performance analysis)
  outcome_price DECIMAL(12,4),     -- Price when position was closed
  outcome_date TIMESTAMPTZ,
  realized_pnl DECIMAL(12,4),
  realized_pnl_percent DECIMAL(8,4),
  outcome_status VARCHAR(20),      -- WIN, LOSS, OPEN, CANCELLED

  -- Metadata
  session_id UUID,                 -- Track actions within same session
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX IF NOT EXISTS idx_activity_user_id ON user_activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON user_activity_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_activity_ticker ON user_activity_logs(ticker);
CREATE INDEX IF NOT EXISTS idx_activity_operation ON user_activity_logs(operation);
CREATE INDEX IF NOT EXISTS idx_activity_category ON user_activity_logs(category);
CREATE INDEX IF NOT EXISTS idx_activity_user_ticker ON user_activity_logs(user_id, ticker);
CREATE INDEX IF NOT EXISTS idx_activity_user_timestamp ON user_activity_logs(user_id, timestamp DESC);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE user_activity_logs ENABLE ROW LEVEL SECURITY;

-- Users can view their own activity logs
CREATE POLICY "Users can view own activity logs" ON user_activity_logs
  FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);

-- Allow inserts from authenticated users and service role
CREATE POLICY "Users can insert own activity logs" ON user_activity_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- Service role can manage all logs (for admin analytics)
CREATE POLICY "Service role can manage activity logs" ON user_activity_logs
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- HELPER FUNCTION: Clean up old logs (keep 1 year)
-- ============================================
CREATE OR REPLACE FUNCTION cleanup_old_activity_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM user_activity_logs WHERE timestamp < NOW() - INTERVAL '365 days';
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- VIEWS FOR ANALYTICS
-- ============================================

-- Performance summary by ticker
CREATE OR REPLACE VIEW user_performance_by_ticker AS
SELECT
  user_id,
  ticker,
  COUNT(*) FILTER (WHERE operation = 'ADD_POSITION') as positions_opened,
  COUNT(*) FILTER (WHERE operation = 'RECORD_SELL') as sells_recorded,
  COUNT(*) FILTER (WHERE operation = 'DELETE_POSITION') as positions_closed,
  AVG(success_probability) as avg_algo_probability,
  AVG(realized_pnl_percent) FILTER (WHERE outcome_status IS NOT NULL) as avg_realized_pnl,
  COUNT(*) FILTER (WHERE outcome_status = 'WIN') as wins,
  COUNT(*) FILTER (WHERE outcome_status = 'LOSS') as losses,
  SUM(realized_pnl) FILTER (WHERE outcome_status IS NOT NULL) as total_pnl
FROM user_activity_logs
WHERE category = 'PORTFOLIO'
GROUP BY user_id, ticker;

-- Algorithm recommendation accuracy
CREATE OR REPLACE VIEW algorithm_accuracy AS
SELECT
  DATE_TRUNC('month', timestamp) as month,
  trade_type,
  recommended_action,
  COUNT(*) as total_recommendations,
  AVG(success_probability) as avg_probability,
  COUNT(*) FILTER (WHERE outcome_status = 'WIN') as actual_wins,
  COUNT(*) FILTER (WHERE outcome_status = 'LOSS') as actual_losses,
  CASE
    WHEN COUNT(*) FILTER (WHERE outcome_status IS NOT NULL) > 0
    THEN COUNT(*) FILTER (WHERE outcome_status = 'WIN')::DECIMAL /
         COUNT(*) FILTER (WHERE outcome_status IS NOT NULL)
    ELSE NULL
  END as actual_win_rate
FROM user_activity_logs
WHERE category = 'PORTFOLIO' AND operation = 'ADD_POSITION'
GROUP BY DATE_TRUNC('month', timestamp), trade_type, recommended_action;

-- Veto system effectiveness
CREATE OR REPLACE VIEW veto_effectiveness AS
SELECT
  DATE_TRUNC('month', timestamp) as month,
  was_vetoed,
  COUNT(*) as total_trades,
  AVG(veto_probability) as avg_veto_probability,
  COUNT(*) FILTER (WHERE outcome_status = 'WIN') as wins,
  COUNT(*) FILTER (WHERE outcome_status = 'LOSS') as losses,
  AVG(realized_pnl_percent) FILTER (WHERE outcome_status IS NOT NULL) as avg_pnl
FROM user_activity_logs
WHERE category = 'PORTFOLIO' AND operation = 'ADD_POSITION'
GROUP BY DATE_TRUNC('month', timestamp), was_vetoed;

-- ============================================
-- Verification query
-- ============================================
SELECT
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'user_activity_logs') as column_count
FROM information_schema.tables
WHERE table_name = 'user_activity_logs';
