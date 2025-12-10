import { logDebug } from './logging';

interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

/**
 * Simple in-memory cache with TTL support.
 * Used to avoid hammering APIs on every tree view refresh.
 */
export class SimpleCache<T> {
    private cache: Map<string, CacheEntry<T>> = new Map();
    private readonly tag = 'Cache';

    constructor(
        private readonly ttlMs: number = 30000 // Default: 30 seconds
    ) {}

    /**
     * Get cached data if still valid.
     * Returns undefined if cache miss or expired.
     */
    get(key: string): T | undefined {
        const entry = this.cache.get(key);
        if (!entry) {
            logDebug(this.tag, `Cache MISS for key: ${key}`);
            return undefined;
        }

        const age = Date.now() - entry.timestamp;
        if (age > this.ttlMs) {
            logDebug(this.tag, `Cache EXPIRED for key: ${key} (age: ${age}ms)`);
            this.cache.delete(key);
            return undefined;
        }

        logDebug(this.tag, `Cache HIT for key: ${key} (age: ${age}ms)`);
        return entry.data;
    }

    /**
     * Store data in cache.
     */
    set(key: string, data: T): void {
        logDebug(this.tag, `Cache SET for key: ${key}`);
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }

    /**
     * Invalidate a specific cache entry.
     */
    invalidate(key: string): void {
        logDebug(this.tag, `Cache INVALIDATE for key: ${key}`);
        this.cache.delete(key);
    }

    /**
     * Clear all cached data.
     */
    clear(): void {
        logDebug(this.tag, 'Cache CLEAR all');
        this.cache.clear();
    }

    /**
     * Get data from cache or fetch it.
     * This is the main method for lazy loading with cache.
     */
    async getOrFetch(key: string, fetchFn: () => Promise<T>): Promise<T> {
        const cached = this.get(key);
        if (cached !== undefined) {
            return cached;
        }

        const data = await fetchFn();
        this.set(key, data);
        return data;
    }
}
