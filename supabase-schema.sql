-- SwingTrade Pro Database Schema
-- Run this SQL in your Supabase SQL Editor

-- Portfolio table (allows multiple entries per ticker for DCA/multiple purchases)
CREATE TABLE portfolios (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  ticker VARCHAR(10) NOT NULL,
  buy_price DECIMAL(10,2) NOT NULL,
  quantity DECIMAL(10,4) NOT NULL,
  date_added TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  notes TEXT
);

-- Watchlist table
CREATE TABLE watchlists (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  ticker VARCHAR(10) NOT NULL,
  date_added TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  notes TEXT,
  UNIQUE(user_id, ticker)
);

-- Enable Row Level Security
ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;

-- Portfolio policies - users can only access their own data
CREATE POLICY "Users can view own portfolio" ON portfolios
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own portfolio" ON portfolios
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own portfolio" ON portfolios
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own portfolio" ON portfolios
  FOR DELETE USING (auth.uid() = user_id);

-- Watchlist policies - users can only access their own data
CREATE POLICY "Users can view own watchlist" ON watchlists
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own watchlist" ON watchlists
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own watchlist" ON watchlists
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own watchlist" ON watchlists
  FOR DELETE USING (auth.uid() = user_id);

-- Create indexes for better query performance
CREATE INDEX idx_portfolios_user_id ON portfolios(user_id);
CREATE INDEX idx_watchlists_user_id ON watchlists(user_id);

