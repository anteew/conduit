import { WebSocketServer } from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import { TenantManager } from '../tenancy/tenant-manager.js';
import { WSRateLimiter } from './ws-rate-limiter.js';
let connCounter = 0;
function generateConnId() {
    return `ws-${Date.now()}-${++connCounter}`;
}
const wsLogPath = path.join(process.cwd(), 'reports', 'gateway-ws.log.jsonl');
let wsLogStream = null;
function initWsLogStream() {
    if (wsLogStream)
        return;
    try {
        const reportsDir = path.dirname(wsLogPath);
        fs.mkdirSync(reportsDir, { recursive: true });
        wsLogStream = fs.createWriteStream(wsLogPath, { flags: 'a' });
        wsLogStream.on('error', (err) => {
            console.error(`[WS] Log stream error: ${err}`);
            wsLogStream = null;
        });
        console.log(`[WS] JSONL logging enabled: ${wsLogPath}`);
    }
    catch (err) {
        console.error(`[WS] Failed to initialize log stream: ${err.message}`);
    }
}
function logWsEvent(data) {
    if (!wsLogStream)
        return;
    try {
        wsLogStream.write(JSON.stringify(data) + '\n');
    }
    catch (err) {
        console.error(`[WS] Failed to write log: ${err}`);
    }
}
function sendError(ws, code, message, closeCode) {
    try {
        ws.send(JSON.stringify({ error: { code, message } }));
        if (closeCode)
            ws.close(closeCode, message);
    }
    catch { }
}
// T5042: WebSocket metrics
const wsMetrics = {
    connectionsTotal: 0,
    activeConnections: 0,
    messagesIn: 0,
    messagesOut: 0,
    creditsGranted: 0,
    deliveriesTotal: 0,
    errorsTotal: 0,
    errorsByType: new Map()
};
export function getWsMetrics() {
    return {
        connectionsTotal: wsMetrics.connectionsTotal,
        activeConnections: wsMetrics.activeConnections,
        messagesIn: wsMetrics.messagesIn,
        messagesOut: wsMetrics.messagesOut,
        creditsGranted: wsMetrics.creditsGranted,
        deliveriesTotal: wsMetrics.deliveriesTotal,
        errorsTotal: wsMetrics.errorsTotal,
        errorsByType: Object.fromEntries(wsMetrics.errorsByType)
    };
}
let isDraining = false;
export function setWsDrainingMode(draining) {
    isDraining = draining;
    console.log(`[WS] Draining mode: ${draining ? 'enabled' : 'disabled'}`);
}
export function startWs(client, port = 9088, bind = '127.0.0.1') {
    initWsLogStream();
    const tokenAllowlist = process.env.CONDUIT_TOKENS ?
        new Set(process.env.CONDUIT_TOKENS.split(',').map(t => t.trim())) : null;
    const tenantConfigPath = process.env.CONDUIT_TENANT_CONFIG || path.join(process.cwd(), 'config', 'tenants.yaml');
    const tenantManager = new TenantManager(tenantConfigPath);
    const maxMessageSize = parseInt(process.env.CONDUIT_WS_MAX_MESSAGE_SIZE || '1048576', 10);
    const messageRateLimit = parseInt(process.env.CONDUIT_WS_MESSAGE_RATE_LIMIT || '1000', 10);
    const rateWindowMs = parseInt(process.env.CONDUIT_WS_RATE_WINDOW_MS || '60000', 10);
    const rateLimiter = messageRateLimit > 0 && rateWindowMs > 0
        ? new WSRateLimiter({ messageRateLimit, windowMs: rateWindowMs })
        : null;
    // T5030: Connection rate limiting per IP
    const connRateLimit = parseInt(process.env.CONDUIT_WS_CONN_RATE_LIMIT || '10', 10); // 10 conns per minute
    const connRateWindowMs = parseInt(process.env.CONDUIT_WS_CONN_RATE_WINDOW_MS || '60000', 10);
    const connRateLimiter = connRateLimit > 0 && connRateWindowMs > 0
        ? new WSRateLimiter({ messageRateLimit: connRateLimit, windowMs: connRateWindowMs })
        : null;
    if (connRateLimiter) {
        console.log(`[WS] Connection rate limiting enabled: ${connRateLimit} connections per ${connRateWindowMs}ms`);
    }
    const wss = new WebSocketServer({ port, host: bind });
    wss.on('connection', (ws, req) => {
        const connId = generateConnId();
        const connStartTime = Date.now();
        let deliveryCount = 0;
        let creditWindow = 0;
        let deliveryPending = false;
        const url = new URL(req.url || '', 'ws://local');
        const clientIp = req.socket.remoteAddress || 'unknown';
        // T5060: Reject connections during drain
        if (isDraining) {
            wsMetrics.errorsTotal++;
            wsMetrics.errorsByType.set('ServerDraining', (wsMetrics.errorsByType.get('ServerDraining') || 0) + 1);
            logWsEvent({
                ts: new Date().toISOString(),
                connId,
                ip: clientIp,
                error: 'ServerDraining'
            });
            ws.close(1001, 'Server draining');
            return;
        }
        wsMetrics.connectionsTotal++;
        wsMetrics.activeConnections++;
        // T5030: Check connection rate limit per IP
        if (connRateLimiter && !connRateLimiter.checkAndConsume(clientIp)) {
            wsMetrics.errorsTotal++;
            wsMetrics.errorsByType.set('ConnectionRateLimitExceeded', (wsMetrics.errorsByType.get('ConnectionRateLimitExceeded') || 0) + 1);
            logWsEvent({
                ts: new Date().toISOString(),
                connId,
                ip: clientIp,
                error: 'ConnectionRateLimitExceeded'
            });
            sendError(ws, 'ConnectionRateLimitExceeded', 'Too many connection attempts from your IP', 1008);
            wsMetrics.activeConnections--;
            return;
        }
        if (url.pathname !== '/v1/subscribe') {
            ws.close();
            return;
        }
        const stream = url.searchParams.get('stream');
        if (!stream) {
            ws.close();
            return;
        }
        const authHeader = req.headers['authorization'] || '';
        const token = Array.isArray(authHeader) ? authHeader[0] : authHeader;
        const bearerToken = token.startsWith('Bearer ') ? token.slice(7) : undefined;
        const tenantId = bearerToken ? tenantManager.getTenantFromToken(bearerToken) : undefined;
        // Auth check
        if (tokenAllowlist) {
            if (!bearerToken || !tokenAllowlist.has(bearerToken)) {
                wsMetrics.errorsTotal++;
                wsMetrics.errorsByType.set('Unauthorized', (wsMetrics.errorsByType.get('Unauthorized') || 0) + 1);
                logWsEvent({
                    ts: new Date().toISOString(),
                    connId,
                    ip: clientIp,
                    stream,
                    tenantId,
                    error: 'Unauthorized'
                });
                sendError(ws, 'Unauthorized', 'Invalid or missing token', 1008);
                wsMetrics.activeConnections--;
                return;
            }
        }
        // T5061: Per-tenant connection limits
        if (tenantId) {
            const tenantConfig = tenantManager.getTenantConfig(tenantId);
            const maxConnections = tenantConfig?.limits?.maxConnections;
            if (maxConnections) {
                const currentConnections = tenantManager.getMetrics()[tenantId]?.connections || 0;
                if (currentConnections >= maxConnections) {
                    wsMetrics.errorsTotal++;
                    wsMetrics.errorsByType.set('TenantConnectionLimitExceeded', (wsMetrics.errorsByType.get('TenantConnectionLimitExceeded') || 0) + 1);
                    logWsEvent({
                        ts: new Date().toISOString(),
                        connId,
                        ip: clientIp,
                        stream,
                        tenantId,
                        error: `TenantConnectionLimitExceeded: ${currentConnections}/${maxConnections}`
                    });
                    sendError(ws, 'TenantConnectionLimitExceeded', `Tenant connection limit exceeded (${maxConnections})`, 1008);
                    wsMetrics.activeConnections--;
                    return;
                }
            }
        }
        if (tenantId) {
            tenantManager.trackConnection(tenantId, true);
        }
        logWsEvent({
            ts: new Date().toISOString(),
            connId,
            ip: clientIp,
            stream
        });
        client.subscribe(stream, (env) => {
            // Strict backpressure: only deliver if we have credit window
            if (creditWindow > 0) {
                creditWindow--;
                deliveryCount++;
                wsMetrics.deliveriesTotal++;
                wsMetrics.messagesOut++;
                logWsEvent({
                    ts: new Date().toISOString(),
                    connId,
                    ip: clientIp,
                    stream,
                    delivers: deliveryCount,
                    creditRemaining: creditWindow
                });
                ws.send(JSON.stringify({ deliver: env }));
                deliveryPending = false;
            }
            else {
                // No credit available, mark as pending
                deliveryPending = true;
                logWsEvent({
                    ts: new Date().toISOString(),
                    connId,
                    ip: clientIp,
                    stream,
                    error: 'Backpressure'
                });
            }
        });
        ws.on('message', (data) => {
            wsMetrics.messagesIn++;
            // Rate limiting check
            if (rateLimiter && !rateLimiter.checkAndConsume(connId)) {
                wsMetrics.errorsTotal++;
                wsMetrics.errorsByType.set('RateLimitExceeded', (wsMetrics.errorsByType.get('RateLimitExceeded') || 0) + 1);
                logWsEvent({
                    ts: new Date().toISOString(),
                    connId,
                    ip: clientIp,
                    stream,
                    error: 'RateLimitExceeded'
                });
                console.log(`[WS] Rate limit exceeded for connection ${connId}`);
                sendError(ws, 'RateLimitExceeded', 'Message rate limit exceeded', 1008);
                return;
            }
            const messageSize = Buffer.byteLength(String(data));
            if (messageSize > maxMessageSize) {
                wsMetrics.errorsTotal++;
                wsMetrics.errorsByType.set('MessageTooLarge', (wsMetrics.errorsByType.get('MessageTooLarge') || 0) + 1);
                logWsEvent({
                    ts: new Date().toISOString(),
                    connId,
                    ip: clientIp,
                    stream,
                    error: `MessageTooLarge: ${messageSize} > ${maxMessageSize}`
                });
                sendError(ws, 'MessageTooLarge', `Message size ${messageSize} exceeds limit ${maxMessageSize}`, 1009);
                return;
            }
            try {
                const msg = JSON.parse(String(data));
                if (typeof msg.credit === 'number') {
                    creditWindow += msg.credit;
                    wsMetrics.creditsGranted += msg.credit;
                    logWsEvent({
                        ts: new Date().toISOString(),
                        connId,
                        ip: clientIp,
                        stream,
                        credit: msg.credit,
                        totalCredit: creditWindow
                    });
                    client.grant(msg.credit);
                }
                else if (typeof msg.ack === 'string')
                    client.ack(msg.ack);
                else if (typeof msg.nack === 'string')
                    client.nack(msg.nack, msg.delayMs);
                else {
                    wsMetrics.errorsTotal++;
                    wsMetrics.errorsByType.set('UnknownOp', (wsMetrics.errorsByType.get('UnknownOp') || 0) + 1);
                    logWsEvent({
                        ts: new Date().toISOString(),
                        connId,
                        ip: clientIp,
                        stream,
                        error: 'UnknownOp'
                    });
                    sendError(ws, 'UnknownOp', 'Unknown operation', 1003);
                }
            }
            catch (e) {
                wsMetrics.errorsTotal++;
                wsMetrics.errorsByType.set('InvalidJSON', (wsMetrics.errorsByType.get('InvalidJSON') || 0) + 1);
                logWsEvent({
                    ts: new Date().toISOString(),
                    connId,
                    ip: clientIp,
                    stream,
                    error: `InvalidJSON: ${e?.message || 'Malformed JSON'}`
                });
                sendError(ws, 'InvalidJSON', e?.message || 'Malformed JSON', 1007);
            }
        });
        ws.on('close', (code) => {
            const duration = Date.now() - connStartTime;
            wsMetrics.activeConnections--;
            if (tenantId) {
                tenantManager.trackConnection(tenantId, false);
            }
            if (rateLimiter) {
                rateLimiter.cleanup(connId);
            }
            logWsEvent({
                ts: new Date().toISOString(),
                connId,
                ip: clientIp,
                stream,
                closeCode: code,
                delivers: deliveryCount,
                durMs: duration
            });
        });
        ws.on('error', (error) => {
            wsMetrics.errorsTotal++;
            wsMetrics.errorsByType.set('SocketError', (wsMetrics.errorsByType.get('SocketError') || 0) + 1);
            logWsEvent({
                ts: new Date().toISOString(),
                connId,
                ip: clientIp,
                stream,
                error: error.message
            });
        });
    });
    return wss;
}
