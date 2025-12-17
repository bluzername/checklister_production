import {
    AnalysisResult,
    AnalysisParameters,
    TradingPlan,
    MarketStatus,
    TrendStatus,
    PatternType,
    SectorRank
} from './types';
import { getFundamentals, FundamentalsData } from './data-services/fmp';
import { analyzeSentiment, SentimentData } from './data-services/sentiment';
import { withLogging } from './data-services/logger';
import {
    getHistoricalPrices,
    getQuote,
    getProviderStatus,
    ChartData,
    PriceQuote
} from './data-services/price-provider';
import { 
    detectMarketRegime, 
    getRegimeThresholds, 
    passesRegimeThreshold,
    MarketRegime,
    RegimeAnalysis,
    RegimeThresholds
} from './market-regime';
import {
    getMultiTimeframeAlignment,
    has4HConfirmation,
    MultiTimeframeAnalysis
} from './multi-timeframe';
import {
    calculateVolumeProfile,
    VolumeProfileMetrics
} from './volume-profile';
import {
    analyzeDivergences,
    analyzeAdaptiveRSI,
    DivergenceAnalysis,
    AdaptiveRSIAnalysis
} from './momentum';
import {
    predictProbability,
    DEFAULT_COEFFICIENTS,
    ModelCoefficients,
    getActiveCoefficients,
} from './model';
import { extractFeatureVector, FeatureVector } from './backtest/types';
import { computeV2Features, convertToPriceBars, PriceBar } from './trade-plan/feature-v2';
import { evaluateVeto, type VetoResult } from './trade-plan/veto-system';
import type { VetoAnalysis } from './types';

// Model configuration - can be swapped out for trained model
// Will be lazily initialized with trained coefficients if available
let activeModelCoefficients: ModelCoefficients | null = null;
let coefficientsInitialized = false;

/**
 * Initialize model coefficients
 * Loads trained coefficients if available, otherwise uses defaults
 */
function initializeCoefficients(): ModelCoefficients {
    if (!coefficientsInitialized) {
        try {
            activeModelCoefficients = getActiveCoefficients();
        } catch {
            activeModelCoefficients = DEFAULT_COEFFICIENTS;
        }
        coefficientsInitialized = true;
    }
    return activeModelCoefficients || DEFAULT_COEFFICIENTS;
}

/**
 * Set the active model coefficients (for using trained models)
 */
export function setModelCoefficients(coefficients: ModelCoefficients): void {
    activeModelCoefficients = coefficients;
    coefficientsInitialized = true;
}

/**
 * Get current model coefficients
 */
export function getModelCoefficients(): ModelCoefficients {
    return initializeCoefficients();
}

// Sector ETF mapping
const SECTOR_ETFS: Record<string, string> = {
    'Technology': 'XLK',
    'Financial Services': 'XLF',
    'Healthcare': 'XLV',
    'Consumer Cyclical': 'XLY',
    'Communication Services': 'XLC',
    'Industrials': 'XLI',
    'Consumer Defensive': 'XLP',
    'Energy': 'XLE',
    'Utilities': 'XLU',
    'Real Estate': 'XLRE',
    'Basic Materials': 'XLB',
};

// High-impact catalyst keywords
const CATALYST_KEYWORDS = [
    'merger', 'acquisition', 'fda approval', 'contract', 'earnings beat',
    'regulation', 'sanction', 'partnership', 'buyback', 'dividend',
    'upgrade', 'breakthrough', 'launch', 'expansion', 'deal'
];

// ============================================
// HELPER FUNCTIONS
// ============================================

function calculateSMA(data: number[], period: number): number {
    if (data.length < period) return 0;
    const slice = data.slice(0, period);
    const sum = slice.reduce((a, b) => a + b, 0);
    return sum / period;
}

function calculateEMA(data: number[], period: number): number {
    if (data.length < period) return 0;
    const k = 2 / (period + 1);
    const window = Math.min(data.length, period * 5);
    const startIdx = data.length - window;
    let ema = data[startIdx];
    for (let i = startIdx + 1; i < data.length; i++) {
        ema = (data[i] * k) + (ema * (1 - k));
    }
    return ema;
}

function calculateRSI(prices: number[], period: number = 14): number {
    if (prices.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    // prices are in reverse order (newest first)
    for (let i = 0; i < period; i++) {
        const change = prices[i] - prices[i + 1];
        if (change > 0) gains += change;
        else losses += Math.abs(change);
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

// Average True Range calculation
function calculateATR(highs: number[], lows: number[], closes: number[], period: number = 14): number {
    if (highs.length < period + 1) return 0;
    
    let atrSum = 0;
    for (let i = 0; i < period; i++) {
        const high = highs[i];
        const low = lows[i];
        const prevClose = closes[i + 1];
        
        const tr = Math.max(
            high - low,
            Math.abs(high - prevClose),
            Math.abs(low - prevClose)
        );
        atrSum += tr;
    }
    return atrSum / period;
}

// Find swing low (lowest low of last N days)
function findSwingLow(lows: number[], period: number = 10): number {
    return Math.min(...lows.slice(0, period));
}

// Find swing high (highest high of last N days)
function findSwingHigh(highs: number[], period: number = 10): number {
    return Math.max(...highs.slice(0, period));
}

// Calculate Fibonacci retracement levels
function calculateFibLevels(swingLow: number, swingHigh: number): { level_382: number; level_500: number; level_618: number } {
    const range = swingHigh - swingLow;
    return {
        level_382: swingHigh - (range * 0.382),
        level_500: swingHigh - (range * 0.5),
        level_618: swingHigh - (range * 0.618)
    };
}

// Check if price is in Fibonacci buy zone
function isInFibBuyZone(price: number, fibLevels: { level_382: number; level_500: number; level_618: number }, tolerance: number = 0.02): { inZone: boolean; level: string } {
    const { level_382, level_500, level_618 } = fibLevels;
    
    if (Math.abs(price - level_382) / level_382 <= tolerance) {
        return { inZone: true, level: '0.382' };
    }
    if (Math.abs(price - level_500) / level_500 <= tolerance) {
        return { inZone: true, level: '0.500' };
    }
    if (Math.abs(price - level_618) / level_618 <= tolerance) {
        return { inZone: true, level: '0.618' };
    }
    return { inZone: false, level: 'N/A' };
}

// Detect Hammer candlestick pattern
function detectHammer(open: number, high: number, low: number, close: number): boolean {
    const bodySize = Math.abs(close - open);
    const totalRange = high - low;
    const lowerWick = Math.min(open, close) - low;
    
    if (totalRange === 0) return false;
    
    // Hammer: Long lower wick, small body at top
    const hasLongLowerWick = (totalRange > 3 * bodySize);
    const wickRatio = lowerWick / totalRange;
    
    return hasLongLowerWick && wickRatio > 0.6;
}

// Detect Bull Flag pattern
function detectBullFlag(prices: number[], highs: number[], lows: number[]): { detected: boolean; poleGain: number; consolidationDays: number } {
    if (prices.length < 15) return { detected: false, poleGain: 0, consolidationDays: 0 };
    
    // Look for pole: > 10% gain in < 5 days
    let poleFound = false;
    let poleEndIdx = 0;
    let poleGain = 0;
    
    for (let i = 5; i < Math.min(15, prices.length); i++) {
        const gain = (prices[i - 5] - prices[i]) / prices[i] * 100;
        if (gain >= 10) {
            poleFound = true;
            poleEndIdx = i - 5;
            poleGain = gain;
            break;
        }
    }
    
    if (!poleFound) return { detected: false, poleGain: 0, consolidationDays: 0 };
    
    // Check consolidation: 3-10 days of sideways/down without retracing > 50% of pole
    const poleTop = Math.max(...highs.slice(poleEndIdx, poleEndIdx + 5));
    const poleBottom = Math.min(...lows.slice(poleEndIdx, poleEndIdx + 5));
    const poleHeight = poleTop - poleBottom;
    
    let consolidationDays = 0;
    for (let i = 0; i < poleEndIdx && i < 10; i++) {
        const retracement = (poleTop - lows[i]) / poleHeight;
        if (retracement <= 0.5) {
            consolidationDays++;
        } else {
            break;
        }
    }
    
    const detected = consolidationDays >= 3 && consolidationDays <= 10;
    return { detected, poleGain, consolidationDays };
}

// Detect Gap Up
function detectGapUp(todayOpen: number, yesterdayHigh: number): { detected: boolean; gapPercent: number } {
    const gapPercent = ((todayOpen - yesterdayHigh) / yesterdayHigh) * 100;
    return {
        detected: gapPercent >= 2,
        gapPercent
    };
}

// Check Higher Highs / Higher Lows
function checkTrendStructure(highs: number[], lows: number[]): { higherHighs: boolean; higherLows: boolean } {
    if (highs.length < 6 || lows.length < 6) return { higherHighs: false, higherLows: false };
    
    // Today's low > lowest low of last 5 days
    const todayLow = lows[0];
    const lowestOf5 = Math.min(...lows.slice(1, 6));
    const higherLows = todayLow > lowestOf5;
    
    // Today's high > last swing high (highest of previous 5-10 days)
    const todayHigh = highs[0];
    const lastSwingHigh = Math.max(...highs.slice(1, 6));
    const higherHighs = todayHigh > lastSwingHigh;
    
    return { higherHighs, higherLows };
}

// Calculate accumulation/distribution
function analyzeAccumulationDistribution(opens: number[], closes: number[], volumes: number[], avgVolume: number): { accDays: number; distDays: number } {
    let accDays = 0;
    let distDays = 0;
    
    const lookback = Math.min(20, opens.length);
    for (let i = 0; i < lookback; i++) {
        const isGreen = closes[i] > opens[i];
        const isRed = closes[i] < opens[i];
        const aboveAvg = volumes[i] > avgVolume;
        const belowAvg = volumes[i] < avgVolume;
        
        if (isGreen && aboveAvg) accDays++;
        if (isRed && belowAvg) distDays++;
    }
    
    return { accDays, distDays };
}

// Check if 5-day volume SMA is rising
function isVolumeSmaRising(volumes: number[]): boolean {
    if (volumes.length < 10) return false;
    
    const sma5_current = calculateSMA(volumes.slice(0, 5), 5);
    const sma5_prev = calculateSMA(volumes.slice(1, 6), 5);
    const sma5_prev2 = calculateSMA(volumes.slice(2, 7), 5);
    
    return sma5_current > sma5_prev && sma5_prev > sma5_prev2;
}

// Fetch market data (SPY/SPX) - supports point-in-time for backtesting
async function fetchMarketData(asOfDate?: Date): Promise<{
    price: number;
    sma50: number;
    sma200: number;
    goldenCross: boolean;
}> {
    try {
        const endDate = asOfDate || new Date();
        const startDate = new Date(endDate.getTime() - 250 * 24 * 60 * 60 * 1000);

        const chartData = await getHistoricalPrices('SPY', startDate, endDate);

        if (!chartData.prices || chartData.prices.length === 0) {
            return { price: 0, sma50: 0, sma200: 0, goldenCross: false };
        }

        // Filter to only include data up to asOfDate
        let prices = chartData.prices;
        if (asOfDate) {
            const asOfTime = asOfDate.getTime();
            const filteredIndices = chartData.dates
                .map((d, i) => ({ date: new Date(d).getTime(), index: i }))
                .filter(item => item.date <= asOfTime)
                .map(item => item.index);
            prices = filteredIndices.map(i => chartData.prices[i]);
        }

        const price = prices[0];
        const sma50 = calculateSMA(prices, 50);
        const sma200 = calculateSMA(prices, 200);
        const goldenCross = sma50 > sma200;

        return { price, sma50, sma200, goldenCross };
    } catch {
        return { price: 0, sma50: 0, sma200: 0, goldenCross: false };
    }
}

// Fetch VIX data - supports point-in-time for backtesting
async function fetchVIXLevel(asOfDate?: Date): Promise<number> {
    try {
        if (asOfDate) {
            // For backtesting, get historical VIX data
            const startDate = new Date(asOfDate.getTime() - 5 * 24 * 60 * 60 * 1000);
            // FMP uses UVXY as VIX proxy, or we can use ^VIX with Yahoo fallback
            const chartData = await getHistoricalPrices('^VIX', startDate, asOfDate);

            if (chartData.prices && chartData.prices.length > 0) {
                // Get the last price on or before asOfDate
                const asOfTime = asOfDate.getTime();
                for (let i = 0; i < chartData.dates.length; i++) {
                    if (new Date(chartData.dates[i]).getTime() <= asOfTime) {
                        return chartData.prices[i];
                    }
                }
            }
            return 20;
        }

        // For live analysis, use current quote
        const quote = await getQuote('^VIX');
        return quote?.price || 20;
    } catch {
        return 20; // Default moderate VIX
    }
}

// Fetch sector ETF data and calculate RS - supports point-in-time for backtesting
async function fetchSectorData(sectorETF: string, asOfDate?: Date): Promise<{
    rs20d: number;
    rs60d: number;
}> {
    try {
        const endDate = asOfDate || new Date();
        const startDate = new Date(endDate.getTime() - 90 * 24 * 60 * 60 * 1000);

        const [sectorData, spyData] = await Promise.all([
            getHistoricalPrices(sectorETF, startDate, endDate),
            getHistoricalPrices('SPY', startDate, endDate)
        ]);

        // Filter to only include data up to asOfDate
        const asOfTime = asOfDate ? asOfDate.getTime() : Date.now();

        const filterPrices = (data: ChartData): number[] => {
            const result: number[] = [];
            for (let i = 0; i < data.dates.length; i++) {
                if (new Date(data.dates[i]).getTime() <= asOfTime) {
                    result.push(data.prices[i]);
                }
            }
            return result;
        };

        const sectorPrices = filterPrices(sectorData);
        const spyPrices = filterPrices(spyData);

        if (sectorPrices.length < 20 || spyPrices.length < 20) {
            return { rs20d: 1, rs60d: 1 };
        }

        // 20-day RS
        const sector20dChange = (sectorPrices[0] - sectorPrices[19]) / sectorPrices[19] * 100;
        const spy20dChange = (spyPrices[0] - spyPrices[19]) / spyPrices[19] * 100;
        const rs20d = spy20dChange !== 0 ? sector20dChange / spy20dChange : 1;

        // 60-day RS
        const sector60dChange = (sectorPrices[0] - sectorPrices[Math.min(59, sectorPrices.length - 1)]) / sectorPrices[Math.min(59, sectorPrices.length - 1)] * 100;
        const spy60dChange = (spyPrices[0] - spyPrices[Math.min(59, spyPrices.length - 1)]) / spyPrices[Math.min(59, spyPrices.length - 1)] * 100;
        const rs60d = spy60dChange !== 0 ? sector60dChange / spy60dChange : 1;

        return { rs20d, rs60d };
    } catch {
        return { rs20d: 1, rs60d: 1 };
    }
}

// ============================================
// SCORING FUNCTIONS
// ============================================

/**
 * Calculate success probability using ML model or fallback to heuristic
 * 
 * When a trained model is available, it uses the logistic regression model
 * with calibrated probabilities. Otherwise, falls back to simple score sum.
 */
export function calculateSuccessProbability(
    parameters: AnalysisParameters,
    result?: Partial<AnalysisResult>,
    useModel: boolean = true
): number {
    // Fallback heuristic: simple weighted sum of scores
    const scores = [
        parameters["1_market_condition"].score,
        parameters["2_sector_condition"].score,
        parameters["3_company_condition"].score,
        parameters["4_catalyst"].score,
        parameters["5_patterns_gaps"].score,
        parameters["6_support_resistance"].score,
        parameters["7_price_movement"].score,
        parameters["8_volume"].score,
        parameters["9_ma_fibonacci"].score,
        parameters["10_rsi"].score,
    ];

    const totalScore = scores.reduce((a, b) => a + b, 0);
    const heuristicProbability = totalScore;

    // If model usage is disabled or no result to extract features from, use heuristic
    if (!useModel || !result) {
        return Math.round(heuristicProbability * 10) / 10;
    }

    // Try to use ML model if trained coefficients are available
    try {
        const coefficients = initializeCoefficients();
        if (coefficients.trainingSamples > 0) {
            // Build a minimal AnalysisResult for feature extraction
            const fullResult: AnalysisResult = {
                ticker: result.ticker || 'UNKNOWN',
                timestamp: result.timestamp || new Date().toISOString(),
                current_price: result.current_price || 0,
                timeframe: result.timeframe || 'Daily',
                trade_type: result.trade_type || 'HOLD',
                parameters,
                success_probability: heuristicProbability,
                confidence_rating: 'MODERATE',
                recommendation: 'HOLD',
                trading_plan: result.trading_plan || {} as TradingPlan,
                risk_analysis: result.risk_analysis || {} as AnalysisResult['risk_analysis'],
                qualitative_assessment: result.qualitative_assessment || {} as AnalysisResult['qualitative_assessment'],
                disclaimers: [],
                chart_data: [],
                market_regime: result.market_regime,
                multi_timeframe: result.multi_timeframe,
                volume_profile: result.volume_profile,
                divergence: result.divergence,
                adaptive_rsi: result.adaptive_rsi,
            };

            const features = extractFeatureVector(fullResult);
            const modelProbability = predictProbability(features, coefficients);
            return Math.round(modelProbability * 10) / 10;
        }
    } catch (error) {
        console.warn('Model prediction failed, using heuristic:', error);
    }

    return Math.round(heuristicProbability * 10) / 10;
}

export function getConfidenceRating(probability: number): string {
    if (probability >= 70) return "HIGH";
    if (probability >= 50) return "MODERATE";
    return "LOW";
}

export function getRecommendation(probability: number): string {
    if (probability >= 80) return "BUY - STRONG";
    if (probability >= 70) return "BUY";
    if (probability >= 50) return "HOLD / WATCH";
    return "AVOID";
}

// ============================================
// MAIN ANALYSIS FUNCTION
// ============================================

/**
 * Analyze a ticker for swing trading opportunities
 * @param ticker - Stock ticker symbol
 * @param asOfDate - Optional: For backtesting, analyze as if on this date (uses only data up to this date)
 */
export async function analyzeTicker(ticker: string, asOfDate?: Date): Promise<AnalysisResult> {
    const isBacktest = !!asOfDate;

    // For backtesting, we need historical data; for live, we can use quote
    const endDate = asOfDate || new Date();
    const startDate = new Date(endDate.getTime() - 250 * 24 * 60 * 60 * 1000);

    // Fetch historical data using the unified price provider
    const chartData = await getHistoricalPrices(ticker, startDate, endDate);

    if (!chartData.prices || chartData.prices.length === 0) {
        throw new Error("Invalid Ticker or No Historical Data");
    }

    // Filter historical data to only include data up to asOfDate
    const asOfTime = asOfDate ? asOfDate.getTime() : Date.now();

    // Build filtered arrays for point-in-time analysis
    const filteredIndices: number[] = [];
    for (let i = 0; i < chartData.dates.length; i++) {
        if (new Date(chartData.dates[i]).getTime() <= asOfTime) {
            filteredIndices.push(i);
        }
    }

    if (filteredIndices.length === 0) {
        throw new Error("No data available for the specified date");
    }

    // For backtest: use last available close price; for live: try to get current quote
    let currentPrice: number;
    let sector: string;
    let marketCap: number;

    if (isBacktest) {
        // Use the close price on/before asOfDate (first index is newest)
        currentPrice = chartData.prices[filteredIndices[0]];
        // For backtesting, we need to get sector info from quote (assume it's stable)
        try {
            const quote = await getQuote(ticker);
            sector = quote?.sector || 'Technology';
            marketCap = quote?.marketCap ? quote.marketCap / 1_000_000_000 : 0;
        } catch {
            sector = 'Technology';
            marketCap = 0;
        }
    } else {
        // Live analysis - fetch current quote
        const quote = await getQuote(ticker);

        if (!quote || !quote.price) {
            throw new Error("Invalid Ticker or No Data Available");
        }

        currentPrice = quote.price;
        sector = quote.sector || 'Technology';
        marketCap = quote.marketCap ? quote.marketCap / 1_000_000_000 : 0;
    }

    // Process historical data (already in newest-first order from price provider)
    const dates = filteredIndices.map(i => chartData.dates[i]);
    const prices = filteredIndices.map(i => chartData.prices[i]);
    const opens = filteredIndices.map(i => chartData.opens[i]);
    const highs = filteredIndices.map(i => chartData.highs[i]);
    const lows = filteredIndices.map(i => chartData.lows[i]);
    const volumes = filteredIndices.map(i => chartData.volumes[i]);

    // Fetch additional market data and premium data services in parallel
    // Pass asOfDate for point-in-time analysis
    const [marketData, vixLevel, fundamentals, sentiment, regimeAnalysis, spyChartData] = await Promise.all([
        fetchMarketData(asOfDate),
        fetchVIXLevel(asOfDate),
        getFundamentals(ticker, asOfDate), // PIT safety: pass asOfDate for backtesting
        // For backtesting, skip sentiment analysis (Claude can't see historical news)
        isBacktest ? Promise.resolve({
            sentiment_score: 0,
            sentiment_label: 'NEUTRAL' as const,
            catalyst_detected: false,
            catalyst_keywords: [],
            catalyst_type: null,
            summary: 'Historical analysis - sentiment not available',
            confidence: 0,
            data_available: false,
        }) : analyzeSentiment(ticker),
        detectMarketRegime(asOfDate),
        // Fetch SPY OHLCV data for veto model features
        getHistoricalPrices('SPY', startDate, endDate)
    ]);
    
    // Get regime-adjusted thresholds
    const regimeThresholds = getRegimeThresholds(regimeAnalysis.regime);
    
    // Calculate all technical indicators
    const sma20 = calculateSMA(prices, 20);
    const sma50 = calculateSMA(prices, 50);
    const sma100 = calculateSMA(prices, 100);
    const sma200 = calculateSMA(prices, 200);
    const ema8 = calculateEMA([...prices].reverse(), 8);
    const ema20 = calculateEMA([...prices].reverse(), 20);
    const ema50 = calculateEMA([...prices].reverse(), 50);
    const rsi = calculateRSI(prices, 14);
    
    // Volume calculations
    const currentVolume = volumes[0];
    const avgVolume30 = calculateSMA(volumes, 30);
    const rvol = avgVolume30 > 0 ? currentVolume / avgVolume30 : 1;
    
    // ATR and swing levels
    const atr = calculateATR(highs, lows, prices, 14);
    const swingLow = findSwingLow(lows, 10);
    const swingHigh = findSwingHigh(highs, 50);
    const swingLow50 = findSwingLow(lows, 50);
    
    // Fibonacci levels
    const fibLevels = calculateFibLevels(swingLow50, swingHigh);
    const fibZone = isInFibBuyZone(currentPrice, fibLevels);
    
    // Pattern detection
    const gapResult = prices.length > 1 ? detectGapUp(opens[0], highs[1]) : { detected: false, gapPercent: 0 };
    const bullFlagResult = detectBullFlag(prices, highs, lows);
    const hammerDetected = detectHammer(opens[0], highs[0], lows[0], prices[0]);
    const trendStructure = checkTrendStructure(highs, lows);
    
    // Volume analysis
    const { accDays, distDays } = analyzeAccumulationDistribution(opens, prices, volumes, avgVolume30);
    const volumeSmaRising = isVolumeSmaRising(volumes);
    
    // Sector data
    const sectorETF = SECTOR_ETFS[sector] || 'SPY';
    const sectorData = await fetchSectorData(sectorETF, asOfDate);
    
    // ============================================
    // CRITERION 1: Market Condition (The "Tide")
    // ============================================
    const spxAbove50SMA = marketData.price > marketData.sma50;
    const vixSafe = vixLevel < 25;
    let marketStatus: MarketStatus = 'NEUTRAL';
    let marketScore = 5;
    
    if (spxAbove50SMA && marketData.goldenCross && vixSafe) {
        marketStatus = 'BULLISH';
        marketScore = 10;
    } else if (spxAbove50SMA && marketData.goldenCross) {
        marketStatus = 'BULLISH';
        marketScore = 8;
    } else if (spxAbove50SMA) {
        marketStatus = 'NEUTRAL';
        marketScore = 6;
    } else if (!spxAbove50SMA && !marketData.goldenCross) {
        marketStatus = 'BEARISH';
        marketScore = 2;
    } else {
        marketStatus = 'BEARISH';
        marketScore = 4;
    }
    
    // ============================================
    // CRITERION 2: Sector Condition (Relative Strength)
    // ============================================
    const avgRS = (sectorData.rs20d + sectorData.rs60d) / 2;
    const outperforming = avgRS > 1.0;
    let sectorRank: SectorRank = 'MIDDLE';
    let sectorScore = 5;
    
    if (avgRS > 1.2) {
        sectorRank = 'TOP_3';
        sectorScore = 10;
    } else if (avgRS > 1.0) {
        sectorRank = 'TOP_3';
        sectorScore = 8;
    } else if (avgRS > 0.8) {
        sectorRank = 'MIDDLE';
        sectorScore = 5;
    } else {
        sectorRank = 'BOTTOM_3';
        sectorScore = 2;
    }
    
    // ============================================
    // CRITERION 3: Company & Fundamental Condition
    // ============================================
    // Use EODHD fundamentals data when available, fallback to market cap
    const earningsSurprise = fundamentals.earnings_surprise;
    const revenueGrowth = fundamentals.revenue_growth_qoq ?? 0;
    const fundamentalsAvailable = fundamentals.data_available;
    
    let companyScore = 5;
    
    if (fundamentalsAvailable) {
        // New scoring with actual fundamentals data
        const hasEarningsBeat = earningsSurprise;
        const hasStrongGrowth = revenueGrowth > 20;
        const hasModerateGrowth = revenueGrowth > 10;
        const hasEarningsMiss = fundamentals.eps_actual !== null && 
                                fundamentals.eps_expected !== null && 
                                fundamentals.eps_actual < fundamentals.eps_expected;
        const hasRevenueDeclining = revenueGrowth < 0;
        
        if (hasEarningsBeat && hasStrongGrowth) {
            companyScore = 10; // Earnings beat + Revenue growth > 20%
        } else if (hasEarningsBeat || hasStrongGrowth) {
            companyScore = 8;  // Earnings beat OR Revenue growth > 20%
        } else if (hasModerateGrowth) {
            companyScore = 7;  // Revenue growth > 10%
        } else if (hasEarningsMiss && hasRevenueDeclining) {
            companyScore = 1;  // Earnings miss + Revenue declining
        } else if (hasEarningsMiss) {
            companyScore = 3;  // Earnings miss
        } else {
            companyScore = 5;  // Neutral (no data or mixed)
        }
    } else {
        // Fallback: Use market cap as proxy for company quality
        if (marketCap > 50) companyScore = 8; // Large cap
        else if (marketCap > 10) companyScore = 7;
        else if (marketCap > 2) companyScore = 5;
        else companyScore = 3; // Small cap higher risk
    }
    
    // ============================================
    // CRITERION 4: Actual Game Changer (Catalyst & RVOL)
    // ============================================
    const rvolThresholdMet = rvol >= 1.5;
    const highRvol = rvol >= 2.0;
    
    // Use sentiment analysis for catalyst detection
    const sentimentAvailable = sentiment.data_available;
    const hasCatalyst = sentiment.catalyst_detected || rvolThresholdMet;
    const detectedKeywords = sentiment.catalyst_keywords;
    const sentimentScore = sentiment.sentiment_score; // -1 to +1
    const positiveSentiment = sentimentScore > 0.3;
    const negativeSentiment = sentimentScore < -0.3;
    
    let catalystScore = 5;
    
    if (sentimentAvailable) {
        // Enhanced scoring with sentiment + RVOL
        if (highRvol && sentiment.catalyst_detected && positiveSentiment) {
            catalystScore = 10; // RVOL >= 2.0 + Positive catalyst detected
        } else if (sentiment.catalyst_detected && positiveSentiment) {
            catalystScore = 9;  // Positive catalyst detected (merger, FDA, etc.)
        } else if (highRvol) {
            catalystScore = 8;  // RVOL >= 2.0
        } else if (rvolThresholdMet || (positiveSentiment && !sentiment.catalyst_detected)) {
            catalystScore = 7;  // RVOL >= 1.5 OR mild positive sentiment
        } else if (negativeSentiment) {
            catalystScore = 3;  // Negative sentiment detected
        } else {
            catalystScore = 5;  // Neutral
        }
    } else {
        // Fallback: RVOL-only scoring
        if (rvol >= 3.0) catalystScore = 10;
        else if (rvol >= 2.0) catalystScore = 8;
        else if (rvol >= 1.5) catalystScore = 7;
        else if (rvol >= 1.0) catalystScore = 5;
        else catalystScore = 3;
    }
    
    // ============================================
    // CRITERION 5: Patterns & Gaps
    // ============================================
    let patternType: PatternType | string = 'NONE';
    let patternScore = 5;
    
    if (gapResult.detected && gapResult.gapPercent >= 2) {
        patternType = 'GAP_UP';
        patternScore = 9;
    } else if (bullFlagResult.detected) {
        patternType = 'BULL_FLAG';
        patternScore = 9;
    } else if (currentPrice > swingHigh && rvol > 1.2) {
        patternType = 'BREAKOUT';
            patternScore = 10;
    } else {
        patternScore = 4;
    }
    
    // ============================================
    // CRITERION 6: Support, Resistance & Stabilizations
    // ============================================
    const nearEma20 = Math.abs(currentPrice - ema20) / ema20 <= 0.03;
    const nearEma50 = Math.abs(currentPrice - ema50) / ema50 <= 0.03;
    const stopLossLevel = swingLow - (0.025 * atr);  // WIDENED: 2.5% ATR buffer to reduce false stops
    const risk = currentPrice - stopLossLevel;
    const takeProfitLevel = currentPrice + (2 * risk);
    const rrRatio = risk > 0 ? (takeProfitLevel - currentPrice) / risk : 0;
    const rrPasses = rrRatio >= 2.0;
    
    let supportScore = 5;
    if (rrPasses && (nearEma20 || nearEma50)) {
        supportScore = 10;
    } else if (rrPasses) {
        supportScore = 8;
    } else if (nearEma20 || nearEma50) {
        supportScore = 6;
    } else {
        supportScore = 4;
    }
    
    // ============================================
    // CRITERION 7: Price Action (Trend Structure)
    // ============================================
    const { higherHighs, higherLows } = trendStructure;
    let trendStatus: TrendStatus = 'CONSOLIDATION';
    let priceActionScore = 5;
    
    if (higherHighs && higherLows) {
        trendStatus = 'UPTREND';
        priceActionScore = hammerDetected ? 10 : 9;
    } else if (higherLows) {
        trendStatus = 'UPTREND';
        priceActionScore = 7;
    } else if (!higherHighs && !higherLows) {
        trendStatus = 'DOWNTREND';
        priceActionScore = 2;
    }
    
    // ============================================
    // CRITERION 8: Volume (The "Lie Detector") - UPGRADED with Volume Profile
    // ============================================
    const volumeProfile = calculateVolumeProfile(opens, highs, lows, prices, volumes);
    const volumeConfirms = volumeProfile.interpretation === 'ACCUMULATION' || 
                          volumeProfile.interpretation === 'STRONG_ACCUMULATION';
    
    // Use volume profile score directly (already 0-10 scale)
    let volumeScore = volumeProfile.overallScore;
    
    // Legacy fallback checks (for compatibility)
    if (volumeScore < 5 && accDays > distDays && volumeSmaRising) {
        volumeScore = Math.max(volumeScore, 6); // Minimum 6 if old logic passes
    }
    
    // Bonus for strong accumulation patterns
    if (volumeProfile.smartMoneySignal === 'BUYING' && volumeProfile.details.institutionalActivity) {
        volumeScore = Math.min(10, volumeScore + 1);
    }
    
    // Penalty for distribution signals
    if (volumeProfile.smartMoneySignal === 'SELLING') {
        volumeScore = Math.max(2, volumeScore - 2);
    }
    
    // ============================================
    // CRITERION 9: Averages & Fibonacci
    // ============================================
    const priceAbove200SMA = sma200 > 0 ? currentPrice > sma200 : true;
    const priceAbove20EMA = currentPrice > ema20;
    const inBuyZone = fibZone.inZone || (nearEma20 || nearEma50);
    
    let maFibScore = 5;
    if (priceAbove200SMA && priceAbove20EMA && inBuyZone) {
        maFibScore = 10;
    } else if (priceAbove200SMA && priceAbove20EMA) {
        maFibScore = 8;
    } else if (priceAbove200SMA) {
        maFibScore = 6;
    } else {
        maFibScore = 3;
    }
    
    // ============================================
    // CRITERION 10: RSI (Relative Strength Index) - UPGRADED with Adaptive Thresholds & Divergence
    // ============================================
    // Phase 4: Adaptive RSI thresholds based on volatility
    const adaptiveRSI = analyzeAdaptiveRSI(rsi, atr, currentPrice);
    
    // Phase 4: Divergence detection for early exit/entry signals
    const divergenceAnalysis = analyzeDivergences(prices);
    
    // Use adaptive RSI score as base
    let rsiScore = adaptiveRSI.score;
    
    // Apply divergence adjustments
    if (divergenceAnalysis.strongest.type !== 'NONE') {
        if (divergenceAnalysis.strongest.implication === 'EXIT_SIGNAL' && 
            divergenceAnalysis.strongest.strength >= 5) {
            // Bearish divergence - reduce score
            rsiScore = Math.max(2, rsiScore - 3);
        } else if (divergenceAnalysis.strongest.implication === 'ENTRY_SIGNAL' && 
                   divergenceAnalysis.strongest.strength >= 5) {
            // Bullish divergence - increase score
            rsiScore = Math.min(10, rsiScore + 2);
        }
    }
    
    // Legacy variables for compatibility
    const inBullRange = rsi >= adaptiveRSI.thresholds.oversold && rsi <= adaptiveRSI.thresholds.overbought;
    const dipBuySignal = rsi >= adaptiveRSI.thresholds.optimalBuyLow && rsi <= adaptiveRSI.thresholds.optimalBuyHigh;
    const positiveMomentum = rsi > 50;
    const overextended = rsi > adaptiveRSI.thresholds.overbought;
    const optimalRange = adaptiveRSI.zone === 'OPTIMAL_BUY';

    // MEAN REVERSION: Buy oversold conditions (RSI < 35)
    const meanReversionSignal = rsi <= 35;
    const deeplyOversold = rsi <= 25;  // Very strong buy signal
    
    // ============================================
    // BUILD PARAMETERS OBJECT
    // ============================================
    const parameters: AnalysisParameters = {
        "1_market_condition": {
            status: marketStatus,
            spx_trend: marketData.goldenCross ? "Golden Cross (50 > 200 SMA)" : "Death Cross",
            spx_price: marketData.price,
            spx_sma50: marketData.sma50,
            spx_sma200: marketData.sma200,
            golden_cross: marketData.goldenCross,
            vix_level: vixLevel,
            vix_safe: vixSafe,
            score: marketScore,
            rationale: `SPY ${spxAbove50SMA ? 'above' : 'below'} 50 SMA, ${marketData.goldenCross ? 'Golden Cross' : 'No Golden Cross'}, VIX: ${vixLevel.toFixed(1)}`
        },
        "2_sector_condition": {
            sector: sector,
            sector_etf: sectorETF,
            rs_score_20d: Math.round(sectorData.rs20d * 100) / 100,
            rs_score_60d: Math.round(sectorData.rs60d * 100) / 100,
            sector_rank: sectorRank,
            outperforming: outperforming,
            status: outperforming ? 'OUTPERFORMING' : 'UNDERPERFORMING',
            score: sectorScore,
            rationale: `${sector} (${sectorETF}) RS: ${avgRS.toFixed(2)} vs SPY - ${sectorRank.replace('_', ' ')}`
        },
        "3_company_condition": {
            status: companyScore >= 7 ? 'POSITIVE' : companyScore >= 5 ? 'NEUTRAL' : 'NEGATIVE',
            earnings_surprise: earningsSurprise,
            revenue_growth_qoq: revenueGrowth,
            meets_growth_threshold: revenueGrowth > 20,
            sentiment_score: sentiment.sentiment_score,
            market_cap: fundamentals.market_cap ?? marketCap,
            earnings_status: fundamentalsAvailable 
                ? (earningsSurprise ? 'Beat' : fundamentals.eps_actual !== null ? 'Miss/Meet' : 'N/A')
                : 'N/A (API not configured)',
            guidance: 'N/A',
            score: companyScore,
            rationale: fundamentalsAvailable
                ? `EPS: ${fundamentals.eps_actual?.toFixed(2) ?? 'N/A'} vs ${fundamentals.eps_expected?.toFixed(2) ?? 'N/A'} | Rev Growth: ${revenueGrowth.toFixed(1)}%`
                : `Market Cap: $${marketCap.toFixed(1)}B - ${marketCap > 10 ? 'Large' : marketCap > 2 ? 'Mid' : 'Small'} Cap`
        },
        "4_catalyst": {
            present: hasCatalyst,
            has_catalyst: hasCatalyst,
            rvol: Math.round(rvol * 100) / 100,
            rvol_threshold_met: rvolThresholdMet,
            catalyst_keywords: detectedKeywords,
            catalyst_type: sentiment.catalyst_type || (rvolThresholdMet ? 'High Interest (RVOL)' : 'None'),
            strength: sentiment.catalyst_detected ? 'STRONG' : rvol >= 2 ? 'STRONG' : rvol >= 1.5 ? 'MODERATE' : 'WEAK',
            timeframe: 'Current',
            score: catalystScore,
            rationale: sentimentAvailable
                ? `RVOL: ${rvol.toFixed(2)}x | Sentiment: ${sentiment.sentiment_label} (${sentiment.sentiment_score.toFixed(2)})${sentiment.catalyst_detected ? ' | Catalyst: ' + sentiment.summary : ''}`
                : `RVOL: ${rvol.toFixed(2)}x (${rvolThresholdMet ? '≥1.5 threshold met' : 'below 1.5 threshold'})`
        },
        "5_patterns_gaps": {
            pattern: patternType,
            gap_detected: gapResult.detected,
            gap_percent: Math.round(gapResult.gapPercent * 100) / 100,
            bull_flag_detected: bullFlagResult.detected,
            pole_gain: bullFlagResult.poleGain,
            consolidation_days: bullFlagResult.consolidationDays,
            gap_status: gapResult.detected ? `Gap Up ${gapResult.gapPercent.toFixed(1)}%` : 'No Gap',
            score: patternScore,
            rationale: patternType !== 'NONE' ? `${patternType} detected` : 'No significant pattern'
        },
        "6_support_resistance": {
            support_zones: [swingLow, ema20, ema50].filter(v => v > 0),
            resistance_zones: [swingHigh],
            near_ema20: nearEma20,
            near_ema50: nearEma50,
            swing_low: swingLow,
            atr: Math.round(atr * 100) / 100,
            stop_loss_level: Math.round(stopLossLevel * 100) / 100,
            take_profit_level: Math.round(takeProfitLevel * 100) / 100,
            risk_reward_ratio: Math.round(rrRatio * 100) / 100,
            rr_passes: rrPasses,
            score: supportScore,
            rationale: `R:R ${rrRatio.toFixed(1)}:1 ${rrPasses ? '✓' : '✗'}, ${nearEma20 ? 'Near 20 EMA' : nearEma50 ? 'Near 50 EMA' : 'Not near key EMAs'}`
        },
        "7_price_movement": {
            trend: trendStatus,
            recent_higher_lows: higherLows,
            recent_higher_highs: higherHighs,
            hammer_detected: hammerDetected,
            candle_confirmation: hammerDetected ? 'Hammer' : 'None',
            score: priceActionScore,
            rationale: `${trendStatus}: ${higherHighs ? 'HH ✓' : 'HH ✗'} ${higherLows ? 'HL ✓' : 'HL ✗'}${hammerDetected ? ' + Hammer' : ''}`
        },
        "8_volume": {
            status: volumeProfile.interpretation,
            volume_trend: volumeProfile.obv.trend === 'UP' ? 'Rising' : volumeProfile.obv.trend === 'DOWN' ? 'Declining' : 'Flat',
            current_volume: currentVolume,
            avg_volume: avgVolume30,
            accumulation_days: accDays,
            distribution_days: distDays,
            volume_sma5_rising: volumeSmaRising,
            volume_confirms: volumeConfirms,
            score: Math.round(volumeScore * 10) / 10,
            rationale: `RVOL: ${volumeProfile.rvol.ratio.toFixed(1)}x | OBV: ${volumeProfile.obv.trend} | CMF: ${volumeProfile.cmf.value > 0 ? '+' : ''}${volumeProfile.cmf.value.toFixed(2)} | ${volumeProfile.smartMoneySignal === 'BUYING' ? '🟢 Smart Money Buying' : volumeProfile.smartMoneySignal === 'SELLING' ? '🔴 Smart Money Selling' : '⚪ Neutral'}`
        },
        "9_ma_fibonacci": {
            ma_20: sma20,
            ma_50: sma50,
            ma_100: sma100,
            ma_200: sma200,
            ema_8: ema8,
            ema_20: ema20,
            alignment: priceAbove200SMA && priceAbove20EMA ? 'Bullish' : 'Mixed',
            price_above_200sma: priceAbove200SMA,
            price_above_20ema: priceAbove20EMA,
            fib_levels: fibLevels,
            in_fib_buy_zone: fibZone.inZone,
            fib_level_current: fibZone.level,
            score: maFibScore,
            rationale: `${priceAbove200SMA ? '> 200 SMA ✓' : '< 200 SMA ✗'} ${priceAbove20EMA ? '> 20 EMA ✓' : '< 20 EMA ✗'}${fibZone.inZone ? ` at Fib ${fibZone.level}` : ''}`
        },
        "10_rsi": {
            value: Math.round(rsi),
            status: adaptiveRSI.zone,
            in_bull_range: inBullRange,
            dip_buy_signal: dipBuySignal,
            positive_momentum: positiveMomentum,
            overextended: overextended,
            optimal_range: optimalRange,
            score: Math.round(rsiScore * 10) / 10,
            rationale: `RSI ${Math.round(rsi)} | Zone: ${adaptiveRSI.zone} | Thresholds: ${adaptiveRSI.thresholds.oversold}-${adaptiveRSI.thresholds.overbought} (${adaptiveRSI.isVolatile ? 'Volatile' : 'Normal'})${divergenceAnalysis.strongest.type !== 'NONE' ? ` | ${divergenceAnalysis.strongest.type.replace('_', ' ')} divergence` : ''}`
        }
    };

    const successProbability = calculateSuccessProbability(parameters);
    
    // ============================================
    // PHASE 2: MULTI-TIMEFRAME ANALYSIS
    // ============================================
    const mtfAnalysis = await getMultiTimeframeAlignment(
        ticker,
        successProbability / 10, // Convert to 0-10 scale
        trendStatus,
        regimeAnalysis.regime,
        asOfDate // PIT safety: pass asOfDate for backtesting
    );
    const hasMTFConfirm = has4HConfirmation(mtfAnalysis);
    
    // ============================================
    // REGIME-ADJUSTED SCORING & RECOMMENDATIONS
    // ============================================
    const originalScore = successProbability;
    let adjustedProbability = successProbability;
    let regimeAdjusted = false;
    let adjustedRecommendation = getRecommendation(successProbability);
    
    // Check if score passes regime threshold
    const regimeCheck = passesRegimeThreshold(
        successProbability / 10, // Convert to 0-10 scale
        regimeAnalysis.regime,
        volumeConfirms, // hasVolumeConfirm
        hasMTFConfirm // Now using real MTF confirmation
    );
    
    // Apply regime-adjusted logic
    if (!regimeCheck.passes) {
        regimeAdjusted = true;
        
        // Downgrade recommendation based on regime
        if (regimeAnalysis.regime === 'CRASH') {
            adjustedRecommendation = 'AVOID - CRASH REGIME';
            adjustedProbability = Math.min(adjustedProbability, 30); // Cap at 30%
        } else if (regimeAnalysis.regime === 'CHOPPY') {
            if (successProbability < 75) {
                adjustedRecommendation = 'WAIT - CHOPPY MARKET';
                adjustedProbability = Math.min(adjustedProbability, 50); // Cap at 50%
            }
        }
    }
    
    // Additional regime-specific adjustments
    if (regimeAnalysis.regime === 'CRASH' && successProbability < 85) {
        adjustedRecommendation = 'AVOID - NOT TODAY';
        regimeAdjusted = true;
    }
    
    // Bonus for exceptional setups in BULL regime
    if (regimeAnalysis.regime === 'BULL' && successProbability >= 75 && volumeConfirms) {
        adjustedProbability = Math.min(100, adjustedProbability + 5);
        regimeAdjusted = true;
    }

    // ============================================
    // MEAN REVERSION STRATEGY ADJUSTMENTS
    // ============================================
    const hasBullishDivergence = divergenceAnalysis.strongest.type === 'REGULAR_BULLISH';
    const hasHiddenBullishDivergence = divergenceAnalysis.strongest.type === 'HIDDEN_BULLISH';
    const anyBullishDivergence = hasBullishDivergence || hasHiddenBullishDivergence;

    // MEAN REVERSION BOOST: Oversold conditions are bullish
    if (meanReversionSignal) {  // RSI <= 35
        adjustedProbability = Math.min(100, adjustedProbability + 10);  // +10% boost
        regimeAdjusted = true;

        // Extra boost for deeply oversold + divergence
        if (deeplyOversold && anyBullishDivergence) {  // RSI <= 25 + divergence
            adjustedProbability = Math.min(100, adjustedProbability + 10);  // Additional +10%
        }
    }

    // DIVERGENCE CONFIRMATION: Required when RSI is not deeply oversold
    if (rsi > 35 && !anyBullishDivergence) {
        // If RSI is not oversold and no divergence, reduce confidence
        adjustedProbability = Math.max(0, adjustedProbability - 5);
    }
    
    // Phase 2: Apply multi-timeframe adjustments
    if (regimeThresholds.requireMultiTimeframe && !hasMTFConfirm) {
        if (regimeAnalysis.regime === 'CHOPPY') {
            adjustedRecommendation = 'WAIT - 4H NOT CONFIRMING';
            adjustedProbability = Math.min(adjustedProbability, 45);
            regimeAdjusted = true;
        } else if (regimeAnalysis.regime === 'CRASH') {
            adjustedRecommendation = 'AVOID - NO MTF ALIGNMENT';
            adjustedProbability = Math.min(adjustedProbability, 30);
            regimeAdjusted = true;
        }
    }
    
    // Bonus for strong MTF alignment
    if (mtfAnalysis.alignment === 'STRONG_BUY') {
        adjustedProbability = Math.min(100, adjustedProbability + 8);
        if (adjustedProbability >= 70 && adjustedRecommendation.includes('WAIT')) {
            adjustedRecommendation = 'BUY - STRONG MTF ALIGNMENT';
        }
        regimeAdjusted = true;
    } else if (mtfAnalysis.alignment === 'BUY') {
        adjustedProbability = Math.min(100, adjustedProbability + 4);
        regimeAdjusted = true;
    }
    
    // Use combined MTF score if beneficial
    const mtfCombinedPct = mtfAnalysis.combined_score * 10;
    if (mtfCombinedPct > adjustedProbability && hasMTFConfirm) {
        adjustedProbability = Math.round((adjustedProbability + mtfCombinedPct) / 2);
        regimeAdjusted = true;
    }

    // Trading Plan with ATR-based Stop Loss
    const stopLoss = stopLossLevel;
    const tp1 = currentPrice + (risk * 1.5);
    const tp2 = currentPrice + (risk * 2.5);
    const tp3 = currentPrice + (risk * 4);
    
    const isUptrend = trendStatus === 'UPTREND' && priceAbove200SMA;
    
    // Use regime-adjusted R:R minimum
    const effectiveRRPasses = rrRatio >= regimeThresholds.minRRRatio;

    const tradingPlan: TradingPlan = {
        signal: isUptrend && adjustedProbability >= 60 && effectiveRRPasses ? "BUY" : "WAIT",
        entry: {
            method: "Market / Limit near support",
            primary_price: currentPrice,
            rationale: nearEma20 || nearEma50 ? "Near EMA support zone" : "Current market price"
        },
        stop_loss: {
            price: stopLoss,
            rationale: `Swing Low ($${swingLow.toFixed(2)}) - 1% ATR buffer`,
            position_above_sl_percentage: Number(((currentPrice - stopLoss) / currentPrice * 100).toFixed(2))
        },
        risk_reward_ratio: `1:${rrRatio.toFixed(1)}`,
        take_profit_levels: [
            { batch: 1, quantity_percent: 33, target_price: tp1, rationale: '1.5x Risk Target' },
            { batch: 2, quantity_percent: 33, target_price: tp2, rationale: '2.5x Risk Target' },
            { batch: 3, quantity_percent: 34, target_price: tp3, rationale: '4x Risk Target (Runner)' }
        ],
        total_tp_average: (tp1 + tp2 + tp3) / 3,
        profit_if_hits_average_tp: ((tp1 + tp2 + tp3) / 3) - currentPrice,
        profit_percentage: Number((((tp1 + tp2 + tp3) / 3 - currentPrice) / currentPrice * 100).toFixed(2))
    };

    // Chart data
    const chartDataLimit = Math.min(60, dates.length);
    const chart_data = [];

    for (let i = 0; i < chartDataLimit; i++) {
        const sma20Val = prices.length >= i + 20 ? calculateSMA(prices.slice(i), 20) : undefined;
        const sma50Val = prices.length >= i + 50 ? calculateSMA(prices.slice(i), 50) : undefined;
        const ema8Val = prices.length >= i + 8 ? calculateEMA([...prices.slice(i, i + 40)].reverse(), 8) : undefined;

        chart_data.push({
            date: dates[i],
            price: prices[i],
            sma20: sma20Val,
            sma50: sma50Val,
            ema8: ema8Val
        });
    }

    // ============================================
    // VETO ANALYSIS (ML-based timing filter)
    // ============================================
    let vetoAnalysis: VetoAnalysis | undefined;

    try {
        // Convert price arrays to PriceBar format for v2 feature computation
        const tickerBars = convertToPriceBars(dates, opens, highs, lows, prices, volumes);

        // Convert SPY data to PriceBar format
        let spyBars: PriceBar[] | undefined;
        if (spyChartData && spyChartData.prices && spyChartData.prices.length > 50) {
            // Filter SPY data to asOfDate if backtesting
            const spyDates = asOfDate
                ? spyChartData.dates.filter(d => new Date(d).getTime() <= asOfTime)
                : spyChartData.dates;
            const spyIndices = spyDates.map(d => spyChartData.dates.indexOf(d));

            spyBars = convertToPriceBars(
                spyIndices.map(i => spyChartData.dates[i]),
                spyIndices.map(i => spyChartData.opens[i]),
                spyIndices.map(i => spyChartData.highs[i]),
                spyIndices.map(i => spyChartData.lows[i]),
                spyIndices.map(i => spyChartData.prices[i]),
                spyIndices.map(i => spyChartData.volumes[i])
            );
        }

        // Compute v2 features and run veto analysis
        const v2Features = computeV2Features(tickerBars, spyBars);
        const vetoResult = evaluateVeto(v2Features as unknown as Record<string, number>, ticker, dates[0], { vetoThreshold: 0.60 });

        vetoAnalysis = {
            vetoed: vetoResult.vetoed,
            pLoss: vetoResult.pLoss,
            pWin: vetoResult.pWin,
            verdict: vetoResult.verdict,
            confidence: vetoResult.confidence,
            reasons: vetoResult.reasons,
        };
    } catch (error) {
        // Veto model not available or error - continue without veto analysis
        console.warn('Veto analysis unavailable:', error);
    }

    // Determine final trade type based on veto analysis
    const baseTradeType = isUptrend && adjustedProbability >= 60 && effectiveRRPasses ? "SWING_LONG" : "AVOID";
    const finalTradeType = vetoAnalysis?.vetoed ? "AVOID" : baseTradeType;

    // Adjust recommendation based on veto
    let finalRecommendation = regimeAdjusted ? adjustedRecommendation : getRecommendation(adjustedProbability);
    if (vetoAnalysis?.vetoed) {
        finalRecommendation = `VETO - Poor timing (${(vetoAnalysis.pLoss * 100).toFixed(0)}% loss probability)`;
    } else if (vetoAnalysis?.verdict === 'CAUTION') {
        finalRecommendation = `CAUTION - ${finalRecommendation} (${(vetoAnalysis.pLoss * 100).toFixed(0)}% loss probability)`;
    }

    return {
        ticker: ticker.toUpperCase(),
        timestamp: new Date().toISOString(),
        current_price: currentPrice,
        timeframe: "Daily",
        trade_type: finalTradeType,
        parameters,
        success_probability: adjustedProbability,
        confidence_rating: getConfidenceRating(adjustedProbability),
        recommendation: finalRecommendation,
        trading_plan: tradingPlan,

        // ML-based Veto System (replaces heuristics for timing decisions)
        veto_analysis: vetoAnalysis,
        risk_analysis: {
            downside_risk: `Stop loss at $${stopLoss.toFixed(2)}`,
            risk_per_unit: risk,
            max_loss_percentage: tradingPlan.stop_loss.position_above_sl_percentage,
            volatility_assessment: atr > currentPrice * 0.03 ? "HIGH" : atr > currentPrice * 0.015 ? "MODERATE" : "LOW",
            key_risk_factors: [
                !marketData.goldenCross ? "Market not in Golden Cross" : "",
                !outperforming ? "Sector underperforming" : "",
                overextended ? "RSI overextended" : "",
                !volumeConfirms ? "Volume not confirming" : "",
                regimeAnalysis.regime === 'CRASH' ? "⚠️ CRASH regime - high risk" : "",
                regimeAnalysis.regime === 'CHOPPY' ? "⚠️ CHOPPY market - stricter criteria" : ""
            ].filter(Boolean)
        },
        qualitative_assessment: {
            setup_quality: adjustedProbability >= 70 ? "EXCELLENT" : adjustedProbability >= 60 ? "GOOD" : adjustedProbability >= 50 ? "FAIR" : "POOR",
            setup_description: patternType !== 'NONE' ? `${patternType} with ${trendStatus}` : `${trendStatus} setup`,
            follow_through_probability: volumeConfirms && priceAbove200SMA ? "HIGH" : "MODERATE",
            next_catalyst: hasCatalyst ? "High volume interest" : "Watch for volume breakout",
            monitoring_points: [
                `Support at $${swingLow.toFixed(2)}`,
                `Resistance at $${swingHigh.toFixed(2)}`,
                `20 EMA at $${ema20.toFixed(2)}`
            ]
        },
        disclaimers: [
            "Educational purposes only - Not financial advice",
            "Data provided by Yahoo Finance",
            "Fundamental data limited without premium API"
        ],
        chart_data,
        
        // Phase 1: Market Regime Context
        market_regime: {
            regime: regimeAnalysis.regime,
            confidence: regimeAnalysis.confidence,
            details: {
                spyAbove50SMA: regimeAnalysis.details.spyAbove50SMA,
                spyAbove200SMA: regimeAnalysis.details.spyAbove200SMA,
                vixLevel: regimeAnalysis.details.vixLevel,
                trendStrength: regimeAnalysis.details.trendStrength,
                volatilityEnvironment: regimeAnalysis.details.volatilityEnvironment,
            },
        },
        regime_thresholds: {
            minEntryScore: regimeThresholds.minEntryScore,
            minRRRatio: regimeThresholds.minRRRatio,
            requireVolumeConfirm: regimeThresholds.requireVolumeConfirm,
            requireMultiTimeframe: regimeThresholds.requireMultiTimeframe,
            allowShorts: regimeThresholds.allowShorts,
            description: regimeThresholds.description,
        },
        regime_adjusted: regimeAdjusted,
        original_score: regimeAdjusted ? originalScore : undefined,
        
        // Phase 2: Multi-Timeframe Analysis
        multi_timeframe: {
            daily_score: mtfAnalysis.daily.score,
            hour4_score: mtfAnalysis.hour4.score,
            combined_score: mtfAnalysis.combined_score,
            alignment: mtfAnalysis.alignment,
            macd_4h_status: mtfAnalysis.hour4.macd.status,
            rsi_4h: mtfAnalysis.hour4.rsi,
            resistance_4h: mtfAnalysis.hour4.resistance,
            support_4h: mtfAnalysis.hour4.support,
        },
        
        // Phase 3: Volume Profile (Enhanced)
        volume_profile: {
            rvol: volumeProfile.rvol.ratio,
            obv_trending: volumeProfile.obv.trend === 'UP',
            obv_value: volumeProfile.obv.value,
            cmf_value: volumeProfile.cmf.value,
            cmf_positive: volumeProfile.cmf.isPositive,
            interpretation: `${volumeProfile.interpretation} (${volumeProfile.smartMoneySignal === 'BUYING' ? 'Smart Money Buying' : volumeProfile.smartMoneySignal === 'SELLING' ? 'Smart Money Selling' : 'Neutral'})`,
        },
        
        // Phase 4: Divergence Detection
        divergence: {
            type: divergenceAnalysis.strongest.type,
            indicator: divergenceAnalysis.strongest.indicator,
            strength: divergenceAnalysis.strongest.strength,
            implication: divergenceAnalysis.strongest.implication,
        },
        
        // Phase 4: Adaptive RSI Thresholds
        adaptive_rsi: {
            value: adaptiveRSI.currentRSI,
            oversold_threshold: adaptiveRSI.thresholds.oversold,
            overbought_threshold: adaptiveRSI.thresholds.overbought,
            in_optimal_range: adaptiveRSI.zone === 'OPTIMAL_BUY',
        },
    };
}
