'use client';

import React, { useState } from 'react';
import {
    ChevronDown,
    ChevronRight,
    TrendingUp,
    Building2,
    Briefcase,
    Zap,
    BarChart3,
    Target,
    Activity,
    Volume2,
    LineChart,
    Gauge,
    Info,
    Code,
    Calculator,
    BookOpen,
    AlertTriangle
} from 'lucide-react';

// This metadata is extracted from the analysis.ts file
const METHODOLOGY_VERSION = '2.1.0';
const LAST_UPDATED = new Date().toISOString().split('T')[0];

interface CriterionDoc {
    id: number;
    key: string;
    name: string;
    subtitle: string;
    icon: React.ElementType;
    description: string;
    objective: string;
    dataSource: string;
    calculation: string;
    scoringLogic: {
        condition: string;
        score: number;
        label: string;
    }[];
    formula?: string;
    outputFields: string[];
    limitations: string[];
    codeReference: string;
}

const criteriaDocumentation: CriterionDoc[] = [
    {
        id: 1,
        key: '1_market_condition',
        name: 'Market Condition',
        subtitle: 'The "Tide"',
        icon: TrendingUp,
        description: 'Determines if the overall market environment supports long positions. As the saying goes, "A rising tide lifts all boats" - trading with the market trend significantly increases success probability.',
        objective: 'Ensure the broader market (SPY/SPX) is in a bullish configuration before taking long positions.',
        dataSource: 'SPY (S&P 500 ETF) daily OHLCV data via Yahoo Finance API. VIX (Volatility Index) for market fear gauge.',
        calculation: `
1. **Primary Trend Check**: SPY current price vs 50-day SMA
   - Bullish if Price > 50 SMA
   
2. **Golden Cross Alignment**: 50-day SMA vs 200-day SMA
   - Bullish alignment when 50 SMA > 200 SMA (Golden Cross)
   - Bearish when 50 SMA < 200 SMA (Death Cross)
   
3. **Volatility Filter**: VIX level check
   - Safe environment when VIX < 25
   - Elevated risk when VIX > 25`,
        scoringLogic: [
            { condition: 'SPY > 50 SMA AND Golden Cross AND VIX < 25', score: 10, label: 'Perfect Bull Market' },
            { condition: 'SPY > 50 SMA AND Golden Cross', score: 8, label: 'Bull Market' },
            { condition: 'SPY > 50 SMA only', score: 6, label: 'Neutral-Bullish' },
            { condition: 'SPY < 50 SMA but Golden Cross', score: 4, label: 'Weakening' },
            { condition: 'SPY < 50 SMA AND Death Cross', score: 2, label: 'Bear Market' }
        ],
        formula: `// Fetch SPY data
const spxAbove50SMA = SPY.price > SMA(SPY.prices, 50)
const goldenCross = SMA(SPY.prices, 50) > SMA(SPY.prices, 200)
const vixSafe = VIX < 25

// Score determination
if (spxAbove50SMA && goldenCross && vixSafe) score = 10
else if (spxAbove50SMA && goldenCross) score = 8
else if (spxAbove50SMA) score = 6
else if (!spxAbove50SMA && !goldenCross) score = 2
else score = 4`,
        outputFields: ['MARKET_STATUS: "BULLISH" | "BEARISH" | "NEUTRAL"', 'golden_cross: boolean', 'vix_level: number', 'vix_safe: boolean'],
        limitations: [
            'Uses SPY as proxy for overall market (not actual S&P 500 index)',
            'VIX data may have slight delays',
            'Does not account for sector rotation within the market'
        ],
        codeReference: 'analysis.ts:350-370'
    },
    {
        id: 2,
        key: '2_sector_condition',
        name: 'Sector Condition',
        subtitle: 'Relative Strength',
        icon: Building2,
        description: 'Ensures the stock belongs to a leading sector with positive money flow. Stocks in strong sectors have institutional tailwinds that support price appreciation.',
        objective: 'Verify the sector is outperforming the broader market (SPY) - money is flowing INTO the sector.',
        dataSource: 'Sector ETFs (XLK, XLF, XLV, XLE, etc.) compared to SPY over 20 and 60 trading days.',
        calculation: `
**Relative Strength (RS) Score Calculation:**

1. Calculate sector ETF performance over 20 days:
   \`Sector_20d_Change = (Today - 20_Days_Ago) / 20_Days_Ago × 100\`

2. Calculate SPY performance over same period:
   \`SPY_20d_Change = (Today - 20_Days_Ago) / 20_Days_Ago × 100\`

3. Calculate RS Score:
   \`RS_Score = Sector_Change / SPY_Change\`

4. Repeat for 60-day period and average both RS scores.

**Interpretation:**
- RS > 1.0 = Sector outperforming market
- RS < 1.0 = Sector underperforming market`,
        scoringLogic: [
            { condition: 'Average RS > 1.2 (Strong outperformance)', score: 10, label: 'Top 3 Sector' },
            { condition: 'Average RS > 1.0 (Outperforming)', score: 8, label: 'Top 3 Sector' },
            { condition: 'Average RS 0.8-1.0 (In-line)', score: 5, label: 'Middle Sector' },
            { condition: 'Average RS < 0.8 (Underperforming)', score: 2, label: 'Bottom 3 Sector' }
        ],
        formula: `// Sector ETF mapping
const SECTOR_ETFS = {
  'Technology': 'XLK',
  'Financial Services': 'XLF',
  'Healthcare': 'XLV',
  'Consumer Cyclical': 'XLY',
  'Energy': 'XLE',
  // ... all 11 sectors
}

// Calculate RS
const sector20dChange = (sectorPrices[0] - sectorPrices[19]) / sectorPrices[19] * 100
const spy20dChange = (spyPrices[0] - spyPrices[19]) / spyPrices[19] * 100
const rs20d = sector20dChange / spy20dChange

// Same for 60-day
const avgRS = (rs20d + rs60d) / 2
const outperforming = avgRS > 1.0`,
        outputFields: ['sector_etf: string (XLK, XLF, etc.)', 'rs_score_20d: number', 'rs_score_60d: number', 'sector_rank: "TOP_3" | "MIDDLE" | "BOTTOM_3"', 'outperforming: boolean'],
        limitations: [
            'Limited to 11 major SPDR sector ETFs',
            'Does not account for sub-industry strength',
            'RS calculation assumes linear relationship'
        ],
        codeReference: 'analysis.ts:372-395'
    },
    {
        id: 3,
        key: '3_company_condition',
        name: 'Company Condition',
        subtitle: 'Fundamental Strength',
        icon: Briefcase,
        description: 'Verifies the company has fundamental tailwinds supporting the technical setup. Uses EODHD API for real earnings and revenue data when configured.',
        objective: 'Check earnings surprise (EPS beat/miss) and revenue growth QoQ for fundamental validation.',
        dataSource: 'EODHD API for fundamentals (earnings, revenue, financial statements). Falls back to Yahoo Finance market cap if EODHD not configured.',
        calculation: `
**With EODHD API (Premium - $20/mo):**
1. **Earnings Surprise**: Compare EPS Actual vs EPS Expected
   - Beat = EPS Actual > EPS Expected
2. **Revenue Growth QoQ**: Calculate quarter-over-quarter change
   - Growth = (Revenue Current - Revenue Previous) / Revenue Previous × 100

**Scoring Logic:**
- Score 10: Earnings beat + Revenue growth > 20%
- Score 8: Earnings beat OR Revenue growth > 20%
- Score 7: Revenue growth > 10%
- Score 5: Neutral (no data or mixed signals)
- Score 3: Earnings miss
- Score 1: Earnings miss + Revenue declining

**Fallback (No EODHD Key):**
Uses Market Cap as proxy for company quality`,
        scoringLogic: [
            { condition: 'Earnings Beat + Revenue Growth > 20%', score: 10, label: 'Strong Fundamentals' },
            { condition: 'Earnings Beat OR Revenue Growth > 20%', score: 8, label: 'Good Fundamentals' },
            { condition: 'Revenue Growth > 10%', score: 7, label: 'Moderate Growth' },
            { condition: 'Neutral / Mixed / No Data', score: 5, label: 'Neutral' },
            { condition: 'Earnings Miss', score: 3, label: 'Weak' },
            { condition: 'Earnings Miss + Revenue Declining', score: 1, label: 'Poor Fundamentals' }
        ],
        formula: `// With EODHD fundamentals data
const fundamentals = await getFundamentals(ticker)

if (fundamentals.data_available) {
  const hasEarningsBeat = fundamentals.earnings_surprise
  const hasStrongGrowth = fundamentals.revenue_growth_qoq > 20
  const hasModerateGrowth = fundamentals.revenue_growth_qoq > 10
  const hasEarningsMiss = eps_actual < eps_expected
  const hasRevenueDeclining = revenue_growth_qoq < 0

  if (hasEarningsBeat && hasStrongGrowth) score = 10
  else if (hasEarningsBeat || hasStrongGrowth) score = 8
  else if (hasModerateGrowth) score = 7
  else if (hasEarningsMiss && hasRevenueDeclining) score = 1
  else if (hasEarningsMiss) score = 3
  else score = 5
} else {
  // Fallback: market cap scoring
  if (marketCap > 50) score = 8
  else if (marketCap > 10) score = 7
  // ...
}`,
        outputFields: ['earnings_surprise: boolean', 'eps_actual: number', 'eps_expected: number', 'revenue_growth_qoq: number', 'meets_growth_threshold: boolean', 'market_cap: number'],
        limitations: [
            'EODHD API required for full functionality ($20/mo)',
            'Falls back to market cap if API not configured',
            'Earnings calendar/next earnings date partially implemented',
            'Guidance analysis not yet implemented'
        ],
        codeReference: 'analysis.ts:503-535'
    },
    {
        id: 4,
        key: '4_catalyst',
        name: 'Actual Game Changer',
        subtitle: 'Catalyst & RVOL + Sentiment',
        icon: Zap,
        description: 'Combines RVOL (Relative Volume) with AI-powered sentiment analysis using Claude to detect catalysts and market interest.',
        objective: 'Identify stocks with unusual activity (RVOL) and/or news catalysts using Claude AI for sentiment analysis.',
        dataSource: 'Volume data from Yahoo Finance + Claude API (Haiku) for sentiment and catalyst detection.',
        calculation: `
**Relative Volume (RVOL) Calculation:**
\`RVOL = Today's Volume / SMA(Volume, 30 days)\`

**Claude Sentiment Analysis:**
Uses Claude AI to analyze recent news and sentiment:
- Sentiment Score: -1 (very negative) to +1 (very positive)
- Catalyst Detection: Identifies mergers, FDA, earnings, contracts, etc.
- Keywords: Extracts relevant catalyst keywords

**Combined Scoring:**
- Score 10: RVOL ≥ 2.0 + Positive catalyst detected
- Score 9: Positive catalyst detected (merger, FDA, etc.)
- Score 8: RVOL ≥ 2.0
- Score 7: RVOL ≥ 1.5 OR mild positive sentiment
- Score 5: Neutral
- Score 3: Negative sentiment detected`,
        scoringLogic: [
            { condition: 'RVOL ≥ 2.0 + Positive Catalyst + Positive Sentiment', score: 10, label: 'Strong Catalyst' },
            { condition: 'Positive Catalyst Detected (merger, FDA, etc.)', score: 9, label: 'Catalyst Present' },
            { condition: 'RVOL ≥ 2.0x (High volume interest)', score: 8, label: 'High Interest' },
            { condition: 'RVOL ≥ 1.5x OR Mild Positive Sentiment', score: 7, label: 'Moderate Interest' },
            { condition: 'Neutral (no catalyst, normal volume)', score: 5, label: 'Neutral' },
            { condition: 'Negative Sentiment Detected', score: 3, label: 'Caution' }
        ],
        formula: `// Volume analysis
const avgVolume30 = SMA(volumes, 30)
const rvol = currentVolume / avgVolume30
const highRvol = rvol >= 2.0

// Claude sentiment analysis
const sentiment = await analyzeSentiment(ticker)
const positiveSentiment = sentiment.sentiment_score > 0.3
const negativeSentiment = sentiment.sentiment_score < -0.3

// Combined scoring
if (highRvol && sentiment.catalyst_detected && positiveSentiment) {
  score = 10  // Perfect storm: volume + catalyst + sentiment
} else if (sentiment.catalyst_detected && positiveSentiment) {
  score = 9   // Catalyst detected
} else if (highRvol) {
  score = 8   // High volume alone
} else if (rvol >= 1.5 || positiveSentiment) {
  score = 7   // Moderate interest
} else if (negativeSentiment) {
  score = 3   // Negative sentiment warning
} else {
  score = 5   // Neutral
}`,
        outputFields: ['has_catalyst: boolean', 'rvol: number', 'sentiment_score: number (-1 to +1)', 'sentiment_label: string', 'catalyst_detected: boolean', 'catalyst_keywords: string[]', 'summary: string'],
        limitations: [
            'Claude API required for sentiment analysis',
            'Uses Claude Haiku model (cost: ~$0.00025/call)',
            'Sentiment based on Claude knowledge cutoff, not real-time news',
            'Results cached for 1 hour to reduce API costs'
        ],
        codeReference: 'analysis.ts:537-575'
    },
    {
        id: 5,
        key: '5_patterns_gaps',
        name: 'Patterns & Gaps',
        subtitle: 'Technical Setups',
        icon: BarChart3,
        description: 'Programmatically identifies high-probability technical setups like gap-ups and bull flags that indicate potential continuation moves.',
        objective: 'Detect actionable chart patterns that historically precede strong price moves.',
        dataSource: 'Daily OHLCV data from Yahoo Finance.',
        calculation: `
**Gap-Up Detection:**
A breakaway gap occurs when today's Open > yesterday's High by at least 2%:
\`Gap% = (Open[Today] - High[Yesterday]) / High[Yesterday] × 100\`
Gap detected if Gap% ≥ 2%

**Bull Flag Detection:**
1. **Pole Phase**: Price increase > 10% in less than 5 days
2. **Flag Phase (Consolidation)**: Price drifts sideways/down for 3-10 days
3. **Validity Check**: Consolidation must NOT retrace > 50% of the pole

**Breakout Detection:**
Current Price > 50-day Swing High AND RVOL > 1.2x`,
        scoringLogic: [
            { condition: 'Breakout: Price > Swing High + Volume confirmation', score: 10, label: 'Breakout' },
            { condition: 'Gap Up ≥ 2%', score: 9, label: 'Gap Up' },
            { condition: 'Bull Flag detected (Pole + Flag)', score: 9, label: 'Bull Flag' },
            { condition: 'No significant pattern', score: 4, label: 'None' }
        ],
        formula: `// Gap Detection
const gapPercent = (opens[0] - highs[1]) / highs[1] * 100
const gapDetected = gapPercent >= 2

// Bull Flag Detection
function detectBullFlag(prices, highs, lows) {
  // Find pole: >10% gain in <5 days
  for (i = 5; i < 15; i++) {
    const gain = (prices[i-5] - prices[i]) / prices[i] * 100
    if (gain >= 10) poleFound = true
  }
  // Check consolidation: 3-10 days, <50% retracement
  // ... consolidation logic
  return { detected, poleGain, consolidationDays }
}

// Pattern scoring
if (currentPrice > swingHigh && rvol > 1.2) pattern = 'BREAKOUT', score = 10
else if (gapDetected) pattern = 'GAP_UP', score = 9
else if (bullFlag.detected) pattern = 'BULL_FLAG', score = 9
else pattern = 'NONE', score = 4`,
        outputFields: ['pattern: "BULL_FLAG" | "GAP_UP" | "BREAKOUT" | "NONE"', 'gap_detected: boolean', 'gap_percent: number', 'bull_flag_detected: boolean', 'pole_gain: number', 'consolidation_days: number'],
        limitations: [
            'Limited to gap-up, bull flag, and breakout patterns',
            'Does not detect head & shoulders, cup & handle, etc.',
            'Simple implementation may miss complex formations'
        ],
        codeReference: 'analysis.ts:430-450'
    },
    {
        id: 6,
        key: '6_support_resistance',
        name: 'Support & Resistance',
        subtitle: 'Risk Management Zones',
        icon: Target,
        description: 'Defines precise entry/exit zones using dynamic support levels and ATR-based stop losses. The foundation of proper position sizing and risk management.',
        objective: 'Calculate stop loss, take profit, and verify favorable Risk:Reward ratio ≥ 2:1.',
        dataSource: 'Daily OHLCV for swing points, ATR calculation from price ranges.',
        calculation: `
**Dynamic Support Detection:**
1. Check if price is within 2-3% of 20-day or 50-day EMA
2. Identify Swing Low = Lowest low of last 10 trading days

**ATR (Average True Range) Calculation:**
For each of the last 14 days:
\`True Range = MAX(High-Low, |High-PrevClose|, |Low-PrevClose|)\`
\`ATR = Average(True Ranges over 14 days)\`

**Stop Loss Calculation:**
\`Stop Loss = Swing Low - (1% × ATR)\`

**Take Profit & Risk:Reward:**
\`Risk = Entry Price - Stop Loss\`
\`Take Profit = Entry Price + (2 × Risk)\`
\`R:R Ratio = (TP - Entry) / (Entry - SL)\`

**Pass Criteria:** R:R ≥ 2.0`,
        scoringLogic: [
            { condition: 'R:R ≥ 2.0 AND near EMA support', score: 10, label: 'Perfect Entry' },
            { condition: 'R:R ≥ 2.0', score: 8, label: 'Good R:R' },
            { condition: 'Near 20 or 50 EMA support only', score: 6, label: 'Support Zone' },
            { condition: 'R:R < 2.0 and not near support', score: 4, label: 'Poor Setup' }
        ],
        formula: `// ATR Calculation
function calculateATR(highs, lows, closes, period = 14) {
  let atrSum = 0
  for (i = 0; i < period; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i+1]),
      Math.abs(lows[i] - closes[i+1])
    )
    atrSum += tr
  }
  return atrSum / period
}

// Support levels
const swingLow = Math.min(...lows.slice(0, 10))
const nearEma20 = Math.abs(price - ema20) / ema20 <= 0.03
const nearEma50 = Math.abs(price - ema50) / ema50 <= 0.03

// Risk management
const stopLoss = swingLow - (0.01 * atr)
const risk = price - stopLoss
const takeProfit = price + (2 * risk)
const rrRatio = (takeProfit - price) / risk
const rrPasses = rrRatio >= 2.0`,
        outputFields: ['swing_low: number', 'atr: number', 'stop_loss_level: number', 'take_profit_level: number', 'risk_reward_ratio: number', 'rr_passes: boolean', 'near_ema20: boolean', 'near_ema50: boolean'],
        limitations: [
            'Uses simple swing low (10-day), not pivot point analysis',
            'Single ATR period (14) used',
            'Does not identify historical support/resistance zones'
        ],
        codeReference: 'analysis.ts:452-478'
    },
    {
        id: 7,
        key: '7_price_movement',
        name: 'Price Action',
        subtitle: 'Trend Structure',
        icon: Activity,
        description: 'Confirms the stock is in an uptrend by analyzing the sequence of highs and lows. Higher highs and higher lows define a healthy uptrend.',
        objective: 'Verify trend structure (HH/HL) and detect reversal candlestick patterns at support.',
        dataSource: 'Daily OHLCV candlestick data.',
        calculation: `
**Higher Highs / Higher Lows Check:**
1. Today's Low > Lowest low of last 5 days (Higher Low confirmed)
2. Today's High > Highest high of last 5 days (Higher High confirmed)

**Hammer Candlestick Detection:**
A hammer at support signals potential reversal:
1. Total Range > 3× Body Size
2. Lower Wick Ratio > 60% of total range
\`Hammer = (High - Low) > 3 × |Open - Close| AND\`
\`         (Min(Open,Close) - Low) / (High - Low) > 0.6\``,
        scoringLogic: [
            { condition: 'Higher Highs + Higher Lows + Hammer', score: 10, label: 'Strong Uptrend + Confirmation' },
            { condition: 'Higher Highs + Higher Lows', score: 9, label: 'Confirmed Uptrend' },
            { condition: 'Higher Lows only', score: 7, label: 'Building Uptrend' },
            { condition: 'No trend structure', score: 5, label: 'Consolidation' },
            { condition: 'Lower Highs + Lower Lows', score: 2, label: 'Downtrend' }
        ],
        formula: `// Higher Highs / Higher Lows
const todayLow = lows[0]
const lowestOf5 = Math.min(...lows.slice(1, 6))
const higherLows = todayLow > lowestOf5

const todayHigh = highs[0]
const highestOf5 = Math.max(...highs.slice(1, 6))
const higherHighs = todayHigh > highestOf5

// Hammer detection
function detectHammer(open, high, low, close) {
  const bodySize = Math.abs(close - open)
  const totalRange = high - low
  const lowerWick = Math.min(open, close) - low
  
  const hasLongLowerWick = totalRange > 3 * bodySize
  const wickRatio = lowerWick / totalRange
  
  return hasLongLowerWick && wickRatio > 0.6
}

// Trend status
if (higherHighs && higherLows) trend = 'UPTREND'
else if (!higherHighs && !higherLows) trend = 'DOWNTREND'
else trend = 'CONSOLIDATION'`,
        outputFields: ['trend: "UPTREND" | "DOWNTREND" | "CONSOLIDATION"', 'recent_higher_lows: boolean', 'recent_higher_highs: boolean', 'hammer_detected: boolean', 'candle_confirmation: string'],
        limitations: [
            'Only detects Hammer pattern (no engulfing, doji, etc.)',
            'Simple 5-day lookback for HH/HL',
            'Does not analyze multiple timeframes'
        ],
        codeReference: 'analysis.ts:480-498'
    },
    {
        id: 8,
        key: '8_volume',
        name: 'Volume Analysis',
        subtitle: 'The "Lie Detector"',
        icon: Volume2,
        description: 'Confirms price movement authenticity through volume behavior. Volume should expand on up-moves and contract on pullbacks for healthy trends.',
        objective: 'Detect accumulation (institutional buying) vs distribution (selling) and confirm breakouts with volume.',
        dataSource: 'Daily volume data from Yahoo Finance.',
        calculation: `
**Accumulation Days:** (Institutional Buying)
Green days (Close > Open) with Above-average volume

**Distribution Days:** (Institutional Selling)
Red days (Close < Open) with Below-average volume

**Volume Trend Confirmation:**
5-day SMA of volume should be rising during breakouts

**Overall Confirmation:**
Volume confirms if: Accumulation Days > Distribution Days AND Volume SMA5 Rising`,
        scoringLogic: [
            { condition: 'Volume confirms + RVOL > 1.5', score: 10, label: 'Strong Confirmation' },
            { condition: 'Volume confirms (Acc > Dist + Rising SMA5)', score: 8, label: 'Good Confirmation' },
            { condition: 'Accumulation Days > Distribution Days', score: 6, label: 'Mild Accumulation' },
            { condition: 'Distribution Days > Accumulation Days', score: 3, label: 'Distribution' }
        ],
        formula: `// Accumulation/Distribution analysis
function analyzeAccDist(opens, closes, volumes, avgVolume) {
  let accDays = 0, distDays = 0
  
  for (i = 0; i < 20; i++) {
    const isGreen = closes[i] > opens[i]
    const isRed = closes[i] < opens[i]
    const aboveAvg = volumes[i] > avgVolume
    const belowAvg = volumes[i] < avgVolume
    
    if (isGreen && aboveAvg) accDays++   // Accumulation
    if (isRed && belowAvg) distDays++    // Distribution
  }
  return { accDays, distDays }
}

// Volume SMA5 Rising
const sma5_current = SMA(volumes.slice(0, 5), 5)
const sma5_prev = SMA(volumes.slice(1, 6), 5)
const volumeSmaRising = sma5_current > sma5_prev

// Confirmation
const volumeConfirms = accDays > distDays && volumeSmaRising`,
        outputFields: ['accumulation_days: number', 'distribution_days: number', 'volume_sma5_rising: boolean', 'volume_confirms: boolean', 'current_volume: number', 'avg_volume: number'],
        limitations: [
            'Simple accumulation/distribution count',
            'Does not use On-Balance Volume (OBV)',
            'No volume profile or VWAP analysis'
        ],
        codeReference: 'analysis.ts:500-520'
    },
    {
        id: 9,
        key: '9_ma_fibonacci',
        name: 'Averages & Fibonacci',
        subtitle: 'Algorithmic Support Levels',
        icon: LineChart,
        description: 'Uses moving averages and Fibonacci retracement levels to identify optimal "buy zones" where price has pulled back to support.',
        objective: 'Confirm price is above key MAs (200 SMA, 20 EMA) and identify Fibonacci buy zones.',
        dataSource: 'Daily closing prices for MA calculation, swing high/low for Fibonacci levels.',
        calculation: `
**Key Moving Average Checks:**
1. Price > 200-day SMA (Long-term trend is UP)
2. Price > 20-day EMA (Short-term momentum positive)

**Fibonacci Retracement Levels:**
From Last Major Low to Last Major High (50-day range):
- 0.382 Level = High - (Range × 0.382)
- 0.500 Level = High - (Range × 0.500)
- 0.618 Level = High - (Range × 0.618)

**Buy Zone Identification:**
Price is in a buy zone if within 2% of any Fibonacci level (0.382, 0.500, or 0.618)`,
        scoringLogic: [
            { condition: 'Above 200 SMA + Above 20 EMA + In Fib Buy Zone', score: 10, label: 'Perfect Dip Buy' },
            { condition: 'Above 200 SMA + Above 20 EMA', score: 8, label: 'Bullish Alignment' },
            { condition: 'Above 200 SMA only', score: 6, label: 'Long-term Bullish' },
            { condition: 'Below 200 SMA', score: 3, label: 'Below Major Support' }
        ],
        formula: `// Moving Average checks
const priceAbove200SMA = currentPrice > SMA(prices, 200)
const priceAbove20EMA = currentPrice > EMA(prices, 20)

// Fibonacci calculation
const swingHigh = Math.max(...highs.slice(0, 50))
const swingLow = Math.min(...lows.slice(0, 50))
const range = swingHigh - swingLow

const fibLevels = {
  level_382: swingHigh - (range * 0.382),
  level_500: swingHigh - (range * 0.500),
  level_618: swingHigh - (range * 0.618)
}

// Check if in buy zone (within 2% of any fib level)
function isInFibBuyZone(price, fibLevels, tolerance = 0.02) {
  for (level of [level_382, level_500, level_618]) {
    if (Math.abs(price - level) / level <= tolerance)
      return { inZone: true, level }
  }
  return { inZone: false, level: 'N/A' }
}`,
        outputFields: ['price_above_200sma: boolean', 'price_above_20ema: boolean', 'fib_levels: { level_382, level_500, level_618 }', 'in_fib_buy_zone: boolean', 'fib_level_current: string'],
        limitations: [
            'Uses 50-day range for Fibonacci (may miss larger swings)',
            'Does not calculate Fibonacci extensions for targets',
            'Single tolerance (2%) for buy zone detection'
        ],
        codeReference: 'analysis.ts:522-545'
    },
    {
        id: 10,
        key: '10_rsi',
        name: 'RSI Momentum',
        subtitle: 'Relative Strength Index',
        icon: Gauge,
        description: 'Measures momentum and identifies overbought/oversold conditions. In uptrends, RSI tends to stay in the 40-90 range, with dips to 40-50 presenting buy opportunities.',
        objective: 'Verify RSI is in the optimal range (45-70) for swing entries, not overextended (>75).',
        dataSource: 'Daily closing prices, 14-period RSI calculation.',
        calculation: `
**RSI Calculation (14-period):**

1. Calculate price changes for each period
2. Separate gains and losses
3. Calculate Average Gain and Average Loss
4. RS (Relative Strength) = Average Gain / Average Loss
5. RSI = 100 - (100 / (1 + RS))

**Bull Market RSI Interpretation:**
- 40-90: Normal bull market range
- 45-70: Optimal swing entry zone
- 40-50: "Dip Buy" signal (momentum pause)
- >75: Overextended (caution, may continue but risky entry)
- <40: Weak momentum (avoid longs)`,
        scoringLogic: [
            { condition: 'RSI 45-70 + RSI > 50 (Optimal + Positive Momentum)', score: 10, label: 'Optimal Entry' },
            { condition: 'RSI 40-50 + In Bull Range (Dip Buy Signal)', score: 9, label: 'Dip Buy Zone' },
            { condition: 'RSI 40-90 + Not Overextended', score: 7, label: 'Acceptable' },
            { condition: 'RSI > 75 (Overextended)', score: 4, label: 'Caution - Extended' },
            { condition: 'RSI < 40 (Weak Momentum)', score: 3, label: 'Weak - Avoid' }
        ],
        formula: `// RSI Calculation
function calculateRSI(prices, period = 14) {
  let gains = 0, losses = 0
  
  for (i = 0; i < period; i++) {
    const change = prices[i] - prices[i + 1]
    if (change > 0) gains += change
    else losses += Math.abs(change)
  }
  
  const avgGain = gains / period
  const avgLoss = losses / period
  const rs = avgGain / avgLoss
  return 100 - (100 / (1 + rs))
}

// RSI interpretation
const inBullRange = rsi >= 40 && rsi <= 90
const dipBuySignal = rsi >= 40 && rsi <= 50
const positiveMomentum = rsi > 50
const overextended = rsi > 75
const optimalRange = rsi >= 45 && rsi <= 70

// Scoring
if (optimalRange && positiveMomentum) score = 10
else if (dipBuySignal && inBullRange) score = 9
else if (inBullRange && !overextended) score = 7
else if (overextended) score = 4
else if (rsi < 40) score = 3`,
        outputFields: ['value: number (RSI)', 'in_bull_range: boolean', 'dip_buy_signal: boolean', 'positive_momentum: boolean', 'overextended: boolean', 'optimal_range: boolean'],
        limitations: [
            'Does not detect RSI divergences',
            'Single period (14) used',
            'No multi-timeframe RSI analysis'
        ],
        codeReference: 'analysis.ts:547-575'
    }
];

// Success Probability Formula Documentation
const probabilityDoc = {
    title: 'Success Probability Calculation',
    description: 'The overall success probability is calculated by summing all 10 criterion scores (each 0-10) and expressing as a percentage out of 100.',
    formula: `totalScore = Σ(criterion[1..10].score)  // Max: 100
successProbability = totalScore%`,
    interpretation: [
        { range: '≥ 80%', rating: 'HIGH', recommendation: 'BUY - STRONG', color: 'emerald' },
        { range: '70-79%', rating: 'HIGH', recommendation: 'BUY', color: 'emerald' },
        { range: '50-69%', rating: 'MODERATE', recommendation: 'HOLD / WATCH', color: 'amber' },
        { range: '< 50%', rating: 'LOW', recommendation: 'AVOID', color: 'red' }
    ]
};

function CriterionCard({ criterion, isExpanded, onToggle }: { 
    criterion: CriterionDoc; 
    isExpanded: boolean;
    onToggle: () => void;
}) {
    const Icon = criterion.icon;
    
    return (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <button
                onClick={onToggle}
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center">
                        <Icon className="w-5 h-5 text-white" />
                    </div>
                    <div className="text-left">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-mono bg-gray-100 px-2 py-0.5 rounded text-gray-500">
                                #{criterion.id}
                            </span>
                            <h3 className="font-semibold text-gray-900">{criterion.name}</h3>
                            <span className="text-xs text-teal-600 font-medium">({criterion.subtitle})</span>
                        </div>
                        <p className="text-sm text-gray-500 mt-0.5 line-clamp-1">{criterion.objective}</p>
                    </div>
                </div>
                {isExpanded ? (
                    <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0" />
                ) : (
                    <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
                )}
            </button>
            
            {isExpanded && (
                <div className="px-6 pb-6 border-t border-gray-100 pt-4 space-y-6 animate-fade-in">
                    {/* Objective */}
                    <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
                        <h4 className="text-sm font-semibold text-teal-800 mb-1">🎯 Objective</h4>
                        <p className="text-sm text-teal-700">{criterion.objective}</p>
                    </div>
                    
                    {/* Description */}
                    <div>
                        <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                            <Info className="w-4 h-4" /> Description
                        </h4>
                        <p className="text-sm text-gray-600">{criterion.description}</p>
                    </div>
                    
                    {/* Data Source */}
                    <div>
                        <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                            <BookOpen className="w-4 h-4" /> Data Source
                        </h4>
                        <p className="text-sm text-gray-600">{criterion.dataSource}</p>
                    </div>
                    
                    {/* Calculation Method */}
                    <div>
                        <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                            <Calculator className="w-4 h-4" /> Calculation Method
                        </h4>
                        <div className="text-sm text-gray-600 whitespace-pre-line bg-gray-50 p-4 rounded-lg border border-gray-200">
                            {criterion.calculation}
                        </div>
                    </div>
                    
                    {/* Formula */}
                    {criterion.formula && (
                        <div>
                            <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                                <Code className="w-4 h-4" /> Implementation (Pseudocode)
                            </h4>
                            <pre className="text-xs bg-gray-900 text-green-400 p-4 rounded-lg overflow-x-auto font-mono">
                                {criterion.formula}
                            </pre>
                        </div>
                    )}
                    
                    {/* Scoring Logic Table */}
                    <div>
                        <h4 className="text-sm font-semibold text-gray-700 mb-2">Scoring Rules</h4>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-gray-50">
                                        <th className="px-3 py-2 text-left font-medium text-gray-600">Condition</th>
                                        <th className="px-3 py-2 text-center font-medium text-gray-600 w-20">Score</th>
                                        <th className="px-3 py-2 text-left font-medium text-gray-600 w-40">Label</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {criterion.scoringLogic.map((rule, idx) => (
                                        <tr key={idx} className="hover:bg-gray-50">
                                            <td className="px-3 py-2 text-gray-700 text-xs">{rule.condition}</td>
                                            <td className="px-3 py-2 text-center">
                                                <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full font-bold text-sm ${
                                                    rule.score >= 8 ? 'bg-emerald-100 text-emerald-700' :
                                                    rule.score >= 6 ? 'bg-amber-100 text-amber-700' :
                                                    rule.score >= 4 ? 'bg-orange-100 text-orange-700' :
                                                    'bg-red-100 text-red-700'
                                                }`}>
                                                    {rule.score}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-gray-600 text-xs">{rule.label}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    
                    {/* Output Fields */}
                    <div>
                        <h4 className="text-sm font-semibold text-gray-700 mb-2">Output Fields</h4>
                        <div className="flex flex-wrap gap-2">
                            {criterion.outputFields.map((field, idx) => (
                                <code key={idx} className="text-xs bg-gray-100 px-2 py-1 rounded text-gray-700">
                                    {field}
                                </code>
                            ))}
                        </div>
                    </div>
                    
                    {/* Limitations */}
                    <div>
                        <h4 className="text-sm font-semibold text-amber-700 mb-2 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4" /> Current Limitations
                        </h4>
                        <ul className="text-sm text-gray-600 space-y-1">
                            {criterion.limitations.map((limitation, idx) => (
                                <li key={idx} className="flex items-start gap-2">
                                    <span className="text-amber-500 mt-1">•</span>
                                    {limitation}
                                </li>
                            ))}
                        </ul>
                    </div>
                    
                    {/* Code Reference */}
                    <div className="flex items-center gap-2 text-xs text-gray-400 pt-2 border-t border-gray-100">
                        <Code className="w-3 h-3" />
                        <span>Source: <code className="bg-gray-100 px-1.5 py-0.5 rounded">{criterion.codeReference}</code></span>
                    </div>
                </div>
            )}
        </div>
    );
}

function ScoreDiagram() {
    return (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Score Aggregation Flow</h3>
            <div className="flex flex-col items-center">
                {/* Criteria grid */}
                <div className="grid grid-cols-5 gap-2 mb-4 w-full max-w-2xl">
                    {['Market', 'Sector', 'Company', 'Catalyst', 'Patterns'].map((name, i) => (
                        <div key={i} className="bg-teal-50 border border-teal-200 rounded-lg p-2 text-center">
                            <div className="text-[10px] text-teal-600 font-medium">#{i + 1}</div>
                            <div className="text-xs font-medium text-teal-800 truncate">{name}</div>
                            <div className="text-lg font-bold text-teal-700">0-10</div>
                        </div>
                    ))}
                </div>
                <div className="grid grid-cols-5 gap-2 mb-4 w-full max-w-2xl">
                    {['S/R', 'Price', 'Volume', 'MA/Fib', 'RSI'].map((name, i) => (
                        <div key={i} className="bg-teal-50 border border-teal-200 rounded-lg p-2 text-center">
                            <div className="text-[10px] text-teal-600 font-medium">#{i + 6}</div>
                            <div className="text-xs font-medium text-teal-800 truncate">{name}</div>
                            <div className="text-lg font-bold text-teal-700">0-10</div>
                        </div>
                    ))}
                </div>
                
                {/* Arrow down */}
                <div className="flex flex-col items-center my-2">
                    <div className="w-0.5 h-4 bg-gray-300"></div>
                    <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-gray-300"></div>
                </div>
                
                {/* Sum */}
                <div className="bg-gray-100 border-2 border-gray-300 rounded-xl px-6 py-3 text-center mb-4">
                    <div className="text-sm text-gray-600">Sum All Scores</div>
                    <div className="font-mono text-lg font-bold text-gray-800">Σ = 0-100</div>
                </div>
                
                {/* Arrow down */}
                <div className="flex flex-col items-center my-2">
                    <div className="w-0.5 h-4 bg-gray-300"></div>
                    <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-gray-300"></div>
                </div>
                
                {/* Result */}
                <div className="bg-gradient-to-br from-teal-500 to-teal-600 rounded-xl px-8 py-4 text-center text-white shadow-lg">
                    <div className="text-sm opacity-90">Success Probability</div>
                    <div className="font-mono text-2xl font-bold">X%</div>
                </div>
            </div>
        </div>
    );
}

function InterpretationTable() {
    return (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Score Interpretation</h3>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-gray-50">
                            <th className="px-4 py-3 text-left font-medium text-gray-600">Range</th>
                            <th className="px-4 py-3 text-left font-medium text-gray-600">Confidence</th>
                            <th className="px-4 py-3 text-left font-medium text-gray-600">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {probabilityDoc.interpretation.map((row, idx) => (
                            <tr key={idx} className="hover:bg-gray-50">
                                <td className="px-4 py-3 font-mono font-medium text-gray-800">{row.range}</td>
                                <td className="px-4 py-3">
                                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                        row.color === 'emerald' ? 'bg-emerald-100 text-emerald-700' :
                                        row.color === 'amber' ? 'bg-amber-100 text-amber-700' :
                                        'bg-red-100 text-red-700'
                                    }`}>
                                        {row.rating}
                                    </span>
                                </td>
                                <td className="px-4 py-3">
                                    <span className={`font-medium ${
                                        row.recommendation.includes('STRONG') ? 'text-emerald-600' :
                                        row.recommendation.includes('BUY') ? 'text-emerald-500' :
                                        row.recommendation.includes('HOLD') ? 'text-amber-600' :
                                        'text-red-600'
                                    }`}>
                                        {row.recommendation}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export function MethodologyTab() {
    const [expandedCriteria, setExpandedCriteria] = useState<Set<number>>(new Set());
    const [expandAll, setExpandAll] = useState(false);

    const toggleCriterion = (id: number) => {
        setExpandedCriteria(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const handleExpandAll = () => {
        if (expandAll) {
            setExpandedCriteria(new Set());
        } else {
            setExpandedCriteria(new Set(criteriaDocumentation.map(c => c.id)));
        }
        setExpandAll(!expandAll);
    };

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {/* Header */}
            <div className="text-center mb-8">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-teal-50 rounded-full text-teal-700 text-sm font-medium mb-4">
                    <Code className="w-4 h-4" />
                    v{METHODOLOGY_VERSION} • Updated {LAST_UPDATED}
                </div>
                <h1 className="text-3xl font-bold text-gray-900 mb-3">
                    How It Works
                </h1>
                <p className="text-gray-600 max-w-2xl mx-auto">
                    Complete transparency into our 10-Point Swing Analysis System. 
                    Each criterion uses robust, quantifiable logic derived from proven technical analysis principles.
                </p>
            </div>

            {/* Overview Section */}
            <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-6 mb-8 text-white">
                <h2 className="text-xl font-bold mb-4">📊 The Robust 10-Point System</h2>
                <div className="grid md:grid-cols-2 gap-6">
                    <div>
                        <p className="text-slate-300 text-sm mb-4">
                            Each stock is evaluated across <strong className="text-white">10 robust criteria</strong> using 
                            real market data. Every criterion produces a score from <strong className="text-white">0 to 10</strong>, 
                            creating a comprehensive assessment out of <strong className="text-white">100 points</strong>.
                        </p>
                        <div className="bg-slate-700/50 rounded-lg p-3 space-y-2">
                            <div>
                                <div className="text-xs text-slate-400">Primary Data Source</div>
                                <div className="text-sm font-medium">Yahoo Finance API</div>
                            </div>
                            <div>
                                <div className="text-xs text-slate-400">Market Data</div>
                                <div className="text-sm font-medium">SPY, VIX, Sector ETFs</div>
                            </div>
                            <div>
                                <div className="text-xs text-slate-400">Lookback Period</div>
                                <div className="text-sm font-medium">250 days (Daily timeframe)</div>
                            </div>
                        </div>
                    </div>
                    <div className="space-y-3">
                        <div className="text-sm font-medium text-slate-300 mb-2">Key Indicators Calculated:</div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="bg-slate-700/50 rounded px-2 py-1">✓ SMA (20, 50, 100, 200)</div>
                            <div className="bg-slate-700/50 rounded px-2 py-1">✓ EMA (8, 20, 50)</div>
                            <div className="bg-slate-700/50 rounded px-2 py-1">✓ RSI (14-period)</div>
                            <div className="bg-slate-700/50 rounded px-2 py-1">✓ ATR (14-period)</div>
                            <div className="bg-slate-700/50 rounded px-2 py-1">✓ RVOL (30-day)</div>
                            <div className="bg-slate-700/50 rounded px-2 py-1">✓ Fibonacci Levels</div>
                            <div className="bg-slate-700/50 rounded px-2 py-1">✓ Sector RS Score</div>
                            <div className="bg-slate-700/50 rounded px-2 py-1">✓ Pattern Detection</div>
                        </div>
                        <div className="mt-4 pt-3 border-t border-slate-600">
                            <div className="flex items-center gap-3">
                                <div className="w-3 h-3 rounded-full bg-emerald-400"></div>
                                <span className="text-sm"><strong>8-10:</strong> Strong pass</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="w-3 h-3 rounded-full bg-amber-400"></div>
                                <span className="text-sm"><strong>5-7:</strong> Neutral</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="w-3 h-3 rounded-full bg-red-400"></div>
                                <span className="text-sm"><strong>1-4:</strong> Fail / Caution</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Quick Reference */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
                <h3 className="font-semibold text-gray-900 mb-4">Quick Reference: All 10 Criteria</h3>
                <div className="grid md:grid-cols-2 gap-3">
                    {criteriaDocumentation.map((c) => (
                        <div key={c.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50">
                            <span className="w-6 h-6 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-xs font-bold">
                                {c.id}
                            </span>
                            <div className="flex-1 min-w-0">
                                <div className="font-medium text-gray-900 text-sm">{c.name}</div>
                                <div className="text-xs text-gray-500 truncate">{c.subtitle}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Score Calculation Visual */}
            <div className="grid md:grid-cols-2 gap-6 mb-8">
                <ScoreDiagram />
                <InterpretationTable />
            </div>

            {/* Criteria List */}
            <div className="mb-6 flex items-center justify-between">
                <h2 className="text-xl font-bold text-gray-900">Detailed Criteria Documentation</h2>
                <button
                    onClick={handleExpandAll}
                    className="text-sm text-teal-600 hover:text-teal-700 font-medium"
                >
                    {expandAll ? 'Collapse All' : 'Expand All'}
                </button>
            </div>
            
            <div className="space-y-3">
                {criteriaDocumentation.map(criterion => (
                    <CriterionCard
                        key={criterion.id}
                        criterion={criterion}
                        isExpanded={expandedCriteria.has(criterion.id)}
                        onToggle={() => toggleCriterion(criterion.id)}
                    />
                ))}
            </div>

            {/* Disclaimer */}
            <div className="mt-8 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <h3 className="font-semibold text-amber-800 mb-2 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" /> Important Disclaimers
                </h3>
                <ul className="text-sm text-amber-700 space-y-1">
                    <li>• This tool is for <strong>educational purposes only</strong> and does not constitute financial advice.</li>
                    <li>• Past performance does not guarantee future results.</li>
                    <li>• Some criteria have limitations (marked) due to free API constraints.</li>
                    <li>• Full fundamental data requires premium API subscriptions.</li>
                    <li>• Always conduct your own research before making investment decisions.</li>
                </ul>
            </div>

            {/* Footer */}
            <div className="mt-6 text-center text-xs text-gray-400">
                Documentation derived from <code className="bg-gray-100 px-1.5 py-0.5 rounded">src/lib/analysis.ts</code>
                <br />
                This system implements robust swing trading criteria based on institutional trading principles.
            </div>
        </div>
    );
}
