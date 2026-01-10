/**
 * API Usage Logger
 * Logs all API calls for monitoring, debugging, and the admin dashboard.
 * 
 * In serverless environments (Vercel), logs are persisted to Supabase
 * for cross-request persistence. In-memory storage is kept as a fallback
 * and for immediate console logging.
 */

import { createClient } from '@supabase/supabase-js';

export interface ApiLogEntry {
    id: string;
    timestamp: Date;
    service: 'yahoo' | 'eodhd' | 'fmp' | 'claude' | 'cache' | 'quiver';
    operation: string;
    ticker: string;
    latency_ms: number;
    success: boolean;
    error?: string;
    cached?: boolean;
}

export interface ApiStats {
    total_calls: number;
    successful_calls: number;
    failed_calls: number;
    cache_hits: number;
    avg_latency_ms: number;
    calls_by_service: Record<string, number>;
    calls_today: number;
    calls_this_week: number;
    estimated_cost: number;
}

// Use globalThis to persist logs across module reloads (for dev/testing)
const MAX_LOG_ENTRIES = 1000;

// Type declaration for global storage
declare global {
    // eslint-disable-next-line no-var
    var __apiLogs: ApiLogEntry[] | undefined;
}

// Initialize or get existing logs array from globalThis
function getLogs(): ApiLogEntry[] {
    if (!globalThis.__apiLogs) {
        globalThis.__apiLogs = [];
    }
    return globalThis.__apiLogs;
}

// Cost estimates per call (in USD)
const COST_PER_CALL: Record<string, number> = {
    yahoo: 0,           // Free
    eodhd: 0.0002,      // ~$20/mo for 100k calls
    fmp: 0.0001,        // ~$10/mo for 100k calls
    claude: 0.00025,    // Haiku pricing
    cache: 0,           // Free (local)
    quiver: 0.0003,     // ~$30/mo for 100k calls (estimate)
};

/**
 * Get Supabase client for logging (uses service role or anon key)
 */
function getSupabaseClient() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    
    if (!url || !key) {
        return null;
    }
    
    return createClient(url, key, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });
}

/**
 * Check if Supabase logging is available
 */
export function isSupabaseLoggingEnabled(): boolean {
    return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && 
              (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY));
}

/**
 * Generate a unique ID for log entries
 */
function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Persist log entry to Supabase (async, non-blocking)
 */
async function persistToSupabase(entry: ApiLogEntry): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    
    try {
        await supabase.from('api_logs').insert({
            timestamp: entry.timestamp.toISOString(),
            service: entry.service,
            operation: entry.operation,
            ticker: entry.ticker,
            latency_ms: entry.latency_ms,
            success: entry.success,
            error: entry.error || null,
            cached: entry.cached || false,
        });
    } catch (error) {
        // Silently fail - don't break the main flow for logging errors
        console.warn('[Logger] Failed to persist to Supabase:', error);
    }
}

/**
 * Log an API call
 */
export function logApiCall(entry: Omit<ApiLogEntry, 'id' | 'timestamp'>): void {
    const logEntry: ApiLogEntry = {
        id: generateId(),
        timestamp: new Date(),
        ...entry,
    };

    // Add to in-memory logs (for current request and dev mode)
    const logs = getLogs();
    logs.unshift(logEntry);

    // Trim to max size
    if (logs.length > MAX_LOG_ENTRIES) {
        logs.pop();
    }

    // Console log for debugging
    const status = entry.success ? '✓' : '✗';
    const cached = entry.cached ? ' [CACHED]' : '';
    console.log(
        `[API] ${status} ${entry.service}/${entry.operation} - ${entry.ticker} - ${entry.latency_ms}ms${cached}${entry.error ? ` - ${entry.error}` : ''}`
    );

    // Persist to Supabase asynchronously (fire-and-forget)
    persistToSupabase(logEntry).catch(() => {
        // Ignore errors - already logged in persistToSupabase
    });
}

/**
 * Helper to wrap an async function with logging
 */
export async function withLogging<T>(
    service: ApiLogEntry['service'],
    operation: string,
    ticker: string,
    fn: () => Promise<T>,
    cached: boolean = false
): Promise<T> {
    const startTime = Date.now();
    
    try {
        const result = await fn();
        const latency = Date.now() - startTime;
        
        logApiCall({
            service,
            operation,
            ticker,
            latency_ms: latency,
            success: true,
            cached,
        });
        
        return result;
    } catch (error) {
        const latency = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        logApiCall({
            service,
            operation,
            ticker,
            latency_ms: latency,
            success: false,
            error: errorMessage,
            cached,
        });
        
        throw error;
    }
}

/**
 * Get recent log entries from Supabase
 */
export async function getRecentLogsFromDb(limit: number = 50): Promise<ApiLogEntry[]> {
    const supabase = getSupabaseClient();
    if (!supabase) {
        return getLogs().slice(0, limit);
    }
    
    try {
        const { data, error } = await supabase
            .from('api_logs')
            .select('*')
            .order('timestamp', { ascending: false })
            .limit(limit);
        
        if (error) {
            console.warn('[Logger] Failed to fetch from Supabase:', error);
            return getLogs().slice(0, limit);
        }
        
        return (data || []).map(row => ({
            id: row.id,
            timestamp: new Date(row.timestamp),
            service: row.service,
            operation: row.operation,
            ticker: row.ticker,
            latency_ms: row.latency_ms,
            success: row.success,
            error: row.error || undefined,
            cached: row.cached,
        }));
    } catch (error) {
        console.warn('[Logger] Error fetching logs from Supabase:', error);
        return getLogs().slice(0, limit);
    }
}

/**
 * Get recent log entries (in-memory fallback)
 */
export function getRecentLogs(limit: number = 50): ApiLogEntry[] {
    return getLogs().slice(0, limit);
}

/**
 * Get all logs (for admin dashboard - in-memory)
 */
export function getAllLogs(): ApiLogEntry[] {
    return [...getLogs()];
}

/**
 * Calculate API usage statistics from Supabase
 */
export async function getApiStatsFromDb(): Promise<ApiStats> {
    const supabase = getSupabaseClient();
    if (!supabase) {
        return getApiStats();
    }
    
    try {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekStart = new Date(todayStart);
        weekStart.setDate(weekStart.getDate() - 7);
        
        // Fetch all logs from last 30 days for stats
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const { data: logs, error } = await supabase
            .from('api_logs')
            .select('*')
            .gte('timestamp', thirtyDaysAgo.toISOString())
            .order('timestamp', { ascending: false });
        
        if (error || !logs) {
            console.warn('[Logger] Failed to fetch stats from Supabase:', error);
            return getApiStats();
        }
        
        const total_calls = logs.length;
        const successful_calls = logs.filter(l => l.success).length;
        const failed_calls = logs.filter(l => !l.success).length;
        const cache_hits = logs.filter(l => l.cached).length;
        
        const totalLatency = logs.reduce((sum, l) => sum + l.latency_ms, 0);
        const avg_latency_ms = total_calls > 0 ? Math.round(totalLatency / total_calls) : 0;

        const calls_by_service: Record<string, number> = {};
        logs.forEach(l => {
            calls_by_service[l.service] = (calls_by_service[l.service] || 0) + 1;
        });

        const calls_today = logs.filter(l => new Date(l.timestamp) >= todayStart).length;
        const calls_this_week = logs.filter(l => new Date(l.timestamp) >= weekStart).length;

        // Calculate estimated cost (only for non-cached, successful calls)
        const billable_calls = logs.filter(l => l.success && !l.cached);
        const estimated_cost = billable_calls.reduce((sum, l) => {
            return sum + (COST_PER_CALL[l.service] || 0);
        }, 0);

        return {
            total_calls,
            successful_calls,
            failed_calls,
            cache_hits,
            avg_latency_ms,
            calls_by_service,
            calls_today,
            calls_this_week,
            estimated_cost: Math.round(estimated_cost * 10000) / 10000,
        };
    } catch (error) {
        console.warn('[Logger] Error calculating stats from Supabase:', error);
        return getApiStats();
    }
}

/**
 * Calculate API usage statistics (in-memory)
 */
export function getApiStats(): ApiStats {
    const logs = getLogs();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);

    const total_calls = logs.length;
    const successful_calls = logs.filter(l => l.success).length;
    const failed_calls = logs.filter(l => !l.success).length;
    const cache_hits = logs.filter(l => l.cached).length;
    
    const totalLatency = logs.reduce((sum, l) => sum + l.latency_ms, 0);
    const avg_latency_ms = total_calls > 0 ? Math.round(totalLatency / total_calls) : 0;

    const calls_by_service: Record<string, number> = {};
    logs.forEach(l => {
        calls_by_service[l.service] = (calls_by_service[l.service] || 0) + 1;
    });

    const calls_today = logs.filter(l => new Date(l.timestamp) >= todayStart).length;
    const calls_this_week = logs.filter(l => new Date(l.timestamp) >= weekStart).length;

    // Calculate estimated cost (only for non-cached, successful calls)
    const billable_calls = logs.filter(l => l.success && !l.cached);
    const estimated_cost = billable_calls.reduce((sum, l) => {
        return sum + (COST_PER_CALL[l.service] || 0);
    }, 0);

    return {
        total_calls,
        successful_calls,
        failed_calls,
        cache_hits,
        avg_latency_ms,
        calls_by_service,
        calls_today,
        calls_this_week,
        estimated_cost: Math.round(estimated_cost * 10000) / 10000,
    };
}

/**
 * Clear all logs (for testing - in-memory only)
 */
export function clearLogs(): void {
    const logs = getLogs();
    logs.length = 0;
}

/**
 * Clear all logs from Supabase (admin function)
 */
export async function clearLogsFromDb(): Promise<boolean> {
    const supabase = getSupabaseClient();
    if (!supabase) return false;
    
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const { error } = await supabase
            .from('api_logs')
            .delete()
            .lt('timestamp', thirtyDaysAgo.toISOString());
        
        return !error;
    } catch {
        return false;
    }
}

/**
 * Get raw log count (for debugging)
 */
export function getLogCount(): number {
    return getLogs().length;
}
