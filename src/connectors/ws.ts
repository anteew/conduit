import { WebSocketServer, WebSocket, RawData } from 'ws';
import { IncomingMessage } from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { PipeClient } from '../control/client.js';
import { TenantManager } from '../tenancy/tenant-manager.js';
import { WSRateLimiter } from './ws-rate-limiter.js';
import { getCodecByName, listCodecs } from '../codec/registry.js';
import { Codec } from '../codec/types.js';
import { jsonCodec } from '../codec/json.js';
import { getGuardrailsFromEnv, checkDecodedPayload } from '../codec/guards.js';

let connCounter = 0;

function generateConnId(): string {
  return `ws-${Date.now()}-${++connCounter}`;
}

const wsLogPath = path.join(process.cwd(), 'reports', 'gateway-ws.log.jsonl');
let wsLogStream: fs.WriteStream | null = null;

function initWsLogStream() {
  if (wsLogStream) return;
  try {
    const reportsDir = path.dirname(wsLogPath);
    fs.mkdirSync(reportsDir, { recursive: true });
    wsLogStream = fs.createWriteStream(wsLogPath, { flags: 'a' });
    wsLogStream.on('error', (err) => {
      console.error(`[WS] Log stream error: ${err}`);
      wsLogStream = null;
    });
    console.log(`[WS] JSONL logging enabled: ${wsLogPath}`);
  } catch (err: any) {
    console.error(`[WS] Failed to initialize log stream: ${err.message}`);
  }
}

// T5041: Structured WebSocket log entry
interface WsLogEntry {
  ts: string;
  connId: string;
  ip: string;
  stream?: string;
  credit?: number;
  delivers?: number;
  closeCode?: number;
  error?: string;
  tenantId?: string;
  creditRemaining?: number;
  totalCredit?: number;
  durMs?: number;
  codec?: string;
}

// T7110: Connection state for codec negotiation
interface WsConnectionState {
  codec: Codec;
  codecName: string;
}

function logWsEvent(data: WsLogEntry) {
  if (!wsLogStream) return;
  try {
    wsLogStream.write(JSON.stringify(data) + '\n');
  } catch (err) {
    console.error(`[WS] Failed to write log: ${err}`);
  }
}

function sendError(ws: WebSocket, code: string, message: string, closeCode?: number, codec?: Codec) {
  try {
    const errorObj = { error: { code, message } };
    if (codec) {
      const t0 = Date.now();
      const encoded = encodeFrame(errorObj, codec);
      recordCodecMetrics(codec.name, 'encode', true, encoded.data.length, Date.now()-t0);
      ws.send(encoded.data, { binary: encoded.binary });
    } else {
      ws.send(JSON.stringify(errorObj));
    }
    if (closeCode) ws.close(closeCode, message);
  } catch {}
}

// T7111: Frame encoding with codec-specific frame types
function encodeFrame(obj: any, codec: Codec): { data: Buffer; binary: boolean } {
  const encoded = codec.encode(obj);
  const buf = Buffer.from(encoded);
  
  return {
    data: buf,
    binary: codec.isBinary
  };
}

// T7111: Frame decoding with codec-specific frame type detection
function decodeFrame(data: RawData, codec: Codec): any {
  const buf = data instanceof Buffer ? data : Buffer.from(data as any);
  return codec.decode(buf);
}

// T7112: Map codec errors to appropriate WebSocket close codes and error messages
function mapCodecError(error: Error, codec: Codec, messageSize?: number): { 
  code: string; 
  message: string; 
  closeCode: number 
} {
  const errorMsg = error.message.toLowerCase();
  // Prefer error type checks when available
  if (error instanceof SyntaxError) {
    return {
      code: 'InvalidJSON',
      message: error.message,
      closeCode: 1007
    };
  }
  
  // Check for oversize errors - these get 1009 Message Too Big
  if (errorMsg.includes('too large') || 
      errorMsg.includes('too big') || 
      errorMsg.includes('exceeds') ||
      errorMsg.includes('maximum') ||
      errorMsg.includes('size limit')) {
    return {
      code: 'MessageTooLarge',
      message: error.message,
      closeCode: 1009
    };
  }
  
  // Decode errors (malformed data) - these get 1007 Invalid Frame Payload
  // Common patterns from JSON.parse, msgpackr, etc.
  if (errorMsg.includes('parse') ||
      errorMsg.includes('invalid') ||
      errorMsg.includes('malformed') ||
      errorMsg.includes('unexpected') ||
      errorMsg.includes('decode') ||
      errorMsg.includes('json') ||
      errorMsg.includes('msgpack') ||
      errorMsg.includes('cbor')) {
    const codecErrorName = codec.name === 'json' ? 'InvalidJSON' : 'DecodeError';
    return {
      code: codecErrorName,
      message: error.message,
      closeCode: 1007
    };
  }
  
  // All other codec errors - these get 1011 Internal Error
  return {
    code: 'CodecError',
    message: error.message,
    closeCode: 1011
  };
}

// T7110/T7103: Codec metrics
const codecMetrics = {
  requestsByCodec: new Map<string, number>(),
  bytesInByCodec: new Map<string, number>(),
  bytesOutByCodec: new Map<string, number>(),
  decodeErrorsByCodec: new Map<string, number>(),
  decodeDurationsByCodec: new Map<string, number[]>(),
  encodeDurationsByCodec: new Map<string, number[]>()
};

function recordCodecMetrics(codecName: string, operation: 'encode' | 'decode', success: boolean, bytes?: number, durMs?: number) {
  if (operation === 'decode') {
    codecMetrics.requestsByCodec.set(codecName, (codecMetrics.requestsByCodec.get(codecName) || 0) + 1)
  }
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
  errorsByType: new Map<string, number>(),
  sizeCapViolations: new Map<string, number>(),
  depthCapViolations: new Map<string, number>()
};

export function getWsMetrics() {
  const summarize = (arr: number[]) => {
    const a = [...arr].sort((x, y) => x - y);
    const p50 = a[Math.floor(a.length * 0.5)] || 0;
    const p95 = a[Math.floor(a.length * 0.95)] || 0;
    const p99 = a[Math.floor(a.length * 0.99)] || 0;
    return { p50, p95, p99, count: a.length };
  };
  return {
    connectionsTotal: wsMetrics.connectionsTotal,
    activeConnections: wsMetrics.activeConnections,
    messagesIn: wsMetrics.messagesIn,
    messagesOut: wsMetrics.messagesOut,
    creditsGranted: wsMetrics.creditsGranted,
    deliveriesTotal: wsMetrics.deliveriesTotal,
    errorsTotal: wsMetrics.errorsTotal,
    errorsByType: Object.fromEntries(wsMetrics.errorsByType),
    sizeCapViolations: Object.fromEntries(wsMetrics.sizeCapViolations),
    depthCapViolations: Object.fromEntries(wsMetrics.depthCapViolations),
    codecs: {
      requestsByCodec: Object.fromEntries(codecMetrics.requestsByCodec),
      bytesInByCodec: Object.fromEntries(codecMetrics.bytesInByCodec),
      bytesOutByCodec: Object.fromEntries(codecMetrics.bytesOutByCodec),
      decodeErrorsByCodec: Object.fromEntries(codecMetrics.decodeErrorsByCodec),
      decodeLatencyMs: Object.fromEntries(Array.from(codecMetrics.decodeDurationsByCodec.entries()).map(([k,v])=>[k, summarize(v)])),
      encodeLatencyMs: Object.fromEntries(Array.from(codecMetrics.encodeDurationsByCodec.entries()).map(([k,v])=>[k, summarize(v)]))
    }
  };
}

let isDraining = false;
export function setWsDrainingMode(draining: boolean) {
  isDraining = draining;
  console.log(`[WS] Draining mode: ${draining ? 'enabled' : 'disabled'}`);
}

export function startWs(client: PipeClient, port = 9088, bind = '127.0.0.1', codecRegistry?: any) {
  initWsLogStream();
  
  // T7110: Check for CONDUIT_CODECS_WS flag
  const codecsEnabled = process.env.CONDUIT_CODECS_WS === 'true';
  
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
  // Cache guardrails for this process (avoid repeated env parsing)
  const guardrailsCached = getGuardrailsFromEnv();
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const connId = generateConnId();
    const connStartTime = Date.now();
    let deliveryCount = 0;
    let creditWindow = 0;
    let deliveryPending = false;
    
    const url = new URL(req.url || '', 'ws://local');
    const clientIp = req.socket.remoteAddress || 'unknown';
    
    // T7110: Codec negotiation
    let connCodec: Codec = jsonCodec;
    let connCodecName = 'json';
    
    if (codecsEnabled && codecRegistry) {
      // Parse 'codec' query parameter
      const codecParam = url.searchParams.get('codec');
      
      // Parse Sec-WebSocket-Protocol header for codec negotiation
      const protocolHeader = req.headers['sec-websocket-protocol'];
      const protocols = protocolHeader 
        ? (Array.isArray(protocolHeader) ? protocolHeader.join(',') : protocolHeader).split(',').map(p => p.trim())
        : [];
      
      // Prefer query parameter over protocol header
      const requestedCodec = codecParam || protocols[0];
      
      if (requestedCodec) {
        // Validate codec exists in codecRegistry
        const codec = codecRegistry.get ? codecRegistry.get(requestedCodec) : getCodecByName(requestedCodec);
        
        if (codec) {
          connCodec = codec;
          connCodecName = requestedCodec;
        } else {
          // Fall back to json if codec unknown
          connCodec = jsonCodec;
          connCodecName = 'json';
        }
      }
    }
    
    const connState: WsConnectionState = {
      codec: connCodec,
      codecName: connCodecName
    };
    
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
      sendError(ws, 'ConnectionRateLimitExceeded', 'Too many connection attempts from your IP', 1008, connState.codec);
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
        sendError(ws, 'Unauthorized', 'Invalid or missing token', 1008, connState.codec);
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
          sendError(ws, 'TenantConnectionLimitExceeded', `Tenant connection limit exceeded (${maxConnections})`, 1008, connState.codec);
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
      stream,
      codec: connCodecName
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
        try {
          const t0 = Date.now();
          const encoded = encodeFrame({ deliver: env }, connState.codec);
          const dur = Date.now() - t0;
          ws.send(encoded.data, { binary: encoded.binary });
          recordCodecMetrics(connState.codecName, 'encode', true, encoded.data.length, dur);
        } catch (encErr: any) {
          recordCodecMetrics(connState.codecName, 'encode', false);
          console.error(`[WS] Encode error for ${connId}:`, encErr.message);
        }
        deliveryPending = false;
      } else {
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
    
    ws.on('message', (data: RawData) => {
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
        sendError(ws, 'RateLimitExceeded', 'Message rate limit exceeded', 1008, connState.codec);
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
        sendError(ws, 'MessageTooLarge', `Message size ${messageSize} exceeds limit ${maxMessageSize}`, 1009, connState.codec);
        return;
      }
      
      try {
        let msg: any;
        try {
          msg = decodeFrame(data, connState.codec);
          recordCodecMetrics(connState.codecName, 'decode', true);
        } catch (decErr: any) {
          recordCodecMetrics(connState.codecName, 'decode', false);
          
          // T7112: Use mapCodecError to determine appropriate error code and close code
          const errorMapping = mapCodecError(decErr, connState.codec, messageSize);
          wsMetrics.errorsTotal++;
          wsMetrics.errorsByType.set(errorMapping.code, (wsMetrics.errorsByType.get(errorMapping.code) || 0) + 1);
          
          // T7112: Log codec error with full context
          logWsEvent({
            ts: new Date().toISOString(),
            connId,
            ip: clientIp,
            stream,
            codec: connState.codecName,
            error: `${errorMapping.code}: ${errorMapping.message}`
          });
          
          // T7112: Send error frame before closing
          console.error(`[WS] Codec decode error for ${connId} (codec=${connState.codecName}): ${errorMapping.message}`);
          sendError(ws, errorMapping.code, errorMapping.message, errorMapping.closeCode, connState.codec);
          return;
        }
        
        // T7120: Check decoded payload size and depth caps
        const check = checkDecodedPayload(msg, guardrailsCached);
        if (check.valid === false) {
          wsMetrics.errorsTotal++;
          const errorCode = check.reason === 'decoded_size_exceeded' ? 'DecodedSizeExceeded' : 'DepthExceeded';
          wsMetrics.errorsByType.set(errorCode, (wsMetrics.errorsByType.get(errorCode) || 0) + 1);
          
          if (check.reason === 'decoded_size_exceeded') {
            wsMetrics.sizeCapViolations.set(connState.codecName, (wsMetrics.sizeCapViolations.get(connState.codecName) || 0) + 1);
          } else if (check.reason === 'depth_exceeded') {
            wsMetrics.depthCapViolations.set(connState.codecName, (wsMetrics.depthCapViolations.get(connState.codecName) || 0) + 1);
          }
          
          logWsEvent({
            ts: new Date().toISOString(),
            connId,
            ip: clientIp,
            stream,
            codec: connState.codecName,
            error: `${errorCode}: limit=${check.limit}, actual=${check.actual}`
          });
          
          console.error(`[WS] ${errorCode} for ${connId} (codec=${connState.codecName}): limit=${check.limit}, actual=${check.actual}`);
          sendError(ws, errorCode, `Decoded payload ${check.reason}: limit=${check.limit}, actual=${check.actual}`, 1007, connState.codec);
          return;
        }
        
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
        else if (typeof msg.ack === 'string') client.ack(msg.ack);
        else if (typeof msg.nack === 'string') client.nack(msg.nack, msg.delayMs);
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
          sendError(ws, 'UnknownOp', 'Unknown operation', 1003, connState.codec);
        }
      } catch (e: any) {
        // T7112: Fallback error handler for non-decode errors
        wsMetrics.errorsTotal++;
        wsMetrics.errorsByType.set('UnknownError', (wsMetrics.errorsByType.get('UnknownError') || 0) + 1);
        logWsEvent({
          ts: new Date().toISOString(),
          connId,
          ip: clientIp,
          stream,
          error: `UnknownError: ${e?.message || 'Unknown error'}`
        });
        console.error(`[WS] Unknown error for ${connId}: ${e?.message}`);
        sendError(ws, 'InternalError', 'Internal error processing message', 1011, connState.codec);
      }
    });
    
    ws.on('close', (code: number) => {
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
    
    ws.on('error', (error: Error) => {
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
