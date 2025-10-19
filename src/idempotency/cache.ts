// Idempotency cache for preventing duplicate operations
// Stores request results keyed by Idempotency-Key header

interface CachedResponse {
  status: number;
  body: any;
  headers?: Record<string, string>;
  timestamp: number;
}

export class IdempotencyCache {
  private cache = new Map<string, CachedResponse>();
  private ttlMs: number;

  constructor(ttlMs = 86400000) { // 24 hours default
    this.ttlMs = ttlMs;
    
    // Cleanup expired entries every hour
    setInterval(() => this.cleanup(), 3600000);
  }

  set(key: string, response: CachedResponse): void {
    this.cache.set(key, {
      ...response,
      timestamp: Date.now()
    });
  }

  get(key: string): CachedResponse | null {
    const cached = this.cache.get(key);
    
    if (!cached) return null;
    
    // Check if expired
    if (Date.now() - cached.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    
    return cached;
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  private cleanup(): void {
    const now = Date.now();
    const expired: string[] = [];
    
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

  size(): number {
    return this.cache.size;
  }
}
