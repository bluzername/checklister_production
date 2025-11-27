'use server';

import { createClient, isSupabaseConfigured } from '@/lib/supabase/server';
import { analyzeTicker } from '@/lib/analysis';
import { PortfolioPosition, PortfolioAction, AnalysisResult } from '@/lib/types';

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

        const { error } = await supabase
            .from('portfolios')
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

function computeAction(
    position: PortfolioPosition,
    analysis: AnalysisResult
): PortfolioAction {
    const { current_price, trading_plan } = analysis;
    const { buy_price } = position;
    const { stop_loss, take_profit_levels } = trading_plan;

    // Check stop loss
    if (current_price <= stop_loss.price) {
        return 'STOP_LOSS_HIT';
    }

    // Check take profit levels (assuming levels are sorted by price ascending)
    const tp1 = take_profit_levels[0]?.target_price;
    const tp2 = take_profit_levels[1]?.target_price;
    const tp3 = take_profit_levels[2]?.target_price;

    if (tp3 && current_price >= tp3) {
        return 'SELL_ALL';
    }

    if ((tp1 && current_price >= tp1) || (tp2 && current_price >= tp2)) {
        return 'SELL_PARTIAL';
    }

    // Check if good to add more (score high and price dipped below entry)
    if (analysis.success_probability >= 70 && current_price < buy_price * 0.97) {
        return 'ADD_MORE';
    }

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

                    return {
                        ...position,
                        current_price: analysis.current_price,
                        action,
                        profit_loss: profitLoss,
                        profit_loss_percent: profitLossPercent,
                        analysis,
                    } as PortfolioPosition;
                } catch {
                    // If analysis fails, return position without analysis
                    return position as PortfolioPosition;
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

        return {
            success: true,
            data: {
                ...position,
                current_price: analysis.current_price,
                action,
                profit_loss: profitLoss,
                profit_loss_percent: profitLossPercent,
                analysis,
            } as PortfolioPosition,
        };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

