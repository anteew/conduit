import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import * as busboy from 'busboy';
import { PassThrough } from 'stream';
import { PipeClient, makeDuplexPair } from '../control/client.js';
import { DemoPipeServer } from '../backend/demo.js';
import { applyRules } from '../dsl/interpreter.js';
import { loadDSL } from '../dsl/loader.js';
import { TCPTerminal } from '../control/terminal.js';
import { createBlobSink, createQueueSink } from '../backends/factory.js';
import { IdempotencyCache } from '../idempotency/cache.js';
import { TenantManager } from '../tenancy/tenant-manager.js';
function parseCorsOrigins() {
    const originsEnv = process.env.CONDUIT_CORS_ORIGINS?.trim();
    if (!originsEnv) {
        return { enabled: false, origins: new Set(), allowAll: false };
    }
    const origins = originsEnv.split(',').map(o => o.trim()).filter(o => o.length > 0);
    const allowAll = origins.includes('*');
    return {
        enabled: true,
        origins: new Set(origins),
        allowAll
    };
}
function isOriginAllowed(origin, config) {
    if (!config.enabled || !origin)
        return false;
    if (config.allowAll)
        return true;
    return config.origins.has(origin);
}
function applyCorsHeaders(res, origin, config) {
    if (!config.enabled)
        return;
    if (isOriginAllowed(origin, config)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
        res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, x-token');
        res.setHeader('Access-Control-Max-Age', '86400');
    }
}
class TokenBucket {
    config;
    buckets = new Map();
    lastCleanup = Date.now();
    constructor(config) {
        this.config = config;
    }
    tryConsume(ip, endpoint) {
        if (!this.config.enabled)
            return { allowed: true };
        const now = Date.now();
        if (now - this.lastCleanup > 300000) {
            const stale = now - (this.config.windowMs * 3);
            for (const [key, bucket] of this.buckets.entries()) {
                if (bucket.lastRefill < stale)
                    this.buckets.delete(key);
            }
            this.lastCleanup = now;
        }
        const key = `${ip}:${endpoint}`;
        const limit = this.config.endpointLimits.get(endpoint) || this.config.perIpLimit;
        const burst = this.config.burstLimits.get(endpoint) || limit; // T5030: Burst capacity
        const bucket = this.buckets.get(key) || { tokens: burst, lastRefill: now };
        const elapsed = now - bucket.lastRefill;
        // T5030: Continuous token refill based on rate (tokens per ms)
        const tokensPerMs = limit / this.config.windowMs;
        const refillAmount = elapsed * tokensPerMs;
        bucket.tokens = Math.min(burst, bucket.tokens + refillAmount);
        bucket.lastRefill = now;
        if (bucket.tokens >= 1) {
            bucket.tokens--;
            this.buckets.set(key, bucket);
            return { allowed: true };
        }
        // Calculate retry-after based on time needed to accumulate 1 token
        const retryAfter = Math.ceil((1 / tokensPerMs) / 1000);
        return { allowed: false, retryAfter };
    }
}
let logStream = null;
function initLogStream() {
    const logPath = process.env.CONDUIT_HTTP_LOG || path.join(process.cwd(), 'reports', 'gateway-http.log.jsonl');
    if (logStream)
        return;
    try {
        const logDir = path.dirname(logPath);
        fs.mkdirSync(logDir, { recursive: true });
        logStream = fs.createWriteStream(logPath, { flags: 'a' });
        logStream.on('error', (err) => {
            console.error(`[HTTP] Log stream error: ${err.message}`);
            logStream = null;
        });
        console.log(`[HTTP] JSONL logging enabled: ${logPath}`);
    }
    catch (e) {
        console.error(`[HTTP] Failed to initialize log stream: ${e.message}`);
    }
}
function logJsonl(entry) {
    if (!logStream)
        return;
    try {
        logStream.write(JSON.stringify(entry) + '\n');
    }
    catch (e) {
        console.error(`[HTTP] Failed to write log entry: ${e.message}`);
    }
}
function send(res, code, body, idempotencyKey) {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
    // Cache successful responses for idempotency
    if (idempotencyKey && code >= 200 && code < 300) {
        idempotencyCache.set(idempotencyKey, { status: code, body, timestamp: Date.now() });
    }
}
let dslConfig = null;
let blobSink = null;
let queueSink = null;
const idempotencyCache = new IdempotencyCache(86400000);
// T5060: Reload tracking
let lastReloadTime = null;
let reloadStatus = 'idle';
let isDraining = false;
// Initialize logging
initLogStream();
// Initialize backends
try {
    blobSink = createBlobSink();
    console.log(`[Blob] Backend: ${process.env.CONDUIT_BLOB_BACKEND || 'local'}`);
}
catch (e) {
    console.warn(`[Blob] Failed to initialize blob backend: ${e.message}`);
}
try {
    queueSink = createQueueSink();
    if (queueSink)
        console.log(`[Queue] Backend: ${process.env.CONDUIT_QUEUE_BACKEND}`);
}
catch (e) {
    console.warn(`[Queue] Failed to initialize queue backend: ${e.message}`);
}
// Initialize tenancy
const tenantConfigPath = process.env.CONDUIT_TENANT_CONFIG || path.join(process.cwd(), 'config', 'tenants.yaml');
const tenantManager = new TenantManager(tenantConfigPath);
// Initialize CORS
const corsConfig = parseCorsOrigins();
if (corsConfig.enabled) {
    console.log(`[CORS] Enabled: ${corsConfig.allowAll ? '*' : Array.from(corsConfig.origins).join(', ')}`);
}
// T5023: Initialize auth with token allowlist and OIDC stub
const tokenAllowlist = process.env.CONDUIT_TOKENS ?
    new Set(process.env.CONDUIT_TOKENS.split(',').map(t => t.trim())) : null;
const protectedEndpoints = ['/v1/enqueue', '/v1/upload', '/v1/stats', '/v1/snapshot', '/v1/admin/reload'];
// OIDC configuration stub for future implementation
const oidcConfig = {
    enabled: process.env.CONDUIT_OIDC_ENABLED === 'true',
    issuer: process.env.CONDUIT_OIDC_ISSUER || '',
    audience: process.env.CONDUIT_OIDC_AUDIENCE || '',
    jwksUri: process.env.CONDUIT_OIDC_JWKS_URI || ''
};
if (oidcConfig.enabled) {
    console.log(`[Auth] OIDC enabled (stub): issuer=${oidcConfig.issuer}`);
}
if (tokenAllowlist) {
    console.log(`[Auth] Token allowlist enabled: ${tokenAllowlist.size} tokens configured`);
    console.log(`[Auth] Protected endpoints: ${protectedEndpoints.join(', ')}`);
}
// T5030: Initialize rate limiter with per-endpoint rate and burst
const endpointLimits = new Map();
endpointLimits.set('/v1/enqueue', Number(process.env.CONDUIT_HTTP_RATE_LIMIT_ENQUEUE || 50));
endpointLimits.set('/v1/upload', Number(process.env.CONDUIT_HTTP_RATE_LIMIT_UPLOAD || 10));
endpointLimits.set('/v1/stats', Number(process.env.CONDUIT_HTTP_RATE_LIMIT_STATS || 100));
const burstLimits = new Map();
burstLimits.set('/v1/enqueue', Number(process.env.CONDUIT_HTTP_BURST_LIMIT_ENQUEUE || 100)); // 2x rate
burstLimits.set('/v1/upload', Number(process.env.CONDUIT_HTTP_BURST_LIMIT_UPLOAD || 20));
burstLimits.set('/v1/stats', Number(process.env.CONDUIT_HTTP_BURST_LIMIT_STATS || 200));
const rateLimitConfig = {
    enabled: String(process.env.CONDUIT_HTTP_RATE_LIMIT_ENABLED || 'false').toLowerCase() === 'true',
    perIpLimit: Number(process.env.CONDUIT_HTTP_RATE_LIMIT_PER_IP || 100),
    windowMs: Number(process.env.CONDUIT_HTTP_RATE_LIMIT_WINDOW_MS || 60000),
    exempt: ['/health', '/perf', '/ui'],
    endpointLimits,
    burstLimits
};
const rateLimiter = new TokenBucket(rateLimitConfig);
if (rateLimitConfig.enabled) {
    console.log(`[HTTP] Rate limiting enabled: perIp=${rateLimitConfig.perIpLimit}/min, window=${rateLimitConfig.windowMs}ms`);
}
// T5033: Header size limits
const headerLimitConfig = {
    maxHeaderSize: Number(process.env.CONDUIT_MAX_HEADER_SIZE || 16384), // 16KB default
    maxCookieLength: Number(process.env.CONDUIT_MAX_COOKIE_LENGTH || 4096) // 4KB default
};
console.log(`[HTTP] Header limits: max=${headerLimitConfig.maxHeaderSize} bytes, cookie=${headerLimitConfig.maxCookieLength} bytes`);
// T5032: HTTP timeouts and keep-alive
const timeoutConfig = {
    keepAliveTimeout: Number(process.env.CONDUIT_KEEPALIVE_TIMEOUT_MS || 65000), // 65s default
    headersTimeout: Number(process.env.CONDUIT_HEADERS_TIMEOUT_MS || 60000), // 60s default
    requestTimeout: Number(process.env.CONDUIT_REQUEST_TIMEOUT_MS || 300000) // 5min default
};
console.log(`[HTTP] Timeouts: keepAlive=${timeoutConfig.keepAliveTimeout}ms, headers=${timeoutConfig.headersTimeout}ms, request=${timeoutConfig.requestTimeout}ms`);
// T5031: Concurrency caps
const concurrencyConfig = {
    maxConcurrentUploads: Number(process.env.CONDUIT_MAX_CONCURRENT_UPLOADS || 100),
    maxConcurrentUploadsPerIp: Number(process.env.CONDUIT_MAX_CONCURRENT_UPLOADS_PER_IP || 10),
    maxGlobalConnections: Number(process.env.CONDUIT_MAX_GLOBAL_CONNECTIONS || 10000)
};
console.log(`[HTTP] Concurrency: uploads=${concurrencyConfig.maxConcurrentUploads}, perIp=${concurrencyConfig.maxConcurrentUploadsPerIp}, global=${concurrencyConfig.maxGlobalConnections}`);
// T5031: Concurrency tracking
let activeGlobalConnections = 0;
let activeUploads = 0;
const activeUploadsPerIp = new Map();
// T5042: HTTP metrics counters and histograms
const httpMetrics = {
    requestsTotal: 0,
    requestsByPath: new Map(),
    requestsByStatus: new Map(),
    bytesIn: 0,
    bytesOut: 0,
    durations: [],
    uploadCount: 0,
    uploadBytesTotal: 0,
    ruleHits: new Map()
};
// Placeholder for WS metrics (populated by ws.ts)
let wsMetrics = null;
export function setWsMetrics(metrics) {
    wsMetrics = metrics;
}
function recordMetrics(path, status, durMs, bytesIn, bytesOut, ruleId, tenantId) {
    httpMetrics.requestsTotal++;
    httpMetrics.requestsByPath.set(path, (httpMetrics.requestsByPath.get(path) || 0) + 1);
    httpMetrics.requestsByStatus.set(status, (httpMetrics.requestsByStatus.get(status) || 0) + 1);
    httpMetrics.bytesIn += bytesIn;
    httpMetrics.bytesOut += bytesOut;
    httpMetrics.durations.push(durMs);
    // Keep last 1000 durations for histogram
    if (httpMetrics.durations.length > 1000) {
        httpMetrics.durations.shift();
    }
    if (ruleId) {
        httpMetrics.ruleHits.set(ruleId, (httpMetrics.ruleHits.get(ruleId) || 0) + 1);
    }
    if (path === '/v1/upload') {
        httpMetrics.uploadCount++;
        httpMetrics.uploadBytesTotal += bytesIn;
    }
    // T5061: Track per-tenant metrics
    if (tenantId) {
        tenantManager.trackRequest(tenantId, bytesIn);
    }
}
function getMetricsSummary() {
    const durations = [...httpMetrics.durations].sort((a, b) => a - b);
    const p50 = durations[Math.floor(durations.length * 0.5)] || 0;
    const p95 = durations[Math.floor(durations.length * 0.95)] || 0;
    const p99 = durations[Math.floor(durations.length * 0.99)] || 0;
    return {
        http: {
            requestsTotal: httpMetrics.requestsTotal,
            bytesIn: httpMetrics.bytesIn,
            bytesOut: httpMetrics.bytesOut,
            requestsByPath: Object.fromEntries(httpMetrics.requestsByPath),
            requestsByStatus: Object.fromEntries(httpMetrics.requestsByStatus),
            ruleHits: Object.fromEntries(httpMetrics.ruleHits),
            durations: {
                p50,
                p95,
                p99,
                count: durations.length
            },
            uploads: {
                count: httpMetrics.uploadCount,
                bytesTotal: httpMetrics.uploadBytesTotal
            }
        },
        tenants: tenantManager.getMetrics()
    };
}
export function loadDSLConfig(path) {
    dslConfig = loadDSL(path);
    console.log(`[HTTP] Loaded DSL rules from ${path}: ${dslConfig.rules.length} rules`);
}
export function reloadDSL() {
    const rulesPath = process.env.CONDUIT_RULES;
    if (!rulesPath) {
        console.warn('[Reload] No CONDUIT_RULES configured, skipping DSL reload');
        return;
    }
    reloadStatus = 'reloading';
    try {
        const newConfig = loadDSL(rulesPath);
        dslConfig = newConfig;
        lastReloadTime = Date.now();
        reloadStatus = 'idle';
        console.log(`[Reload] DSL rules reloaded: ${newConfig.rules.length} rules`);
    }
    catch (error) {
        reloadStatus = 'error';
        console.error(`[Reload] Failed to reload DSL: ${error.message}`);
        throw error;
    }
}
export function reloadTenants() {
    try {
        const tenantConfigPath = process.env.CONDUIT_TENANT_CONFIG || path.join(process.cwd(), 'config', 'tenants.yaml');
        const newTenantManager = new TenantManager(tenantConfigPath);
        Object.assign(tenantManager, newTenantManager);
        lastReloadTime = Date.now();
        console.log(`[Reload] Tenant configuration reloaded from ${tenantConfigPath}`);
    }
    catch (error) {
        console.error(`[Reload] Failed to reload tenants: ${error.message}`);
        throw error;
    }
}
export function getReloadStatus() {
    return {
        status: reloadStatus,
        lastReloadTime: lastReloadTime ? new Date(lastReloadTime).toISOString() : null,
        reloadSupported: !!process.env.CONDUIT_RULES,
        isDraining
    };
}
export function setDrainingMode(draining) {
    isDraining = draining;
    console.log(`[HTTP] Draining mode: ${draining ? 'enabled' : 'disabled'}`);
}
function normalizeHeaders(h) {
    const out = {};
    Object.entries(h).forEach(([k, v]) => {
        if (typeof v === 'string')
            out[k.toLowerCase()] = v;
        else if (Array.isArray(v))
            out[k.toLowerCase()] = v[0];
    });
    return out;
}
async function handleWithDSL(client, req, res) {
    if (!dslConfig)
        return false;
    const url = new URL(req.url || '/', 'http://localhost');
    const headers = normalizeHeaders(req.headers);
    const contentType = (headers['content-type'] || '').split(';')[0];
    const ip = req.socket.remoteAddress || 'unknown';
    const startTime = process.hrtime.bigint();
    // Fast-path: if a rule matches purely on method/path/contentType and directly responds via HTTP,
    // avoid buffering large bodies (e.g., application/octet-stream uploads).
    const preMatch = dslConfig.rules.find(r => {
        const w = r.when?.http;
        const s = r.send?.http;
        if (!w || !s)
            return false;
        const methodOk = Array.isArray(w.method) ? w.method.includes(req.method) : (w.method ? w.method === req.method : true);
        const pathOk = w.path ? w.path === url.pathname : true;
        const ctOk = w.contentType ? w.contentType === contentType : true;
        return methodOk && pathOk && ctOk;
    });
    if (preMatch && preMatch.send.http) {
        // Prepare response using DSL, respond immediately (202), then drain in background
        const ctx = {
            $method: req.method || 'GET',
            $path: url.pathname,
            $headers: headers,
            $query: Object.fromEntries(url.searchParams.entries()),
        };
        const result = await applyRules(dslConfig, client, ctx);
        const status = result?.status || 202;
        const responseBody = result?.body || result || { ok: true };
        const ruleId = preMatch.id || 'dsl_rule';
        // Drain mode: async (respond then drain) by default; sync if CONDUIT_UPLOAD_SYNC=true
        const isOctet = contentType === 'application/octet-stream';
        const isUploadPath = url.pathname === '/v1/upload';
        const headerMode = (headers['x-upload-mode'] || '').toLowerCase();
        const syncUpload = isOctet && isUploadPath && (process.env.CONDUIT_UPLOAD_SYNC === 'true' || headerMode === 'sync');
        logJsonl({
            ts: new Date().toISOString(),
            event: 'http_request_start',
            ip,
            method: req.method,
            path: url.pathname,
            ruleId
        });
        if (!syncUpload) {
            // Async: send response now
            send(res, status, responseBody);
        }
        // Drain with instrumentation (optional file sink)
        let total = 0;
        let lastMark = 0;
        const started = process.hrtime.bigint();
        // Optional file sink for tests: set CONDUIT_UPLOAD_FILE or CONDUIT_UPLOAD_DIR
        const sinkFile = process.env.CONDUIT_UPLOAD_FILE;
        const sinkDir = process.env.CONDUIT_UPLOAD_DIR;
        let dest = null;
        let sinkPath = null;
        try {
            if (isOctet && isUploadPath && (sinkFile || sinkDir)) {
                if (sinkFile) {
                    sinkPath = sinkFile;
                }
                else if (sinkDir) {
                    fs.mkdirSync(sinkDir, { recursive: true });
                    sinkPath = path.join(sinkDir, `upload_${Date.now()}_${Math.random().toString(36).slice(2)}.bin`);
                }
                if (sinkPath)
                    dest = fs.createWriteStream(sinkPath);
            }
        }
        catch (e) {
            console.error(`[HTTP] upload sink setup failed: ${e?.message || e}`);
        }
        req.on('data', (chunk) => {
            total += chunk.length;
            if (dest) {
                if (!dest.write(chunk))
                    req.pause(), dest.once('drain', () => req.resume());
            }
            if (total - lastMark >= 10 * 1024 * 1024) { // every 10MB
                lastMark = total;
                const currentDurNs = Number(process.hrtime.bigint() - started);
                const currentSecs = currentDurNs / 1e9;
                const currentMB = total / 1048576;
                const currentRate = currentSecs > 0 ? (currentMB / currentSecs) : 0;
                console.log(`[HTTP] draining octet-stream: ${(total / 1048576).toFixed(1)} MB`);
                logJsonl({
                    ts: new Date().toISOString(),
                    event: 'http_upload_progress',
                    ip,
                    method: req.method,
                    path: url.pathname,
                    bytes: total,
                    durMs: Math.round(currentDurNs / 1e6),
                    rateMBps: parseFloat(currentRate.toFixed(2)),
                    ruleId
                });
            }
        });
        req.on('end', () => {
            try {
                dest?.end();
            }
            catch { }
            const durNs = Number(process.hrtime.bigint() - started);
            const secs = durNs / 1e9;
            const mb = total / 1048576;
            const rate = secs > 0 ? (mb / secs) : 0;
            if (sinkPath) {
                try {
                    const st = fs.statSync(sinkPath);
                    console.log(`[HTTP] upload complete: ${(st.size / 1048576).toFixed(1)} MB written to ${sinkPath}`);
                }
                catch {
                    console.log(`[HTTP] upload complete: ${mb.toFixed(1)} MB (stat failed for ${sinkPath})`);
                }
            }
            console.log(`[HTTP] octet-stream drained: ${mb.toFixed(1)} MB in ${secs.toFixed(3)}s (${rate.toFixed(1)} MB/s)`);
            logJsonl({
                ts: new Date().toISOString(),
                event: 'http_request_complete',
                ip,
                method: req.method,
                path: url.pathname,
                bytes: total,
                durMs: Math.round(durNs / 1e6),
                rateMBps: parseFloat(rate.toFixed(2)),
                ruleId,
                status
            });
            if (syncUpload) {
                try {
                    send(res, status, responseBody);
                }
                catch { }
            }
        });
        req.resume();
        return true;
    }
    // Fallback: buffer (capped) and parse JSON body for standard rules
    logJsonl({
        ts: new Date().toISOString(),
        event: 'http_request_start',
        ip,
        method: req.method,
        path: url.pathname
    });
    const MAX = Number(process.env.CONDUIT_MAX_BODY || 1_000_000); // 1MB default
    const MAX_JSON = Number(process.env.CONDUIT_MAX_JSON_SIZE || 10_485_760); // 10MB default
    const isJSON = contentType === 'application/json';
    const sizeLimit = isJSON ? Math.min(MAX_JSON, MAX) : MAX;
    // T5021: Handle gzip compression
    const contentEncoding = headers['content-encoding'] || '';
    const isGzipped = contentEncoding.toLowerCase().includes('gzip');
    let requestStream = req;
    if (isGzipped) {
        try {
            requestStream = req.pipe(zlib.createGunzip());
            requestStream.on('error', (err) => {
                console.warn(`[HTTP] Gzip decompression error: ${err.message} from ${ip}`);
                const durNs = Number(process.hrtime.bigint() - startTime);
                logJsonl({
                    ts: new Date().toISOString(),
                    event: 'http_request_complete',
                    ip,
                    method: req.method,
                    path: url.pathname,
                    durMs: Math.round(durNs / 1e6),
                    status: 400,
                    error: 'InvalidGzipEncoding'
                });
                send(res, 400, {
                    error: 'Invalid gzip encoding',
                    code: 'InvalidGzipEncoding'
                });
            });
        }
        catch (err) {
            const durNs = Number(process.hrtime.bigint() - startTime);
            logJsonl({
                ts: new Date().toISOString(),
                event: 'http_request_complete',
                ip,
                method: req.method,
                path: url.pathname,
                durMs: Math.round(durNs / 1e6),
                status: 400,
                error: 'GzipSetupFailed'
            });
            send(res, 400, {
                error: 'Failed to setup gzip decompression',
                code: 'GzipSetupFailed'
            });
            return true;
        }
    }
    let body = '';
    let received = 0;
    for await (const chunk of requestStream) {
        received += chunk.length;
        if (received > sizeLimit) {
            const durNs = Number(process.hrtime.bigint() - startTime);
            if (isJSON) {
                const limitMB = (MAX_JSON / 1_048_576).toFixed(0);
                const gzipNote = isGzipped ? ' (after decompression)' : '';
                console.warn(`[HTTP] JSON body exceeded ${limitMB}MB limit: ${received} bytes${gzipNote} from ${req.socket.remoteAddress}`);
                logJsonl({
                    ts: new Date().toISOString(),
                    event: 'http_request_complete',
                    ip,
                    method: req.method,
                    path: url.pathname,
                    bytes: received,
                    durMs: Math.round(durNs / 1e6),
                    status: 413,
                    error: 'JSONTooLarge',
                    gzipped: isGzipped
                });
                const suggestion = isGzipped
                    ? 'JSON payload exceeds limit even after gzip decompression. Consider multipart upload for large data.'
                    : 'Consider using gzip compression (Content-Encoding: gzip) or multipart upload for large data';
                send(res, 413, {
                    error: `JSON body exceeds ${limitMB}MB limit`,
                    code: 'JSONTooLarge',
                    suggestion
                });
            }
            else {
                logJsonl({
                    ts: new Date().toISOString(),
                    event: 'http_request_complete',
                    ip,
                    method: req.method,
                    path: url.pathname,
                    bytes: received,
                    durMs: Math.round(durNs / 1e6),
                    status: 413,
                    error: 'PayloadTooLarge'
                });
                send(res, 413, { error: 'PayloadTooLarge' });
            }
            if (isGzipped)
                requestStream.destroy();
            req.resume();
            return true;
        }
        body += chunk;
    }
    let parsedBody = {};
    try {
        if (body)
            parsedBody = JSON.parse(body);
    }
    catch { }
    const ctx = {
        $method: req.method || 'GET',
        $path: url.pathname,
        $headers: headers,
        $query: Object.fromEntries(url.searchParams.entries()),
        $body: parsedBody
    };
    const result = await applyRules(dslConfig, client, ctx);
    if (result) {
        const status = result.status || 200;
        const responseBody = result.body || result;
        const durNs = Number(process.hrtime.bigint() - startTime);
        logJsonl({
            ts: new Date().toISOString(),
            event: 'http_request_complete',
            ip,
            method: req.method,
            path: url.pathname,
            bytes: received,
            durMs: Math.round(durNs / 1e6),
            ruleId: 'dsl_rule',
            status
        });
        send(res, status, responseBody);
        return true;
    }
    return false;
}
export function startHttp(client, port = 9087, bind = '127.0.0.1') {
    initLogStream();
    if (process.env.CONDUIT_RULES) {
        try {
            loadDSLConfig(process.env.CONDUIT_RULES);
        }
        catch (e) {
            console.error(`[HTTP] Failed to load DSL rules: ${e.message}`);
        }
    }
    const server = http.createServer(async (req, res) => {
        const reqStartTime = process.hrtime.bigint();
        const reqIp = req.socket.remoteAddress || 'unknown';
        const reqUrl = new URL(req.url || '/', 'http://localhost');
        // T5061: Extract tenant from auth token
        const authHeader = req.headers['authorization'] || '';
        const token = Array.isArray(authHeader) ? authHeader[0] : authHeader;
        const bearerToken = token.startsWith('Bearer ') ? token.slice(7) : undefined;
        const tenantId = bearerToken ? tenantManager.getTenantFromToken(bearerToken) : undefined;
        // T5060: Check if draining (during reload or shutdown)
        if (isDraining) {
            const drainMode = process.env.CONDUIT_DRAIN_REJECT_NEW === 'true';
            if (drainMode) {
                const durNs = Number(process.hrtime.bigint() - reqStartTime);
                logJsonl({
                    ts: new Date().toISOString(),
                    event: 'http_request_rejected',
                    ip: reqIp,
                    method: req.method,
                    path: reqUrl.pathname,
                    status: 503,
                    reason: 'ServerDraining'
                });
                res.writeHead(503, { 'content-type': 'application/json' });
                res.end(JSON.stringify({
                    error: 'Service draining',
                    code: 'ServerDraining',
                    reason: 'Server is reloading configuration or shutting down'
                }));
                return;
            }
        }
        // T5031: Check global connection limit
        activeGlobalConnections++;
        const currentConnections = activeGlobalConnections;
        if (currentConnections > concurrencyConfig.maxGlobalConnections) {
            activeGlobalConnections--;
            const durNs = Number(process.hrtime.bigint() - reqStartTime);
            logJsonl({
                ts: new Date().toISOString(),
                event: 'http_request_complete',
                ip: reqIp,
                method: req.method,
                path: reqUrl.pathname,
                durMs: Math.round(durNs / 1e6),
                status: 503,
                error: 'TooManyConnections'
            });
            res.writeHead(503, {
                'content-type': 'application/json',
                'retry-after': '10'
            });
            res.end(JSON.stringify({
                error: 'Service Unavailable',
                code: 'TooManyConnections',
                message: 'Global connection limit exceeded',
                limit: concurrencyConfig.maxGlobalConnections
            }));
            return;
        }
        req.on('close', () => {
            activeGlobalConnections--;
        });
        // T5033: Check header size limits
        const rawHeaders = req.rawHeaders;
        let totalHeaderSize = 0;
        for (let i = 0; i < rawHeaders.length; i++) {
            totalHeaderSize += Buffer.byteLength(rawHeaders[i], 'utf8');
        }
        if (totalHeaderSize > headerLimitConfig.maxHeaderSize) {
            const durNs = Number(process.hrtime.bigint() - reqStartTime);
            logJsonl({
                ts: new Date().toISOString(),
                event: 'http_request_complete',
                ip: reqIp,
                method: req.method,
                path: reqUrl.pathname,
                durMs: Math.round(durNs / 1e6),
                status: 431,
                error: 'RequestHeaderFieldsTooLarge',
                bytes: totalHeaderSize
            });
            res.writeHead(431, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
                error: 'Request Header Fields Too Large',
                code: 'RequestHeaderFieldsTooLarge',
                size: totalHeaderSize,
                limit: headerLimitConfig.maxHeaderSize
            }));
            return;
        }
        // Check cookie length
        const cookieHeader = req.headers.cookie;
        if (cookieHeader) {
            const cookieLength = Buffer.byteLength(cookieHeader, 'utf8');
            if (cookieLength > headerLimitConfig.maxCookieLength) {
                const durNs = Number(process.hrtime.bigint() - reqStartTime);
                logJsonl({
                    ts: new Date().toISOString(),
                    event: 'http_request_complete',
                    ip: reqIp,
                    method: req.method,
                    path: reqUrl.pathname,
                    durMs: Math.round(durNs / 1e6),
                    status: 431,
                    error: 'CookieTooLarge',
                    bytes: cookieLength
                });
                res.writeHead(431, { 'content-type': 'application/json' });
                res.end(JSON.stringify({
                    error: 'Cookie Too Large',
                    code: 'CookieTooLarge',
                    size: cookieLength,
                    limit: headerLimitConfig.maxCookieLength
                }));
                return;
            }
        }
        const origin = req.headers['origin'];
        const xTokenHeader = req.headers['x-token'];
        // CORS: Handle OPTIONS preflight
        if (req.method === 'OPTIONS') {
            if (corsConfig.enabled && origin && isOriginAllowed(origin, corsConfig)) {
                applyCorsHeaders(res, origin, corsConfig);
                res.writeHead(204).end();
            }
            else {
                res.writeHead(403, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: 'Origin not allowed' }));
            }
            return;
        }
        // CORS: Apply to all responses
        if (origin && corsConfig.enabled) {
            applyCorsHeaders(res, origin, corsConfig);
        }
        // T5023: Auth check for protected endpoints (supports Authorization: Bearer and X-Token)
        if (tokenAllowlist && protectedEndpoints.includes(reqUrl.pathname)) {
            if (!token || !tokenAllowlist.has(token)) {
                logJsonl({
                    ts: new Date().toISOString(),
                    event: 'http_auth_failed',
                    ip: reqIp,
                    method: req.method,
                    path: reqUrl.pathname,
                    error: 'Unauthorized'
                });
                res.writeHead(401, { 'content-type': 'application/json' });
                res.end(JSON.stringify({
                    error: 'Unauthorized',
                    message: 'Valid API token required. Provide via Authorization: Bearer <token> or X-Token header'
                }));
                return;
            }
        }
        // T5061: Tenant rate limiting check (before global rate limiting)
        if (tenantId) {
            const tenantAllowed = tenantManager.checkRateLimit(tenantId);
            if (!tenantAllowed) {
                activeGlobalConnections--;
                const durNs = Number(process.hrtime.bigint() - reqStartTime);
                logJsonl({
                    ts: new Date().toISOString(),
                    event: 'http_request_complete',
                    ip: reqIp,
                    method: req.method,
                    path: reqUrl.pathname,
                    durMs: Math.round(durNs / 1e6),
                    status: 429,
                    error: 'TenantRateLimitExceeded',
                    tenantId
                });
                res.writeHead(429, {
                    'content-type': 'application/json',
                    'retry-after': '60'
                });
                res.end(JSON.stringify({
                    error: 'Tenant Rate Limit Exceeded',
                    code: 'TenantRateLimitExceeded',
                    tenant: tenantId
                }));
                return;
            }
        }
        // Rate limiting
        if (!rateLimitConfig.exempt.includes(reqUrl.pathname)) {
            const result = rateLimiter.tryConsume(reqIp, reqUrl.pathname);
            if (!result.allowed) {
                res.writeHead(429, {
                    'content-type': 'application/json',
                    'retry-after': String(result.retryAfter || 60)
                });
                res.end(JSON.stringify({
                    error: 'Rate limit exceeded',
                    code: 'RateLimitExceeded',
                    retryAfter: result.retryAfter || 60
                }));
                return;
            }
        }
        // Idempotency check for unsafe methods
        const idempotencyKey = req.headers['idempotency-key'];
        if (idempotencyKey && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')) {
            const cached = idempotencyCache.get(idempotencyKey);
            if (cached) {
                console.log(`[Idempotency] Replay for key: ${idempotencyKey}`);
                res.writeHead(cached.status, {
                    'content-type': 'application/json',
                    'x-idempotency-replay': 'true',
                    ...(cached.headers || {})
                });
                res.end(JSON.stringify(cached.body));
                return;
            }
        }
        // T5020: Large/binary detection and routing
        const contentType = (req.headers['content-type'] || '').split(';')[0].trim();
        const contentLength = parseInt(req.headers['content-length'] || '0', 10);
        const largeThreshold = Number(process.env.CONDUIT_LARGE_THRESHOLD || 5_242_880); // 5MB default
        // Binary MIME types that should be routed to upload
        const binaryMimeTypes = new Set([
            'application/octet-stream',
            'application/pdf',
            'application/zip',
            'image/jpeg',
            'image/png',
            'image/gif',
            'image/webp',
            'video/mp4',
            'video/mpeg',
            'audio/mpeg',
            'audio/wav',
            'application/x-tar',
            'application/gzip'
        ]);
        const isBinaryMime = binaryMimeTypes.has(contentType);
        const isLarge = contentLength > largeThreshold;
        const isNotUploadPath = reqUrl.pathname !== '/v1/upload';
        if ((req.method === 'POST' || req.method === 'PUT') && isNotUploadPath && (isBinaryMime || isLarge)) {
            const reason = isBinaryMime
                ? `Binary content type: ${contentType}`
                : `Large payload: ${(contentLength / 1048576).toFixed(2)}MB exceeds ${(largeThreshold / 1048576).toFixed(0)}MB threshold`;
            console.warn(`[HTTP] Auto-routing to upload path: ${reason} from ${reqIp}`);
            logJsonl({
                ts: new Date().toISOString(),
                event: 'http_large_detected',
                ip: reqIp,
                method: req.method,
                path: reqUrl.pathname,
                contentType,
                bytes: contentLength,
                reason
            });
            res.writeHead(413, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
                error: 'Payload Too Large',
                code: 'PayloadTooLarge',
                reason,
                suggestion: `Use /v1/upload endpoint for large or binary content. Threshold: ${(largeThreshold / 1048576).toFixed(0)}MB`
            }));
            return;
        }
        try {
            // Simple static UI under /ui
            const u = new URL(req.url || '/', 'http://localhost');
            if (req.method === 'GET') {
                let p = u.pathname;
                if (p === '/')
                    p = '/ui';
                if (p.startsWith('/ui')) {
                    const publicDir = path.resolve(process.cwd(), 'public');
                    const rel = p === '/ui' ? 'index.html' : p.replace('/ui/', '');
                    const filePath = path.join(publicDir, rel);
                    if (filePath.startsWith(publicDir) && fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
                        const ext = path.extname(filePath).toLowerCase();
                        const ct = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.js' ? 'text/javascript; charset=utf-8' : ext === '.css' ? 'text/css; charset=utf-8' : 'application/octet-stream';
                        const data = fs.readFileSync(filePath);
                        res.writeHead(200, { 'content-type': ct });
                        res.end(data);
                        return;
                    }
                }
            }
            if (await handleWithDSL(client, req, res))
                return;
            const url = new URL(req.url || '/', 'http://localhost');
            if (req.method === 'GET' && url.pathname === '/health') {
                const durNs = Number(process.hrtime.bigint() - reqStartTime);
                const reloadInfo = getReloadStatus();
                const healthStatus = {
                    ok: !isDraining,
                    version: 'v0.1',
                    features: ['http', 'ws', 'sse'],
                    status: isDraining ? 'draining' : 'healthy',
                    reload: reloadInfo
                };
                logJsonl({ ts: new Date().toISOString(), event: 'http_request_complete', ip: reqIp, method: req.method, path: url.pathname, durMs: Math.round(durNs / 1e6), status: isDraining ? 503 : 200 });
                send(res, isDraining ? 503 : 200, healthStatus);
                return;
            }
            if (req.method === 'POST' && url.pathname === '/v1/enqueue') {
                let body = '';
                req.on('data', c => body += c);
                req.on('end', () => {
                    const durNs = Number(process.hrtime.bigint() - reqStartTime);
                    try {
                        const { to, envelope } = JSON.parse(body || '{}');
                        client.enqueue(to, envelope).then(r => {
                            logJsonl({ ts: new Date().toISOString(), event: 'http_request_complete', ip: reqIp, method: req.method, path: url.pathname, bytes: body.length, durMs: Math.round(durNs / 1e6), status: 200 });
                            send(res, 200, r);
                        }).catch(e => {
                            logJsonl({ ts: new Date().toISOString(), event: 'http_request_complete', ip: reqIp, method: req.method, path: url.pathname, bytes: body.length, durMs: Math.round(durNs / 1e6), status: 400, error: 'enqueue_failed' });
                            send(res, 400, { error: e?.detail || e?.message || 'bad request' });
                        });
                    }
                    catch (e) {
                        logJsonl({ ts: new Date().toISOString(), event: 'http_request_complete', ip: reqIp, method: req.method, path: url.pathname, bytes: body.length, durMs: Math.round(durNs / 1e6), status: 400, error: 'invalid_json' });
                        send(res, 400, { error: e?.message || 'invalid json' });
                    }
                });
                return;
            }
            // T5010: Enhanced multipart/form-data streaming with safety limits
            if (req.method === 'POST' && url.pathname === '/v1/upload') {
                // T5061: Check per-tenant upload limits first
                if (tenantId) {
                    if (!tenantManager.canStartUpload(tenantId)) {
                        const durNs = Number(process.hrtime.bigint() - reqStartTime);
                        logJsonl({
                            ts: new Date().toISOString(),
                            event: 'http_request_complete',
                            ip: reqIp,
                            method: req.method,
                            path: url.pathname,
                            durMs: Math.round(durNs / 1e6),
                            status: 503,
                            error: 'TenantUploadLimitExceeded',
                            tenantId
                        });
                        res.writeHead(503, {
                            'content-type': 'application/json',
                            'retry-after': '30'
                        });
                        res.end(JSON.stringify({
                            error: 'Tenant upload limit exceeded',
                            code: 'TenantUploadLimitExceeded',
                            tenantId
                        }));
                        return;
                    }
                    tenantManager.trackUploadStart(tenantId);
                }
                // T5031: Check upload concurrency limits
                if (activeUploads >= concurrencyConfig.maxConcurrentUploads) {
                    if (tenantId)
                        tenantManager.trackUploadEnd(tenantId);
                    const durNs = Number(process.hrtime.bigint() - reqStartTime);
                    logJsonl({
                        ts: new Date().toISOString(),
                        event: 'http_request_complete',
                        ip: reqIp,
                        method: req.method,
                        path: url.pathname,
                        durMs: Math.round(durNs / 1e6),
                        status: 503,
                        error: 'TooManyUploads'
                    });
                    res.writeHead(503, {
                        'content-type': 'application/json',
                        'retry-after': '30'
                    });
                    res.end(JSON.stringify({
                        error: 'Service Unavailable',
                        code: 'TooManyUploads',
                        message: 'Too many concurrent uploads',
                        limit: concurrencyConfig.maxConcurrentUploads
                    }));
                    return;
                }
                const uploadsForIp = activeUploadsPerIp.get(reqIp) || 0;
                if (uploadsForIp >= concurrencyConfig.maxConcurrentUploadsPerIp) {
                    const durNs = Number(process.hrtime.bigint() - reqStartTime);
                    logJsonl({
                        ts: new Date().toISOString(),
                        event: 'http_request_complete',
                        ip: reqIp,
                        method: req.method,
                        path: url.pathname,
                        durMs: Math.round(durNs / 1e6),
                        status: 503,
                        error: 'TooManyUploadsPerIp'
                    });
                    res.writeHead(503, {
                        'content-type': 'application/json',
                        'retry-after': '30'
                    });
                    res.end(JSON.stringify({
                        error: 'Service Unavailable',
                        code: 'TooManyUploadsPerIp',
                        message: 'Too many concurrent uploads from your IP',
                        limit: concurrencyConfig.maxConcurrentUploadsPerIp
                    }));
                    return;
                }
                // Track upload
                activeUploads++;
                activeUploadsPerIp.set(reqIp, uploadsForIp + 1);
                const cleanupUpload = () => {
                    activeUploads--;
                    const current = activeUploadsPerIp.get(reqIp) || 1;
                    if (current <= 1) {
                        activeUploadsPerIp.delete(reqIp);
                    }
                    else {
                        activeUploadsPerIp.set(reqIp, current - 1);
                    }
                    if (tenantId) {
                        tenantManager.trackUploadEnd(tenantId);
                    }
                };
                const contentType = req.headers['content-type'] || '';
                if (!contentType.includes('multipart/form-data')) {
                    cleanupUpload();
                    const durNs = Number(process.hrtime.bigint() - reqStartTime);
                    logJsonl({ ts: new Date().toISOString(), event: 'http_request_complete', ip: reqIp, method: req.method, path: url.pathname, durMs: Math.round(durNs / 1e6), status: 400, error: 'expected_multipart' });
                    send(res, 400, { error: 'Expected multipart/form-data' });
                    return;
                }
                const uploadDir = process.env.CONDUIT_UPLOAD_DIR || path.join(os.tmpdir(), 'uploads');
                if (!fs.existsSync(uploadDir)) {
                    fs.mkdirSync(uploadDir, { recursive: true });
                }
                const uploadMode = process.env.CONDUIT_UPLOAD_MODE || 'async';
                const maxParts = Number(process.env.CONDUIT_MULTIPART_MAX_PARTS || 10);
                const maxFields = Number(process.env.CONDUIT_MULTIPART_MAX_FIELDS || 50);
                const maxPartSize = Number(process.env.CONDUIT_MULTIPART_MAX_PART_SIZE || 104857600); // 100MB
                try {
                    const bb = busboy({
                        headers: req.headers,
                        limits: {
                            fileSize: maxPartSize,
                            files: maxParts,
                            fields: maxFields
                        }
                    });
                    const files = [];
                    const fields = {};
                    let totalBytes = 0;
                    let fileCount = 0;
                    let fieldCount = 0;
                    let limitsExceeded = false;
                    let exceededReason = '';
                    bb.on('field', (fieldname, value) => {
                        fieldCount++;
                        if (fieldCount > maxFields) {
                            limitsExceeded = true;
                            exceededReason = `Field count exceeded: ${fieldCount} > ${maxFields}`;
                            req.unpipe(bb);
                            bb.destroy();
                            return;
                        }
                        fields[fieldname] = value;
                    });
                    bb.on('file', (fieldname, file, info) => {
                        const { filename, encoding, mimeType } = info;
                        fileCount++;
                        if (fileCount > maxParts) {
                            limitsExceeded = true;
                            exceededReason = `File count exceeded: ${fileCount} > ${maxParts}`;
                            file.resume(); // drain the file stream
                            req.unpipe(bb);
                            bb.destroy();
                            return;
                        }
                        const fileStart = Date.now();
                        const filePath = path.join(uploadDir, `${Date.now()}-${filename}`);
                        let fileBytes = 0;
                        console.log(`[UPLOAD] Mode: ${uploadMode}, File: ${filename}, Type: ${mimeType}, IP: ${reqIp}`);
                        // T5011 + T5013: Use pluggable blob sink with integrity metadata
                        const useBlobSink = blobSink && (process.env.CONDUIT_UPLOAD_USE_BLOB_SINK === 'true');
                        if (useBlobSink) {
                            // Stream to blob sink with integrity computation
                            const passThrough = new PassThrough();
                            let hashStream = crypto.createHash('sha256');
                            file.on('data', (chunk) => {
                                fileBytes += chunk.length;
                                totalBytes += chunk.length;
                                if (fileBytes > maxPartSize) {
                                    limitsExceeded = true;
                                    exceededReason = `Part size exceeded: ${(fileBytes / 1048576).toFixed(2)}MB > ${(maxPartSize / 1048576).toFixed(0)}MB`;
                                    file.resume();
                                    passThrough.destroy();
                                    req.unpipe(bb);
                                    return;
                                }
                                hashStream.update(chunk);
                                passThrough.write(chunk);
                            });
                            file.on('end', async () => {
                                passThrough.end();
                                const sha256 = hashStream.digest('hex');
                                const duration = ((Date.now() - fileStart) / 1000).toFixed(2);
                                const mbps = (fileBytes / (1024 * 1024) / parseFloat(duration)).toFixed(2);
                                try {
                                    const blobRef = await blobSink.store(passThrough, {
                                        filename,
                                        mime: mimeType,
                                        clientIp: reqIp,
                                        tags: { ...fields }
                                    });
                                    files.push({
                                        fieldname,
                                        filename,
                                        encoding,
                                        mimeType,
                                        size: fileBytes,
                                        blobId: blobRef.blobId,
                                        sha256: blobRef.sha256,
                                        backend: blobRef.backend,
                                        duration,
                                        mbps
                                    });
                                    console.log(`[UPLOAD] File complete (blob): ${filename}, ${fileBytes} bytes, ${duration}s, ${mbps} MB/s, sha256=${blobRef.sha256.substring(0, 16)}...`);
                                }
                                catch (err) {
                                    console.error(`[UPLOAD] Blob sink failed for ${filename}: ${err.message}`);
                                    limitsExceeded = true;
                                    exceededReason = `Blob storage failed: ${err.message}`;
                                }
                            });
                            file.on('error', (err) => {
                                passThrough.destroy();
                            });
                        }
                        else if (uploadMode === 'async') {
                            // Legacy: local filesystem async
                            const writeStream = fs.createWriteStream(filePath);
                            let hashStream = crypto.createHash('sha256');
                            file.on('data', (chunk) => {
                                fileBytes += chunk.length;
                                totalBytes += chunk.length;
                                if (fileBytes > maxPartSize) {
                                    limitsExceeded = true;
                                    exceededReason = `Part size exceeded: ${(fileBytes / 1048576).toFixed(2)}MB > ${(maxPartSize / 1048576).toFixed(0)}MB`;
                                    file.resume();
                                    writeStream.destroy();
                                    fs.unlink(filePath, () => { });
                                    req.unpipe(bb);
                                    return;
                                }
                                hashStream.update(chunk);
                                if (!writeStream.write(chunk)) {
                                    file.pause();
                                    writeStream.once('drain', () => file.resume());
                                }
                            });
                            file.on('end', () => {
                                writeStream.end();
                                const sha256 = hashStream.digest('hex');
                                const duration = ((Date.now() - fileStart) / 1000).toFixed(2);
                                const mbps = (fileBytes / (1024 * 1024) / parseFloat(duration)).toFixed(2);
                                // T5013: Write integrity metadata alongside file
                                const metadataPath = `${filePath}.meta.json`;
                                const metadata = {
                                    filename,
                                    mimeType,
                                    size: fileBytes,
                                    sha256,
                                    uploadedAt: new Date().toISOString(),
                                    uploadedBy: reqIp,
                                    fields
                                };
                                fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
                                files.push({
                                    fieldname,
                                    filename,
                                    encoding,
                                    mimeType,
                                    size: fileBytes,
                                    path: filePath,
                                    sha256,
                                    duration,
                                    mbps
                                });
                                console.log(`[UPLOAD] File complete: ${filename}, ${fileBytes} bytes, ${duration}s, ${mbps} MB/s, sha256=${sha256.substring(0, 16)}...`);
                            });
                            file.on('error', (err) => {
                                writeStream.destroy();
                                fs.unlink(filePath, () => { });
                            });
                        }
                        else {
                            // sync mode: buffer in memory
                            const chunks = [];
                            let hashStream = crypto.createHash('sha256');
                            file.on('data', (chunk) => {
                                chunks.push(chunk);
                                fileBytes += chunk.length;
                                totalBytes += chunk.length;
                                hashStream.update(chunk);
                                if (fileBytes > maxPartSize) {
                                    limitsExceeded = true;
                                    exceededReason = `Part size exceeded: ${(fileBytes / 1048576).toFixed(2)}MB > ${(maxPartSize / 1048576).toFixed(0)}MB`;
                                    file.resume();
                                    req.unpipe(bb);
                                    return;
                                }
                            });
                            file.on('end', () => {
                                const buffer = Buffer.concat(chunks);
                                fs.writeFileSync(filePath, buffer);
                                const sha256 = hashStream.digest('hex');
                                const duration = ((Date.now() - fileStart) / 1000).toFixed(2);
                                const mbps = (fileBytes / (1024 * 1024) / parseFloat(duration)).toFixed(2);
                                // T5013: Write integrity metadata
                                const metadataPath = `${filePath}.meta.json`;
                                const metadata = {
                                    filename,
                                    mimeType,
                                    size: fileBytes,
                                    sha256,
                                    uploadedAt: new Date().toISOString(),
                                    uploadedBy: reqIp,
                                    fields
                                };
                                fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
                                files.push({
                                    fieldname,
                                    filename,
                                    encoding,
                                    mimeType,
                                    size: fileBytes,
                                    path: filePath,
                                    sha256,
                                    duration,
                                    mbps
                                });
                                console.log(`[UPLOAD] File complete: ${filename}, ${fileBytes} bytes, ${duration}s, ${mbps} MB/s, sha256=${sha256.substring(0, 16)}...`);
                            });
                        }
                    });
                    bb.on('finish', async () => {
                        cleanupUpload(); // T5031: Release concurrency slot
                        if (limitsExceeded) {
                            const durNs = Number(process.hrtime.bigint() - reqStartTime);
                            logJsonl({
                                ts: new Date().toISOString(),
                                event: 'http_request_complete',
                                ip: reqIp,
                                method: req.method,
                                path: url.pathname,
                                bytes: totalBytes,
                                durMs: Math.round(durNs / 1e6),
                                status: 413,
                                error: 'limits_exceeded'
                            });
                            send(res, 413, {
                                error: 'Upload limits exceeded',
                                code: 'PayloadTooLarge',
                                reason: exceededReason,
                                limits: {
                                    maxParts,
                                    maxFields,
                                    maxPartSize: `${(maxPartSize / 1048576).toFixed(0)}MB`
                                }
                            });
                            return;
                        }
                        const totalDuration = ((Date.now() - Number(reqStartTime)) / 1000).toFixed(2);
                        const totalMbps = (totalBytes / (1024 * 1024) / parseFloat(totalDuration)).toFixed(2);
                        const durNs = Number(process.hrtime.bigint() - reqStartTime);
                        // T5040: Log with integrity metadata from T5013
                        const logEntry = {
                            ts: new Date().toISOString(),
                            ip: reqIp,
                            method: req.method,
                            path: url.pathname,
                            bytes: totalBytes,
                            mode: uploadMode,
                            ruleId: 'multipart_upload',
                            status: 200,
                            durMs: Math.round(durNs / 1e6),
                            rateMBps: parseFloat(totalMbps)
                        };
                        // Include integrity fields from first file if available
                        if (files.length > 0 && files[0].sha256) {
                            logEntry.sha256 = files[0].sha256;
                            logEntry.mime = files[0].mimeType;
                            logEntry.size = files[0].size;
                        }
                        logJsonl(logEntry);
                        recordMetrics(url.pathname, 200, Math.round(durNs / 1e6), totalBytes, 0, 'multipart_upload');
                        console.log(`[UPLOAD] Complete: ${fileCount} files, ${fieldCount} fields, ${totalBytes} bytes, ${totalDuration}s, ${totalMbps} MB/s, mode: ${uploadMode}`);
                        // T5012: Optional auto-enqueue on upload completion
                        const autoEnqueue = process.env.CONDUIT_UPLOAD_AUTO_ENQUEUE === 'true';
                        const enqueueTarget = process.env.CONDUIT_UPLOAD_ENQUEUE_TARGET || 'agents/uploads/inbox';
                        let enqueueResult = null;
                        if (autoEnqueue && files.length > 0) {
                            try {
                                const envelope = {
                                    type: 'upload_complete',
                                    uploadedAt: new Date().toISOString(),
                                    clientIp: reqIp,
                                    totalFiles: fileCount,
                                    totalBytes,
                                    fields,
                                    files: files.map(f => ({
                                        filename: f.filename,
                                        size: f.size,
                                        mime: f.mimeType,
                                        sha256: f.sha256,
                                        blobId: f.blobId,
                                        backend: f.backend,
                                        path: f.path
                                    }))
                                };
                                enqueueResult = await client.enqueue(enqueueTarget, envelope);
                                console.log(`[UPLOAD] Auto-enqueued to ${enqueueTarget}: ${JSON.stringify(enqueueResult)}`);
                            }
                            catch (err) {
                                console.error(`[UPLOAD] Auto-enqueue failed: ${err.message}`);
                            }
                        }
                        send(res, 200, {
                            success: true,
                            mode: uploadMode,
                            fileCount,
                            fieldCount,
                            totalBytes,
                            totalDuration,
                            totalMbps,
                            files,
                            enqueued: autoEnqueue ? enqueueResult : undefined
                        });
                    });
                    bb.on('error', (err) => {
                        cleanupUpload(); // T5031: Release concurrency slot on error
                        const durNs = Number(process.hrtime.bigint() - reqStartTime);
                        logJsonl({
                            ts: new Date().toISOString(),
                            event: 'http_request_complete',
                            ip: reqIp,
                            method: req.method,
                            path: url.pathname,
                            durMs: Math.round(durNs / 1e6),
                            status: 400,
                            error: 'upload_failed'
                        });
                        send(res, 400, { error: err.message || 'Upload failed' });
                    });
                    req.pipe(bb);
                }
                catch (err) {
                    cleanupUpload(); // T5031: Release concurrency slot on exception
                    const durNs = Number(process.hrtime.bigint() - reqStartTime);
                    logJsonl({
                        ts: new Date().toISOString(),
                        event: 'http_request_complete',
                        ip: reqIp,
                        method: req.method,
                        path: url.pathname,
                        durMs: Math.round(durNs / 1e6),
                        status: 500,
                        error: 'internal_error'
                    });
                    send(res, 500, { error: err.message || 'Internal error' });
                }
                return;
            }
            if (req.method === 'GET' && url.pathname === '/v1/stats') {
                const stream = url.searchParams.get('stream');
                if (!stream) {
                    const durNs = Number(process.hrtime.bigint() - reqStartTime);
                    logJsonl({ ts: new Date().toISOString(), event: 'http_request_complete', ip: reqIp, method: req.method, path: url.pathname, durMs: Math.round(durNs / 1e6), status: 400, error: 'missing_stream' });
                    send(res, 400, { error: 'missing stream' });
                    return;
                }
                client.stats(stream).then(r => {
                    const durNs = Number(process.hrtime.bigint() - reqStartTime);
                    logJsonl({ ts: new Date().toISOString(), event: 'http_request_complete', ip: reqIp, method: req.method, path: url.pathname, durMs: Math.round(durNs / 1e6), status: 200 });
                    send(res, 200, r);
                }).catch(() => {
                    const durNs = Number(process.hrtime.bigint() - reqStartTime);
                    logJsonl({ ts: new Date().toISOString(), event: 'http_request_complete', ip: reqIp, method: req.method, path: url.pathname, durMs: Math.round(durNs / 1e6), status: 500, error: 'stats_failed' });
                    send(res, 500, { error: 'stats failed' });
                });
                return;
            }
            if (req.method === 'GET' && url.pathname === '/v1/metrics') {
                client.metrics().then(backendMetrics => {
                    const durNs = Number(process.hrtime.bigint() - reqStartTime);
                    const durMs = Math.round(durNs / 1e6);
                    // T5042: Combine backend metrics with HTTP metrics
                    const httpSummary = getMetricsSummary();
                    const combinedMetrics = Object.assign({}, backendMetrics, httpSummary, { ws: wsMetrics || {} });
                    logJsonl({ ts: new Date().toISOString(), ip: reqIp, method: req.method, path: url.pathname, durMs, status: 200 });
                    recordMetrics(url.pathname, 200, durMs, 0, JSON.stringify(combinedMetrics).length);
                    send(res, 200, combinedMetrics);
                }).catch(() => {
                    const durNs = Number(process.hrtime.bigint() - reqStartTime);
                    const durMs = Math.round(durNs / 1e6);
                    logJsonl({ ts: new Date().toISOString(), ip: reqIp, method: req.method, path: url.pathname, durMs, status: 500, error: 'metrics_failed' });
                    recordMetrics(url.pathname, 500, durMs, 0, 0);
                    send(res, 500, { error: 'metrics failed' });
                });
                return;
            }
            // SSE demo (heartbeat only)
            if (req.method === 'GET' && url.pathname === '/v1/live') {
                logJsonl({ ts: new Date().toISOString(), event: 'http_request_complete', ip: reqIp, method: req.method, path: url.pathname, status: 200 });
                res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'connection': 'keep-alive' });
                const hb = setInterval(() => { res.write(': heartbeat\n\n'); }, 15000);
                req.on('close', () => clearInterval(hb));
                res.write('data: {"connected":true}\n\n');
                return;
            }
            const durNs = Number(process.hrtime.bigint() - reqStartTime);
            logJsonl({ ts: new Date().toISOString(), event: 'http_request_complete', ip: reqIp, method: req.method, path: reqUrl.pathname, durMs: Math.round(durNs / 1e6), status: 404, error: 'not_found' });
            res.writeHead(404).end();
        }
        catch (e) {
            const durNs = Number(process.hrtime.bigint() - reqStartTime);
            logJsonl({ ts: new Date().toISOString(), event: 'http_request_complete', ip: reqIp, method: req.method, path: reqUrl.pathname, durMs: Math.round(durNs / 1e6), status: 500, error: 'internal_error' });
            res.writeHead(500).end();
        }
    });
    // T5032: Configure HTTP timeouts and keep-alive
    server.keepAliveTimeout = timeoutConfig.keepAliveTimeout;
    server.headersTimeout = timeoutConfig.headersTimeout;
    server.requestTimeout = timeoutConfig.requestTimeout;
    // Handle timeout events (slowloris protection)
    server.on('timeout', (socket) => {
        console.warn(`[HTTP] Request timeout from ${socket.remoteAddress}`);
        logJsonl({
            ts: new Date().toISOString(),
            event: 'http_timeout',
            ip: socket.remoteAddress || 'unknown',
            error: 'RequestTimeout'
        });
        socket.destroy();
    });
    server.listen(port, bind);
    return server;
}
export function makeClientWithDemo(rec) {
    const [clientEnd, serverEnd] = makeDuplexPair();
    const demo = new DemoPipeServer();
    demo.attach(serverEnd);
    const client = new PipeClient(clientEnd, rec);
    client.hello().catch(() => { });
    return client;
}
export async function makeClientWithTerminal(config, rec) {
    const terminal = new TCPTerminal(config);
    const stream = await terminal.connect();
    const client = new PipeClient(stream, rec);
    await client.hello();
    return client;
}
