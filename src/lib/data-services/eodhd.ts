/**
 * EODHD API Client
 * Fetches fundamental data: earnings, revenue, financial statements
 * https://eodhd.com/financial-apis/
 */

import { withLogging } from './logger';
import { cacheKey, getOrFetch, TTL } from './cache';

const EODHD_BASE_URL = 'https://eodhd.com/api';

export interface FundamentalsData {
    eps_actual: number | null;
    eps_expected: number | null;
    earnings_surprise: boolean;
    earnings_surprise_percent: number | null;
    revenue_current: number | null;
    revenue_previous: number | null;
    revenue_growth_qoq: number | null;
    next_earnings_date: string | null;
    market_cap: number | null;
    pe_ratio: number | null;
    data_available: boolean;
}

/**
 * Check if EODHD API is configured
 */
export function isEodhdConfigured(): boolean {
    return !!process.env.EODHD_API_KEY;
}

/**
 * Fetch fundamentals data from EODHD
 */
async function fetchFundamentalsFromApi(ticker: string): Promise<FundamentalsData> {
    const apiKey = process.env.EODHD_API_KEY;
    
    if (!apiKey) {
        console.warn('[EODHD] API key not configured, returning empty fundamentals');
        return getEmptyFundamentals();
    }
    
    try {
        // Fetch fundamentals endpoint
        const url = `${EODHD_BASE_URL}/fundamentals/${ticker}.US?api_token=${apiKey}&fmt=json`;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`EODHD API error: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Extract relevant data from the response
        return parseFundamentals(data, ticker);
    } catch (error) {
        console.error(`[EODHD] Error fetching fundamentals for ${ticker}:`, error);
        throw error;
    }
}

/**
 * Parse EODHD fundamentals response into our format
 */
function parseFundamentals(data: Record<string, unknown>, ticker: string): FundamentalsData {
    try {
        // Extract highlights
        const highlights = data.Highlights as Record<string, unknown> || {};
        const earnings = data.Earnings as Record<string, unknown> || {};
        const history = earnings.History as Record<string, Record<string, unknown>> || {};
        
        // Get most recent earnings
        const earningsDates = Object.keys(history).sort().reverse();
        const latestEarnings = earningsDates.length > 0 ? history[earningsDates[0]] : null;
        const previousEarnings = earningsDates.length > 1 ? history[earningsDates[1]] : null;
        
        // Extract EPS data
        const eps_actual = latestEarnings?.epsActual as number | null ?? null;
        const eps_expected = latestEarnings?.epsEstimate as number | null ?? null;
        
        // Calculate earnings surprise
        let earnings_surprise = false;
        let earnings_surprise_percent: number | null = null;
        
        if (eps_actual !== null && eps_expected !== null && eps_expected !== 0) {
            earnings_surprise = eps_actual > eps_expected;
            earnings_surprise_percent = ((eps_actual - eps_expected) / Math.abs(eps_expected)) * 100;
        }
        
        // Extract revenue from income statement
        const financials = data.Financials as Record<string, unknown> || {};
        const incomeStatement = financials.Income_Statement as Record<string, unknown> || {};
        const quarterlyIncome = incomeStatement.quarterly as Record<string, Record<string, unknown>> || {};
        
        const incomeDates = Object.keys(quarterlyIncome).sort().reverse();
        const latestIncome = incomeDates.length > 0 ? quarterlyIncome[incomeDates[0]] : null;
        const previousIncome = incomeDates.length > 1 ? quarterlyIncome[incomeDates[1]] : null;
        
        const revenue_current = latestIncome?.totalRevenue as number | null ?? null;
        const revenue_previous = previousIncome?.totalRevenue as number | null ?? null;
        
        // Calculate QoQ revenue growth
        let revenue_growth_qoq: number | null = null;
        if (revenue_current !== null && revenue_previous !== null && revenue_previous !== 0) {
            revenue_growth_qoq = ((revenue_current - revenue_previous) / revenue_previous) * 100;
        }
        
        // Find next earnings date from annual data
        const annual = earnings.Annual as Record<string, Record<string, unknown>> || {};
        const nextEarningsDate = findNextEarningsDate(annual);
        
        // Extract other metrics
        const market_cap = highlights.MarketCapitalization as number | null ?? null;
        const pe_ratio = highlights.PERatio as number | null ?? null;
        
        return {
            eps_actual,
            eps_expected,
            earnings_surprise,
            earnings_surprise_percent: earnings_surprise_percent !== null 
                ? Math.round(earnings_surprise_percent * 100) / 100 
                : null,
            revenue_current,
            revenue_previous,
            revenue_growth_qoq: revenue_growth_qoq !== null 
                ? Math.round(revenue_growth_qoq * 100) / 100 
                : null,
            next_earnings_date: nextEarningsDate,
            market_cap: market_cap !== null ? market_cap / 1_000_000_000 : null, // Convert to billions
            pe_ratio,
            data_available: true,
        };
    } catch (error) {
        console.error(`[EODHD] Error parsing fundamentals for ${ticker}:`, error);
        return getEmptyFundamentals();
    }
}

/**
 * Find next earnings date (placeholder - EODHD calendar endpoint needed)
 */
function findNextEarningsDate(annualData: Record<string, Record<string, unknown>>): string | null {
    // This would need the calendar endpoint for accurate next earnings
    // For now, return null (can be enhanced later)
    return null;
}

/**
 * Return empty fundamentals (for graceful degradation)
 */
function getEmptyFundamentals(): FundamentalsData {
    return {
        eps_actual: null,
        eps_expected: null,
        earnings_surprise: false,
        earnings_surprise_percent: null,
        revenue_current: null,
        revenue_previous: null,
        revenue_growth_qoq: null,
        next_earnings_date: null,
        market_cap: null,
        pe_ratio: null,
        data_available: false,
    };
}

/**
 * Main function: Get fundamentals with caching and logging
 */
export async function getFundamentals(ticker: string): Promise<FundamentalsData> {
    const key = cacheKey('eodhd', 'fundamentals', ticker);
    
    try {
        const { data, cached } = await getOrFetch(
            key,
            TTL.FUNDAMENTALS,
            () => withLogging(
                'eodhd',
                'fundamentals',
                ticker,
                () => fetchFundamentalsFromApi(ticker)
            )
        );
        
        // If it was cached, log the cache hit
        if (cached) {
            const { logApiCall } = await import('./logger');
            logApiCall({
                service: 'cache',
                operation: 'fundamentals',
                ticker,
                latency_ms: 0,
                success: true,
                cached: true,
            });
        }
        
        return data;
    } catch (error) {
        // Graceful degradation: return empty data on failure
        console.warn(`[EODHD] Falling back to empty fundamentals for ${ticker}`);
        return getEmptyFundamentals();
    }
}

/**
 * Fetch earnings calendar for upcoming earnings
 * (Optional enhancement - requires separate API call)
 */
export async function getEarningsCalendar(ticker: string): Promise<{
    next_earnings_date: string | null;
    days_until_earnings: number | null;
}> {
    // Placeholder - can be implemented with EODHD calendar endpoint
    return {
        next_earnings_date: null,
        days_until_earnings: null,
    };
}

