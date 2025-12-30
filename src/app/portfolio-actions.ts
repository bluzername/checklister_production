'use server';

import { createClient, isSupabaseConfigured } from '@/lib/supabase/server';
import { analyzeTicker } from '@/lib/analysis';
import { PortfolioPosition, PortfolioAction, AnalysisResult, PositionSells, PriceLevelSell } from '@/lib/types';
import {
  getCachedAnalysis,
  setCachedAnalysis,
  markCacheRefreshing,
  invalidateCache
} from '@/lib/portfolio/cache';
import { logPortfolioOperation, updateActivityOutcome } from '@/lib/activity-logger';

export type SellPriceLevel = 'stop_loss' | 'pt1' | 'pt2' | 'pt3';

export async function getPortfolio(): Promise<{ success: boolean; data?: PortfolioPosition[]; error?: string }> {
    try {
        if (!isSupabaseConfigured()) {
            return { success: false, error: 'Database not configured' };
        }
        const supabase = await createClient();
        
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, error: 'Not authenticated' };
        }

        const { data, error } = await supabase
            .from('portfolios')
            .select('*')
            .eq('user_id', user.id)
            .order('date_added', { ascending: false });

        if (error) {
            return { success: false, error: error.message };
        }

        return { success: true, data: data as PortfolioPosition[] };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

export async function addPosition(
    ticker: string,
    buyPrice: number,
    quantity: number,
    notes?: string
): Promise<{ success: boolean; data?: PortfolioPosition; error?: string }> {
    try {
        if (!isSupabaseConfigured()) {
            return { success: false, error: 'Database not configured' };
        }
        const supabase = await createClient();

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, error: 'Not authenticated' };
        }

        const { data, error } = await supabase
            .from('portfolios')
            .insert({
                user_id: user.id,
                ticker: ticker.toUpperCase(),
                buy_price: buyPrice,
                quantity: quantity,
                notes: notes || null,
            })
            .select()
            .single();

        if (error) {
            return { success: false, error: error.message };
        }

        // Invalidate cache when position is added
        invalidateCache(user.id);

        // Log the ADD_POSITION operation with full context
        // Fetch current analysis to capture algorithm state at time of entry
        let analysis: AnalysisResult | null = null;
        try {
            analysis = await analyzeTicker(ticker.toUpperCase());
        } catch {
            // Analysis failed, but we still log the operation
            console.log(`[Portfolio] Could not fetch analysis for ${ticker} during logging`);
        }

        // Fire-and-forget logging (non-blocking)
        logPortfolioOperation(
            user.id,
            'ADD_POSITION',
            ticker.toUpperCase(),
            {
                position_id: data.id,
                buy_price: buyPrice,
                quantity: quantity,
                notes: notes,
            },
            analysis,
            analysis?.recommendation
        ).catch(err => console.error('[Portfolio] Logging error:', err));

        return { success: true, data: data as PortfolioPosition };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

export async function deletePosition(id: string): Promise<{ success: boolean; error?: string }> {
    try {
        if (!isSupabaseConfigured()) {
            return { success: false, error: 'Database not configured' };
        }
        const supabase = await createClient();

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, error: 'Not authenticated' };
        }

        // Fetch position details before deletion for logging
        const { data: position } = await supabase
            .from('portfolios')
            .select('*')
            .eq('id', id)
            .eq('user_id', user.id)
            .single();

        const { error } = await supabase
            .from('portfolios')
            .delete()
            .eq('id', id)
            .eq('user_id', user.id);

        if (error) {
            return { success: false, error: error.message };
        }

        // Invalidate cache when position is deleted
        invalidateCache(user.id);

        // Log the DELETE_POSITION operation with outcome tracking
        if (position) {
            let analysis: AnalysisResult | null = null;
            try {
                analysis = await analyzeTicker(position.ticker);
            } catch {
                // Analysis failed, continue with logging
            }

            // Calculate realized P/L for outcome tracking
            const currentPrice = analysis?.current_price;
            let realizedPnl: number | undefined;
            let realizedPnlPercent: number | undefined;
            let outcomeStatus: 'WIN' | 'LOSS' | 'CANCELLED' = 'CANCELLED';

            if (currentPrice && position.buy_price) {
                realizedPnl = (currentPrice - position.buy_price) * position.quantity;
                realizedPnlPercent = ((currentPrice - position.buy_price) / position.buy_price) * 100;
                outcomeStatus = realizedPnl >= 0 ? 'WIN' : 'LOSS';
            }

            // Log the deletion
            logPortfolioOperation(
                user.id,
                'DELETE_POSITION',
                position.ticker,
                {
                    position_id: id,
                    buy_price: position.buy_price,
                    quantity: position.quantity,
                    notes: `Deleted with P/L: ${realizedPnlPercent?.toFixed(2) ?? 'N/A'}%`,
                },
                analysis
            ).catch(err => console.error('[Portfolio] Logging error:', err));

            // Update the original ADD_POSITION entry with outcome
            if (currentPrice) {
                updateActivityOutcome(id, {
                    outcome_price: currentPrice,
                    outcome_date: new Date(),
                    realized_pnl: realizedPnl ?? 0,
                    realized_pnl_percent: realizedPnlPercent ?? 0,
                    outcome_status: outcomeStatus,
                }).catch(err => console.error('[Portfolio] Outcome update error:', err));
            }
        }

        return { success: true };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

export async function recordSellAtPrice(
    positionId: string,
    priceLevel: SellPriceLevel,
    sharesSold: number,
    sellPrice: number
): Promise<{ success: boolean; error?: string }> {
    try {
        if (!isSupabaseConfigured()) {
            return { success: false, error: 'Database not configured' };
        }
        const supabase = await createClient();
        
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, error: 'Not authenticated' };
        }

        // Get current position
        const { data: position, error: fetchError } = await supabase
            .from('portfolios')
            .select('*')
            .eq('id', positionId)
            .eq('user_id', user.id)
            .single();

        if (fetchError || !position) {
            return { success: false, error: fetchError?.message || 'Position not found' };
        }

        // Calculate remaining shares
        const currentSells: PositionSells = position.sells || {};
        const totalSold = 
            (currentSells.stop_loss?.shares_sold || 0) +
            (currentSells.pt1?.shares_sold || 0) +
            (currentSells.pt2?.shares_sold || 0) +
            (currentSells.pt3?.shares_sold || 0);
        
        const remainingShares = position.quantity - totalSold;
        
        if (sharesSold > remainingShares) {
            return { success: false, error: `Cannot sell more than ${remainingShares} remaining shares` };
        }

        // Create the new sell record
        const sellRecord: PriceLevelSell = {
            shares_sold: sharesSold,
            sell_price: sellPrice,
            sell_date: new Date().toISOString()
        };

        // Merge with existing sells (accumulate if already sold at this level)
        const existingSell = currentSells[priceLevel];
        if (existingSell) {
            sellRecord.shares_sold += existingSell.shares_sold;
        }

        const updatedSells: PositionSells = {
            ...currentSells,
            [priceLevel]: sellRecord
        };

        // Update the position
        const { error: updateError } = await supabase
            .from('portfolios')
            .update({ sells: updatedSells })
            .eq('id', positionId)
            .eq('user_id', user.id);

        if (updateError) {
            return { success: false, error: updateError.message };
        }

        // Invalidate cache when sells are recorded
        invalidateCache(user.id);

        // Log the RECORD_SELL operation with full context
        let analysis: AnalysisResult | null = null;
        try {
            analysis = await analyzeTicker(position.ticker);
        } catch {
            // Analysis failed, continue with logging
        }

        // Calculate P/L for this specific sell
        const sellPnl = (sellPrice - position.buy_price) * sharesSold;
        const sellPnlPercent = ((sellPrice - position.buy_price) / position.buy_price) * 100;

        logPortfolioOperation(
            user.id,
            'RECORD_SELL',
            position.ticker,
            {
                position_id: positionId,
                buy_price: position.buy_price,
                quantity: position.quantity,
                sell_price: sellPrice,
                shares_sold: sharesSold,
                price_level: priceLevel,
                notes: `Sold ${sharesSold} shares at ${priceLevel.toUpperCase()} for $${sellPrice} (P/L: ${sellPnlPercent.toFixed(2)}%)`,
            },
            analysis
        ).catch(err => console.error('[Portfolio] Logging error:', err));

        return { success: true };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

function computeAction(
    position: PortfolioPosition,
    analysis: AnalysisResult
): PortfolioAction {
    const { current_price, success_probability } = analysis;
    const { buy_price } = position;
    
    // Calculate P/L percentage from entry
    const plPercent = ((current_price - buy_price) / buy_price) * 100;
    const isInProfit = plPercent > 0;
    const isInLoss = plPercent < 0;
    
    // === PROFIT SCENARIOS ===
    
    // Big winner: Up 25%+ → Take profits
    if (plPercent >= 25) {
        return 'SELL_ALL';
    }
    
    // Good profit: Up 10-25% → Consider taking some off
    if (plPercent >= 10) {
        return 'TAKE_PROFIT';
    }
    
    // Small profit with weakening setup → Take profit before it reverses
    if (isInProfit && plPercent >= 5 && success_probability < 50) {
        return 'TAKE_PROFIT';
    }
    
    // === LOSS SCENARIOS ===
    
    // Severe loss: Down 20%+ with weak analysis → Cut losses
    if (plPercent <= -20 && success_probability < 50) {
        return 'CUT_LOSS';
    }
    
    // Stop loss hit: Down 15%+ with very weak analysis → Exit
    if (plPercent <= -15 && success_probability < 40) {
        return 'STOP_LOSS';
    }
    
    // Down but setup still good: Consider averaging down
    if (isInLoss && plPercent <= -5 && success_probability >= 70) {
        return 'ADD_MORE';
    }
    
    // Down with okay setup: Just hold
    if (isInLoss && success_probability >= 50) {
        return 'HOLD';
    }
    
    // Down with weak setup but not severe: Hold but watch closely
    if (isInLoss && success_probability < 50 && plPercent > -15) {
        return 'HOLD'; // Could add a 'WATCH' status later
    }
    
    // === DEFAULT ===
    return 'HOLD';
}

export async function analyzePortfolio(): Promise<{ 
    success: boolean; 
    data?: PortfolioPosition[]; 
    error?: string 
}> {
    try {
        if (!isSupabaseConfigured()) {
            return { success: false, error: 'Database not configured' };
        }
        const supabase = await createClient();
        
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, error: 'Not authenticated' };
        }

        const { data: positions, error } = await supabase
            .from('portfolios')
            .select('*')
            .eq('user_id', user.id)
            .order('date_added', { ascending: false });

        if (error) {
            return { success: false, error: error.message };
        }

        if (!positions || positions.length === 0) {
            return { success: true, data: [] };
        }

        // Analyze each position
        const analyzedPositions: PortfolioPosition[] = await Promise.all(
            positions.map(async (position) => {
                try {
                    const analysis = await analyzeTicker(position.ticker);
                    const action = computeAction(position as PortfolioPosition, analysis);
                    const profitLoss = analysis.current_price - position.buy_price;
                    const profitLossPercent = ((analysis.current_price - position.buy_price) / position.buy_price) * 100;

                    // Calculate remaining shares
                    const sells: PositionSells = position.sells || {};
                    const totalSold = 
                        (sells.stop_loss?.shares_sold || 0) +
                        (sells.pt1?.shares_sold || 0) +
                        (sells.pt2?.shares_sold || 0) +
                        (sells.pt3?.shares_sold || 0);
                    const remaining_shares = position.quantity - totalSold;

                    return {
                        ...position,
                        current_price: analysis.current_price,
                        action,
                        profit_loss: profitLoss,
                        profit_loss_percent: profitLossPercent,
                        analysis,
                        remaining_shares,
                    } as PortfolioPosition;
                } catch {
                    // If analysis fails, return position without analysis
                    const sells: PositionSells = position.sells || {};
                    const totalSold = 
                        (sells.stop_loss?.shares_sold || 0) +
                        (sells.pt1?.shares_sold || 0) +
                        (sells.pt2?.shares_sold || 0) +
                        (sells.pt3?.shares_sold || 0);
                    return {
                        ...position,
                        remaining_shares: position.quantity - totalSold,
                    } as PortfolioPosition;
                }
            })
        );

        return { success: true, data: analyzedPositions };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

export async function analyzePosition(id: string): Promise<{
    success: boolean;
    data?: PortfolioPosition;
    error?: string;
}> {
    try {
        if (!isSupabaseConfigured()) {
            return { success: false, error: 'Database not configured' };
        }
        const supabase = await createClient();
        
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, error: 'Not authenticated' };
        }

        const { data: position, error } = await supabase
            .from('portfolios')
            .select('*')
            .eq('id', id)
            .eq('user_id', user.id)
            .single();

        if (error || !position) {
            return { success: false, error: error?.message || 'Position not found' };
        }

        const analysis = await analyzeTicker(position.ticker);
        const action = computeAction(position as PortfolioPosition, analysis);
        const profitLoss = analysis.current_price - position.buy_price;
        const profitLossPercent = ((analysis.current_price - position.buy_price) / position.buy_price) * 100;

        // Calculate remaining shares
        const sells: PositionSells = position.sells || {};
        const totalSold = 
            (sells.stop_loss?.shares_sold || 0) +
            (sells.pt1?.shares_sold || 0) +
            (sells.pt2?.shares_sold || 0) +
            (sells.pt3?.shares_sold || 0);
        const remaining_shares = position.quantity - totalSold;

        return {
            success: true,
            data: {
                ...position,
                current_price: analysis.current_price,
                action,
                profit_loss: profitLoss,
                profit_loss_percent: profitLossPercent,
                analysis,
                remaining_shares,
            } as PortfolioPosition,
        };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

/**
 * Cached portfolio analysis - returns cached data if fresh, otherwise fetches new data.
 * Cache is valid for 15 minutes or until positions change.
 */
export async function analyzePortfolioCached(forceRefresh = false): Promise<{
    success: boolean;
    data?: PortfolioPosition[];
    error?: string;
    fromCache: boolean;
    lastUpdated: number | null;
    isStale: boolean;
}> {
    try {
        if (!isSupabaseConfigured()) {
            return { success: false, error: 'Database not configured', fromCache: false, lastUpdated: null, isStale: false };
        }
        const supabase = await createClient();

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, error: 'Not authenticated', fromCache: false, lastUpdated: null, isStale: false };
        }

        // Fetch raw positions from DB (fast)
        const { data: rawPositions, error } = await supabase
            .from('portfolios')
            .select('*')
            .eq('user_id', user.id)
            .order('date_added', { ascending: false });

        if (error) {
            return { success: false, error: error.message, fromCache: false, lastUpdated: null, isStale: false };
        }

        if (!rawPositions || rawPositions.length === 0) {
            return { success: true, data: [], fromCache: false, lastUpdated: null, isStale: false };
        }

        // Check cache
        const { cached, isStale, lastUpdated } = getCachedAnalysis(user.id, rawPositions);

        // Return cached data if fresh and not forcing refresh
        if (cached && !isStale && !forceRefresh) {
            return {
                success: true,
                data: cached,
                fromCache: true,
                lastUpdated,
                isStale: false
            };
        }

        // Mark as refreshing to prevent duplicate refreshes
        markCacheRefreshing(user.id, true);

        try {
            // Analyze each position (the slow part)
            const analyzedPositions: PortfolioPosition[] = await Promise.all(
                rawPositions.map(async (position) => {
                    try {
                        const analysis = await analyzeTicker(position.ticker);
                        const action = computeAction(position as PortfolioPosition, analysis);
                        const profitLoss = analysis.current_price - position.buy_price;
                        const profitLossPercent = ((analysis.current_price - position.buy_price) / position.buy_price) * 100;

                        // Calculate remaining shares
                        const sells: PositionSells = position.sells || {};
                        const totalSold =
                            (sells.stop_loss?.shares_sold || 0) +
                            (sells.pt1?.shares_sold || 0) +
                            (sells.pt2?.shares_sold || 0) +
                            (sells.pt3?.shares_sold || 0);
                        const remaining_shares = position.quantity - totalSold;

                        return {
                            ...position,
                            current_price: analysis.current_price,
                            action,
                            profit_loss: profitLoss,
                            profit_loss_percent: profitLossPercent,
                            analysis,
                            remaining_shares,
                        } as PortfolioPosition;
                    } catch {
                        // If analysis fails, return position without analysis
                        const sells: PositionSells = position.sells || {};
                        const totalSold =
                            (sells.stop_loss?.shares_sold || 0) +
                            (sells.pt1?.shares_sold || 0) +
                            (sells.pt2?.shares_sold || 0) +
                            (sells.pt3?.shares_sold || 0);
                        return {
                            ...position,
                            remaining_shares: position.quantity - totalSold,
                        } as PortfolioPosition;
                    }
                })
            );

            // Update cache
            setCachedAnalysis(user.id, analyzedPositions, rawPositions);

            return {
                success: true,
                data: analyzedPositions,
                fromCache: false,
                lastUpdated: Date.now(),
                isStale: false
            };
        } finally {
            markCacheRefreshing(user.id, false);
        }
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            fromCache: false,
            lastUpdated: null,
            isStale: false
        };
    }
}

