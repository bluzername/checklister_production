-- Migration: Add source column to watchlists table
-- This tracks where watchlist items came from (manual, politician_trading, insider_activity, scanner)

-- Add source column with default 'manual' for existing entries
ALTER TABLE watchlists
ADD COLUMN source TEXT DEFAULT 'manual';

-- Create index for efficient filtering by source
CREATE INDEX idx_watchlists_source ON watchlists(source);

-- Ensure all existing entries have 'manual' as source
UPDATE watchlists SET source = 'manual' WHERE source IS NULL;
