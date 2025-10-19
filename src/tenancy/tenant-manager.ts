import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';

export interface TenantLimits {
  rateLimit?: number;
  maxConcurrentUploads?: number;
  maxUploadSize?: number;
  maxConnections?: number;
}

export interface TenantConfig {
  tokens: string[];
  limits: TenantLimits;
}

export interface TenantMetrics {
  requests: number;
  bytes: number;
  uploads: number;
  connections: number;
  errors: number;
}

interface TenantRateLimit {
  tokens: number;
  lastRefill: number;
}

export class TenantManager {
  private tenants = new Map<string, TenantConfig>();
  private tokenToTenant = new Map<string, string>();
  private tenantMetrics = new Map<string, TenantMetrics>();
  private tenantRateLimits = new Map<string, TenantRateLimit>();
  private tenantActiveUploads = new Map<string, number>();
  private tenantActiveConnections = new Map<string, number>();
  
  private readonly DEFAULT_RATE_LIMIT = 1000;
  private readonly DEFAULT_MAX_CONCURRENT_UPLOADS = 50;
  private readonly RATE_LIMIT_WINDOW_MS = 60000;
  
  constructor(configPath?: string) {
    if (configPath && fs.existsSync(configPath)) {
      this.loadConfig(configPath);
    }
  }
  
  private loadConfig(configPath: string) {
    try {
      const content = fs.readFileSync(configPath, 'utf8');
      const config = YAML.parse(content);
      
      if (config?.tenants) {
        for (const [tenantId, tenantConfig] of Object.entries(config.tenants)) {
          const tc = tenantConfig as any;
          this.tenants.set(tenantId, {
            tokens: tc.tokens || [],
            limits: tc.limits || {}
          });
          
          for (const token of tc.tokens || []) {
            this.tokenToTenant.set(token, tenantId);
          }
          
          this.tenantMetrics.set(tenantId, {
            requests: 0,
            bytes: 0,
            uploads: 0,
            connections: 0,
            errors: 0
          });
        }
      }
    } catch (err: any) {
      console.error(`[TenantManager] Failed to load config from ${configPath}: ${err.message}`);
    }
  }
  
  getTenantFromToken(token?: string): string | undefined {
    if (!token) return undefined;
    
    if (this.tokenToTenant.has(token)) {
      return this.tokenToTenant.get(token);
    }
    
    if (token.includes('.')) {
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
          if (payload.tenant) {
            return payload.tenant;
          }
        }
      } catch {
      }
    }
    
    const prefix = token.split('-')[0];
    if (prefix && prefix.length >= 3) {
      return prefix;
    }
    
    return undefined;
  }
  
  checkRateLimit(tenantId: string): boolean {
    const config = this.tenants.get(tenantId);
    const limit = config?.limits?.rateLimit || this.DEFAULT_RATE_LIMIT;
    
    const now = Date.now();
    let bucket = this.tenantRateLimits.get(tenantId);
    
    if (!bucket) {
      bucket = { tokens: limit, lastRefill: now };
      this.tenantRateLimits.set(tenantId, bucket);
    }
    
    const elapsed = now - bucket.lastRefill;
    const refillCount = Math.floor(elapsed / this.RATE_LIMIT_WINDOW_MS) * limit;
    
    if (refillCount > 0) {
      bucket.tokens = Math.min(limit, bucket.tokens + refillCount);
      bucket.lastRefill = now;
    }
    
    if (bucket.tokens > 0) {
      bucket.tokens--;
      return true;
    }
    
    return false;
  }
  
  canStartUpload(tenantId: string): boolean {
    const config = this.tenants.get(tenantId);
    const limit = config?.limits?.maxConcurrentUploads || this.DEFAULT_MAX_CONCURRENT_UPLOADS;
    const current = this.tenantActiveUploads.get(tenantId) || 0;
    return current < limit;
  }
  
  trackUploadStart(tenantId: string) {
    const current = this.tenantActiveUploads.get(tenantId) || 0;
    this.tenantActiveUploads.set(tenantId, current + 1);
  }
  
  trackUploadEnd(tenantId: string) {
    const current = this.tenantActiveUploads.get(tenantId) || 0;
    this.tenantActiveUploads.set(tenantId, Math.max(0, current - 1));
  }
  
  trackConnection(tenantId: string, isNew: boolean) {
    const current = this.tenantActiveConnections.get(tenantId) || 0;
    this.tenantActiveConnections.set(tenantId, isNew ? current + 1 : Math.max(0, current - 1));
    
    const metrics = this.getTenantMetrics(tenantId);
    if (isNew) metrics.connections++;
  }
  
  trackRequest(tenantId: string, bytes: number) {
    const metrics = this.getTenantMetrics(tenantId);
    metrics.requests++;
    metrics.bytes += bytes;
  }
  
  trackUpload(tenantId: string, bytes: number) {
    const metrics = this.getTenantMetrics(tenantId);
    metrics.uploads++;
    metrics.bytes += bytes;
  }
  
  trackError(tenantId: string) {
    const metrics = this.getTenantMetrics(tenantId);
    metrics.errors++;
  }
  
  private getTenantMetrics(tenantId: string): TenantMetrics {
    let metrics = this.tenantMetrics.get(tenantId);
    if (!metrics) {
      metrics = {
        requests: 0,
        bytes: 0,
        uploads: 0,
        connections: 0,
        errors: 0
      };
      this.tenantMetrics.set(tenantId, metrics);
    }
    return metrics;
  }
  
  getMetrics(): Record<string, TenantMetrics> {
    const result: Record<string, TenantMetrics> = {};
    for (const [tenantId, metrics] of this.tenantMetrics) {
      result[tenantId] = { ...metrics };
    }
    return result;
  }
  
  getTenantConfig(tenantId: string): TenantConfig | undefined {
    return this.tenants.get(tenantId);
  }
  
  getAllTenants(): string[] {
    return Array.from(this.tenants.keys());
  }
}
