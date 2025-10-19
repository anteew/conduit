# Conduit — Protocol Server for Kernel Transports

Conduit terminates external transports (HTTP/WS/SSE) and speaks a small, pipe‑native control protocol to core services (e.g., Courier). It enables reuse, edge policies (auth/quotas), and composition without modifying core server code.

## Status
- Stage 2 skeleton: HTTP, WS, SSE connectors; in‑process demo backend; control protocol client; record/replay hook.
- Next: add TCP/Unix terminals; extract from demo backend to target a real core service.

## Quick Start
```bash
npm ci
npm run dev
# HTTP on 127.0.0.1:9087; WS on 127.0.0.1:9088
curl http://127.0.0.1:9087/health
```

## Config (env)
- CONDUIT_HTTP_PORT=9087, CONDUIT_WS_PORT=9088, CONDUIT_BIND=127.0.0.1
- CONDUIT_TOKENS=dev-local (optional edge Bearer allowlist)
- CONDUIT_RECORD=/tmp/conduit.ctrl.jsonl (optional control frame recording)
- CONDUIT_RECORD_REDACT=true (default: redact sensitive fields like token/auth)
- CONDUIT_RULES=config/rules.yaml (optional DSL rule file for endpoint customization)
- CONDUIT_MAX_BODY=1000000 (general body size limit, default 1MB)
- CONDUIT_MAX_JSON_SIZE=10485760 (JSON body size limit, default 10MB)
- CONDUIT_HTTP_LOG=reports/gateway-http.log.jsonl (optional structured JSONL logging for HTTP requests)
- CONDUIT_WS_MESSAGE_RATE_LIMIT=1000 (max messages per window per WebSocket connection, default 1000)
- CONDUIT_WS_RATE_WINDOW_MS=60000 (rate limit window in milliseconds, default 60000)

## JSON Body Size Limits & Compression

### Size Limits

Conduit enforces separate size limits for JSON and non-JSON payloads:

- **General bodies**: 1MB default (`CONDUIT_MAX_BODY`)
- **JSON bodies**: 10MB default (`CONDUIT_MAX_JSON_SIZE`)

When a JSON request exceeds the limit, Conduit returns HTTP 413 with guidance:

```json
{
  "error": "JSON body exceeds 10MB limit",
  "code": "JSONTooLarge",
  "suggestion": "Consider using gzip compression (Content-Encoding: gzip) or multipart upload for large data"
}
```

All oversized JSON attempts are logged with client IP for security monitoring.

### Using Gzip Compression

For large JSON payloads, use gzip compression to reduce transfer size:

```bash
# Compress and send JSON with curl
echo '{"large": "data..."}' | gzip | curl -X POST \
  -H "Content-Type: application/json" \
  -H "Content-Encoding: gzip" \
  --data-binary @- \
  http://127.0.0.1:9087/v1/enqueue
```

**Node.js example:**
```javascript
const zlib = require('zlib');
const https = require('https');

const data = JSON.stringify({ large: 'payload...' });
const compressed = zlib.gzipSync(data);

const req = https.request({
  hostname: '127.0.0.1',
  port: 9087,
  path: '/v1/enqueue',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Encoding': 'gzip',
    'Content-Length': compressed.length
  }
});
req.write(compressed);
req.end();
```

### When to Use Multipart Upload

For payloads >10MB even when compressed, use multipart upload (`application/octet-stream`):

```bash
curl -X POST \
  -H "Content-Type: application/octet-stream" \
  --data-binary @large-file.bin \
  http://127.0.0.1:9087/v1/upload
```

See upload endpoint documentation for chunk streaming and progress tracking.

### Performance Implications

- **Gzip compression**: 60-80% size reduction for JSON, minimal CPU overhead
- **Parsing limits**: Prevents memory exhaustion from malicious or malformed payloads
- **Streaming**: Large non-JSON uploads stream directly without buffering
- **Security**: Size limits protect against DoS attacks via payload flooding

## Control Frame Recording & Debugging

Conduit supports JSONL-based recording of all control frames for debugging and reproducibility.

### Enable Recording
```bash
CONDUIT_RECORD=/tmp/conduit.ctrl.jsonl npm run dev
```

Each frame is logged as a JSON line with:
- `ts`: ISO timestamp
- `dir`: Direction (`in` or `out`)
- `frame`: The control frame itself

By default, sensitive fields (`token`, `auth`, `password`, `secret`) are redacted. To disable:
```bash
CONDUIT_RECORD=/tmp/frames.jsonl CONDUIT_RECORD_REDACT=false npm run dev
```

### Live Tailer
Monitor frames in real-time with color-coded output:
```bash
node --loader ts-node/esm scripts/tail-frames.ts /tmp/conduit.ctrl.jsonl
# Or if CONDUIT_RECORD is set:
CONDUIT_RECORD=/tmp/conduit.ctrl.jsonl node --loader ts-node/esm scripts/tail-frames.ts
```

The tailer shows:
- **Timestamp** (dimmed, millisecond precision)
- **Direction** (← in, → out, color-coded)
- **Frame type** (color-coded: hello/magenta, ok/green, error/red, enqueue/blue, etc.)
- **Key fields** (reqId, to, stream, id, n, code)

### Replay Patterns (Future)
Recorded frames can be replayed for:
- Integration testing with known frame sequences
- Reproducing bugs from production logs
- Performance benchmarking with real traffic patterns

### Privacy Considerations
- **Default**: Sensitive fields are redacted (`[REDACTED]`)
- **Production**: Always keep `CONDUIT_RECORD_REDACT=true` or omit `CONDUIT_RECORD`
- **Log rotation**: Currently manual; consider logrotate or size-based rotation for long-running services
- **Sensitive data**: Envelope payloads are logged as-is; avoid recording in production if envelopes contain PII

## DSL Rules

Conduit supports declarative endpoint configuration via YAML rules. When `CONDUIT_RULES` is set, DSL rules take priority; hardcoded endpoints act as fallback for backward compatibility.

### Complete Default Rules

A comprehensive `config/rules.yaml` is provided with complete parity to all hardcoded endpoints:

**HTTP Endpoints:**
- `GET /health` - Health check with version and feature list
- `POST /v1/enqueue` - Enqueue message to stream
- `GET /v1/stats?stream=X` - Get stream statistics
- `GET /v1/snapshot?view=X` - Get view snapshot
- `GET /v1/metrics` - Get system metrics

**WebSocket Endpoints:**
- Connection to `/v1/subscribe?stream=X` - Subscribe to stream
- Message `{credit: N}` - Grant credit (flow control)
- Message `{ack: "id"}` - Acknowledge message
- Message `{nack: "id", delayMs: N}` - Negative acknowledge with delay

**Error Handling:**
All endpoints include comprehensive error mappings with appropriate HTTP status codes and WebSocket close codes.

### Example Rule

```yaml
version: proto-dsl/v0

rules:
  - id: http-enqueue
    when:
      http:
        method: POST
        path: /v1/enqueue
    send:
      frame:
        type: enqueue
        fields:
          to: $body.to
          envelope: $body.envelope
        respond:
          http:
            status: 200
            body: $result
    onError:
      InvalidJSON:
        http:
          status: 400
          body:
            error: invalid json
```

### Selectors

Extract data from requests using:
- `$body.field` - Request body field
- `$query.param` - Query parameter
- `$headers.name` - Request header
- `$method` - HTTP method
- `$path` - Request path
- `$message.field` - WebSocket message field
- `$result` - Frame operation result
- `$error` - Error details

### Extending with Custom Endpoints

To add custom endpoints, edit `config/rules.yaml`:

**Example: Add custom status endpoint**
```yaml
rules:
  - id: custom-status
    when:
      http:
        method: GET
        path: /status
    send:
      http:
        status: 200
        body:
          service: conduit
          uptime: $uptime
          custom: true
```

**Example: Add authenticated endpoint**
```yaml
rules:
  - id: secure-enqueue
    when:
      http:
        method: POST
        path: /v1/secure/enqueue
        headers:
          authorization: "Bearer secret-token"
    send:
      frame:
        type: enqueue
        fields:
          to: $body.to
          envelope: $body.envelope
        respond:
          http:
            status: 200
            body: $result
    onError:
      Unauthorized:
        http:
          status: 401
          body:
            error: Unauthorized
```

**Example: Add custom WebSocket operation**
```yaml
rules:
  - id: ws-message-pause
    when:
      ws:
        message:
          json.has: pause
    send:
      frame:
        type: grant
        fields:
          credit: 0
```

### Common Customizations

**1. Change response format:**
```yaml
send:
  frame:
    type: enqueue
    fields:
      to: $body.to
      envelope: $body.envelope
    respond:
      http:
        status: 202
        body:
          success: true
          messageId: $result.id
          timestamp: $result.ts
```

**2. Add custom error handling:**
```yaml
onError:
  RateLimited:
    http:
      status: 429
      body:
        error: RateLimited
        message: Too many requests
        retryAfter: 60
```

**3. Path wildcards:**
```yaml
when:
  http:
    method: GET
    path: /v1/streams/*
```

**4. Multiple conditions:**
```yaml
when:
  all:
    - http:
        method: POST
        path: /v1/enqueue
    - http:
        headers:
          content-type: application/json
```

See [docs/rfcs/PROTO-DSL-v0.md](docs/rfcs/PROTO-DSL-v0.md) for complete DSL specification.

## WebSocket Rate Limiting

Conduit implements per-connection rate limiting for WebSocket messages to ensure fairness and prevent abuse.

### How It Works

- **Token bucket algorithm**: Each connection gets its own token bucket that refills continuously
- **Per-connection tracking**: Rate limits apply per `connId`, not per IP (multiple connections from same client are independent)
- **Burst allowance**: Allows short bursts while enforcing average rate over time window
- **Graceful closure**: On rate limit violation, sends error frame then closes with code 1008 (Policy Violation)

### Configuration

```bash
# Allow 1000 messages per minute per connection
CONDUIT_WS_MESSAGE_RATE_LIMIT=1000
CONDUIT_WS_RATE_WINDOW_MS=60000
```

**Default**: 1000 messages per 60 seconds (16.6 msgs/sec average)

### Behavior on Rate Limit Exceeded

1. Connection receives error frame:
```json
{
  "error": {
    "code": "RateLimitExceeded",
    "message": "Message rate limit exceeded"
  }
}
```

2. Connection is closed with WebSocket code **1008** (Policy Violation)
3. Event is logged: `[WS] Rate limit exceeded for connection ws-123-...`

### Token Bucket Details

- **Tokens refill continuously** at average rate (e.g., 16.6/sec for default 1000/60s)
- **Burst capacity**: Full bucket size = `CONDUIT_WS_MESSAGE_RATE_LIMIT`
- **Message cost**: 1 token per message
- **Window sliding**: Smooth token refill, not fixed window reset

This allows clients to burst up to the full limit, then sustain at the average rate indefinitely.

### Security & Fairness

- **Per-connection isolation**: One slow/abusive connection doesn't affect others
- **Memory efficient**: Token buckets cleaned up on connection close
- **DoS protection**: Prevents message flooding attacks
- **Fair resource sharing**: All connections get equal message budget

### Disabling Rate Limiting

Set `CONDUIT_WS_MESSAGE_RATE_LIMIT=0` or `CONDUIT_WS_RATE_WINDOW_MS=0` to disable.

## Testing

### Test Suite

Conduit includes comprehensive testing for stability and performance:

| Test | Purpose | Duration | Load Profile |
|------|---------|----------|--------------|
| **http_bidir.test.ts** | HTTP bidirectional flow | ~5s | Sequential enqueue + stats |
| **ws_bidir.test.ts** | WebSocket credit flow | ~10s | Credit grant + delivery |
| **T3022-ws-errors.test.ts** | WebSocket error handling | ~5s | Error scenarios |
| **perf_small.test.ts** | Latency benchmark | ~2min | Up to 50 concurrent, 60s sustained |
| **large_payload.test.ts** | Large payload handling | ~30s | 1MB-10MB payloads |
| **json_cap.test.ts** | JSON size limits | ~10s | Size cap enforcement |
| **soak_mixed.test.ts** | 15-min stability soak | 15min | Mixed HTTP/WS/upload load |

### Running Tests

```bash
# Build first
npm run build

# Individual tests
npm run test:compile && node tests_compiled/http_bidir.test.js
npm run test:compile && node tests_compiled/ws_bidir.test.js

# Performance benchmarks
npm run bench:small
npm run bench:large

# Soak test (15 minutes)
npm run test:compile && node tests_compiled/soak_mixed.test.js
```

### Soak Test (T4062)

The **soak_mixed.test.ts** runs for 15 minutes with:

- **20 HTTP clients**: Alternating enqueue and stats requests
- **30 WebSocket clients**: Subscribe with credit flow
- **10 Upload clients**: 10-100KB multipart uploads

**Metrics tracked:**
- Throughput (requests/sec)
- Memory usage (RSS, heap)
- Active connections
- Error rates and types

**Reports every 30 seconds** showing:
- Request counts and rates
- Memory snapshots
- Connection stability
- Error distribution

**Final assessment includes:**
- ✅ Throughput (>1000 requests)
- ✅ Error rate (<1%)
- ✅ Memory stability (growth <10%)
- ✅ Clean shutdown (no lingering connections)

**Configuration:**
```bash
# Override duration (default: 15 minutes)
CONDUIT_SOAK_DURATION_MIN=30 npm run test:compile && node tests_compiled/soak_mixed.test.js

# With upload directory
CONDUIT_UPLOAD_DIR=uploads npm run test:compile && node tests_compiled/soak_mixed.test.js
```

**Expected results:**
- 5,000-15,000 total requests over 15 minutes
- <0.1% error rate
- Stable memory (±10% growth)
- All connections closed cleanly

Use this test to detect memory leaks, connection leaks, and throughput degradation under sustained mixed load.

## Docs
- docs/rfcs/CONTROL-PROTOCOL-v1.md — frames used between Conduit and core.
- docs/rfcs/PROTO-DSL-v0.md — translator DSL for mapping external protocols to frames.
- docs/OBSERVABILITY.md — structured JSONL logging for agent-friendly observability.
