/**
 * Financial Modeling Prep (FMP) API Client
 * Fetches fundamental data: earnings surprises, revenue, financial statements
 * Uses the new /stable/ API endpoints (v3 is legacy)
 * https://site.financialmodelingprep.com/developer/docs/
 *
 * PIT Safety: All functions now accept asOfDate parameter for backtesting.
 * When asOfDate is provided, earnings data is filtered to only include
 * earnings releases that occurred before that date.
 */

import { withLogging } from './logger';
import { cacheKey, getOrFetch, TTL } from './cache';

const FMP_BASE_URL = 'https://financialmodelingprep.com/stable';

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
 * Check if FMP API is configured
 */
export function isFmpConfigured(): boolean {
    return !!process.env.FMP_API_KEY;
}

// Also export as isEodhdConfigured for backwards compatibility
export const isEodhdConfigured = isFmpConfigured;

/**
 * FMP Earnings Response Type
 */
interface FmpEarningsData {
    symbol: string;
    date: string;
    epsActual: number | null;
    epsEstimated: number | null;
    revenueActual: number | null;
    revenueEstimated: number | null;
    lastUpdated: string;
}

/**
 * FMP Profile Response Type
 */
interface FmpProfileData {
    symbol: string;
    price: number;
    marketCap: number;
    beta: number;
    companyName: string;
    sector: string;
    industry: string;
}

/**
 * Fetch earnings data from FMP (includes EPS and revenue with estimates)
 * Endpoint: /stable/earnings?symbol={symbol}
 *
 * @param ticker - Stock ticker symbol
 * @param apiKey - FMP API key
 * @param asOfDate - Optional date for PIT safety (backtesting)
 *                   When provided, only returns earnings released before this date.
 */
async function fetchEarningsData(ticker: string, apiKey: string, asOfDate?: Date): Promise<{
    eps_actual: number | null;
    eps_expected: number | null;
    earnings_surprise: boolean;
    earnings_surprise_percent: number | null;
    revenue_current: number | null;
    revenue_previous: number | null;
    revenue_growth_qoq: number | null;
    next_earnings_date: string | null;
}> {
    try {
        const url = `${FMP_BASE_URL}/earnings?symbol=${ticker}&apikey=${apiKey}`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`FMP earnings error: ${response.status}`);
        }

        const data: FmpEarningsData[] = await response.json();

        if (!Array.isArray(data) || data.length === 0) {
            return {
                eps_actual: null,
                eps_expected: null,
                earnings_surprise: false,
                earnings_surprise_percent: null,
                revenue_current: null,
                revenue_previous: null,
                revenue_growth_qoq: null,
                next_earnings_date: null,
            };
        }

        // PIT Safety: Use asOfDate or current date for filtering
        const effectiveDate = asOfDate || new Date();

        // Find the most recent completed earnings (with epsActual not null)
        // that were released BEFORE the effective date (PIT safety)
        const completedEarnings = data.filter(e =>
            e.epsActual !== null && new Date(e.date) <= effectiveDate
        );

        // Find next upcoming earnings (epsActual is null, date is in future relative to effectiveDate)
        const upcomingEarnings = data.filter(e =>
            e.epsActual === null && new Date(e.date) > effectiveDate
        );
        
        const nextEarningsDate = upcomingEarnings.length > 0 
            ? upcomingEarnings[upcomingEarnings.length - 1].date 
            : null;
        
        if (completedEarnings.length === 0) {
            return {
                eps_actual: null,
                eps_expected: null,
                earnings_surprise: false,
                earnings_surprise_percent: null,
                revenue_current: null,
                revenue_previous: null,
                revenue_growth_qoq: null,
                next_earnings_date: nextEarningsDate,
            };
        }
        
        // Most recent completed earnings
        const latest = completedEarnings[0];
        const previous = completedEarnings.length > 1 ? completedEarnings[1] : null;
        
        const eps_actual = latest.epsActual;
        const eps_expected = latest.epsEstimated;
        
        // Calculate earnings surprise
        let earnings_surprise = false;
        let earnings_surprise_percent: number | null = null;
        
        if (eps_actual !== null && eps_expected !== null && eps_expected !== 0) {
            earnings_surprise = eps_actual > eps_expected;
            earnings_surprise_percent = ((eps_actual - eps_expected) / Math.abs(eps_expected)) * 100;
        }
        
        // Get revenue data
        const revenue_current = latest.revenueActual;
        const revenue_previous = previous?.revenueActual ?? null;
        
        // Calculate QoQ revenue growth
        let revenue_growth_qoq: number | null = null;
        if (revenue_current !== null && revenue_previous !== null && revenue_previous !== 0) {
            revenue_growth_qoq = ((revenue_current - revenue_previous) / revenue_previous) * 100;
        }
        
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
        };
    } catch (error) {
        console.error(`[FMP] Error fetching earnings for ${ticker}:`, error);
        return {
            eps_actual: null,
            eps_expected: null,
            earnings_surprise: false,
            earnings_surprise_percent: null,
            revenue_current: null,
            revenue_previous: null,
            revenue_growth_qoq: null,
            next_earnings_date: null,
        };
    }
}

/**
 * Fetch company profile from FMP
 * Endpoint: /stable/profile?symbol={symbol}
 */
async function fetchProfile(ticker: string, apiKey: string): Promise<{
    market_cap: number | null;
    pe_ratio: number | null;
}> {
    try {
        const url = `${FMP_BASE_URL}/profile?symbol=${ticker}&apikey=${apiKey}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`FMP profile error: ${response.status}`);
        }
        
        const data: FmpProfileData[] = await response.json();
        
        if (!Array.isArray(data) || data.length === 0) {
            return { market_cap: null, pe_ratio: null };
        }
        
        const profile = data[0];
        
        return {
            market_cap: profile.marketCap ? profile.marketCap / 1_000_000_000 : null, // Convert to billions
            pe_ratio: null, // PE ratio not in profile, can be calculated
        };
    } catch (error) {
        console.error(`[FMP] Error fetching profile for ${ticker}:`, error);
        return { market_cap: null, pe_ratio: null };
    }
}

/**
 * Fetch all fundamentals data from FMP
 *
 * @param ticker - Stock ticker symbol
 * @param asOfDate - Optional date for PIT safety (backtesting)
 */
async function fetchFundamentalsFromApi(ticker: string, asOfDate?: Date): Promise<FundamentalsData> {
    const apiKey = process.env.FMP_API_KEY;

    if (!apiKey) {
        console.warn('[FMP] API key not configured, returning empty fundamentals');
        return getEmptyFundamentals();
    }

    try {
        // Fetch earnings and profile in parallel
        // Note: asOfDate is passed to earnings for PIT safety
        const [earnings, profile] = await Promise.all([
            fetchEarningsData(ticker, apiKey, asOfDate),
            fetchProfile(ticker, apiKey),
        ]);
        
        // Check if we got any meaningful data
        const hasData = earnings.eps_actual !== null || 
                       earnings.revenue_current !== null || 
                       profile.market_cap !== null;
        
        return {
            eps_actual: earnings.eps_actual,
            eps_expected: earnings.eps_expected,
            earnings_surprise: earnings.earnings_surprise,
            earnings_surprise_percent: earnings.earnings_surprise_percent,
            revenue_current: earnings.revenue_current,
            revenue_previous: earnings.revenue_previous,
            revenue_growth_qoq: earnings.revenue_growth_qoq,
            next_earnings_date: earnings.next_earnings_date,
            market_cap: profile.market_cap,
            pe_ratio: profile.pe_ratio,
            data_available: hasData,
        };
    } catch (error) {
        console.error(`[FMP] Error fetching fundamentals for ${ticker}:`, error);
        throw error;
    }
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
 *
 * @param ticker - Stock ticker symbol
 * @param asOfDate - Optional date for PIT safety (backtesting)
 *                   When provided, only returns earnings released before this date.
 */
export async function getFundamentals(ticker: string, asOfDate?: Date): Promise<FundamentalsData> {
    // Include asOfDate in cache key for PIT-safe caching
    const dateKey = asOfDate ? asOfDate.toISOString().split('T')[0] : 'live';
    const key = cacheKey('fmp', 'fundamentals', `${ticker}_${dateKey}`);

    try {
        const { data, cached } = await getOrFetch(
            key,
            TTL.FUNDAMENTALS,
            () => withLogging(
                'fmp',
                'fundamentals',
                ticker,
                () => fetchFundamentalsFromApi(ticker, asOfDate)
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
        console.warn(`[FMP] Falling back to empty fundamentals for ${ticker}`);
        return getEmptyFundamentals();
    }
}

/**
 * Get earnings calendar for upcoming earnings
 */
export async function getEarningsCalendar(ticker: string): Promise<{
    next_earnings_date: string | null;
    days_until_earnings: number | null;
}> {
    const apiKey = process.env.FMP_API_KEY;
    
    if (!apiKey) {
        return { next_earnings_date: null, days_until_earnings: null };
    }
    
    try {
        const url = `${FMP_BASE_URL}/earnings?symbol=${ticker}&apikey=${apiKey}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            return { next_earnings_date: null, days_until_earnings: null };
        }
        
        const data: FmpEarningsData[] = await response.json();
        
        if (!Array.isArray(data) || data.length === 0) {
            return { next_earnings_date: null, days_until_earnings: null };
        }
        
        // Find next upcoming earnings
        const today = new Date();
        const upcomingEarnings = data.filter(e => 
            e.epsActual === null && new Date(e.date) > today
        );
        
        if (upcomingEarnings.length === 0) {
            return { next_earnings_date: null, days_until_earnings: null };
        }
        
        // Get the closest upcoming earnings
        const nextDate = upcomingEarnings[upcomingEarnings.length - 1].date;
        const earningsDate = new Date(nextDate);
        const days_until_earnings = Math.ceil((earningsDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        
        return {
            next_earnings_date: nextDate,
            days_until_earnings,
        };
    } catch (error) {
        console.error(`[FMP] Error fetching earnings calendar for ${ticker}:`, error);
        return { next_earnings_date: null, days_until_earnings: null };
    }
}
