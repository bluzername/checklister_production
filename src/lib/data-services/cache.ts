/**
 * Simple In-Memory Cache with TTL
 * Reduces API calls and costs by caching responses.
 */

interface CacheEntry<T> {
    data: T;
    timestamp: number;
    ttl: number; // Time to live in milliseconds
}

// In-memory cache storage
const cache = new Map<string, CacheEntry<unknown>>();

// Default TTLs (in milliseconds)
export const TTL = {
    FUNDAMENTALS: 24 * 60 * 60 * 1000,  // 24 hours - fundamentals don't change often
    SENTIMENT: 60 * 60 * 1000,           // 1 hour - news changes faster
    MARKET_DATA: 5 * 60 * 1000,          // 5 minutes - SPY/VIX data
    SECTOR_DATA: 60 * 60 * 1000,         // 1 hour - sector RS
    QUOTE: 60 * 1000,                    // 1 minute - stock quotes
};

/**
 * Generate a cache key
 */
export function cacheKey(service: string, operation: string, ticker: string): string {
    return `${service}:${operation}:${ticker.toUpperCase()}`;
}

/**
 * Get an item from cache
 * Returns undefined if not found or expired
 */
export function getCached<T>(key: string): T | undefined {
    const entry = cache.get(key) as CacheEntry<T> | undefined;
    
    if (!entry) {
        return undefined;
    }
    
    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
        // Expired - remove and return undefined
        cache.delete(key);
        return undefined;
    }
    
    return entry.data;
}

/**
 * Set an item in cache
 */
export function setCache<T>(key: string, data: T, ttl: number): void {
    cache.set(key, {
        data,
        timestamp: Date.now(),
        ttl,
    });
}

/**
 * Check if a key exists and is not expired
 */
export function hasCache(key: string): boolean {
    return getCached(key) !== undefined;
}

/**
 * Remove an item from cache
 */
export function invalidateCache(key: string): void {
    cache.delete(key);
}

/**
 * Clear all cache entries
 */
export function clearCache(): void {
    cache.clear();
}

/**
 * Get cache statistics
 */
export function getCacheStats(): {
    size: number;
    keys: string[];
    memoryEstimate: string;
} {
    const keys = Array.from(cache.keys());
    
    // Rough memory estimate (not exact, but gives an idea)
    let memoryBytes = 0;
    cache.forEach((entry, key) => {
        memoryBytes += key.length * 2; // Key size (UTF-16)
        memoryBytes += JSON.stringify(entry.data).length * 2; // Data size estimate
        memoryBytes += 16; // Overhead for timestamp and ttl
    });
    
    const memoryEstimate = memoryBytes < 1024 
        ? `${memoryBytes} B`
        : memoryBytes < 1024 * 1024
            ? `${(memoryBytes / 1024).toFixed(1)} KB`
            : `${(memoryBytes / (1024 * 1024)).toFixed(1)} MB`;
    
    return {
        size: cache.size,
        keys,
        memoryEstimate,
    };
}

/**
 * Helper function: get from cache or fetch and cache
 */
export async function getOrFetch<T>(
    key: string,
    ttl: number,
    fetchFn: () => Promise<T>
): Promise<{ data: T; cached: boolean }> {
    // Check cache first
    const cached = getCached<T>(key);
    if (cached !== undefined) {
        return { data: cached, cached: true };
    }
    
    // Fetch fresh data
    const data = await fetchFn();
    
    // Cache it
    setCache(key, data, ttl);
    
    return { data, cached: false };
}

/**
 * Cleanup expired entries (call periodically if needed)
 */
export function cleanupExpired(): number {
    const now = Date.now();
    let removed = 0;
    
    cache.forEach((entry, key) => {
        if (now - entry.timestamp > entry.ttl) {
            cache.delete(key);
            removed++;
        }
    });
    
    return removed;
}

