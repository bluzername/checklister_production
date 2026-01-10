/**
 * Soft Signals Data Service
 * Fetches insider trades from Financial Modeling Prep (FMP) API.
 * https://financialmodelingprep.com/stable/insider-trading/latest
 *
 * This provides the data for Criterion 11 (Soft Signals) in the analysis system.
 *
 * NOTE: Congress trading data is currently unavailable (FMP endpoints return empty).
 * Will be added when a working data source is found.
 */

import { withLogging, logApiCall } from './logger';
import { cacheKey, getOrFetch, TTL } from './cache';

const FMP_BASE_URL = 'https://financialmodelingprep.com/stable';

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

    // Congress data (last 90 days) - currently unavailable
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

// FMP API response type
interface FMPInsiderTrade {
    symbol: string;
    filingDate: string;
    transactionDate: string;
    reportingCik: string;
    companyCik: string;
    transactionType: string;
    securitiesOwned: number;
    reportingName: string;
    typeOfOwner: string;
    acquisitionOrDisposition: 'A' | 'D';
    directOrIndirect: string;
    formType: string;
    securitiesTransacted: number;
    price: number;
    securityName: string;
    url: string;
}

// ============================================
// CONFIGURATION CHECK
// ============================================

/**
 * Check if FMP API is configured
 */
export function isQuiverConfigured(): boolean {
    return !!process.env.FMP_API_KEY;
}

// ============================================
// INTERNAL HELPERS
// ============================================

/**
 * Parse transaction type from FMP format
 * acquisitionOrDisposition: A = Acquisition (BUY), D = Disposition (SELL)
 * transactionType: P = Purchase, S = Sale, G = Gift, etc.
 */
function parseTransactionType(trade: FMPInsiderTrade): 'BUY' | 'SELL' | 'OPTION' {
    const txType = (trade.transactionType || '').toLowerCase();

    // Check transaction type first
    if (txType.includes('purchase') || txType === 'p' || txType === 'p-purchase') {
        return 'BUY';
    }
    if (txType.includes('sale') || txType === 's' || txType === 's-sale') {
        return 'SELL';
    }
    if (txType.includes('option') || txType.includes('exercise') || txType === 'm') {
        return 'OPTION';
    }
    if (txType.includes('gift') || txType === 'g' || txType === 'g-gift') {
        // Gifts are dispositions but not really sells - treat as OPTION (neutral)
        return 'OPTION';
    }

    // Fall back to acquisition/disposition flag
    if (trade.acquisitionOrDisposition === 'A') {
        return 'BUY';
    }
    if (trade.acquisitionOrDisposition === 'D') {
        return 'SELL';
    }

    return 'OPTION';
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
// BULK DATA CACHE
// ============================================

let allInsiderTradesCache: { data: InsiderTrade[]; timestamp: number } | null = null;
const BULK_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

/**
 * Fetch ALL recent insider trades (bulk endpoint)
 * This is much more efficient than per-ticker queries
 */
async function fetchAllInsiderTrades(): Promise<InsiderTrade[]> {
    // Check cache
    if (allInsiderTradesCache && Date.now() - allInsiderTradesCache.timestamp < BULK_CACHE_TTL) {
        console.log('[FMP] Using cached bulk insider data');
        return allInsiderTradesCache.data;
    }

    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) {
        throw new Error('[FMP] API key not configured');
    }

    console.log('[FMP] Fetching bulk insider trades...');

    // Fetch multiple pages to get more data
    const allTrades: InsiderTrade[] = [];
    const pagesToFetch = 5; // 500 trades total

    for (let page = 0; page < pagesToFetch; page++) {
        const url = `${FMP_BASE_URL}/insider-trading/latest?page=${page}&limit=100&apikey=${apiKey}`;
        const response = await fetch(url, {
            headers: { 'Accept': 'application/json' },
        });

        if (!response.ok) {
            console.error(`[FMP] API error: ${response.status} ${response.statusText}`);
            break;
        }

        const data: FMPInsiderTrade[] = await response.json();

        if (!Array.isArray(data) || data.length === 0) {
            break;
        }

        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

        const trades = data
            .filter(trade => {
                const tradeDate = new Date(trade.transactionDate);
                return !isNaN(tradeDate.getTime()) && tradeDate >= ninetyDaysAgo;
            })
            .map(trade => ({
                ticker: trade.symbol,
                name: trade.reportingName || 'Unknown',
                title: trade.typeOfOwner || 'Unknown',
                transactionType: parseTransactionType(trade),
                shares: Math.abs(trade.securitiesTransacted || 0),
                pricePerShare: trade.price || null,
                totalValue: trade.price && trade.securitiesTransacted
                    ? Math.abs(trade.price * trade.securitiesTransacted)
                    : null,
                filingDate: trade.filingDate,
                transactionDate: trade.transactionDate,
            }));

        allTrades.push(...trades);

        // Small delay between pages
        if (page < pagesToFetch - 1) {
            await new Promise(r => setTimeout(r, 100));
        }
    }

    console.log(`[FMP] Fetched ${allTrades.length} insider trades`);

    // Update cache
    allInsiderTradesCache = {
        data: allTrades,
        timestamp: Date.now(),
    };

    return allTrades;
}

/**
 * Get insider trades for a specific ticker (from bulk cache)
 */
async function fetchInsiderTrades(ticker: string): Promise<InsiderTrade[]> {
    try {
        const allTrades = await fetchAllInsiderTrades();
        const tickerUpper = ticker.toUpperCase();
        return allTrades.filter(t => t.ticker.toUpperCase() === tickerUpper);
    } catch (error) {
        console.error(`[FMP] Error fetching insider trades for ${ticker}:`, error);
        return [];
    }
}

/**
 * Fetch congressional trades for a ticker
 * NOTE: Currently returns empty - FMP congress endpoints don't work
 */
async function fetchCongressTrades(ticker: string): Promise<CongressTrade[]> {
    // FMP congress trading endpoints return empty arrays
    // TODO: Add alternative source (House Stock Watcher, etc.)
    return [];
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

    // Filter out options/gifts - only count real buys and sells
    const realInsiderTrades = insiderTrades.filter(t =>
        t.transactionType === 'BUY' || t.transactionType === 'SELL'
    );

    // ===== INSIDER SCORING =====
    const insiderBuys = realInsiderTrades.filter(t => t.transactionType === 'BUY');
    const insiderSells = realInsiderTrades.filter(t => t.transactionType === 'SELL');
    const insiderBuyRatio = realInsiderTrades.length > 0
        ? insiderBuys.length / realInsiderTrades.length
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
        /CEO|CFO|COO|President|Chairman|Chief/i.test(t.title)
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
 * Fetch and aggregate soft signals data
 */
async function fetchSoftSignalsFromApi(ticker: string): Promise<SoftSignalsData> {
    if (!isQuiverConfigured()) {
        console.warn('[FMP] API key not configured, returning empty soft signals');
        return getEmptySoftSignals();
    }

    try {
        // Fetch both data sources in parallel
        const [insiderTrades, congressTrades] = await Promise.all([
            fetchInsiderTrades(ticker),
            fetchCongressTrades(ticker),
        ]);

        // Filter to only real buys/sells for metrics
        const realInsiderTrades = insiderTrades.filter(t =>
            t.transactionType === 'BUY' || t.transactionType === 'SELL'
        );

        // Calculate metrics
        const insiderBuys = realInsiderTrades.filter(t => t.transactionType === 'BUY');
        const insiderSells = realInsiderTrades.filter(t => t.transactionType === 'SELL');
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
            insider_buy_ratio: realInsiderTrades.length > 0
                ? Math.round((insiderBuys.length / realInsiderTrades.length) * 100) / 100
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
            data_available: insiderTrades.length > 0 || congressTrades.length > 0,

            recent_insider_trades: insiderTrades.slice(0, 10),
            recent_congress_trades: congressTrades.slice(0, 10),
        };
    } catch (error) {
        console.error(`[FMP] Error fetching soft signals for ${ticker}:`, error);
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
    const key = cacheKey('fmp', 'soft_signals', ticker);

    try {
        const { data, cached } = await getOrFetch(
            key,
            TTL.SENTIMENT, // 1 hour TTL (same as sentiment)
            () => withLogging(
                'fmp',
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
        console.warn(`[FMP] Falling back to empty soft signals for ${ticker}`);
        return getEmptySoftSignals();
    }
}

/**
 * Get all tickers with recent insider activity
 * Useful for recommendations feature
 */
export async function getTickersWithInsiderActivity(): Promise<string[]> {
    try {
        const allTrades = await fetchAllInsiderTrades();
        const tickers = new Set(allTrades.map(t => t.ticker));
        return Array.from(tickers);
    } catch (error) {
        console.error('[FMP] Error getting tickers with insider activity:', error);
        return [];
    }
}
