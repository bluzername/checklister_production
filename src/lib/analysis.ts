import { 
    AnalysisResult, 
    AnalysisParameters, 
    TradingPlan,
    MarketStatus,
    TrendStatus,
    PatternType,
    SectorRank
} from './types';
import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

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

// Fetch market data (SPY/SPX)
async function fetchMarketData(): Promise<{
    price: number;
    sma50: number;
    sma200: number;
    goldenCross: boolean;
}> {
    try {
        const historical = await yahooFinance.chart('SPY', {
            period1: new Date(Date.now() - 250 * 24 * 60 * 60 * 1000),
            period2: new Date(),
            interval: '1d'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any;
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const quotes = historical.quotes.filter((q: any) => q.close != null);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prices = quotes.map((q: any) => q.close as number).reverse();
        
        const price = prices[0];
        const sma50 = calculateSMA(prices, 50);
        const sma200 = calculateSMA(prices, 200);
        const goldenCross = sma50 > sma200;
        
        return { price, sma50, sma200, goldenCross };
    } catch {
        return { price: 0, sma50: 0, sma200: 0, goldenCross: false };
    }
}

// Fetch VIX data
async function fetchVIXLevel(): Promise<number> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const quote = await yahooFinance.quote('^VIX') as any;
        return quote?.regularMarketPrice || 20;
    } catch {
        return 20; // Default moderate VIX
    }
}

// Fetch sector ETF data and calculate RS
async function fetchSectorData(sectorETF: string): Promise<{
    rs20d: number;
    rs60d: number;
}> {
    try {
        const endDate = new Date();
        const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [sectorHist, spyHist] = await Promise.all([
            yahooFinance.chart(sectorETF, { period1: startDate, period2: endDate, interval: '1d' }),
            yahooFinance.chart('SPY', { period1: startDate, period2: endDate, interval: '1d' })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ]) as any[];
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sectorPrices = sectorHist.quotes.filter((q: any) => q.close != null).map((q: any) => q.close).reverse();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const spyPrices = spyHist.quotes.filter((q: any) => q.close != null).map((q: any) => q.close).reverse();
        
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

export function calculateSuccessProbability(parameters: AnalysisParameters): number {
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
    const successRate = (totalScore / 100) * 100;

    return Math.round(successRate * 10) / 10;
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

export async function analyzeTicker(ticker: string): Promise<AnalysisResult> {
    // Fetch main ticker data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quote = await yahooFinance.quote(ticker) as any;
    
    if (!quote || !quote.regularMarketPrice) {
        throw new Error("Invalid Ticker or No Data Available");
    }

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 250);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const historical = await yahooFinance.chart(ticker, {
        period1: startDate,
        period2: endDate,
        interval: '1d'
    }) as any;

    if (!historical || !historical.quotes || historical.quotes.length === 0) {
        throw new Error("Invalid Ticker or No Historical Data");
    }

    const currentPrice = quote.regularMarketPrice;
    const sector = quote.sector || 'Technology';
    const marketCap = quote.marketCap ? quote.marketCap / 1_000_000_000 : 0;

    // Process historical data (most recent first)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const validQuotes = historical.quotes.filter((q: any) => q.close != null && q.open != null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dates = validQuotes.map((q: any) => new Date(q.date).toISOString().split('T')[0]).reverse();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prices = validQuotes.map((q: any) => q.close as number).reverse();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opens = validQuotes.map((q: any) => q.open as number).reverse();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const highs = validQuotes.map((q: any) => q.high as number).reverse();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lows = validQuotes.map((q: any) => q.low as number).reverse();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const volumes = validQuotes.map((q: any) => q.volume as number).reverse();

    // Fetch additional market data
    const [marketData, vixLevel] = await Promise.all([
        fetchMarketData(),
        fetchVIXLevel()
    ]);
    
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
    const sectorData = await fetchSectorData(sectorETF);
    
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
    // Note: Full fundamental data requires premium APIs
    // Using market cap and available data as proxy
    const revenueGrowth = 0; // Would need fundamental API
    const earningsSurprise = false; // Would need earnings calendar
    const sentimentScore = 0.5; // Neutral default
    
    let companyScore = 5;
    if (marketCap > 50) companyScore = 8; // Large cap
    else if (marketCap > 10) companyScore = 7;
    else if (marketCap > 2) companyScore = 5;
    else companyScore = 3; // Small cap higher risk
    
    // ============================================
    // CRITERION 4: Actual Game Changer (Catalyst & RVOL)
    // ============================================
    const rvolThresholdMet = rvol >= 1.5;
    // Note: News API integration would detect catalyst keywords
    const detectedKeywords: string[] = []; // Would need news API
    const hasCatalyst = rvolThresholdMet; // RVOL alone indicates interest
    
    let catalystScore = 5;
    if (rvol >= 3.0) catalystScore = 10;
    else if (rvol >= 2.0) catalystScore = 8;
    else if (rvol >= 1.5) catalystScore = 7;
    else if (rvol >= 1.0) catalystScore = 5;
    else catalystScore = 3;
    
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
    const stopLossLevel = swingLow - (0.01 * atr);
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
    // CRITERION 8: Volume (The "Lie Detector")
    // ============================================
    const volumeConfirms = accDays > distDays && volumeSmaRising;
    let volumeScore = 5;
    
    if (volumeConfirms && rvol > 1.5) {
        volumeScore = 10;
    } else if (volumeConfirms) {
        volumeScore = 8;
    } else if (accDays > distDays) {
        volumeScore = 6;
    } else if (distDays > accDays) {
        volumeScore = 3;
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
    // CRITERION 10: RSI (Relative Strength Index)
    // ============================================
    const inBullRange = rsi >= 40 && rsi <= 90;
    const dipBuySignal = rsi >= 40 && rsi <= 50;
    const positiveMomentum = rsi > 50;
    const overextended = rsi > 75;
    const optimalRange = rsi >= 45 && rsi <= 70;
    
    let rsiScore = 5;
    if (optimalRange && positiveMomentum) {
        rsiScore = 10;
    } else if (dipBuySignal && inBullRange) {
        rsiScore = 9; // Dip buy opportunity
    } else if (inBullRange && !overextended) {
        rsiScore = 7;
    } else if (overextended) {
        rsiScore = 4; // Caution - overextended
    } else if (rsi < 40) {
        rsiScore = 3; // Weak momentum
    }
    
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
            sentiment_score: sentimentScore,
            market_cap: marketCap,
            earnings_status: 'N/A (requires premium API)',
            guidance: 'N/A',
            score: companyScore,
            rationale: `Market Cap: $${marketCap.toFixed(1)}B - ${marketCap > 10 ? 'Large' : marketCap > 2 ? 'Mid' : 'Small'} Cap`
        },
        "4_catalyst": {
            present: hasCatalyst,
            has_catalyst: hasCatalyst,
            rvol: Math.round(rvol * 100) / 100,
            rvol_threshold_met: rvolThresholdMet,
            catalyst_keywords: detectedKeywords,
            catalyst_type: rvolThresholdMet ? 'High Interest (RVOL)' : 'None',
            strength: rvol >= 2 ? 'STRONG' : rvol >= 1.5 ? 'MODERATE' : 'WEAK',
            timeframe: 'Current',
            score: catalystScore,
            rationale: `RVOL: ${rvol.toFixed(2)}x (${rvolThresholdMet ? '≥1.5 threshold met' : 'below 1.5 threshold'})`
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
            status: volumeConfirms ? 'CONFIRMING' : 'NOT CONFIRMING',
            volume_trend: volumeSmaRising ? 'Rising' : 'Flat/Declining',
            current_volume: currentVolume,
            avg_volume: avgVolume30,
            accumulation_days: accDays,
            distribution_days: distDays,
            volume_sma5_rising: volumeSmaRising,
            volume_confirms: volumeConfirms,
            score: volumeScore,
            rationale: `Acc: ${accDays} days, Dist: ${distDays} days, Vol SMA5 ${volumeSmaRising ? 'rising' : 'flat'}`
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
            status: overextended ? 'OVERBOUGHT' : rsi < 30 ? 'OVERSOLD' : optimalRange ? 'OPTIMAL' : 'NEUTRAL',
            in_bull_range: inBullRange,
            dip_buy_signal: dipBuySignal,
            positive_momentum: positiveMomentum,
            overextended: overextended,
            optimal_range: optimalRange,
            score: rsiScore,
            rationale: `RSI ${Math.round(rsi)} - ${optimalRange ? 'Optimal (45-70)' : overextended ? 'Overextended (>75)' : dipBuySignal ? 'Dip Buy Zone (40-50)' : 'Outside optimal'}`
        }
    };

    const successProbability = calculateSuccessProbability(parameters);

    // Trading Plan with ATR-based Stop Loss
    const stopLoss = stopLossLevel;
    const tp1 = currentPrice + (risk * 1.5);
    const tp2 = currentPrice + (risk * 2.5);
    const tp3 = currentPrice + (risk * 4);
    
    const isUptrend = trendStatus === 'UPTREND' && priceAbove200SMA;

    const tradingPlan: TradingPlan = {
        signal: isUptrend && successProbability >= 60 ? "BUY" : "WAIT",
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

    return {
        ticker: ticker.toUpperCase(),
        timestamp: new Date().toISOString(),
        current_price: currentPrice,
        timeframe: "Daily",
        trade_type: isUptrend && successProbability >= 60 ? "SWING_LONG" : "AVOID",
        parameters,
        success_probability: successProbability,
        confidence_rating: getConfidenceRating(successProbability),
        recommendation: getRecommendation(successProbability),
        trading_plan: tradingPlan,
        risk_analysis: {
            downside_risk: `Stop loss at $${stopLoss.toFixed(2)}`,
            risk_per_unit: risk,
            max_loss_percentage: tradingPlan.stop_loss.position_above_sl_percentage,
            volatility_assessment: atr > currentPrice * 0.03 ? "HIGH" : atr > currentPrice * 0.015 ? "MODERATE" : "LOW",
            key_risk_factors: [
                !marketData.goldenCross ? "Market not in Golden Cross" : "",
                !outperforming ? "Sector underperforming" : "",
                overextended ? "RSI overextended" : "",
                !volumeConfirms ? "Volume not confirming" : ""
            ].filter(Boolean)
        },
        qualitative_assessment: {
            setup_quality: successProbability >= 70 ? "EXCELLENT" : successProbability >= 60 ? "GOOD" : successProbability >= 50 ? "FAIR" : "POOR",
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
        chart_data
    };
}
