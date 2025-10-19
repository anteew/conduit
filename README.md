# Conduit — Protocol Server for Kernel Transports

Conduit terminates external transports (HTTP/WS/SSE) and speaks a small, pipe‑native control protocol to core services (e.g., Courier). It enables reuse, edge policies (auth/quotas), and composition without modifying core server code.

## Features

- **Pluggable Blob Storage**: S3, MinIO, or local disk with SHA256 integrity
- **Queue Integration**: BullMQ (Redis) for async work with callbacks
- **DSL-Driven**: Add endpoints via YAML rules, no code changes
- **Reference Pattern**: Agents receive blobRef/queueRef instead of raw data
- **Production-Ready**: Rate limits, auth, CORS, multi-tenancy, zero-downtime reload

## Status
- v1.1: Full blob & queue backend support with examples
- TCP/Unix terminals for connecting to real core services (Courier)
- Wave 6: Load tests and SRE operational documentation

## Quick Start
```bash
npm ci
npm run dev
# HTTP on 127.0.0.1:9087; WS on 127.0.0.1:9088
curl http://127.0.0.1:9087/health
```

## Config (env)

### Server
- CONDUIT_HTTP_PORT=9087, CONDUIT_WS_PORT=9088, CONDUIT_BIND=127.0.0.1
- CONDUIT_BACKEND=demo|tcp://HOST:PORT|unix:///path/sock
- CONDUIT_RULES=config/rules.yaml (DSL rules for endpoint customization)
- CONDUIT_TENANT_CONFIG=config/tenants.yaml (Multi-tenant configuration, T5061)

### Zero-Downtime Reload & Graceful Shutdown (T5060)
- Send SIGHUP to reload configuration without dropping connections
- CONDUIT_RELOAD_DRAIN_TIMEOUT_MS=30000 (drain timeout during reload, default 30s)
- CONDUIT_SHUTDOWN_TIMEOUT_MS=30000 (graceful shutdown timeout, default 30s)
- CONDUIT_DRAIN_REJECT_NEW=false (reject new requests during drain, default false)
- Send SIGTERM or SIGINT for graceful shutdown
- Health check at /health reflects draining status (503 when draining)

### Blob Storage (v1.1)
- CONDUIT_BLOB_BACKEND=local|s3|minio
- CONDUIT_BLOB_LOCAL_DIR=/tmp/blobs
- CONDUIT_BLOB_S3_REGION=us-east-1
- CONDUIT_BLOB_S3_BUCKET=uploads
- CONDUIT_BLOB_S3_ACCESS_KEY_ID=...
- CONDUIT_BLOB_S3_SECRET_ACCESS_KEY=...
- CONDUIT_BLOB_MINIO_ENDPOINT=http://localhost:9000
- CONDUIT_BLOB_MINIO_BUCKET=uploads
- CONDUIT_BLOB_MINIO_ACCESS_KEY=minioadmin
- CONDUIT_BLOB_MINIO_SECRET_KEY=minioadmin

### Queue Backend (v1.1)
- CONDUIT_QUEUE_BACKEND=bullmq|none
- CONDUIT_QUEUE_REDIS_URL=redis://localhost:6379
- CONDUIT_QUEUE_PREFIX=conduit

### Security & Authentication (T5023)
- CONDUIT_TOKENS=dev-local,prod-token (comma-separated API token allowlist)
- CONDUIT_OIDC_ENABLED=false (enable OIDC authentication, stub for future)
- CONDUIT_OIDC_ISSUER=https://auth.example.com (OIDC issuer URL)
- CONDUIT_OIDC_AUDIENCE=api://conduit (expected audience claim)
- CONDUIT_OIDC_JWKS_URI=https://auth.example.com/.well-known/jwks.json (JWKS endpoint)

### CORS Configuration (T5022)
- CONDUIT_CORS_ORIGINS=http://localhost:3000,https://app.example.com (comma-separated allowed origins, or * for all)

### Observability (T5040, T5041, T5042)
- CONDUIT_RECORD=/tmp/conduit.ctrl.jsonl (control frame recording)
- CONDUIT_RECORD_REDACT=true (redact sensitive fields)
- Automatic structured JSONL logging:
  - `reports/gateway-http.log.jsonl` - HTTP requests with integrity metadata
  - `reports/gateway-ws.log.jsonl` - WebSocket lifecycle (connect/credit/deliver/close)
- Expanded /v1/metrics endpoint with:
  - HTTP: requests, bytes, durations (p50/p95/p99), rule hits, status codes
  - WebSocket: connections, messages, credits, deliveries, errors

### Limits
- CONDUIT_MAX_BODY=1000000 (general body, 1MB)
- CONDUIT_MAX_JSON_SIZE=10485760 (JSON body, 10MB)
- CONDUIT_LARGE_THRESHOLD=5242880 (large/binary detection threshold, 5MB, T5020)
- CONDUIT_MAX_HEADER_SIZE=16384 (max total header size, 16KB, T5033)
- CONDUIT_MAX_COOKIE_LENGTH=4096 (max cookie header length, 4KB, T5033)
- CONDUIT_WS_MAX_MESSAGE_SIZE=1048576 (WebSocket message size cap, 1MB, sends close code 1009)
- CONDUIT_WS_MESSAGE_RATE_LIMIT=1000 (messages per minute per connection)

### Timeouts & Keep-Alive (T5032)
- CONDUIT_KEEPALIVE_TIMEOUT_MS=65000 (keep-alive timeout, 65s default)
- CONDUIT_HEADERS_TIMEOUT_MS=60000 (headers timeout for slowloris protection, 60s default)
- CONDUIT_REQUEST_TIMEOUT_MS=300000 (request timeout, 5min default)

### Concurrency Caps (T5031)
- CONDUIT_MAX_CONCURRENT_UPLOADS=100 (max concurrent uploads globally, default 100)
- CONDUIT_MAX_CONCURRENT_UPLOADS_PER_IP=10 (max concurrent uploads per IP, default 10)
- CONDUIT_MAX_GLOBAL_CONNECTIONS=10000 (max total concurrent connections, default 10000)

### Rate Limits & Quotas (T5030)
- CONDUIT_HTTP_RATE_LIMIT_ENABLED=false (enable HTTP rate limiting)
- CONDUIT_HTTP_RATE_LIMIT_PER_IP=100 (default rate per IP per minute)
- CONDUIT_HTTP_RATE_LIMIT_WINDOW_MS=60000 (rate limit window, 1 minute)
- CONDUIT_HTTP_RATE_LIMIT_ENQUEUE=50 (rate for /v1/enqueue per IP per minute)
- CONDUIT_HTTP_BURST_LIMIT_ENQUEUE=100 (burst capacity for /v1/enqueue)
- CONDUIT_HTTP_RATE_LIMIT_UPLOAD=10 (rate for /v1/upload per IP per minute)
- CONDUIT_HTTP_BURST_LIMIT_UPLOAD=20 (burst capacity for /v1/upload)
- CONDUIT_HTTP_RATE_LIMIT_STATS=100 (rate for /v1/stats per IP per minute)
- CONDUIT_HTTP_BURST_LIMIT_STATS=200 (burst capacity for /v1/stats)
- CONDUIT_WS_CONN_RATE_LIMIT=10 (max WebSocket connections per IP per minute, default 10)
- CONDUIT_WS_CONN_RATE_WINDOW_MS=60000 (connection rate window, 1 minute)

### Multi-Tenancy (T5061)
Per-tenant partitioning with isolated limits and metrics:
- Configure tenants in `config/tenants.yaml`
- Token-to-tenant mapping (static tokens or JWT claims)
- Per-tenant rate limits override global limits
- Per-tenant upload concurrency limits
- Per-tenant WebSocket connection limits
- Per-tenant metrics tracking (requests, bytes, uploads, connections, errors)
- Tenant ID extracted from Bearer token or x-tenant-id header
- See config/tenants.yaml for example configuration

## T5010: Multipart Upload Safety Limits (New)
- CONDUIT_MULTIPART_MAX_PARTS=10 (max file parts per request, default 10)
- CONDUIT_MULTIPART_MAX_FIELDS=50 (max form fields, default 50)
- CONDUIT_MULTIPART_MAX_PART_SIZE=104857600 (max file size per part in bytes, default 100MB)
- CONDUIT_UPLOAD_MODE=async (upload mode: async for streaming, sync for buffering, default async)
- CONDUIT_UPLOAD_DIR=/tmp/uploads (upload directory, default /tmp/uploads)

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

For payloads >10MB even when compressed, use multipart upload:

```bash
# Upload single file
curl -X POST http://127.0.0.1:9087/v1/upload \
  -F "file=@large-file.bin"

# Upload multiple files
curl -X POST http://127.0.0.1:9087/v1/upload \
  -F "file=@file1.pdf" \
  -F "file=@file2.jpg" \
  -F "description=test upload"
```

## Multipart Upload with Safety Limits (T5010)

The `/v1/upload` endpoint provides streaming multipart/form-data handling with comprehensive safety limits to prevent abuse and resource exhaustion.

### Safety Limits

**File Limits:**
- Max file parts per request: 10 (configurable via `CONDUIT_MULTIPART_MAX_PARTS`)
- Max file size per part: 100MB (configurable via `CONDUIT_MULTIPART_MAX_PART_SIZE`)
- Exceeds limit → 413 Payload Too Large with detailed error

**Field Limits:**
- Max form fields: 50 (configurable via `CONDUIT_MULTIPART_MAX_FIELDS`)
- Prevents memory exhaustion from excessive metadata

**Response on Limit Exceeded:**
```json
{
  "error": "Upload limits exceeded",
  "code": "PayloadTooLarge",
  "reason": "File count exceeded: 11 > 10",
  "limits": {
    "maxParts": 10,
    "maxFields": 50,
    "maxPartSize": "100MB"
  }
}
```

### Upload Modes

**Async (Default):** Streams files directly to disk with minimal memory usage
```bash
export CONDUIT_UPLOAD_MODE=async
```

**Sync:** Buffers files in memory before writing (use for small files only)
```bash
export CONDUIT_UPLOAD_MODE=sync
```

### Enhanced Logging

The endpoint logs comprehensive metrics:

**Console Output:**
```
[UPLOAD] Mode: async, File: document.pdf, Type: application/pdf, IP: 127.0.0.1
[UPLOAD] File complete: document.pdf, 5242880 bytes, 2.15s, 2.32 MB/s
[UPLOAD] Complete: 2 files, 1 fields, 10485760 bytes, 4.50s, 2.22 MB/s, mode: async
```

**JSONL Logs** (if `CONDUIT_HTTP_LOG` set):
```json
{
  "ts": "2024-10-19T14:30:00.000Z",
  "event": "http_request_complete",
  "ip": "127.0.0.1",
  "method": "POST",
  "path": "/v1/upload",
  "bytes": 10485760,
  "durMs": 4500,
  "rateMBps": 2.22,
  "status": 200
}
```

### Example Usage

**Basic upload:**
```bash
curl -X POST http://127.0.0.1:9087/v1/upload \
  -F "file=@document.pdf"
```

**Response:**
```json
{
  "success": true,
  "mode": "async",
  "fileCount": 1,
  "fieldCount": 0,
  "totalBytes": 3145728,
  "totalDuration": "1.50",
  "totalMbps": "2.00",
  "files": [
    {
      "fieldname": "file",
      "filename": "document.pdf",
      "encoding": "7bit",
      "mimeType": "application/pdf",
      "size": 3145728,
      "path": "/tmp/uploads/1729350000000-document.pdf",
      "duration": "1.50",
      "mbps": "2.00"
    }
  ]
}
```

### Configuration Summary

```bash
# Safety limits
export CONDUIT_MULTIPART_MAX_PARTS=10
export CONDUIT_MULTIPART_MAX_FIELDS=50
export CONDUIT_MULTIPART_MAX_PART_SIZE=104857600  # 100MB

# Upload behavior
export CONDUIT_UPLOAD_MODE=async
export CONDUIT_UPLOAD_DIR=/var/uploads

# Logging
export CONDUIT_HTTP_LOG=reports/gateway-http.log.jsonl
```

### Performance Implications

- **Gzip compression**: 60-80% size reduction for JSON, minimal CPU overhead
- **Parsing limits**: Prevents memory exhaustion from malicious or malformed payloads
- **Streaming**: Large non-JSON uploads stream directly without buffering
- **Security**: Size limits protect against DoS attacks via payload flooding

## Authentication & Authorization (T5023)

Conduit supports API key/token authentication to protect sensitive endpoints.

### Token Allowlist

Configure comma-separated tokens that are allowed to access protected endpoints:

```bash
export CONDUIT_TOKENS=dev-token-123,prod-token-456,test-key-789
npm run dev
```

### Protected Endpoints

The following endpoints require authentication when `CONDUIT_TOKENS` is set:
- `/v1/enqueue` - Message enqueue
- `/v1/upload` - File uploads
- `/v1/stats` - Statistics
- `/v1/snapshot` - State snapshots
- `/v1/admin/reload` - Admin operations

### Providing Tokens

Tokens can be provided via two headers:

**1. Authorization: Bearer** (recommended)
```bash
curl -X POST http://127.0.0.1:9087/v1/enqueue \
  -H "Authorization: Bearer dev-token-123" \
  -H "Content-Type: application/json" \
  -d '{"to":"agents/inbox","envelope":{"type":"test"}}'
```

**2. X-Token header** (alternative)
```bash
curl -X POST http://127.0.0.1:9087/v1/enqueue \
  -H "X-Token: dev-token-123" \
  -H "Content-Type: application/json" \
  -d '{"to":"agents/inbox","envelope":{"type":"test"}}'
```

### Unauthorized Response

Requests without valid tokens receive HTTP 401:

```json
{
  "error": "Unauthorized",
  "message": "Valid API token required. Provide via Authorization: Bearer <token> or X-Token header"
}
```

All failed authentication attempts are logged with client IP for security monitoring.

### OIDC Support (Stub)

OIDC/JWT authentication is planned for future releases. Configuration stubs are available:

```bash
export CONDUIT_OIDC_ENABLED=false
export CONDUIT_OIDC_ISSUER=https://auth.example.com
export CONDUIT_OIDC_AUDIENCE=api://conduit
export CONDUIT_OIDC_JWKS_URI=https://auth.example.com/.well-known/jwks.json
```

When `CONDUIT_OIDC_ENABLED=true`, Conduit will verify JWT tokens from the configured issuer (not yet implemented).

## CORS (Cross-Origin Resource Sharing) (T5022)

Conduit supports configurable CORS for browser-based clients.

### Configuration

Enable CORS by setting allowed origins:

```bash
# Allow specific origins
export CONDUIT_CORS_ORIGINS=http://localhost:3000,https://app.example.com
npm run dev

# Allow all origins (not recommended for production)
export CONDUIT_CORS_ORIGINS=*
npm run dev
```

### Supported Endpoints

CORS is enabled for:
- `/v1/*` - All API endpoints
- `/ui` - Static UI resources

### Preflight Handling

Conduit automatically handles OPTIONS preflight requests:

```bash
curl -X OPTIONS http://127.0.0.1:9087/v1/enqueue \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type,authorization"
```

Response headers:
```
Access-Control-Allow-Origin: http://localhost:3000
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS, PATCH
Access-Control-Allow-Headers: content-type, authorization, x-token
Access-Control-Max-Age: 86400
```

### Browser Example

```javascript
// Browser fetch with CORS
fetch('http://127.0.0.1:9087/v1/enqueue', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer dev-token-123'
  },
  body: JSON.stringify({
    to: 'agents/inbox',
    envelope: { type: 'message', payload: 'hello' }
  })
})
.then(res => res.json())
.then(data => console.log(data));
```

### Rejected Origins

If origin is not in allowlist, OPTIONS returns 403:

```json
{
  "error": "Origin not allowed"
}
```

### Security Notes

- Origins must match exactly (including protocol and port)
- Wildcard `*` allows all origins but disables credential sharing
- Preflight responses are cached for 24 hours (86400 seconds)
- Failed CORS checks are logged with client IP

## Large & Binary Request Detection (T5020)

Conduit automatically detects and routes large or binary payloads to prevent accidental misuse of standard JSON endpoints.

### Auto-Detection

Two detection modes:

**1. Binary MIME Type Detection**
Requests with binary content types are rejected with guidance to use `/v1/upload`:

Binary MIME allowlist:
- `application/octet-stream`
- `application/pdf`, `application/zip`, `application/gzip`
- `image/*` (jpeg, png, gif, webp)
- `video/*` (mp4, mpeg)
- `audio/*` (mpeg, wav)

**2. Size Threshold Detection**
Requests exceeding the size threshold are rejected:

```bash
export CONDUIT_LARGE_THRESHOLD=5242880  # 5MB default
```

### Behavior

When a large/binary request is detected on non-upload endpoints:

```bash
curl -X POST http://127.0.0.1:9087/v1/enqueue \
  -H "Content-Type: application/pdf" \
  -H "Content-Length: 10485760" \
  --data-binary @document.pdf
```

Response (HTTP 413):
```json
{
  "error": "Payload Too Large",
  "code": "PayloadTooLarge",
  "reason": "Binary content type: application/pdf",
  "suggestion": "Use /v1/upload endpoint for large or binary content. Threshold: 5MB"
}
```

### Correct Usage

Route large/binary content to `/v1/upload`:

```bash
# Binary content via octet-stream
curl -X POST http://127.0.0.1:9087/v1/upload \
  -H "Content-Type: application/octet-stream" \
  --data-binary @large-file.bin

# Or use multipart/form-data
curl -X POST http://127.0.0.1:9087/v1/upload \
  -F "file=@document.pdf"
```

### Logging

All detection events are logged:

```json
{
  "ts": "2024-10-19T14:30:00.000Z",
  "event": "http_large_detected",
  "ip": "127.0.0.1",
  "method": "POST",
  "path": "/v1/enqueue",
  "contentType": "application/pdf",
  "bytes": 10485760,
  "reason": "Binary content type: application/pdf"
}
```

### Configuration

```bash
# Adjust detection threshold (default 5MB)
export CONDUIT_LARGE_THRESHOLD=10485760  # 10MB

# Disable by setting very high threshold
export CONDUIT_LARGE_THRESHOLD=1073741824  # 1GB
```

### Design Rationale

- Prevents accidental JSON endpoint misuse for file uploads
- Guides users to proper upload endpoints
- Protects memory/CPU from processing large payloads as JSON
- Provides clear error messages with actionable guidance

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

### Record/Replay for Edge Debugging

Record/replay enables capturing production traffic from edge environments and replaying it locally for debugging, testing, and performance analysis.

#### Use Cases

**1. Reproduce Edge-Only Bugs**
Capture traffic from staging or production edge instances where bugs manifest but are hard to debug:
```bash
# On edge instance
CONDUIT_RECORD=/var/log/conduit/edge-issue.jsonl \
CONDUIT_RECORD_REDACT=true \
npm start
```

**2. Performance Testing with Real Traffic**
Record production traffic patterns and replay locally to benchmark performance improvements:
```bash
# Record 1 hour of production traffic
CONDUIT_RECORD=/data/prod-traffic-$(date +%Y%m%d-%H%M).jsonl npm start
```

**3. Integration Test Generation**
Capture known-good frame sequences to use as integration test fixtures:
```bash
# Record test scenario
CONDUIT_RECORD=/tests/fixtures/happy-path.jsonl npm run dev
# Later: use fixture in automated tests
```

**4. Multi-Region Debugging**
When issues only appear in specific regions/edges, capture frames and replay locally with identical conditions:
```bash
# On edge (e.g., eu-west-1)
CONDUIT_RECORD=/var/log/conduit/eu-west-1-issue.jsonl npm start
# Download and replay locally
```

#### Capture Best Practices

**For production edge environments:**
```bash
# Always redact sensitive fields
export CONDUIT_RECORD=/var/log/conduit/edge-$(hostname)-$(date +%Y%m%d).jsonl
export CONDUIT_RECORD_REDACT=true
# Enable HTTP logging for correlation
export CONDUIT_HTTP_LOG=/var/log/conduit/http-$(hostname)-$(date +%Y%m%d).jsonl
```

**For targeted issue capture:**
```bash
# 1. Enable recording when issue suspected
export CONDUIT_RECORD=/tmp/issue-capture.jsonl
export CONDUIT_RECORD_REDACT=true

# 2. Reproduce issue or wait for occurrence
# 3. Stop recording (restart without CONDUIT_RECORD)
# 4. Analyze captured frames
cat /tmp/issue-capture.jsonl | jq 'select(.frame.type == "error")'
```

**Time-bounded capture:**
```bash
# Capture for 10 minutes then auto-stop
timeout 600 env CONDUIT_RECORD=/tmp/10min-capture.jsonl npm start
```

#### Replay Pipeline (Future)

Recorded frames can be replayed for debugging and testing. The replay pipeline:

**1. Filter & Prepare**
```bash
# Extract specific time window
cat edge-capture.jsonl | jq -c 'select(.ts >= "2025-10-19T14:00:00Z" and .ts <= "2025-10-19T14:30:00Z")' > filtered.jsonl

# Extract specific stream
cat edge-capture.jsonl | jq -c 'select(.frame.to == "agents/worker/inbox")' > stream-specific.jsonl

# Remove sensitive data if not already redacted
cat capture.jsonl | jq -c '.frame.auth = "[REDACTED]" | .frame.token = "[REDACTED]"' > sanitized.jsonl
```

**2. Replay (Planned Feature)**
```bash
# Replay frames against local instance
node --loader ts-node/esm scripts/replay-frames.ts filtered.jsonl \
  --target tcp://localhost:9099 \
  --speed 1.0  # 1.0 = real-time, 10.0 = 10x speed
  
# Replay with assertions
node --loader ts-node/esm scripts/replay-frames.ts filtered.jsonl \
  --expect-success \
  --fail-on-error
```

**3. Compare Outputs**
```bash
# Record baseline
CONDUIT_RECORD=/tmp/baseline.jsonl npm start

# Make code changes, record again
CONDUIT_RECORD=/tmp/modified.jsonl npm start

# Compare frame sequences
diff <(jq -c '.frame' /tmp/baseline.jsonl) <(jq -c '.frame' /tmp/modified.jsonl)
```

#### Analyzing Recorded Frames

**Find error patterns:**
```bash
cat edge-capture.jsonl | jq 'select(.frame.type == "error") | .frame.error'
```

**Count frame types:**
```bash
cat edge-capture.jsonl | jq -r '.frame.type' | sort | uniq -c
```

**Extract timing info:**
```bash
cat edge-capture.jsonl | jq -r '[.ts, .dir, .frame.type] | @csv'
```

**Find frames with specific reqId:**
```bash
cat edge-capture.jsonl | jq -c 'select(.frame.reqId == "req-123")'
```

**Correlate with HTTP logs:**
```bash
# Match timestamps between control frames and HTTP requests
join -j 1 <(jq -r '[.ts, .frame.reqId] | @tsv' frames.jsonl | sort) \
         <(jq -r '[.ts, .path, .status] | @tsv' http.log.jsonl | sort)
```

### Privacy Considerations
- **Default**: Sensitive fields are redacted (`[REDACTED]`)
- **Production**: Always keep `CONDUIT_RECORD_REDACT=true` or omit `CONDUIT_RECORD`
- **Log rotation**: Currently manual; consider logrotate or size-based rotation for long-running services
- **Sensitive data**: Envelope payloads are logged as-is; avoid recording in production if envelopes contain PII
- **Edge deployments**: Ensure recorded files are encrypted at rest and during transfer
- **Retention**: Set automatic cleanup for recordings (e.g., 7-day retention)

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

## Per-Tenant Overlays (T5062)

Conduit supports per-tenant rule overlays for multi-tenant deployments. This enables tenant-specific endpoint customization without requiring separate instances.

### How It Works

Tenant overlays are defined in `config/rules.yaml` under the `tenantOverlays` section. Tenant rules are evaluated **before** base rules, allowing tenants to override or extend default behavior.

```yaml
version: proto-dsl/v0

# Base rules for all tenants
rules:
  - id: health
    when: { http: { path: /health } }
    send: { http: { status: 200, body: { ok: true } } }

# Tenant-specific overlays
tenantOverlays:
  tenant-a:
    rules:
      # Custom webhook for tenant A
      - id: tenant-a-webhook
        when:
          http:
            method: POST
            path: /v1/webhook/incoming
            headers:
              x-tenant-id: tenant-a
        send:
          frame:
            type: enqueue
            fields:
              to: agents/tenant-a/webhooks/inbox
              envelope: $body
            respond:
              http:
                status: 202
                body:
                  accepted: true
                  tenant: tenant-a
```

### Evaluation Order

1. **Tenant overlay rules** (if `x-tenant-id` header present and overlay exists)
2. **Base rules** (default for all tenants)
3. **Hardcoded endpoints** (fallback for backward compatibility)

### Common Use Cases

**1. Tenant-specific webhooks:**
```yaml
tenantOverlays:
  premium-corp:
    rules:
      - id: premium-webhook
        when:
          http:
            path: /v1/webhook/events
            headers:
              x-tenant-id: premium-corp
        send:
          frame:
            type: enqueue
            fields:
              to: agents/premium-corp/events/inbox
              envelope: $body
```

**2. Enhanced security for specific tenants:**
```yaml
tenantOverlays:
  secure-tenant:
    rules:
      - id: secure-enqueue
        when:
          http:
            method: POST
            path: /v1/enqueue
            headers:
              x-tenant-id: secure-tenant
              authorization: "Bearer *"
              x-api-key: "*"
        send:
          frame:
            type: enqueue
            fields:
              to: agents/secure-tenant/$body.to
              envelope: $body.envelope
```

**3. Custom error formats:**
```yaml
tenantOverlays:
  enterprise-tenant:
    rules:
      - id: enterprise-snapshot
        when:
          http:
            path: /v1/snapshot
            headers:
              x-tenant-id: enterprise-tenant
        send:
          frame:
            type: snapshot
            fields:
              view: $query.view
          respond:
            http:
              status: 200
              body:
                status: success
                tenant: enterprise-tenant
                data: $result
        onError:
          UnknownView:
            http:
              status: 404
              body:
                errorCode: VIEW_NOT_FOUND
                tenant: enterprise-tenant
                support: support@enterprise.com
```

### Testing Tenant Overlays

```bash
# Test tenant-specific endpoint
curl -H "x-tenant-id: tenant-a" \
     -X POST http://localhost:9087/v1/webhook/incoming \
     -d '{"event":"test","data":"payload"}'

# Test with different tenant (falls back to base rules)
curl -H "x-tenant-id: tenant-b" \
     -X POST http://localhost:9087/v1/enqueue \
     -d '{"to":"stream","envelope":{"type":"test"}}'

# Test without tenant header (uses base rules)
curl -X GET http://localhost:9087/health
```

### Best Practices

**✅ Use overlays for:**
- Tenant-specific webhook endpoints
- Custom authentication requirements per tenant
- Tenant-specific error formats and response structures
- Stream namespace isolation (prefix with tenant ID)

**❌ Don't use overlays for:**
- Complete data isolation (use separate instances)
- Different performance SLAs (use separate instances)
- Compliance-required physical separation

**Security:**
- Always validate tenant identity via headers
- Namespace tenant streams: `agents/{tenant-id}/{stream}`
- Log tenant rule matches for audit trails
- Avoid exposing tenant IDs in URLs

**Performance:**
- Overlay evaluation adds ~0.1ms per request
- Use specific path matchers (avoid wildcards when possible)
- 100 tenants × 10 rules = ~50KB memory overhead

See [docs/RULES-REFERENCE.md#per-tenant-overlays](docs/RULES-REFERENCE.md#per-tenant-overlays) for complete documentation.

## WebSocket Message Size Caps (T5050)

Conduit enforces per-message size limits for WebSocket messages to prevent memory exhaustion and abuse.

### Configuration

```bash
# Set max message size (default: 1MB)
CONDUIT_WS_MAX_MESSAGE_SIZE=1048576
```

### Behavior on Size Exceeded

When a message exceeds the configured size limit:

1. Connection receives error frame:
```json
{
  "error": {
    "code": "MessageTooLarge",
    "message": "Message size 2097152 exceeds limit 1048576"
  }
}
```

2. Connection is closed with WebSocket code **1009** (Message Too Big)
3. Event is logged with size details

### Security Benefits

- **DoS protection**: Prevents memory exhaustion from oversized messages
- **Fair resource sharing**: All connections subject to same size limits
- **Early rejection**: Messages rejected before JSON parsing

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

## WebSocket Sticky Sessions (T5053)

When deploying Conduit behind a load balancer with multiple instances, WebSocket connections require sticky sessions to maintain state continuity.

### Why Sticky Sessions?

WebSocket connections are stateful and maintain:
- **Credit windows**: Per-connection delivery limits
- **Rate limit buckets**: Per-connection token buckets
- **Subscription state**: Active stream subscriptions
- **Connection tracking**: Tenant connection counts

Without sticky sessions, a WebSocket connection may route to different backend instances, losing state and causing:
- Delivery failures (lost credit window)
- Rate limit bypass or false violations
- Duplicate subscriptions
- Incorrect tenant quotas

### Load Balancer Configuration

#### nginx

```nginx
upstream conduit_ws {
    ip_hash;  # Client IP-based sticky sessions
    server 127.0.0.1:9088;
    server 127.0.0.1:9089;
    server 127.0.0.1:9090;
}

server {
    listen 443 ssl;
    server_name ws.example.com;

    location /v1/subscribe {
        proxy_pass http://conduit_ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        
        # Connection timeout for long-lived WebSockets
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

#### HAProxy

```haproxy
frontend websocket_frontend
    bind *:443 ssl crt /etc/ssl/certs/example.pem
    default_backend conduit_ws

backend conduit_ws
    balance source  # Source IP-based sticky sessions
    hash-type consistent
    
    # WebSocket upgrade
    option http-server-close
    option forwardfor
    
    server conduit1 127.0.0.1:9088 check
    server conduit2 127.0.0.1:9089 check
    server conduit3 127.0.0.1:9090 check
```

#### AWS Application Load Balancer

Enable sticky sessions (session affinity) in target group settings:

```bash
# Via AWS CLI
aws elbv2 modify-target-group-attributes \
    --target-group-arn arn:aws:elasticloadbalancing:region:account-id:targetgroup/conduit-ws/xxx \
    --attributes Key=stickiness.enabled,Value=true \
                 Key=stickiness.type,Value=lb_cookie \
                 Key=stickiness.lb_cookie.duration_seconds,Value=86400
```

Or via AWS Console:
1. Navigate to Target Groups → Select your Conduit WS target group
2. Attributes tab → Edit
3. Enable "Stickiness"
4. Duration: 86400 seconds (24 hours)

#### Kubernetes Ingress (nginx-ingress)

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: conduit-ws
  annotations:
    nginx.ingress.kubernetes.io/affinity: "cookie"
    nginx.ingress.kubernetes.io/session-cookie-name: "conduit-ws-route"
    nginx.ingress.kubernetes.io/session-cookie-max-age: "86400"
    nginx.ingress.kubernetes.io/session-cookie-expires: "86400"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
spec:
  rules:
  - host: ws.example.com
    http:
      paths:
      - path: /v1/subscribe
        pathType: Prefix
        backend:
          service:
            name: conduit-ws
            port:
              number: 9088
```

### Verification

Test sticky sessions by connecting multiple times from the same client:

```bash
# Connect, send credit, verify connId in logs
wscat -c "ws://your-lb.example.com/v1/subscribe?stream=test" \
      -H "Authorization: Bearer your-token"

# Send credit
> {"credit": 10}

# Check backend logs - connId should remain consistent across reconnects from same IP
tail -f reports/gateway-ws.log.jsonl | grep ws_connect
```

### Alternative: Stateless Design

For full horizontal scalability without sticky sessions, consider:

1. **Shared state backend**: Store credit windows in Redis
2. **Stateless credit**: Let backend manage all flow control
3. **Connection migration**: Implement reconnection protocol with state recovery

These require significant architectural changes and are not currently supported.

### Best Practices

✅ **Do:**
- Enable sticky sessions for WebSocket endpoints
- Use IP-based or cookie-based affinity
- Set appropriate session timeout (≥ typical connection duration)
- Monitor connection distribution across backends

❌ **Don't:**
- Use round-robin without sticky sessions
- Set session timeout < connection lifetime
- Mix HTTP and WebSocket traffic on same upstream (separate them)

## HTTP/WS Rate Limits & Quotas (T5030)

Conduit implements token-bucket rate limiting with burst capacity for both HTTP endpoints and WebSocket connections.

### Configuration

#### HTTP Rate Limiting

```bash
# Enable HTTP rate limiting
export CONDUIT_HTTP_RATE_LIMIT_ENABLED=true

# Default rate and window
export CONDUIT_HTTP_RATE_LIMIT_PER_IP=100  # requests per minute per IP
export CONDUIT_HTTP_RATE_LIMIT_WINDOW_MS=60000  # 1 minute

# Per-endpoint rate limits (requests per minute per IP)
export CONDUIT_HTTP_RATE_LIMIT_ENQUEUE=50
export CONDUIT_HTTP_RATE_LIMIT_UPLOAD=10
export CONDUIT_HTTP_RATE_LIMIT_STATS=100

# Per-endpoint burst capacity (allows short bursts)
export CONDUIT_HTTP_BURST_LIMIT_ENQUEUE=100  # 2x rate
export CONDUIT_HTTP_BURST_LIMIT_UPLOAD=20
export CONDUIT_HTTP_BURST_LIMIT_STATS=200
```

#### WebSocket Rate Limiting

```bash
# Message rate limiting (per connection)
export CONDUIT_WS_MESSAGE_RATE_LIMIT=1000  # messages per minute
export CONDUIT_WS_RATE_WINDOW_MS=60000

# Connection rate limiting (per IP)
export CONDUIT_WS_CONN_RATE_LIMIT=10  # connections per minute per IP
export CONDUIT_WS_CONN_RATE_WINDOW_MS=60000
```

### How It Works

**Token Bucket Algorithm:**
- Each IP:endpoint pair gets a token bucket
- Tokens refill continuously at the configured rate
- Burst capacity allows short-term spikes
- Smooth rate enforcement over time (not fixed windows)

**Example:** `/v1/enqueue` with rate=50/min, burst=100:
1. Bucket starts with 100 tokens (burst capacity)
2. Each request consumes 1 token
3. Tokens refill at 50/60s = 0.833 tokens/sec
4. Client can burst 100 requests immediately
5. Then sustain 50 requests/min indefinitely

### Behavior on Rate Limit Exceeded

**HTTP endpoints:**
```json
{
  "error": "Too many requests",
  "code": "TooManyRequests",
  "message": "Rate limit exceeded for /v1/enqueue"
}
```

Response includes HTTP 429 with `Retry-After` header indicating seconds until next token available.

**WebSocket connections:**
```json
{
  "error": {
    "code": "ConnectionRateLimitExceeded",
    "message": "Too many connection attempts from your IP"
  }
}
```

Connection closed with code 1008 (Policy Violation).

### Exempt Endpoints

The following endpoints are exempt from rate limiting:
- `/health` - Health checks
- `/perf` - Performance metrics
- `/ui` - Static UI resources

### Security & Fairness

- **DoS protection**: Prevents request flooding per IP
- **Burst tolerance**: Allows legitimate traffic spikes
- **Fair resource sharing**: Per-IP limits prevent monopolization
- **Smooth enforcement**: Continuous token refill, not fixed windows
- **Memory efficient**: Stale buckets cleaned up automatically

### Per-Endpoint Strategy

**`/v1/enqueue` (rate=50, burst=100):**
- Moderate rate for message enqueueing
- 2x burst for batch operations

**`/v1/upload` (rate=10, burst=20):**
- Low rate due to resource intensity
- Small burst for multi-file uploads

**`/v1/stats` (rate=100, burst=200):**
- High rate for frequent polling
- Large burst for dashboards

### Best Practices

✅ **Do:**
- Set burst capacity 2-3x higher than rate for bursty workloads
- Monitor rate limit violations per endpoint
- Use per-endpoint limits based on resource cost
- Set appropriate `Retry-After` for client backoff

❌ **Don't:**
- Set burst = rate (defeats purpose of burst capacity)
- Exempt heavy endpoints from rate limiting
- Use rate limits as replacement for authentication
- Set rate limits below legitimate usage patterns

### Monitoring

Rate limit events are logged with:
- Client IP
- Endpoint
- Current token count
- Retry-after duration

JSONL log entry:
```json
{
  "ts": "2024-10-19T14:30:00.000Z",
  "event": "http_rate_limited",
  "ip": "192.168.1.100",
  "path": "/v1/enqueue",
  "retryAfter": 5
}
```

## HTTP Concurrency Caps (T5031)

Conduit implements connection and upload concurrency limits to ensure fair resource sharing and prevent resource exhaustion.

### Configuration

```bash
# Max concurrent uploads globally (default: 100)
export CONDUIT_MAX_CONCURRENT_UPLOADS=100

# Max concurrent uploads per IP (default: 10)
export CONDUIT_MAX_CONCURRENT_UPLOADS_PER_IP=10

# Max total concurrent connections (default: 10000)
export CONDUIT_MAX_GLOBAL_CONNECTIONS=10000
```

### How It Works

**Global Connection Limit:**
- Applies to all HTTP requests across all endpoints
- Checked at request start before any processing
- Returns 503 immediately when limit exceeded

**Upload Concurrency:**
- Separate limit for `/v1/upload` endpoint
- Both global and per-IP limits enforced
- Prevents a single client monopolizing upload capacity

### Behavior on Limit Exceeded

**Global connections exceeded:**
```json
{
  "error": "Service Unavailable",
  "code": "TooManyConnections",
  "message": "Global connection limit exceeded",
  "limit": 10000
}
```

**Upload limits exceeded:**
```json
{
  "error": "Service Unavailable",
  "code": "TooManyUploads",
  "message": "Too many concurrent uploads",
  "limit": 100
}
```

**Per-IP upload limit:**
```json
{
  "error": "Service Unavailable",
  "code": "TooManyUploadsPerIp",
  "message": "Too many concurrent uploads from your IP",
  "limit": 10
}
```

All responses include HTTP 503 with `Retry-After: 10` or `Retry-After: 30` headers.

### Security & Fairness

- **DoS protection**: Prevents connection and upload flooding
- **Fair resource sharing**: Per-IP limits prevent monopolization
- **Graceful degradation**: Returns 503 with retry guidance
- **Real-time tracking**: Concurrency cleaned up on connection close

### Best Practices

- Set `CONDUIT_MAX_GLOBAL_CONNECTIONS` based on available memory and file descriptors
- Set `CONDUIT_MAX_CONCURRENT_UPLOADS` lower than global connections (uploads are resource-intensive)
- Set `CONDUIT_MAX_CONCURRENT_UPLOADS_PER_IP` to prevent single client abuse (5-20 recommended)
- Monitor `activeGlobalConnections` and `activeUploads` metrics

## HTTP Timeouts & Keep-Alive (T5032)

Conduit implements configurable timeouts and keep-alive settings to protect against slowloris attacks and manage long-lived connections.

### Configuration

```bash
# Keep-alive timeout (default: 65s, slightly longer than typical LB timeout)
export CONDUIT_KEEPALIVE_TIMEOUT_MS=65000

# Headers timeout (slowloris protection, default: 60s)
export CONDUIT_HEADERS_TIMEOUT_MS=60000

# Request timeout (max request duration, default: 5 minutes)
export CONDUIT_REQUEST_TIMEOUT_MS=300000
```

### How It Works

**Keep-Alive Timeout:**
- Controls idle timeout for persistent HTTP/1.1 connections
- Should be slightly longer than load balancer timeouts (typically 60s)
- Prevents connection pool exhaustion

**Headers Timeout:**
- Maximum time to receive complete request headers
- Protects against slowloris attacks (slow header transmission)
- Enforced before request processing begins

**Request Timeout:**
- Maximum time for entire request/response cycle
- Applies to long-running uploads or processing
- Socket destroyed on timeout

### Behavior on Timeout

When a timeout occurs:
1. Event is logged: `[HTTP] Request timeout from <IP>`
2. Socket is destroyed immediately
3. Client receives connection reset

JSONL log entry:
```json
{
  "ts": "2024-10-19T14:30:00.000Z",
  "event": "http_timeout",
  "ip": "192.168.1.100",
  "error": "RequestTimeout"
}
```

### Security Benefits

- **Slowloris protection**: Headers timeout prevents slow header attacks
- **Resource management**: Keep-alive timeout prevents connection exhaustion
- **Fair resource sharing**: Request timeout prevents single request monopolizing server
- **DoS mitigation**: All timeouts protect against various timing-based attacks

### Best Practices

- Set `CONDUIT_KEEPALIVE_TIMEOUT_MS` slightly higher than your load balancer timeout
- Set `CONDUIT_HEADERS_TIMEOUT_MS` low enough to block slowloris but high enough for slow networks (30-60s recommended)
- Set `CONDUIT_REQUEST_TIMEOUT_MS` based on your longest legitimate request (large uploads may need 10+ minutes)

## HTTP Header Size Limits (T5033)

Conduit enforces header size limits to prevent memory exhaustion and DoS attacks via oversized headers.

### Configuration

```bash
# Max total header size (default: 16KB)
export CONDUIT_MAX_HEADER_SIZE=16384

# Max cookie header length (default: 4KB)
export CONDUIT_MAX_COOKIE_LENGTH=4096
```

### Behavior on Limit Exceeded

When headers or cookies exceed the configured limits, Conduit returns HTTP 431:

```json
{
  "error": "Request Header Fields Too Large",
  "code": "RequestHeaderFieldsTooLarge",
  "size": 20480,
  "limit": 16384
}
```

or for cookies:

```json
{
  "error": "Cookie Too Large",
  "code": "CookieTooLarge",
  "size": 5120,
  "limit": 4096
}
```

### Security Benefits

- **DoS protection**: Prevents memory exhaustion from oversized headers
- **Early rejection**: Headers checked before request processing
- **Compliance**: Follows HTTP 431 Request Header Fields Too Large standard
- **Logging**: All violations logged with client IP and size details

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

### Load Tests (T5070, T5071)

**T5070-Concurrent-Uploads-100** (concurrent_uploads.test.ts):
- 100 concurrent clients uploading files
- Mixed file sizes: 1KB to 10MB
- 60-second load duration
- Measures: throughput (MB/s, req/s), latency (p50/p95/p99), error types, memory footprint
- Reports: request summary, status codes, concurrency levels, memory stability

```bash
npm run test:load-uploads
```

**T5071-Concurrent-WS-100** (concurrent_ws.test.ts):
- 100 concurrent WebSocket connections
- Message delivery with credit flow
- 60-second sustained test
- Measures: connection rate (conn/sec), delivery throughput (msg/sec), latency, memory usage
- Reports: connection metrics, message flow, credit utilization, error rates

```bash
npm run test:load-ws
```

Both tests include automatic memory monitoring and stability assessment. Tests PASS if:
- Connection/upload success rate >95%
- Error rate <5%
- Memory growth <200MB
- No memory leaks detected

## Docs
- docs/rfcs/CONTROL-PROTOCOL-v1.md — frames used between Conduit and core.
- docs/rfcs/PROTO-DSL-v0.md — translator DSL for mapping external protocols to frames.
- docs/OBSERVABILITY.md — structured JSONL logging for agent-friendly observability.

## Future Enhancements (Wave 8 Explorations)

Wave 8 completed three exploratory research tasks for v1.2+ roadmap:

- **HTTP/2 & HTTP/3:** [docs/rfcs/T5090-HTTP2-HTTP3-EXPLORATION.md](docs/rfcs/T5090-HTTP2-HTTP3-EXPLORATION.md)
  - HTTP/2 production-ready via Node.js `http2` module (v1.2 target)
  - 40-70% latency reduction for concurrent requests
  - HTTP/3 deferred to v2.0 pending ecosystem maturity
  
- **Resumable/Chunked Uploads:** [docs/rfcs/GATEWAY-HTTP-UX.md](docs/rfcs/GATEWAY-HTTP-UX.md#13-resumablechunked-uploads-t5091---design) (Section 13)
  - Four-phase protocol: initiate → upload chunks → query status → finalize
  - Failure recovery with chunk-level tracking and SHA256 validation
  - Integration with blob system (T5010/T5011) for blobRef generation
  
- **CBOR/MessagePack Codecs:** [docs/rfcs/PROTO-DSL-v0.md](docs/rfcs/PROTO-DSL-v0.md#14a-cbor--messagepack-codec-option-t5092---design-exploration) (Section 14a)
  - 35-37% size reduction, 70% CPU reduction for control frames
  - Opt-in per-transport: Serial/BLE use CBOR, HTTP/WS keep JSONL
  - Backward compatible with existing deployments

See [WAVE8-EXPLORATION-SUMMARY.md](WAVE8-EXPLORATION-SUMMARY.md) for complete findings and roadmap recommendations.
