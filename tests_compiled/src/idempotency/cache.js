// Idempotency cache for preventing duplicate operations
// Stores request results keyed by Idempotency-Key header
export class IdempotencyCache {
    cache = new Map();
    ttlMs;
    constructor(ttlMs = 86400000) {
        this.ttlMs = ttlMs;
        // Cleanup expired entries every hour
        setInterval(() => this.cleanup(), 3600000);
    }
    set(key, response) {
        this.cache.set(key, {
            ...response,
            timestamp: Date.now()
        });
    }
    get(key) {
        const cached = this.cache.get(key);
        if (!cached)
            return null;
        // Check if expired
        if (Date.now() - cached.timestamp > this.ttlMs) {
            this.cache.delete(key);
            return null;
        }
        return cached;
    }
    has(key) {
        return this.get(key) !== null;
    }
    delete(key) {
        this.cache.delete(key);
    }
    cleanup() {
        const now = Date.now();
        const expired = [];
        for (const [key, value] of this.cache.entries()) {
            if (now - value.timestamp > this.ttlMs) {
                expired.push(key);
            }
        }
        expired.forEach(key => this.cache.delete(key));
        if (expired.length > 0) {
            console.log(`[Idempotency] Cleaned up ${expired.length} expired keys`);
        }
    }
    size() {
        return this.cache.size;
    }
}
