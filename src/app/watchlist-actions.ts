'use server';

import { createClient, isSupabaseConfigured } from '@/lib/supabase/server';
import { analyzeTicker } from '@/lib/analysis';
import { WatchlistItem, AnalysisResult } from '@/lib/types';

// Batch size for parallel processing - limits concurrent API calls to avoid rate limiting
// Increased to 20 for faster analysis since FMP has generous rate limits (300/min)
const ANALYSIS_BATCH_SIZE = 20;

// Staleness configuration
const MAX_WATCHLIST_DAYS = 45; // Auto-remove after 45 days

/**
 * Calculate staleness metrics from date_added
 */
function calculateStaleness(dateAdded: string): { days: number; percent: number } {
    const days = Math.floor((Date.now() - new Date(dateAdded).getTime()) / (1000 * 60 * 60 * 24));
    const percent = Math.min(100, Math.round((days / MAX_WATCHLIST_DAYS) * 100));
    return { days, percent };
}

/**
 * Add staleness fields to a watchlist item
 */
function addStalenessFields<T extends { date_added: string }>(item: T): T & { days_in_watchlist: number; staleness_percent: number } {
    const { days, percent } = calculateStaleness(item.date_added);
    return {
        ...item,
        days_in_watchlist: days,
        staleness_percent: percent,
    };
}

/**
 * Process items in batches to avoid rate limiting while maintaining good performance.
 * Processes BATCH_SIZE items in parallel, then waits before the next batch.
 */
async function processInBatches<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    batchSize: number = ANALYSIS_BATCH_SIZE
): Promise<R[]> {
    const results: R[] = [];

    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(processor));
        results.push(...batchResults);

        // Small delay between batches to avoid rate limiting
        if (i + batchSize < items.length) {
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }

    return results;
}

export async function getWatchlist(): Promise<{ success: boolean; data?: WatchlistItem[]; error?: string }> {
    try {
        if (!isSupabaseConfigured()) {
            return { success: false, error: 'Database not configured' };
        }
        const supabase = await createClient();

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, error: 'Not authenticated' };
        }

        // Calculate cutoff date for 45-day max
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - MAX_WATCHLIST_DAYS);

        const { data, error } = await supabase
            .from('watchlists')
            .select('*')
            .eq('user_id', user.id)
            .gte('date_added', cutoffDate.toISOString())
            .order('date_added', { ascending: false });

        if (error) {
            return { success: false, error: error.message };
        }

        // Add staleness fields to each item
        const itemsWithStaleness = (data || []).map(item => addStalenessFields(item) as WatchlistItem);

        return { success: true, data: itemsWithStaleness };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

export async function addToWatchlist(
    ticker: string,
    notes?: string
): Promise<{ success: boolean; data?: WatchlistItem; error?: string }> {
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
            .from('watchlists')
            .insert({
                user_id: user.id,
                ticker: ticker.toUpperCase(),
                notes: notes || null,
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') {
                return { success: false, error: 'This ticker is already in your watchlist' };
            }
            return { success: false, error: error.message };
        }

        // Analyze the newly added ticker immediately
        try {
            const analysis = await analyzeTicker(data.ticker);
            const itemWithStaleness = addStalenessFields(data);

            return {
                success: true,
                data: {
                    ...itemWithStaleness,
                    current_price: analysis.current_price,
                    score: analysis.success_probability,
                    is_good_entry: isGoodEntry(analysis),
                    analysis,
                } as WatchlistItem,
            };
        } catch {
            // If analysis fails, return item with staleness but without analysis
            return { success: true, data: addStalenessFields(data) as WatchlistItem };
        }
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

export async function removeFromWatchlist(id: string): Promise<{ success: boolean; error?: string }> {
    try {
        if (!isSupabaseConfigured()) {
            return { success: false, error: 'Database not configured' };
        }
        const supabase = await createClient();
        
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, error: 'Not authenticated' };
        }

        const { error } = await supabase
            .from('watchlists')
            .delete()
            .eq('id', id)
            .eq('user_id', user.id);

        if (error) {
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

function isGoodEntry(analysis: AnalysisResult): boolean {
    // Good entry if score is high and price is near support
    const { success_probability, parameters, current_price } = analysis;
    const supportZones = parameters['6_support_resistance'].support_zones;
    
    if (success_probability < 70) return false;
    
    // Check if current price is within 3% of any support zone
    const nearSupport = supportZones.some(support => {
        const diff = Math.abs(current_price - support) / support;
        return diff <= 0.03;
    });
    
    return nearSupport || success_probability >= 80;
}

export async function analyzeWatchlist(): Promise<{
    success: boolean;
    data?: WatchlistItem[];
    error?: string;
    expiring_count?: number;  // Items with 40+ days
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

        // Calculate cutoff date for 45-day max
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - MAX_WATCHLIST_DAYS);

        const { data: items, error } = await supabase
            .from('watchlists')
            .select('*')
            .eq('user_id', user.id)
            .gte('date_added', cutoffDate.toISOString())
            .order('date_added', { ascending: false });

        if (error) {
            return { success: false, error: error.message };
        }

        if (!items || items.length === 0) {
            return { success: true, data: [], expiring_count: 0 };
        }

        // Analyze watchlist items in batches to avoid rate limiting while maintaining performance
        const analyzedItems = await processInBatches(
            items,
            async (item) => {
                try {
                    const analysis = await analyzeTicker(item.ticker);
                    const itemWithStaleness = addStalenessFields(item);

                    return {
                        ...itemWithStaleness,
                        current_price: analysis.current_price,
                        score: analysis.success_probability,
                        is_good_entry: isGoodEntry(analysis),
                        analysis,
                    } as WatchlistItem;
                } catch {
                    // If analysis fails, return item with staleness but without analysis
                    return addStalenessFields(item) as WatchlistItem;
                }
            }
        );

        // Count items expiring soon (40+ days)
        const expiringCount = analyzedItems.filter(item => (item.days_in_watchlist || 0) >= 40).length;

        return { success: true, data: analyzedItems, expiring_count: expiringCount };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

export async function analyzeWatchlistItem(id: string): Promise<{
    success: boolean;
    data?: WatchlistItem;
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

        const { data: item, error } = await supabase
            .from('watchlists')
            .select('*')
            .eq('id', id)
            .eq('user_id', user.id)
            .single();

        if (error || !item) {
            return { success: false, error: error?.message || 'Item not found' };
        }

        const analysis = await analyzeTicker(item.ticker);

        return {
            success: true,
            data: {
                ...addStalenessFields(item),
                current_price: analysis.current_price,
                score: analysis.success_probability,
                is_good_entry: isGoodEntry(analysis),
                analysis,
            } as WatchlistItem,
        };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

export async function updateWatchlistDate(
    id: string,
    newDate?: Date
): Promise<{ success: boolean; data?: WatchlistItem; error?: string }> {
    try {
        if (!isSupabaseConfigured()) {
            return { success: false, error: 'Database not configured' };
        }
        const supabase = await createClient();

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, error: 'Not authenticated' };
        }

        // Use provided date or default to now (reset to today)
        const dateToSet = newDate || new Date();

        const { data, error } = await supabase
            .from('watchlists')
            .update({ date_added: dateToSet.toISOString() })
            .eq('id', id)
            .eq('user_id', user.id)
            .select()
            .single();

        if (error) {
            return { success: false, error: error.message };
        }

        // Return item with staleness fields
        return { success: true, data: addStalenessFields(data) as WatchlistItem };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}
