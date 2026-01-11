'use server';

import { createClient, isSupabaseConfigured } from '@/lib/supabase/server';
import { createAdminClient, isAdminConfigured } from '@/lib/supabase/admin';

// ============================================
// TYPES
// ============================================

export interface Recommendation {
    id: string;
    ticker: string;
    company_name: string | null;

    // Soft signal data
    insider_buys: number;
    insider_sells: number;
    insider_buy_ratio: number | null;
    top_buyer: string | null;

    // Congress data
    congress_buys: number;
    congress_sells: number;

    // Scoring
    soft_signal_score: number | null;
    signal_strength: 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';

    // Technical timing (on-demand)
    timing_verdict: string | null;
    success_probability: number | null;

    // Trade details
    last_trade_date: string | null;
    last_trade_value: number | null;

    // Metadata
    created_at: string;
    updated_at: string;
}

// ============================================
// READ OPERATIONS
// ============================================

/**
 * Get all recommendations with STRONG or MODERATE signals
 */
export async function getRecommendations(): Promise<{
    success: boolean;
    data?: Recommendation[];
    error?: string;
    lastUpdated?: string;
}> {
    try {
        if (!isSupabaseConfigured()) {
            return { success: false, error: 'Database not configured' };
        }
        const supabase = await createClient();

        const { data, error } = await supabase
            .from('recommendations')
            .select('*')
            .in('signal_strength', ['STRONG', 'MODERATE'])
            .order('soft_signal_score', { ascending: false });

        if (error) {
            return { success: false, error: error.message };
        }

        // Get most recent update time
        const lastUpdated = data && data.length > 0
            ? data.reduce((latest, item) =>
                item.updated_at > latest ? item.updated_at : latest,
                data[0].updated_at
            )
            : null;

        return {
            success: true,
            data: data as Recommendation[],
            lastUpdated: lastUpdated || undefined
        };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

/**
 * Get recommendations grouped by signal strength
 */
export async function getRecommendationsGrouped(): Promise<{
    success: boolean;
    strong?: Recommendation[];
    moderate?: Recommendation[];
    error?: string;
    lastUpdated?: string;
}> {
    try {
        const result = await getRecommendations();
        if (!result.success || !result.data) {
            return { success: false, error: result.error };
        }

        const strong = result.data.filter(r => r.signal_strength === 'STRONG');
        const moderate = result.data.filter(r => r.signal_strength === 'MODERATE');

        return {
            success: true,
            strong,
            moderate,
            lastUpdated: result.lastUpdated
        };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

/**
 * Get a single recommendation by ticker
 */
export async function getRecommendation(ticker: string): Promise<{
    success: boolean;
    data?: Recommendation;
    error?: string;
}> {
    try {
        if (!isSupabaseConfigured()) {
            return { success: false, error: 'Database not configured' };
        }
        const supabase = await createClient();

        const { data, error } = await supabase
            .from('recommendations')
            .select('*')
            .eq('ticker', ticker.toUpperCase())
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return { success: false, error: 'Recommendation not found' };
            }
            return { success: false, error: error.message };
        }

        return { success: true, data: data as Recommendation };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

// ============================================
// WRITE OPERATIONS (for cron job)
// ============================================

export interface RecommendationInput {
    ticker: string;
    company_name?: string;
    insider_buys: number;
    insider_sells: number;
    insider_buy_ratio?: number;
    top_buyer?: string;
    congress_buys?: number;
    congress_sells?: number;
    soft_signal_score: number;
    signal_strength: 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';
    last_trade_date?: string;
    last_trade_value?: number;
}

/**
 * Upsert a single recommendation (insert or update)
 */
export async function upsertRecommendation(input: RecommendationInput): Promise<{
    success: boolean;
    data?: Recommendation;
    error?: string;
}> {
    try {
        if (!isAdminConfigured()) {
            return { success: false, error: 'Admin client not configured' };
        }
        const supabase = createAdminClient();

        const { data, error } = await supabase
            .from('recommendations')
            .upsert({
                ticker: input.ticker.toUpperCase(),
                company_name: input.company_name || null,
                insider_buys: input.insider_buys,
                insider_sells: input.insider_sells,
                insider_buy_ratio: input.insider_buy_ratio || null,
                top_buyer: input.top_buyer || null,
                congress_buys: input.congress_buys || 0,
                congress_sells: input.congress_sells || 0,
                soft_signal_score: input.soft_signal_score,
                signal_strength: input.signal_strength,
                last_trade_date: input.last_trade_date || null,
                last_trade_value: input.last_trade_value || null,
                updated_at: new Date().toISOString(),
            }, {
                onConflict: 'ticker',
            })
            .select()
            .single();

        if (error) {
            return { success: false, error: error.message };
        }

        return { success: true, data: data as Recommendation };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

/**
 * Upsert multiple recommendations (batch operation for cron)
 */
export async function upsertRecommendations(inputs: RecommendationInput[]): Promise<{
    success: boolean;
    count?: number;
    error?: string;
}> {
    try {
        if (!isAdminConfigured()) {
            return { success: false, error: 'Admin client not configured' };
        }
        const supabase = createAdminClient();

        const records = inputs.map(input => ({
            ticker: input.ticker.toUpperCase(),
            company_name: input.company_name || null,
            insider_buys: input.insider_buys,
            insider_sells: input.insider_sells,
            insider_buy_ratio: input.insider_buy_ratio || null,
            top_buyer: input.top_buyer || null,
            congress_buys: input.congress_buys || 0,
            congress_sells: input.congress_sells || 0,
            soft_signal_score: input.soft_signal_score,
            signal_strength: input.signal_strength,
            last_trade_date: input.last_trade_date || null,
            last_trade_value: input.last_trade_value || null,
            updated_at: new Date().toISOString(),
        }));

        const { error } = await supabase
            .from('recommendations')
            .upsert(records, {
                onConflict: 'ticker',
            });

        if (error) {
            return { success: false, error: error.message };
        }

        return { success: true, count: records.length };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

/**
 * Remove old recommendations (tickers no longer in insider data)
 */
export async function cleanupOldRecommendations(keepTickers: string[]): Promise<{
    success: boolean;
    removed?: number;
    error?: string;
}> {
    try {
        if (!isAdminConfigured()) {
            return { success: false, error: 'Admin client not configured' };
        }
        const supabase = createAdminClient();

        // First get count of items to be removed
        const { data: toRemove } = await supabase
            .from('recommendations')
            .select('ticker')
            .not('ticker', 'in', `(${keepTickers.map(t => `"${t}"`).join(',')})`);

        const { error } = await supabase
            .from('recommendations')
            .delete()
            .not('ticker', 'in', `(${keepTickers.map(t => `"${t}"`).join(',')})`);

        if (error) {
            return { success: false, error: error.message };
        }

        return { success: true, removed: toRemove?.length || 0 };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}
