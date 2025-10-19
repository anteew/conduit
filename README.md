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

## Docs
- docs/rfcs/CONTROL-PROTOCOL-v1.md — frames used between Conduit and core.
- docs/rfcs/PROTO-DSL-v0.md — translator DSL for mapping external protocols to frames.
