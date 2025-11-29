/**
 * Test Script for Data Services
 * 
 * Run with: npx tsx scripts/test-data-services.ts
 * 
 * Tests:
 * 1. FMP fundamentals fetching
 * 2. Claude sentiment analysis
 * 3. Cache functionality
 * 4. Full analysis integration
 */

// Load environment variables from .env.local
import { config } from 'dotenv';
config({ path: '.env.local' });

import { getFundamentals, isFmpConfigured } from '../src/lib/data-services/fmp';
import { analyzeSentiment, isClaudeConfigured } from '../src/lib/data-services/sentiment';
import { getApiStats, getRecentLogs, clearLogs } from '../src/lib/data-services/logger';
import { getCacheStats, clearCache } from '../src/lib/data-services/cache';
import { analyzeTicker } from '../src/lib/analysis';

const TEST_TICKERS = ['AAPL', 'NVDA', 'TSLA'];

async function testEodhd() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST 1: FMP Fundamentals');
    console.log('='.repeat(60));
    
    const configured = isFmpConfigured();
    console.log(`\nFMP API configured: ${configured ? '✅ Yes' : '❌ No (will use fallback)'}`);
    
    for (const ticker of TEST_TICKERS) {
        console.log(`\n--- ${ticker} ---`);
        const startTime = Date.now();
        
        try {
            const data = await getFundamentals(ticker);
            const latency = Date.now() - startTime;
            
            console.log(`  Data available: ${data.data_available ? '✅' : '❌'}`);
            console.log(`  Latency: ${latency}ms`);
            
            if (data.data_available) {
                console.log(`  EPS Actual: ${data.eps_actual ?? 'N/A'}`);
                console.log(`  EPS Expected: ${data.eps_expected ?? 'N/A'}`);
                console.log(`  Earnings Surprise: ${data.earnings_surprise ? '✅ Beat' : '❌ Miss/Meet'}`);
                console.log(`  Revenue Growth QoQ: ${data.revenue_growth_qoq?.toFixed(1) ?? 'N/A'}%`);
                console.log(`  Market Cap: $${data.market_cap?.toFixed(1) ?? 'N/A'}B`);
            }
        } catch (error) {
            console.log(`  ❌ Error: ${error}`);
        }
    }
}

async function testSentiment() {
    console.log('\n' + '='.repeat(60));
    console.log('🎭 TEST 2: Claude Sentiment Analysis');
    console.log('='.repeat(60));
    
    const configured = isClaudeConfigured();
    console.log(`\nClaude API configured: ${configured ? '✅ Yes' : '❌ No (will use fallback)'}`);
    
    for (const ticker of TEST_TICKERS) {
        console.log(`\n--- ${ticker} ---`);
        const startTime = Date.now();
        
        try {
            const data = await analyzeSentiment(ticker);
            const latency = Date.now() - startTime;
            
            console.log(`  Data available: ${data.data_available ? '✅' : '❌'}`);
            console.log(`  Latency: ${latency}ms`);
            
            if (data.data_available) {
                console.log(`  Sentiment Score: ${data.sentiment_score.toFixed(2)}`);
                console.log(`  Sentiment Label: ${data.sentiment_label}`);
                console.log(`  Catalyst Detected: ${data.catalyst_detected ? '✅ ' + (data.catalyst_type || 'Yes') : '❌ No'}`);
                if (data.catalyst_keywords.length > 0) {
                    console.log(`  Keywords: ${data.catalyst_keywords.join(', ')}`);
                }
                console.log(`  Summary: ${data.summary}`);
                console.log(`  Confidence: ${(data.confidence * 100).toFixed(0)}%`);
            }
        } catch (error) {
            console.log(`  ❌ Error: ${error}`);
        }
    }
}

async function testCache() {
    console.log('\n' + '='.repeat(60));
    console.log('💾 TEST 3: Cache Functionality');
    console.log('='.repeat(60));
    
    const ticker = 'AAPL';
    
    // First call (should hit API)
    console.log(`\n--- First call for ${ticker} (should hit API) ---`);
    const start1 = Date.now();
    await getFundamentals(ticker);
    const time1 = Date.now() - start1;
    console.log(`  Time: ${time1}ms`);
    
    // Second call (should hit cache)
    console.log(`\n--- Second call for ${ticker} (should hit cache) ---`);
    const start2 = Date.now();
    await getFundamentals(ticker);
    const time2 = Date.now() - start2;
    console.log(`  Time: ${time2}ms`);
    
    const cacheWorking = time2 < time1 / 2 || time2 < 10;
    console.log(`\n  Cache working: ${cacheWorking ? '✅ Yes (second call was faster)' : '⚠️ Check cache implementation'}`);
    
    // Cache stats
    const cacheStats = getCacheStats();
    console.log(`\n--- Cache Stats ---`);
    console.log(`  Items cached: ${cacheStats.size}`);
    console.log(`  Memory: ${cacheStats.memoryEstimate}`);
}

async function testFullAnalysis() {
    console.log('\n' + '='.repeat(60));
    console.log('🔍 TEST 4: Full Analysis Integration');
    console.log('='.repeat(60));
    
    const ticker = TEST_TICKERS[0];
    console.log(`\nAnalyzing ${ticker}...`);
    
    const startTime = Date.now();
    
    try {
        const result = await analyzeTicker(ticker);
        const latency = Date.now() - startTime;
        
        console.log(`\n✅ Analysis complete in ${latency}ms`);
        console.log(`\n--- Results ---`);
        console.log(`  Ticker: ${result.ticker}`);
        console.log(`  Price: $${result.current_price.toFixed(2)}`);
        console.log(`  Success Probability: ${result.success_probability}%`);
        console.log(`  Recommendation: ${result.recommendation}`);
        
        console.log(`\n--- Criterion Scores ---`);
        const p = result.parameters;
        console.log(`  1. Market Condition:    ${p["1_market_condition"].score}/10 - ${p["1_market_condition"].status}`);
        console.log(`  2. Sector Condition:    ${p["2_sector_condition"].score}/10 - ${p["2_sector_condition"].sector}`);
        console.log(`  3. Company Condition:   ${p["3_company_condition"].score}/10 - ${p["3_company_condition"].rationale.slice(0, 50)}...`);
        console.log(`  4. Catalyst & RVOL:     ${p["4_catalyst"].score}/10 - RVOL ${p["4_catalyst"].rvol}x`);
        console.log(`  5. Patterns & Gaps:     ${p["5_patterns_gaps"].score}/10 - ${p["5_patterns_gaps"].pattern}`);
        console.log(`  6. Support/Resistance:  ${p["6_support_resistance"].score}/10 - R:R ${p["6_support_resistance"].risk_reward_ratio}`);
        console.log(`  7. Price Action:        ${p["7_price_movement"].score}/10 - ${p["7_price_movement"].trend}`);
        console.log(`  8. Volume:              ${p["8_volume"].score}/10 - ${p["8_volume"].status}`);
        console.log(`  9. MA & Fibonacci:      ${p["9_ma_fibonacci"].score}/10`);
        console.log(`  10. RSI:                ${p["10_rsi"].score}/10 - RSI ${p["10_rsi"].value}`);
        
    } catch (error) {
        console.log(`\n❌ Analysis failed: ${error}`);
    }
}

async function showApiStats() {
    console.log('\n' + '='.repeat(60));
    console.log('📈 API Usage Statistics');
    console.log('='.repeat(60));
    
    const stats = getApiStats();
    const logs = getRecentLogs(10);
    
    console.log(`\n--- Summary ---`);
    console.log(`  Total Calls: ${stats.total_calls}`);
    console.log(`  Successful: ${stats.successful_calls}`);
    console.log(`  Failed: ${stats.failed_calls}`);
    console.log(`  Cache Hits: ${stats.cache_hits}`);
    console.log(`  Avg Latency: ${stats.avg_latency_ms}ms`);
    console.log(`  Est. Cost: $${stats.estimated_cost.toFixed(4)}`);
    
    console.log(`\n--- Calls by Service ---`);
    for (const [service, count] of Object.entries(stats.calls_by_service)) {
        console.log(`  ${service}: ${count}`);
    }
    
    console.log(`\n--- Recent Logs (last 10) ---`);
    for (const log of logs) {
        const status = log.success ? '✅' : '❌';
        const cached = log.cached ? ' [CACHED]' : '';
        console.log(`  ${status} ${log.service}/${log.operation} - ${log.ticker} - ${log.latency_ms}ms${cached}`);
    }
}

async function main() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║     SwingTrade Pro - Data Services Test Suite              ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    
    // Clear previous state
    clearLogs();
    clearCache();
    
    // Run tests
    await testEodhd();
    await testSentiment();
    await testCache();
    await testFullAnalysis();
    await showApiStats();
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ All tests completed!');
    console.log('='.repeat(60) + '\n');
}

main().catch(console.error);

