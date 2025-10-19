import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { PipeClient, makeDuplexPair } from '../control/client.js';
import { DemoPipeServer } from '../backend/demo.js';
import { applyRules } from '../dsl/interpreter.js';
import { loadDSL } from '../dsl/loader.js';
import { TCPTerminal } from '../control/terminal.js';
let logStream = null;
function initLogStream() {
    const logPath = process.env.CONDUIT_HTTP_LOG;
    if (!logPath || logStream)
        return;
    try {
        const logDir = path.dirname(logPath);
        fs.mkdirSync(logDir, { recursive: true });
        logStream = fs.createWriteStream(logPath, { flags: 'a' });
        logStream.on('error', (err) => {
            console.error(`[HTTP] Log stream error: ${err.message}`);
            logStream = null;
        });
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
function send(res, code, body) { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); }
let dslConfig = null;
export function loadDSLConfig(path) {
    dslConfig = loadDSL(path);
    console.log(`[HTTP] Loaded DSL rules from ${path}: ${dslConfig.rules.length} rules`);
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
    let body = '';
    let received = 0;
    for await (const chunk of req) {
        received += chunk.length;
        if (received > sizeLimit) {
            const durNs = Number(process.hrtime.bigint() - startTime);
            if (isJSON) {
                const limitMB = (MAX_JSON / 1_048_576).toFixed(0);
                console.warn(`[HTTP] JSON body exceeded ${limitMB}MB limit: ${received} bytes from ${req.socket.remoteAddress}`);
                logJsonl({
                    ts: new Date().toISOString(),
                    event: 'http_request_complete',
                    ip,
                    method: req.method,
                    path: url.pathname,
                    bytes: received,
                    durMs: Math.round(durNs / 1e6),
                    status: 413,
                    error: 'JSONTooLarge'
                });
                send(res, 413, {
                    error: `JSON body exceeds ${limitMB}MB limit`,
                    code: 'JSONTooLarge',
                    suggestion: 'Consider using gzip compression (Content-Encoding: gzip) or multipart upload for large data'
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
                logJsonl({ ts: new Date().toISOString(), event: 'http_request_complete', ip: reqIp, method: req.method, path: url.pathname, durMs: Math.round(durNs / 1e6), status: 200 });
                send(res, 200, { ok: true, version: 'v0.1', features: ['http', 'ws', 'sse'] });
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
                client.metrics().then(r => {
                    const durNs = Number(process.hrtime.bigint() - reqStartTime);
                    logJsonl({ ts: new Date().toISOString(), event: 'http_request_complete', ip: reqIp, method: req.method, path: url.pathname, durMs: Math.round(durNs / 1e6), status: 200 });
                    send(res, 200, r);
                }).catch(() => {
                    const durNs = Number(process.hrtime.bigint() - reqStartTime);
                    logJsonl({ ts: new Date().toISOString(), event: 'http_request_complete', ip: reqIp, method: req.method, path: url.pathname, durMs: Math.round(durNs / 1e6), status: 500, error: 'metrics_failed' });
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
