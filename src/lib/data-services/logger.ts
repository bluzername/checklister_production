/**
 * API Usage Logger
 * Logs all API calls for monitoring, debugging, and the admin dashboard.
 * Stores last 1000 entries in memory.
 */

export interface ApiLogEntry {
    id: string;
    timestamp: Date;
    service: 'yahoo' | 'eodhd' | 'claude' | 'cache';
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

// In-memory log storage (last 1000 entries)
const MAX_LOG_ENTRIES = 1000;
const logs: ApiLogEntry[] = [];

// Cost estimates per call (in USD)
const COST_PER_CALL: Record<string, number> = {
    yahoo: 0,           // Free
    eodhd: 0.0002,      // ~$20/mo for 100k calls
    claude: 0.00025,    // Haiku pricing
    cache: 0,           // Free (local)
};

/**
 * Generate a unique ID for log entries
 */
function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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

    logs.unshift(logEntry); // Add to front (newest first)

    // Trim to max size
    if (logs.length > MAX_LOG_ENTRIES) {
        logs.pop();
    }

    // Console log for debugging (can be disabled in production)
    const status = entry.success ? '✓' : '✗';
    const cached = entry.cached ? ' [CACHED]' : '';
    console.log(
        `[API] ${status} ${entry.service}/${entry.operation} - ${entry.ticker} - ${entry.latency_ms}ms${cached}${entry.error ? ` - ${entry.error}` : ''}`
    );
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
 * Get recent log entries
 */
export function getRecentLogs(limit: number = 50): ApiLogEntry[] {
    return logs.slice(0, limit);
}

/**
 * Get all logs (for admin dashboard)
 */
export function getAllLogs(): ApiLogEntry[] {
    return [...logs];
}

/**
 * Calculate API usage statistics
 */
export function getApiStats(): ApiStats {
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

    const calls_today = logs.filter(l => l.timestamp >= todayStart).length;
    const calls_this_week = logs.filter(l => l.timestamp >= weekStart).length;

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
        estimated_cost: Math.round(estimated_cost * 10000) / 10000, // Round to 4 decimals
    };
}

/**
 * Clear all logs (for testing)
 */
export function clearLogs(): void {
    logs.length = 0;
}

