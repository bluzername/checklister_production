/**
 * Quiver Quantitative API Client
 * Fetches insider trades (SEC Form 4) and congressional trading disclosures.
 * https://api.quiverquant.com/beta
 *
 * This provides the data for Criterion 11 (Soft Signals) in the analysis system.
 */

import { withLogging, logApiCall } from './logger';
import { cacheKey, getOrFetch, TTL } from './cache';

const QUIVER_BASE_URL = 'https://api.quiverquant.com/beta';

// ============================================
// TYPES
// ============================================

export interface InsiderTrade {
    ticker: string;
    name: string;                    // Insider name
    title: string;                   // Position (CEO, Director, etc.)
    transactionType: 'BUY' | 'SELL' | 'OPTION';
    shares: number;
    pricePerShare: number | null;
    totalValue: number | null;
    filingDate: string;             // When SEC filing was submitted
    transactionDate: string;        // When trade occurred
}

export interface CongressTrade {
    ticker: string;
    representative: string;
    party: 'D' | 'R' | 'I';
    house: 'House' | 'Senate';
    transactionType: 'BUY' | 'SELL';
    amount: string;                 // Range like "$15,001 - $50,000"
    amountLow: number;
    amountHigh: number;
    transactionDate: string;
    disclosureDate: string;
}

export interface SoftSignalsData {
    // Insider data (last 90 days)
    insider_buys_count: number;
    insider_sells_count: number;
    insider_buy_ratio: number;      // buys / (buys + sells)
    insider_net_value: number;      // Total buy value - sell value
    insider_top_buyer: string | null;
    insider_last_buy_date: string | null;
    insider_recent_activity: boolean; // Activity in last 30 days

    // Congress data (last 90 days)
    congress_buys_count: number;
    congress_sells_count: number;
    congress_buy_ratio: number;
    congress_bipartisan: boolean;   // Both parties buying
    congress_recent_activity: boolean;

    // Combined signals
    combined_score: number;         // 0-10 soft signal score
    signal_strength: 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';
    data_available: boolean;

    // Raw data for detailed view
    recent_insider_trades: InsiderTrade[];
    recent_congress_trades: CongressTrade[];
}

// ============================================
// CONFIGURATION CHECK
// ============================================

/**
 * Check if Quiver API is configured
 */
export function isQuiverConfigured(): boolean {
    return !!process.env.QUIVER_API_KEY;
}

// ============================================
// INTERNAL HELPERS
// ============================================

/**
 * Parse transaction type from Quiver API format
 */
function parseTransactionType(type: string): 'BUY' | 'SELL' | 'OPTION' {
    const lower = (type || '').toLowerCase();
    if (lower.includes('purchase') || lower.includes('buy') || lower.includes('acquisition') || lower === 'p') {
        return 'BUY';
    }
    if (lower.includes('sale') || lower.includes('sell') || lower.includes('disposition') || lower === 's') {
        return 'SELL';
    }
    return 'OPTION';
}

/**
 * Parse congressional amount range string to numbers
 * e.g., "$15,001 - $50,000" => { low: 15001, high: 50000 }
 */
function parseAmountRange(amount: string): { low: number; high: number } {
    if (!amount) return { low: 0, high: 0 };
    const numbers = amount.match(/\$?([\d,]+)/g);
    if (!numbers || numbers.length === 0) return { low: 0, high: 0 };
    const parsed = numbers.map(n => parseInt(n.replace(/[$,]/g, ''), 10));
    return {
        low: Math.min(...parsed),
        high: Math.max(...parsed),
    };
}

/**
 * Calculate net value (buy value - sell value)
 */
function calculateNetValue(buys: InsiderTrade[], sells: InsiderTrade[]): number {
    const buyValue = buys.reduce((sum, t) => sum + (t.totalValue || 0), 0);
    const sellValue = sells.reduce((sum, t) => sum + (t.totalValue || 0), 0);
    return buyValue - sellValue;
}

// ============================================
// API FETCH FUNCTIONS
// ============================================

/**
 * Generic Quiver API fetcher
 */
async function fetchFromQuiver<T>(endpoint: string): Promise<T> {
    const apiKey = process.env.QUIVER_API_KEY;
    if (!apiKey) {
        throw new Error('[QUIVER] API key not configured');
    }

    const url = `${QUIVER_BASE_URL}${endpoint}`;
    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Accept': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(`[QUIVER] API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
}

/**
 * Fetch insider trades for a ticker (last 90 days)
 */
async function fetchInsiderTrades(ticker: string): Promise<InsiderTrade[]> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = await fetchFromQuiver<any[]>(`/historical/insiders/${ticker}`);

        if (!Array.isArray(data)) {
            return [];
        }

        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

        return data
            .filter(trade => {
                const tradeDate = new Date(trade.Date || trade.TransactionDate);
                return !isNaN(tradeDate.getTime()) && tradeDate >= ninetyDaysAgo;
            })
            .map(trade => ({
                ticker: trade.Ticker || ticker,
                name: trade.Name || 'Unknown',
                title: trade.Title || 'Unknown',
                transactionType: parseTransactionType(trade.Transaction || trade.TransactionType),
                shares: Math.abs(trade.Shares || 0),
                pricePerShare: trade.Price || null,
                totalValue: trade.Value || null,
                filingDate: trade.FilingDate || trade.Date,
                transactionDate: trade.Date || trade.TransactionDate,
            }));
    } catch (error) {
        console.error(`[QUIVER] Error fetching insider trades for ${ticker}:`, error);
        return [];
    }
}

/**
 * Fetch congressional trades for a ticker (last 90 days)
 */
async function fetchCongressTrades(ticker: string): Promise<CongressTrade[]> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = await fetchFromQuiver<any[]>(`/historical/congresstrading/${ticker}`);

        if (!Array.isArray(data)) {
            return [];
        }

        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

        return data
            .filter(trade => {
                const tradeDate = new Date(trade.TransactionDate);
                return !isNaN(tradeDate.getTime()) && tradeDate >= ninetyDaysAgo;
            })
            .map(trade => {
                const amountRange = parseAmountRange(trade.Amount || '');
                return {
                    ticker: trade.Ticker || ticker,
                    representative: trade.Representative || 'Unknown',
                    party: (trade.Party || 'I') as 'D' | 'R' | 'I',
                    house: (trade.House || 'House') as 'House' | 'Senate',
                    transactionType: (trade.Transaction?.toLowerCase().includes('purchase') ? 'BUY' : 'SELL') as 'BUY' | 'SELL',
                    amount: trade.Amount || '$0',
                    amountLow: amountRange.low,
                    amountHigh: amountRange.high,
                    transactionDate: trade.TransactionDate,
                    disclosureDate: trade.DisclosureDate || trade.TransactionDate,
                };
            });
    } catch (error) {
        console.error(`[QUIVER] Error fetching congress trades for ${ticker}:`, error);
        return [];
    }
}

// ============================================
// SCORING LOGIC
// ============================================

/**
 * Calculate the combined soft signal score (0-10)
 * Based on insider + congress trading activity
 */
export function calculateSoftSignalScore(
    insiderTrades: InsiderTrade[],
    congressTrades: CongressTrade[]
): { score: number; strength: 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE' } {
    let score = 5; // Neutral baseline

    // ===== INSIDER SCORING =====
    const insiderBuys = insiderTrades.filter(t => t.transactionType === 'BUY');
    const insiderSells = insiderTrades.filter(t => t.transactionType === 'SELL');
    const insiderBuyRatio = insiderTrades.length > 0
        ? insiderBuys.length / insiderTrades.length
        : 0.5;

    // Strong insider buying (3+ buys with >70% buy ratio)
    if (insiderBuys.length >= 3 && insiderBuyRatio > 0.7) {
        score += 2.5;
    } else if (insiderBuys.length >= 1 && insiderBuyRatio > 0.5) {
        // Any buying with >50% buy ratio
        score += 1.5;
    }

    // Penalize heavy insider selling (3+ sells with <30% buy ratio)
    if (insiderSells.length >= 3 && insiderBuyRatio < 0.3) {
        score -= 2;
    }

    // C-suite buying is especially bullish
    const cSuiteBuys = insiderBuys.filter(t =>
        /CEO|CFO|COO|President|Chairman/i.test(t.title)
    );
    if (cSuiteBuys.length > 0) {
        score += 1;
    }

    // ===== CONGRESS SCORING =====
    const congressBuys = congressTrades.filter(t => t.transactionType === 'BUY');
    const congressSells = congressTrades.filter(t => t.transactionType === 'SELL');
    const congressBuyRatio = congressTrades.length > 0
        ? congressBuys.length / congressTrades.length
        : 0.5;

    // Congress buying (2+ buys with >70% ratio)
    if (congressBuys.length >= 2 && congressBuyRatio > 0.7) {
        score += 1.5;
    } else if (congressBuys.length >= 1) {
        // Any congress buying
        score += 0.5;
    }

    // Bipartisan buying (both D and R) is a stronger signal
    const parties = new Set(congressBuys.map(t => t.party));
    if (parties.has('D') && parties.has('R')) {
        score += 1;
    }

    // Congress selling
    if (congressSells.length >= 2 && congressBuyRatio < 0.3) {
        score -= 1;
    }

    // ===== RECENCY BONUS =====
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentInsiderBuys = insiderBuys.filter(t =>
        new Date(t.transactionDate) >= thirtyDaysAgo
    );
    if (recentInsiderBuys.length > 0) {
        score += 0.5;
    }

    // Clamp to 0-10 range
    score = Math.max(0, Math.min(10, score));

    // Determine strength label
    let strength: 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';
    if (score >= 8) strength = 'STRONG';
    else if (score >= 6) strength = 'MODERATE';
    else if (score >= 4) strength = 'WEAK';
    else strength = 'NONE';

    return { score: Math.round(score * 10) / 10, strength };
}

// ============================================
// MAIN DATA FETCHER
// ============================================

/**
 * Fetch and aggregate soft signals data from Quiver API
 */
async function fetchSoftSignalsFromApi(ticker: string): Promise<SoftSignalsData> {
    if (!isQuiverConfigured()) {
        console.warn('[QUIVER] API key not configured, returning empty soft signals');
        return getEmptySoftSignals();
    }

    try {
        // Fetch both data sources in parallel
        const [insiderTrades, congressTrades] = await Promise.all([
            fetchInsiderTrades(ticker),
            fetchCongressTrades(ticker),
        ]);

        // Calculate metrics
        const insiderBuys = insiderTrades.filter(t => t.transactionType === 'BUY');
        const insiderSells = insiderTrades.filter(t => t.transactionType === 'SELL');
        const congressBuys = congressTrades.filter(t => t.transactionType === 'BUY');
        const congressSells = congressTrades.filter(t => t.transactionType === 'SELL');

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // Calculate score
        const { score, strength } = calculateSoftSignalScore(insiderTrades, congressTrades);

        // Find top buyer (by value)
        const topBuyer = insiderBuys
            .filter(t => t.totalValue !== null)
            .sort((a, b) => (b.totalValue || 0) - (a.totalValue || 0))[0];

        // Find last buy date
        const sortedBuys = insiderBuys
            .filter(t => t.transactionDate)
            .sort((a, b) => new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime());

        return {
            insider_buys_count: insiderBuys.length,
            insider_sells_count: insiderSells.length,
            insider_buy_ratio: insiderTrades.length > 0
                ? Math.round((insiderBuys.length / insiderTrades.length) * 100) / 100
                : 0.5,
            insider_net_value: calculateNetValue(insiderBuys, insiderSells),
            insider_top_buyer: topBuyer ? `${topBuyer.name} (${topBuyer.title})` : null,
            insider_last_buy_date: sortedBuys[0]?.transactionDate || null,
            insider_recent_activity: insiderBuys.some(t =>
                new Date(t.transactionDate) >= thirtyDaysAgo
            ),

            congress_buys_count: congressBuys.length,
            congress_sells_count: congressSells.length,
            congress_buy_ratio: congressTrades.length > 0
                ? Math.round((congressBuys.length / congressTrades.length) * 100) / 100
                : 0.5,
            congress_bipartisan: new Set(congressBuys.map(t => t.party)).size > 1,
            congress_recent_activity: congressBuys.some(t =>
                new Date(t.transactionDate) >= thirtyDaysAgo
            ),

            combined_score: score,
            signal_strength: strength,
            data_available: true,

            recent_insider_trades: insiderTrades.slice(0, 10),
            recent_congress_trades: congressTrades.slice(0, 10),
        };
    } catch (error) {
        console.error(`[QUIVER] Error fetching soft signals for ${ticker}:`, error);
        throw error;
    }
}

/**
 * Return empty soft signals (for graceful degradation)
 */
export function getEmptySoftSignals(): SoftSignalsData {
    return {
        insider_buys_count: 0,
        insider_sells_count: 0,
        insider_buy_ratio: 0.5,
        insider_net_value: 0,
        insider_top_buyer: null,
        insider_last_buy_date: null,
        insider_recent_activity: false,
        congress_buys_count: 0,
        congress_sells_count: 0,
        congress_buy_ratio: 0.5,
        congress_bipartisan: false,
        congress_recent_activity: false,
        combined_score: 5,
        signal_strength: 'NONE',
        data_available: false,
        recent_insider_trades: [],
        recent_congress_trades: [],
    };
}

// ============================================
// MAIN EXPORT
// ============================================

/**
 * Get soft signals with caching and logging
 * Main function to use in analysis pipeline
 */
export async function getSoftSignals(ticker: string): Promise<SoftSignalsData> {
    const key = cacheKey('quiver', 'soft_signals', ticker);

    try {
        const { data, cached } = await getOrFetch(
            key,
            TTL.SENTIMENT, // 1 hour TTL (same as sentiment)
            () => withLogging(
                'quiver',
                'soft_signals',
                ticker,
                () => fetchSoftSignalsFromApi(ticker)
            )
        );

        // If it was cached, log the cache hit
        if (cached) {
            logApiCall({
                service: 'cache',
                operation: 'soft_signals',
                ticker,
                latency_ms: 0,
                success: true,
                cached: true,
            });
        }

        return data;
    } catch (error) {
        // Graceful degradation: return neutral data on failure
        console.warn(`[QUIVER] Falling back to empty soft signals for ${ticker}`);
        return getEmptySoftSignals();
    }
}
