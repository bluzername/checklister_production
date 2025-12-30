'use server';

import { createClient, isSupabaseConfigured } from '@/lib/supabase/server';
import { analyzeTicker } from '@/lib/analysis';
import { WatchlistItem, AnalysisResult } from '@/lib/types';
import { logWatchlistOperation, logAnalysisOperation } from '@/lib/activity-logger';

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

        const { data, error } = await supabase
            .from('watchlists')
            .select('*')
            .eq('user_id', user.id)
            .order('date_added', { ascending: false });

        if (error) {
            return { success: false, error: error.message };
        }

        return { success: true, data: data as WatchlistItem[] };
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

        // Log the ADD_WATCHLIST operation with current analysis
        let analysis: AnalysisResult | null = null;
        try {
            analysis = await analyzeTicker(ticker.toUpperCase());
        } catch {
            // Analysis failed, continue with logging
        }

        logWatchlistOperation(
            user.id,
            'ADD_WATCHLIST',
            ticker.toUpperCase(),
            { notes: notes },
            analysis
        ).catch(err => console.error('[Watchlist] Logging error:', err));

        return { success: true, data: data as WatchlistItem };
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

        // Fetch item details before deletion for logging
        const { data: item } = await supabase
            .from('watchlists')
            .select('*')
            .eq('id', id)
            .eq('user_id', user.id)
            .single();

        const { error } = await supabase
            .from('watchlists')
            .delete()
            .eq('id', id)
            .eq('user_id', user.id);

        if (error) {
            return { success: false, error: error.message };
        }

        // Log the REMOVE_WATCHLIST operation
        if (item) {
            let analysis: AnalysisResult | null = null;
            try {
                analysis = await analyzeTicker(item.ticker);
            } catch {
                // Analysis failed, continue with logging
            }

            logWatchlistOperation(
                user.id,
                'REMOVE_WATCHLIST',
                item.ticker,
                { notes: `Removed from watchlist. Original notes: ${item.notes || 'none'}` },
                analysis
            ).catch(err => console.error('[Watchlist] Logging error:', err));
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

        const { data: items, error } = await supabase
            .from('watchlists')
            .select('*')
            .eq('user_id', user.id)
            .order('date_added', { ascending: false });

        if (error) {
            return { success: false, error: error.message };
        }

        if (!items || items.length === 0) {
            return { success: true, data: [] };
        }

        // Analyze each watchlist item
        const analyzedItems: WatchlistItem[] = await Promise.all(
            items.map(async (item) => {
                try {
                    const analysis = await analyzeTicker(item.ticker);
                    
                    return {
                        ...item,
                        current_price: analysis.current_price,
                        score: analysis.success_probability,
                        is_good_entry: isGoodEntry(analysis),
                        analysis,
                    } as WatchlistItem;
                } catch {
                    // If analysis fails, return item without analysis
                    return item as WatchlistItem;
                }
            })
        );

        return { success: true, data: analyzedItems };
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
                ...item,
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

