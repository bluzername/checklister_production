/**
 * Sentiment Analysis Service using Claude API
 * Analyzes recent news and market sentiment for a given stock ticker.
 */

import Anthropic from '@anthropic-ai/sdk';
import { withLogging } from './logger';
import { cacheKey, getOrFetch, TTL } from './cache';

export interface SentimentData {
    sentiment_score: number;        // -1 to +1
    sentiment_label: 'VERY_NEGATIVE' | 'NEGATIVE' | 'NEUTRAL' | 'POSITIVE' | 'VERY_POSITIVE';
    catalyst_detected: boolean;
    catalyst_keywords: string[];
    catalyst_type: string | null;   // "earnings", "merger", "fda", etc.
    summary: string;
    confidence: number;             // 0 to 1
    data_available: boolean;
}

// Catalyst keywords for detection
const CATALYST_KEYWORDS = [
    'merger', 'acquisition', 'acquire', 'buyout',
    'fda approval', 'fda', 'drug approval', 'clinical trial',
    'earnings beat', 'earnings miss', 'revenue beat', 'guidance',
    'contract', 'partnership', 'deal', 'agreement',
    'product launch', 'new product', 'release',
    'buyback', 'share repurchase', 'dividend',
    'upgrade', 'downgrade', 'price target',
    'lawsuit', 'settlement', 'regulatory', 'investigation',
    'ceo', 'executive', 'layoff', 'restructuring',
];

/**
 * Check if Claude API is configured
 */
export function isClaudeConfigured(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * Get sentiment label from score
 */
function getSentimentLabel(score: number): SentimentData['sentiment_label'] {
    if (score <= -0.6) return 'VERY_NEGATIVE';
    if (score <= -0.2) return 'NEGATIVE';
    if (score <= 0.2) return 'NEUTRAL';
    if (score <= 0.6) return 'POSITIVE';
    return 'VERY_POSITIVE';
}

/**
 * Analyze sentiment using Claude API
 */
async function fetchSentimentFromClaude(ticker: string): Promise<SentimentData> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    
    if (!apiKey) {
        console.warn('[SENTIMENT] Anthropic API key not configured, returning neutral sentiment');
        return getEmptySentiment();
    }
    
    try {
        const anthropic = new Anthropic({
            apiKey: apiKey,
        });
        
        const prompt = `You are a financial analyst. Analyze the current market sentiment for stock ticker ${ticker}.

Based on your knowledge of recent news, earnings, and market events (up to your knowledge cutoff), provide:

1. A sentiment score from -1.0 (very negative) to +1.0 (very positive)
2. Whether any significant catalyst is present (earnings, merger, FDA, contract, etc.)
3. Key catalyst keywords if any
4. A brief 1-2 sentence summary of the current sentiment

Important: If you don't have specific recent information about this stock, provide a neutral assessment based on the company's general standing.

Respond ONLY with valid JSON in this exact format:
{
  "sentiment_score": 0.0,
  "catalyst_detected": false,
  "catalyst_keywords": [],
  "catalyst_type": null,
  "summary": "Brief summary here",
  "confidence": 0.5
}`;

        const message = await anthropic.messages.create({
            model: 'claude-3-haiku-20240307',
            max_tokens: 500,
            messages: [
                {
                    role: 'user',
                    content: prompt,
                }
            ],
        });
        
        // Extract text content from response
        const textContent = message.content.find(c => c.type === 'text');
        if (!textContent || textContent.type !== 'text') {
            throw new Error('No text content in Claude response');
        }
        
        // Parse JSON response
        const responseText = textContent.text.trim();
        
        // Try to extract JSON from response (Claude sometimes adds extra text)
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('No JSON found in Claude response');
        }
        
        const parsed = JSON.parse(jsonMatch[0]);
        
        // Validate and normalize the response
        const sentiment_score = Math.max(-1, Math.min(1, Number(parsed.sentiment_score) || 0));
        const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5));
        
        return {
            sentiment_score,
            sentiment_label: getSentimentLabel(sentiment_score),
            catalyst_detected: Boolean(parsed.catalyst_detected),
            catalyst_keywords: Array.isArray(parsed.catalyst_keywords) ? parsed.catalyst_keywords : [],
            catalyst_type: parsed.catalyst_type || null,
            summary: String(parsed.summary || 'No summary available'),
            confidence,
            data_available: true,
        };
    } catch (error) {
        console.error(`[SENTIMENT] Error analyzing sentiment for ${ticker}:`, error);
        throw error;
    }
}

/**
 * Return empty/neutral sentiment (for graceful degradation)
 */
function getEmptySentiment(): SentimentData {
    return {
        sentiment_score: 0,
        sentiment_label: 'NEUTRAL',
        catalyst_detected: false,
        catalyst_keywords: [],
        catalyst_type: null,
        summary: 'Sentiment analysis unavailable',
        confidence: 0,
        data_available: false,
    };
}

/**
 * Main function: Analyze sentiment with caching and logging
 */
export async function analyzeSentiment(ticker: string): Promise<SentimentData> {
    const key = cacheKey('claude', 'sentiment', ticker);
    
    try {
        const { data, cached } = await getOrFetch(
            key,
            TTL.SENTIMENT,
            () => withLogging(
                'claude',
                'sentiment',
                ticker,
                () => fetchSentimentFromClaude(ticker)
            )
        );
        
        // If it was cached, log the cache hit
        if (cached) {
            const { logApiCall } = await import('./logger');
            logApiCall({
                service: 'cache',
                operation: 'sentiment',
                ticker,
                latency_ms: 0,
                success: true,
                cached: true,
            });
        }
        
        return data;
    } catch (error) {
        // Graceful degradation: return neutral sentiment on failure
        console.warn(`[SENTIMENT] Falling back to neutral sentiment for ${ticker}`);
        return getEmptySentiment();
    }
}

/**
 * Quick sentiment check (uses simpler logic, no API call)
 * For when you just need a basic sentiment without calling Claude
 */
export function getBasicSentiment(
    rvol: number,
    rsi: number,
    priceVsSma: number
): Pick<SentimentData, 'sentiment_score' | 'sentiment_label'> {
    // Simple heuristic-based sentiment
    let score = 0;
    
    // High RVOL is generally positive (interest)
    if (rvol > 2) score += 0.3;
    else if (rvol > 1.5) score += 0.15;
    
    // RSI in optimal range is positive
    if (rsi >= 45 && rsi <= 70) score += 0.2;
    else if (rsi > 75) score -= 0.2; // Overextended
    else if (rsi < 30) score -= 0.3; // Oversold can be negative momentum
    
    // Price vs moving average
    if (priceVsSma > 0.05) score += 0.2; // 5% above SMA
    else if (priceVsSma < -0.05) score -= 0.2; // 5% below SMA
    
    // Clamp to -1 to 1
    score = Math.max(-1, Math.min(1, score));
    
    return {
        sentiment_score: Math.round(score * 100) / 100,
        sentiment_label: getSentimentLabel(score),
    };
}







