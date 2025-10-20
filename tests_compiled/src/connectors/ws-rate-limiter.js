export class WSRateLimiter {
    buckets = new Map();
    config;
    tokensPerMs;
    constructor(config) {
        this.config = config;
        this.tokensPerMs = config.messageRateLimit / config.windowMs;
    }
    checkAndConsume(connId) {
        const now = Date.now();
        let bucket = this.buckets.get(connId);
        if (!bucket) {
            bucket = {
                tokens: this.config.messageRateLimit,
                lastRefill: now,
                messageCount: 0
            };
            this.buckets.set(connId, bucket);
        }
        const elapsed = now - bucket.lastRefill;
        const refillAmount = elapsed * this.tokensPerMs;
        bucket.tokens = Math.min(this.config.messageRateLimit, bucket.tokens + refillAmount);
        bucket.lastRefill = now;
        if (bucket.tokens >= 1) {
            bucket.tokens -= 1;
            bucket.messageCount += 1;
            return true;
        }
        return false;
    }
    cleanup(connId) {
        this.buckets.delete(connId);
    }
    getStats(connId) {
        const bucket = this.buckets.get(connId);
        if (!bucket)
            return null;
        return {
            messageCount: bucket.messageCount,
            tokensRemaining: Math.floor(bucket.tokens)
        };
    }
}
