/**
 * Multi-Timeframe Analysis Types
 * Types for 4-hour chart confirmation system
 */

export type TimeframeAlignment = 'STRONG_BUY' | 'BUY' | 'CONSIDER' | 'SKIP';
export type MACDStatus = 'POSITIVE' | 'TURNING_POSITIVE' | 'NEGATIVE';

/**
 * MACD indicator values
 */
export interface MACDData {
  macdLine: number;
  signalLine: number;
  histogram: number;
  status: MACDStatus;
  crossover: 'BULLISH' | 'BEARISH' | 'NONE';
  histogramRising: boolean;
}

/**
 * 4-Hour timeframe analysis result
 */
export interface Hour4Analysis {
  score: number; // 0-10
  macd: MACDData;
  rsi: number;
  ema20: number;
  priceAboveEMA20: boolean;
  resistance: number;
  support: number;
  priceVsResistance: number; // % from resistance
  priceVsSupport: number; // % from support
  higherHighs: boolean;
  higherLows: boolean;
  trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS';
  timestamp: string;
}

/**
 * Combined multi-timeframe analysis
 */
export interface MultiTimeframeAnalysis {
  daily: {
    score: number;
    trend: string;
  };
  hour4: Hour4Analysis;
  combined_score: number;
  alignment: TimeframeAlignment;
  recommendation: string;
  timestamp: string;
}

/**
 * OHLCV candle data
 */
export interface OHLCVCandle {
  timestamp: number;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Intraday data response structure
 */
export interface IntradayDataResponse {
  candles: OHLCVCandle[];
  ticker: string;
  interval: string;
  dataSource: 'yahoo_1h' | 'estimated' | 'fallback';
}







