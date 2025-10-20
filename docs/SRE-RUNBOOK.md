# Conduit SRE Runbook

## Overview

This runbook provides operational guidance for running, monitoring, and troubleshooting Conduit in production.

**Service:** Conduit - Protocol Server for Kernel Transports  
**Ports:** 9087 (HTTP), 9088 (WebSocket)  
**Dependencies:** Redis (optional, for BullMQ queue backend), S3/MinIO (optional, for blob storage)

---

## Health Checks

### Primary Health Endpoint

**GET /health**
- **Purpose:** Basic liveness check
- **Expected Response:** `200 OK` with `{"status":"ok"}` or `503 Service Unavailable` during drain
- **Unprotected:** Always accessible without authentication
- **Use Case:** Load balancer health checks, k8s liveness probes

```bash
curl http://localhost:9087/health
# Expected: {"status":"ok"}
# During drain: {"status":"draining"} with 503 status
```

### Quick CLI (mkctl)

For local checks, use the helper script:

```bash
scripts/mkctl.sh health            # 127.0.0.1:9087 by default
scripts/mkctl.sh metrics
scripts/mkctl.sh reload
```

Pass an alternate host/port as the second argument, e.g. `scripts/mkctl.sh health 10.0.0.5:9087`.

### Metrics Endpoint

**GET /v1/metrics**
- **Purpose:** Comprehensive system metrics
- **Protection:** Can be protected via bearer token (CONDUIT_TOKENS)
- **Response Structure:**
  ```json
  {
    "streams": [
      {
        "id": "stream-name",
        "stats": {
          "depth": 0,
          "inflight": 0,
          "rateIn": 0,
          "rateOut": 0,
          "latP50": 0,
          "latP95": 0,
          "lastTs": "2025-01-01T00:00:00.000Z"
        }
      }
    ],
    "timestamp": "2025-01-01T00:00:00.000Z",
    "uptime": 3600.5,
    "gateway": {
      "http": {
        "rules": {},
        "endpoints": {
          "/v1/enqueue": {
            "requests": 1000,
            "bytes": 50000,
            "errors": 5,
            "errorRate": 0.5
          }
        },
        "uploads": {
          "count": 10,
          "bytes": 10485760,
          "avgMBps": 2.5,
          "latency": {
            "p50Ms": 100,
            "p95Ms": 250,
            "p99Ms": 500
          }
        }
      },
      "ws": {
        "connections": {
          "active": 50,
          "total": 150
        },
        "credit": {
          "granted": 10000,
          "used": 8500,
          "windowUtil": 0.85
        },
        "deliveries": {
          "count": 5000,
          "latency": {
            "p50Ms": 5,
            "p95Ms": 15,
            "p99Ms": 30,
            "avgMs": 7.5
          }
        }
      },
      "errors": {
        "400": 10,
        "401": 5,
        "500": 2
      }
    },
    "tenants": {
      "tenant-id": {
        "activeConnections": 5,
        "totalConnections": 20,
        "messagesDelivered": 1000,
        "bytesDelivered": 50000
      }
    }
  }
  ```

**Key Metrics:**
- **streams**: Per-stream queue statistics
- **gateway.http**: HTTP endpoint counters, latencies, errors
- **gateway.ws**: WebSocket connection and delivery metrics
- **gateway.errors**: HTTP error code distribution
- **tenants**: Per-tenant connection and delivery stats
- **uptime**: Process uptime in seconds

Deployment notes:
- Build dist with `npm run build` and run with `npm run start:dist` or use systemd unit at `docs/systemd/conduit.service` (ExecStart runs `node dist/index.js`).
- Ensure environment variables are exported before the service starts.

---

## Log Files

All logs are written as **JSONL** (JSON Lines) for structured parsing.

### HTTP Gateway Logs

**Location:** `./reports/gateway-http.log.jsonl` (default)  
**Format:** One JSON object per line  
**Fields:**
```json
{
  "ts": "2025-01-01T00:00:00.000Z",
  "method": "POST",
  "url": "/v1/enqueue",
  "status": 200,
  "ip": "192.168.1.100",
  "tenant": "tenant-id",
  "durationMs": 15,
  "bytes": 1024,
  "ruleMatch": "rule-name",
  "integrity": "sha256-abc123..."
}
```

**Parsing Examples:**
```bash
# Count requests by status code
jq -s 'group_by(.status) | map({status: .[0].status, count: length})' reports/gateway-http.log.jsonl

# Find slow requests (>1s)
jq 'select(.durationMs > 1000)' reports/gateway-http.log.jsonl

# Requests by tenant
jq -r '.tenant' reports/gateway-http.log.jsonl | sort | uniq -c

# Top endpoints by request count
jq -r '.url' reports/gateway-http.log.jsonl | sort | uniq -c | sort -rn | head -10
```

### WebSocket Gateway Logs

**Location:** `./reports/gateway-ws.log.jsonl` (default)  
**Format:** One JSON object per line  
**Events:**
- `connect`: New WebSocket connection
- `disconnect`: Connection closed
- `deliver`: Message delivered to client
- `credit`: Credit granted by client
- `ack`/`nack`: Message acknowledgment

```json
{
  "ts": "2025-01-01T00:00:00.000Z",
  "event": "deliver",
  "tenant": "tenant-id",
  "stream": "agents/user123/inbox",
  "msgId": "msg-123",
  "latencyMs": 5,
  "ip": "192.168.1.100"
}
```

### Control Frame Logs

**Location:** Configurable via `CONDUIT_RECORD` environment variable  
**Purpose:** Debug internal control protocol messages between Conduit and backend  
**Format:**
```json
{
  "ts": "2025-01-01T00:00:00.000Z",
  "dir": "in",
  "type": "enqueue",
  "reqId": "req-123",
  "stream": "agents/user123/inbox"
}
```

**Note:** Only enable in development/debugging. Can generate high volume of logs.

---

## Configuration Knobs

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `CONDUIT_HTTP_PORT` | `9087` | HTTP listen port |
| `CONDUIT_WS_PORT` | `9088` | WebSocket listen port |
| `CONDUIT_BIND` | `127.0.0.1` | Bind address |
| `CONDUIT_TOKENS` | `""` | API token allowlist (comma-separated) |
| `CONDUIT_BACKEND` | `demo` | Backend: `demo`, `tcp://host:port`, `unix:///path` |
| `CONDUIT_RULES` | `config/rules.yaml` | DSL rules file path |
| `CONDUIT_TENANT_CONFIG` | `config/tenants.yaml` | Multi-tenant configuration |
| `CONDUIT_BLOB_BACKEND` | `local` | Blob storage: `local`, `s3`, `minio` |
| `CONDUIT_BLOB_LOCAL_DIR` | `/tmp/blobs` | Local blob storage directory |
| `CONDUIT_QUEUE_BACKEND` | `none` | Queue backend: `bullmq`, `none` |
| `CONDUIT_QUEUE_REDIS_URL` | `redis://localhost:6379` | Redis URL for BullMQ |
| `CONDUIT_CORS_ORIGINS` | `""` | CORS origins (comma-separated or `*`) |
| `CONDUIT_HTTP_RATE_LIMIT_ENABLED` | `false` | Enable HTTP rate limiting |
| `CONDUIT_HTTP_RATE_LIMIT_PER_IP` | `100` | Requests per IP per minute |
| `CONDUIT_MAX_CONCURRENT_UPLOADS` | `100` | Max concurrent uploads globally |
| `CONDUIT_MAX_GLOBAL_CONNECTIONS` | `10000` | Max total concurrent connections |
| `CONDUIT_RECORD` | `""` | Control frame log path (debug) |
| `CONDUIT_RECORD_REDACT` | `true` | Redact sensitive fields in logs |
| `CONDUIT_CODECS_HTTP` | `false` | Enable HTTP codec negotiation (msgpack) |
| `CONDUIT_CODECS_WS` | `false` | Enable WebSocket codec negotiation (msgpack) |
| `CONDUIT_DEFAULT_CODEC` | `json` | Default codec when Accept is ambiguous |

### Runtime Configuration

**Rules:** Loaded from `config/rules.yaml` (DSL configuration)  
**Tenants:** Loaded from `config/tenants.yaml` (multi-tenant partitioning)  
**Reload:** Send `SIGHUP` to process for zero-downtime configuration reload  
**Graceful Shutdown:** Send `SIGTERM` or `SIGINT` for graceful shutdown with connection draining

---

## Blob Backend Monitoring

### Local Filesystem

**Directory:** `CONDUIT_BLOB_LOCAL_DIR` (default: `/tmp/blobs`)  
**Monitoring:**
```bash
# Check disk usage
du -sh /tmp/blobs

# Count blobs
find /tmp/blobs -type f | wc -l

# Find large blobs
find /tmp/blobs -type f -size +100M

# Check blob integrity (SHA256 manifest)
ls -lh /tmp/blobs/*.manifest.json
```

**Alerts:**
- Disk space < 10% free
- I/O errors in logs

### S3/MinIO

**Configuration:**
```bash
CONDUIT_BLOB_BACKEND=s3
CONDUIT_BLOB_S3_REGION=us-east-1
CONDUIT_BLOB_S3_BUCKET=uploads
CONDUIT_BLOB_S3_ACCESS_KEY_ID=...
CONDUIT_BLOB_S3_SECRET_ACCESS_KEY=...
```

**Monitoring:**
- CloudWatch metrics: `PutObject`, `GetObject` latencies
- Error rates (5xx)
- Bucket size and object count

**Common Issues:**
- **403 Forbidden:** Check IAM permissions (`s3:PutObject`, `s3:GetObject`)
- **Slow uploads:** Check network latency to S3 endpoint
- **Throttling:** Increase request rate limits or use S3 prefix sharding

---

## Queue Backend Monitoring

### None (Default)

**Characteristics:**
- No async queue backend
- Direct synchronous processing
- Suitable when backend handles queuing (e.g., Courier)

**Monitoring:**
- Monitor backend connection health
- Check control frame logs if enabled (`CONDUIT_RECORD`)

### BullMQ (Redis)

**Configuration:**
```bash
CONDUIT_QUEUE_BACKEND=bullmq
CONDUIT_REDIS_URL=redis://redis.example.com:6379
```

**Monitoring:**
```bash
# Redis memory usage
redis-cli INFO memory

# Queue depth
redis-cli LLEN bull:queue:stream-name

# Failed jobs
redis-cli ZCARD bull:queue:stream-name:failed
```

**Alerts:**
- Redis memory > 80%
- Failed job count increasing
- Redis unavailable (fallback to in-memory)

**Common Issues:**
- **Connection refused:** Check Redis is running and accessible
- **OOM errors:** Increase Redis memory or enable eviction policy
- **Slow dequeue:** Check Redis CPU usage, network latency

---

## Common Issues & Troubleshooting

### 1. High Error Rates

**Symptom:** Increasing `gateway.errors["5xx"]` count in metrics  
**Investigation:**
```bash
# Check recent errors
jq 'select(.status >= 500)' reports/gateway-http.log.jsonl | tail -20

# Group by endpoint
jq -s 'group_by(.url) | map({url: .[0].url, errors: map(select(.status >= 500)) | length})' reports/gateway-http.log.jsonl

# Check error distribution
jq 'select(.status >= 400) | {status, url, tenant}' reports/gateway-http.log.jsonl | tail -50
```

**Common Causes:**
- Backend unavailable (check `CONDUIT_BACKEND` connection)
- Disk full (blob uploads failing)
- Memory exhaustion (restart process)
- Configuration error (check rules.yaml syntax)

**Remediation:**
- Scale horizontally (add more instances)
- Increase resource limits (memory, disk)
- Check upstream dependencies

---

### 2. Message Delivery Stalls

**Symptom:** `streams[].stats.depth` increasing, `rateOut` dropping  
**Investigation:**
```bash
# Check WebSocket connections
curl http://localhost:3000/v1/metrics | jq '.gateway.ws.connections'

# Check credit usage
curl http://localhost:3000/v1/metrics | jq '.gateway.ws.credit'
```

**Common Causes:**
- No active consumers (connections dropped)
- Credit exhaustion (client not granting credit)
- Slow consumer (client processing backlog)

**Remediation:**
- Restart consumer applications
- Check consumer logs for errors
- Increase consumer parallelism
- Check `latP95` - if high, consumer is slow

---

### 3. Authentication Failures

**Symptom:** HTTP 401 errors, `/v1/enqueue` rejections  
**Investigation:**
```bash
# Check auth errors
jq 'select(.status == 401)' reports/gateway-http.log.jsonl

# Verify token configuration
echo $CONDUIT_TOKENS

# Check which endpoints require auth (from rules.yaml)
grep -A 5 "authRequired" config/rules.yaml
```

**Common Causes:**
- Missing or incorrect `Authorization` header
- Token mismatch between gateway and clients
- Token not set in environment

**Remediation:**
- Verify token in client requests: `Authorization: Bearer <token>`
- Check token environment variable on server
- Reload configuration after token change

---

### 4. High Latency

**Symptom:** `latP95` or `latP99` exceeding SLOs  
**Investigation:**
```bash
# Check per-endpoint latencies
curl http://localhost:9087/v1/metrics | jq '.gateway.http.endpoints'

# Check upload latencies
curl http://localhost:9087/v1/metrics | jq '.gateway.http.uploads.latency'

# Analyze latency distribution from logs
jq '.durationMs' reports/gateway-http.log.jsonl | sort -n | tail -100
```

**Common Causes:**
- Slow blob uploads (disk I/O, S3 latency)
- CPU saturation (high rule evaluation overhead)
- Network congestion
- Downstream service slow

**Remediation:**
- Use faster blob backend (local SSD, S3 transfer acceleration)
- Optimize rules (reduce complexity)
- Scale horizontally
- Check network bandwidth

---

### 5. Memory Leaks

**Symptom:** Process memory increasing over time  
**Investigation:**
```bash
# Monitor process memory
ps aux | grep conduit

# Check active connections
curl http://localhost:9087/v1/metrics | jq '.gateway.ws.connections.active'

# Check upload concurrency
curl http://localhost:9087/v1/metrics | jq '.gateway.http.uploads'
```

**Common Causes:**
- Unconsumed messages accumulating in streams
- Large blob uploads not garbage collected
- Connection leaks (WebSockets not closed)

**Remediation:**
- Restart process (temporary)
- Ensure consumers are running and healthy
- Check `gateway.ws.connections.active` for leaks
- Clean up old blobs if using local filesystem

---

## Alert Thresholds

### Critical Alerts

| Metric | Threshold | Action |
|--------|-----------|--------|
| `/health` returning non-200 | Immediate | Page on-call, investigate logs |
| `gateway.errors["5xx"]` rate | > 1% of requests | Check logs, restart if needed |
| `streams[].stats.depth` | > 10,000 | Check consumers, scale if needed |
| Disk usage (blob dir) | > 90% | Clean old blobs, add storage |
| Redis unavailable (BullMQ) | Immediate | Restart Redis, check connectivity |

### Warning Alerts

| Metric | Threshold | Action |
|--------|-----------|--------|
| `gateway.http.endpoints[].errorRate` | > 0.5% | Investigate specific endpoint |
| `gateway.ws.credit.windowUtil` | > 0.95 | Consumers may be credit-starved |
| `latP95` (deliveries) | > 100ms | Check consumer performance |
| `gateway.ws.connections.active` | Sustained high growth | Check for connection leaks |
| Memory usage | > 80% | Plan to scale or restart |

---

## Incident Response Procedures

### 1. Service Down (Health Check Failing)

1. **Check process status:**
   ```bash
   systemctl status conduit  # or docker ps, or pm2 status
   ```

2. **Check logs for errors:**
   ```bash
   tail -n 100 reports/gateway-http.log.jsonl | jq 'select(.status >= 500)'
   journalctl -u conduit -n 100  # systemd logs
   # or check stderr if running directly
   tail -n 100 server.err.log
   ```

3. **Attempt restart:**
   ```bash
   systemctl restart conduit
   # or
   docker restart conduit
   # or for npm dev mode
   npm run dev
   ```

4. **If restart fails, check:**
   - Ports 9087/9088 not in use: `lsof -i :9087 && lsof -i :9088`
   - Dependencies available (Redis if using BullMQ, S3/MinIO if configured)
   - Configuration valid: `npm run build` (TypeScript compilation)
   - Rules YAML syntax: `node -e "require('yaml').parse(require('fs').readFileSync('config/rules.yaml','utf8'))"`

---

### 2. High Error Rate

1. **Identify affected endpoints:**
   ```bash
   curl http://localhost:9087/v1/metrics | jq '.gateway.http.endpoints'
   ```

2. **Check recent errors:**
   ```bash
   jq 'select(.status >= 400) | {ts, url, status, ip, tenant}' reports/gateway-http.log.jsonl | tail -20
   ```

3. **Common fixes:**
   - **401 errors:** Verify `CONDUIT_TOKENS` set correctly, check Authorization header format
   - **500 errors:** Check backend connection (`CONDUIT_BACKEND`), restart if needed
   - **503 errors:** Service overloaded (concurrency limits hit) or draining, scale horizontally
   - **413 errors:** Request too large, check `CONDUIT_MAX_JSON_SIZE` or `CONDUIT_MULTIPART_MAX_PART_SIZE`

---

### 3. Message Backlog Growing

1. **Check WebSocket consumers:**
   ```bash
   curl http://localhost:9087/v1/metrics | jq '.gateway.ws.connections'
   ```

2. **Check per-tenant metrics:**
   ```bash
   curl http://localhost:9087/v1/metrics | jq '.tenants'
   ```

3. **Actions:**
   - Check consumer apps are connected and active
   - Verify credit granting from WebSocket logs:
     ```bash
     jq 'select(.event == "credit")' reports/gateway-ws.log.jsonl | tail -20
     ```
   - Check for slow message delivery:
     ```bash
     jq 'select(.event == "deliver") | .latencyMs' reports/gateway-ws.log.jsonl | sort -n | tail -20
     ```
   - Scale consumer instances if needed

---

## Dashboards

### Recommended Metrics for Grafana

**Health:**
- `/health` status code (should be 200)
- Process uptime

**Throughput:**
- `gateway.http.endpoints[].requests` (rate per second)
- `gateway.ws.deliveries.count` (rate per second)
- `streams[].stats.rateIn` / `rateOut`

**Latency:**
- `gateway.http.endpoints[].latency.p95Ms`
- `gateway.ws.deliveries.latency.p95Ms`
- `streams[].stats.latP95`

**Errors:**
- `gateway.http.endpoints[].errorRate`
- `gateway.errors` breakdown by status code

**Resources:**
- Process memory (from host metrics)
- Disk usage (blob directory)
- Redis memory (if using BullMQ)

---

## Capacity Planning

### Sizing Guidelines

**Small deployment (< 1000 msg/s):**
- 2 CPU cores, 2GB RAM
- Local blob storage (SSD preferred)
- In-memory queue backend

**Medium deployment (1000-10000 msg/s):**
- 4-8 CPU cores, 4-8GB RAM
- S3/MinIO for blobs
- BullMQ with Redis (separate instance)
- Horizontal scaling (2-4 instances behind load balancer)

**Large deployment (> 10000 msg/s):**
- 8+ CPU cores per instance, 16GB+ RAM
- S3 with transfer acceleration
- Redis cluster for BullMQ
- Auto-scaling (5-20 instances)
- Monitoring and alerting (Prometheus + Grafana)

### Scaling Strategies

**Horizontal Scaling:**
- Multiple Courier instances behind load balancer
- Sticky sessions NOT required for HTTP
- WebSocket consumers should use consistent hashing or connection pooling

**Vertical Scaling:**
- Increase CPU for high message throughput
- Increase memory for large queue depths
- Use faster disks (NVMe) for local blob storage

---

## Backup & Recovery

### Critical Data

**Blobs:** If using local filesystem, back up `CONDUIT_BLOB_DIR` regularly
- S3/MinIO provides built-in durability (no manual backup needed)

**Queue State:** 
- In-memory backend: **Not persistent**, data lost on restart
- BullMQ: Persist Redis with RDB or AOF

**Configuration:**
- Back up `config/` directory (rules)
- Version control recommended (git)

### Disaster Recovery

1. **Service restart:** Data intact (if using persistent backends)
2. **Server failure:** Redeploy on new server, restore blobs and configuration
3. **Data loss:** 
   - In-memory queues: Messages lost, clients will retry (if idempotent)
   - BullMQ: Restore Redis from backup

---

## Security Best Practices

1. **Always set `CONDUIT_CONTROL_TOKEN`** in production
2. **Enable `CONDUIT_PROTECT_METRICS=true`** to prevent metric exposure
3. **Use TLS termination** (reverse proxy: nginx, Envoy, Traefik)
4. **Restrict CORS origins** (avoid `*` in production)
5. **Enable rate limiting** to prevent abuse
6. **Rotate tokens** periodically
7. **Monitor logs** for suspicious activity (high 401 rates, unusual IPs)

---

## HTTP Codec Negotiation (Opt-In)

### Enabling Codec Support

**Feature:** T7101 - HTTP request body decoding via codec registry  
**Status:** Opt-in via `CONDUIT_CODECS_HTTP=true`  
**Default:** Disabled (uses JSON-only decoding)

**Configuration:**
```bash
export CONDUIT_CODECS_HTTP=true
npm run dev
```

**Supported Codecs:**
- `application/json` - JSON codec (default)
- `application/msgpack` - MessagePack binary codec
- Structured suffix support: `application/vnd.api+json` auto-detects JSON

**How It Works:**
1. Client sends request with `Content-Type: application/msgpack`
2. Gateway detects codec from Content-Type header
3. Request body decoded using selected codec
4. Decode errors return `400 Bad Request` with error details

**Example Usage:**
```bash
# JSON request (works with or without flag)
curl -X POST http://localhost:9087/v1/enqueue \
  -H "Content-Type: application/json" \
  -d '{"to":"agents/inbox","envelope":{"hello":"world"}}'

# MessagePack request (requires CONDUIT_CODECS_HTTP=true)
curl -X POST http://localhost:9087/v1/enqueue \
  -H "Content-Type: application/msgpack" \
  --data-binary @request.msgpack
```

**Error Responses:**
```json
{
  "error": "Request body decode failed",
  "details": "Invalid MessagePack format",
  "codec": "msgpack"
}
```

**Monitoring:**
- Decode errors logged with `error: 'decode_error'`
- Codec usage tracked in metrics (T7103 - future)
- Check logs: `jq 'select(.error == "decode_error")' reports/gateway-http.log.jsonl`

**Rollback:**
- Set `CONDUIT_CODECS_HTTP=false` or unset to disable
- All requests fallback to JSON decoding when disabled

---

## Binary Codec Usage

### Enabling Codecs

Binary codecs (MessagePack) reduce CPU and bandwidth for high-throughput workloads:

```bash
# Enable HTTP codec negotiation
CONDUIT_CODECS_HTTP=true

# Enable WebSocket codec negotiation
CONDUIT_CODECS_WS=true

# Set default codec when Accept header is ambiguous or */*
CONDUIT_DEFAULT_CODEC=msgpack  # or 'json' (default)
```

### HTTP Examples

**Sending MessagePack request:**
```bash
# Enqueue with msgpack encoding
curl -X POST http://localhost:9087/v1/enqueue \
  -H "Content-Type: application/msgpack" \
  -H "Authorization: Bearer token123" \
  --data-binary @payload.msgpack

# Request msgpack response
curl http://localhost:9087/v1/metrics \
  -H "Accept: application/msgpack" \
  --output metrics.msgpack
```

**Content negotiation with quality values:**
```bash
# Prefer msgpack, fallback to JSON
curl http://localhost:9087/v1/metrics \
  -H "Accept: application/msgpack;q=0.9, application/json;q=0.5"
```

**X-Codec header override (T7102):**
```bash
# Force msgpack response regardless of Accept header
curl http://localhost:9087/v1/metrics \
  -H "X-Codec: msgpack" \
  --output metrics.msgpack

# Force JSON response even with msgpack Accept header
curl http://localhost:9087/v1/metrics \
  -H "Accept: application/msgpack" \
  -H "X-Codec: json"

# Invalid codec falls back to Accept negotiation
curl http://localhost:9087/v1/metrics \
  -H "X-Codec: invalid-codec" \
  -H "Accept: application/json"
```

**Supported Content-Type values:**
- `application/json` (default)
- `application/msgpack`
- `application/x-msgpack`

### WebSocket Examples

**Connect with codec negotiation:**
```bash
# JSON (default)
wscat -c "ws://localhost:9088/v1/subscribe?stream=agents/inbox&codec=json"

# MessagePack binary frames
wscat -c "ws://localhost:9088/v1/subscribe?stream=agents/inbox&codec=msgpack"
```

**Query parameters:**
- `?codec=json` - Use JSON text frames
- `?codec=msgpack` - Use MessagePack binary frames
- No parameter - Defaults to JSON

**Frame types:**
- JSON codec: Text frames (opcode 0x1)
- MessagePack codec: Binary frames (opcode 0x2)

### Performance Considerations

MessagePack typically provides:
- 30-50% smaller payload sizes
- 2-3x faster encode/decode vs JSON
- Suitable for high-volume agent messaging

See `examples/codec-comparison/` for benchmarks.

---

## Useful Commands

```bash
# Check service health
curl http://localhost:9087/health

# Get full metrics
curl http://localhost:9087/v1/metrics | jq .

# Reload configuration (zero-downtime)
kill -HUP $(pgrep -f "node dist/index.js")

# Graceful shutdown
kill -TERM $(pgrep -f "node dist/index.js")

# Count active WebSocket connections
curl http://localhost:9087/v1/metrics | jq '.gateway.ws.connections.active'

# Find slowest endpoints
curl http://localhost:9087/v1/metrics | jq '.gateway.http.endpoints | to_entries | sort_by(.value.latency.p95Ms) | reverse | .[0:5]'

# Check error distribution from logs
jq -s 'group_by(.status) | map({status: .[0].status, count: length})' reports/gateway-http.log.jsonl | jq 'sort_by(.count) | reverse'

# Monitor per-tenant metrics
curl -s http://localhost:9087/v1/metrics | jq '.tenants'

# Check upload throughput
curl -s http://localhost:9087/v1/metrics | jq '.gateway.http.uploads'

# Monitor connection activity in real-time
watch -n 2 "curl -s http://localhost:9087/v1/metrics | jq '{http: .gateway.http.endpoints, ws: .gateway.ws.connections}'"

# Find authentication failures
jq 'select(.status == 401) | {ts, url, ip, tenant}' reports/gateway-http.log.jsonl | tail -20

# Check WebSocket delivery rate
jq 'select(.event == "deliver")' reports/gateway-ws.log.jsonl | wc -l
```

---

## Support & Escalation

**Documentation:** 
- [README.md](../README.md) - Configuration and features
- [OBSERVABILITY.md](./OBSERVABILITY.md) - Logging and monitoring details
- [docs/rfcs/](./rfcs/) - Protocol specifications

**Logs:** Check `reports/gateway-http.log.jsonl`, `reports/gateway-ws.log.jsonl` for errors  
**Metrics:** Always include `/v1/metrics` output in bug reports  
**Configuration:** Include `config/rules.yaml` and `config/tenants.yaml` (redact secrets)

**Escalation Path:**
1. Check this runbook for common issues
2. Review recent configuration changes (`git log config/`)
3. Check dependencies (Redis if using BullMQ, S3/MinIO if configured) are healthy
4. Run load tests to reproduce: `npm run test:load-uploads` or `npm run test:load-ws`
5. Collect logs, metrics, and configuration; open incident ticket
6. Consider rollback if recent deployment caused issue

**Debug Mode:**
```bash
# Enable control frame logging
CONDUIT_RECORD=/tmp/conduit-debug.jsonl npm run dev

# Enable verbose logging (if supported)
DEBUG=conduit:* npm run dev
```
