# Observability

## Control Frame Recording & Replay

Control frame recording captures all internal protocol communication for debugging, replay testing, and issue reproduction—especially critical for edge environments where production issues are hard to debug locally.

### Configuration

```bash
# Enable recording with redaction (recommended for production)
export CONDUIT_RECORD=/var/log/conduit/frames.jsonl
export CONDUIT_RECORD_REDACT=true

# Disable redaction for development/debugging
export CONDUIT_RECORD=/tmp/frames.jsonl
export CONDUIT_RECORD_REDACT=false
```

### Record Format

Each line in the JSONL file contains:
```json
{
  "ts": "2025-10-19T14:23:45.678Z",
  "dir": "in",
  "frame": {
    "type": "enqueue",
    "reqId": "req-abc123",
    "to": "agents/worker/inbox",
    "envelope": {"msg": "hello"}
  }
}
```

**Fields:**
- `ts` - ISO 8601 timestamp
- `dir` - Direction: `in` (received) or `out` (sent)
- `frame` - The control frame object (type-specific fields)

**Redaction:**
Fields `token`, `auth`, `password`, `secret` are automatically redacted when `CONDUIT_RECORD_REDACT=true`.

### Edge Environment Use Cases

#### 1. Reproduce Production Issues Locally

**Scenario:** Bug only manifests in staging/production edge, not local dev.

**Solution:**
```bash
# On edge instance (e.g., staging-us-east-1)
export CONDUIT_RECORD=/var/log/conduit/issue-2025-10-19.jsonl
export CONDUIT_RECORD_REDACT=true
systemctl restart conduit

# Wait for issue to occur (or reproduce manually)
# Download captured frames
scp staging-us-east-1:/var/log/conduit/issue-2025-10-19.jsonl ./

# Analyze locally
cat issue-2025-10-19.jsonl | jq 'select(.frame.type == "error")'

# Replay against local instance (future feature)
node scripts/replay-frames.ts issue-2025-10-19.jsonl --target tcp://localhost:9099
```

#### 2. Multi-Region Traffic Analysis

**Scenario:** Different behavior across edge regions (latency, errors, throughput).

**Solution:**
```bash
# On each region
export CONDUIT_RECORD=/var/log/conduit/$(hostname)-$(date +%Y%m%d-%H).jsonl

# Collect after 1 hour
scp us-east-1:/var/log/conduit/us-east-1-*.jsonl ./us-east.jsonl
scp eu-west-1:/var/log/conduit/eu-west-1-*.jsonl ./eu-west.jsonl

# Compare error rates
echo "US East errors:"
cat us-east.jsonl | jq 'select(.frame.type == "error")' | wc -l
echo "EU West errors:"
cat eu-west.jsonl | jq 'select(.frame.type == "error")' | wc -l

# Compare frame type distributions
jq -r '.frame.type' us-east.jsonl | sort | uniq -c
jq -r '.frame.type' eu-west.jsonl | sort | uniq -c
```

#### 3. Integration Test Fixture Generation

**Scenario:** Need realistic test data for integration tests.

**Solution:**
```bash
# Record known-good scenario
CONDUIT_RECORD=/tests/fixtures/happy-path.jsonl npm run dev

# Trigger test scenario manually
curl -X POST http://localhost:9087/v1/enqueue -d '{"to":"test","envelope":{"msg":"test"}}'

# Stop server, validate fixture
cat /tests/fixtures/happy-path.jsonl | jq 'select(.frame.type == "error")'
# (should be empty)

# Use fixture in automated tests
describe('Happy path replay', () => {
  it('should handle recorded frames', async () => {
    const frames = readFixture('happy-path.jsonl');
    await replayFrames(frames);
    // Assert expected outcomes
  });
});
```

#### 4. Performance Regression Testing

**Scenario:** Need to ensure performance doesn't degrade after code changes.

**Solution:**
```bash
# Record baseline traffic (1 hour)
CONDUIT_RECORD=/benchmarks/baseline-v1.0.jsonl npm start &
sleep 3600 && kill %1

# Apply code changes, record again
CONDUIT_RECORD=/benchmarks/modified-v1.1.jsonl npm start &
sleep 3600 && kill %1

# Compare timing characteristics
jq '.ts' baseline-v1.0.jsonl | head -1000 > baseline-times.txt
jq '.ts' modified-v1.1.jsonl | head -1000 > modified-times.txt
# Analyze time deltas between frames (future: automated tool)
```

### Replay Pipeline (Planned)

The replay pipeline enables deterministic testing and debugging by replaying captured frames.

#### Step 1: Filter & Prepare

**Extract time window:**
```bash
cat production.jsonl | jq -c 'select(.ts >= "2025-10-19T14:00:00Z" and .ts <= "2025-10-19T15:00:00Z")' > window.jsonl
```

**Extract specific stream:**
```bash
cat production.jsonl | jq -c 'select(.frame.to == "agents/worker/inbox")' > worker-inbox.jsonl
```

**Filter by frame type:**
```bash
cat production.jsonl | jq -c 'select(.frame.type == "enqueue")' > enqueues.jsonl
```

**Extract request flow (by reqId):**
```bash
REQ_ID="req-abc123"
cat production.jsonl | jq -c --arg rid "$REQ_ID" 'select(.frame.reqId == $rid)' > request-flow.jsonl
```

**Sanitize sensitive data:**
```bash
cat production.jsonl | jq -c '.frame.auth = "[REDACTED]" | .frame.token = "[REDACTED]"' > sanitized.jsonl
```

#### Step 2: Replay (Future Feature)

**Basic replay:**
```bash
node --loader ts-node/esm scripts/replay-frames.ts filtered.jsonl \
  --target tcp://localhost:9099
```

**Replay at different speeds:**
```bash
# Real-time (preserve original timing)
replay-frames.ts capture.jsonl --speed 1.0

# 10x speed (compress time by 10x)
replay-frames.ts capture.jsonl --speed 10.0

# As fast as possible (ignore timing)
replay-frames.ts capture.jsonl --speed 0
```

**Replay with assertions:**
```bash
# Expect all frames to succeed
replay-frames.ts capture.jsonl --expect-success

# Fail on first error
replay-frames.ts capture.jsonl --fail-on-error

# Record output for comparison
replay-frames.ts capture.jsonl --record-output /tmp/replay-output.jsonl
```

#### Step 3: Compare & Validate

**Compare baseline vs modified:**
```bash
# Extract frame responses only
jq -c 'select(.dir == "out") | .frame' baseline.jsonl > baseline-responses.jsonl
jq -c 'select(.dir == "out") | .frame' modified.jsonl > modified-responses.jsonl

# Diff responses
diff baseline-responses.jsonl modified-responses.jsonl
```

**Validate expected behavior:**
```bash
# Ensure no errors in replay
cat replay-output.jsonl | jq 'select(.frame.type == "error")' | wc -l
# Should output: 0

# Ensure all enqueues succeeded
cat replay-output.jsonl | jq 'select(.frame.type == "ok")' | wc -l
```

### Live Monitoring

**Real-time tailer with color coding:**
```bash
node --loader ts-node/esm scripts/tail-frames.ts /var/log/conduit/frames.jsonl
```

**Filter specific frame types:**
```bash
tail -f frames.jsonl | jq 'select(.frame.type == "error")'
```

**Monitor specific stream:**
```bash
tail -f frames.jsonl | jq --arg stream "agents/worker/inbox" 'select(.frame.to == $stream)'
```

**Watch for slow frames (correlate with high latency):**
```bash
# Stream timestamps, detect gaps >100ms
tail -f frames.jsonl | jq -r '.ts' | while read ts; do
  # Custom script to detect gaps
done
```

### Analyzing Recorded Frames

#### Common Queries

**Count frames by type:**
```bash
cat frames.jsonl | jq -r '.frame.type' | sort | uniq -c
```

**Find all errors:**
```bash
cat frames.jsonl | jq 'select(.frame.type == "error")'
```

**Extract error codes:**
```bash
cat frames.jsonl | jq -r 'select(.frame.type == "error") | .frame.error.code' | sort | uniq -c
```

**Find frames for specific request:**
```bash
REQ_ID="req-abc123"
cat frames.jsonl | jq -c --arg rid "$REQ_ID" 'select(.frame.reqId == $rid)'
```

**Calculate frame rate:**
```bash
TOTAL=$(cat frames.jsonl | wc -l)
START=$(cat frames.jsonl | head -1 | jq -r '.ts')
END=$(cat frames.jsonl | tail -1 | jq -r '.ts')
echo "Frames: $TOTAL from $START to $END"
# Calculate rate: TOTAL / (END - START in seconds)
```

**Correlate with HTTP logs:**
```bash
# Extract timestamp and reqId from both logs
join -j 1 \
  <(jq -r '[.ts, .frame.reqId, .frame.type] | @tsv' frames.jsonl | sort) \
  <(jq -r '[.ts, .path, .status] | @tsv' http.log.jsonl | sort)
```

**Detect frame order anomalies:**
```bash
# Check if response (out) comes before request (in) for same reqId
cat frames.jsonl | jq -r '[.frame.reqId, .dir, .ts] | @tsv' | sort -k1,1 -k3,3
```

### Best Practices

#### Production Edge Deployments

**Always enable redaction:**
```bash
export CONDUIT_RECORD_REDACT=true
```

**Use log rotation:**
```bash
# /etc/logrotate.d/conduit-frames
/var/log/conduit/frames.jsonl {
    hourly
    rotate 24
    compress
    delaycompress
    missingok
    notifempty
    create 0640 conduit conduit
    postrotate
        systemctl reload conduit
    endscript
}
```

**Set retention policies:**
```bash
# Auto-cleanup after 7 days
find /var/log/conduit/*.jsonl -mtime +7 -delete
```

**Encrypt at rest:**
```bash
# Use encrypted volume for /var/log/conduit
cryptsetup luksFormat /dev/xvdf
mount /dev/mapper/conduit-logs /var/log/conduit
```

#### Development & Debugging

**Enable recording for specific test runs:**
```bash
CONDUIT_RECORD=/tmp/test-run-$(date +%s).jsonl npm test
```

**Time-bounded recording:**
```bash
# Record for 10 minutes then stop
timeout 600 env CONDUIT_RECORD=/tmp/capture.jsonl npm start
```

**Conditional recording (only errors):**
```bash
# Future feature: CONDUIT_RECORD_FILTER=error
# For now: post-process
cat all-frames.jsonl | jq 'select(.frame.type == "error")' > errors-only.jsonl
```

### Security Considerations

**Sensitive Data:**
- Always use `CONDUIT_RECORD_REDACT=true` in production
- Envelope payloads are NOT redacted (may contain PII)
- Audit recorded files before sharing

**Access Control:**
```bash
# Restrict access to recordings
chmod 640 /var/log/conduit/frames.jsonl
chown conduit:conduit-admins /var/log/conduit/frames.jsonl
```

**Transfer Security:**
```bash
# Encrypt during transfer
scp -o "Compression=yes" edge:/var/log/conduit/frames.jsonl ./
# Or use rsync with encryption
rsync -avz --compress edge:/var/log/conduit/frames.jsonl ./
```

**Compliance:**
- GDPR: Recordings may contain personal data in envelopes
- HIPAA: Ensure recordings are encrypted at rest and in transit
- PCI: Avoid recording payment card data (use envelope filtering)

## HTTP Gateway JSONL Logging

The HTTP gateway writes structured logs in JSONL (JSON Lines) format for agent-friendly observability and analysis.

### Configuration

Enable logging by setting the `CONDUIT_HTTP_LOG` environment variable:

```bash
export CONDUIT_HTTP_LOG=reports/gateway-http.log.jsonl
```

The gateway will:
- Create the directory if it doesn't exist
- Append to the log file (safe for concurrent writes)
- One JSON object per line (JSONL format)

### Log Format

Each log entry is a single-line JSON object with the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `ts` | string | ISO 8601 timestamp (e.g., `2025-10-19T14:23:45.678Z`) |
| `ip` | string | Client IP address |
| `method` | string | HTTP method (GET, POST, etc.) |
| `path` | string | Request path |
| `bytes` | number | Request body size in bytes (optional) |
| `mode` | string | Upload mode: async, sync (optional) |
| `ruleId` | string | Matched DSL rule ID (optional) |
| `status` | number | HTTP status code |
| `durMs` | number | Duration in milliseconds |
| `rateMBps` | number | Transfer rate in MB/s (optional, for uploads) |
| `error` | string | Error code if request failed (optional) |
| `sha256` | string | File integrity hash from T5013 (optional, for uploads) |
| `mime` | string | File MIME type (optional, for uploads) |
| `size` | number | File size in bytes (optional, for uploads) |

### Example Log Entries

#### Upload with integrity metadata
```json
{"ts":"2025-10-19T14:23:46.789Z","ip":"127.0.0.1","method":"POST","path":"/v1/upload","bytes":104857600,"mode":"async","ruleId":"multipart_upload","status":200,"durMs":1234,"rateMBps":85.3,"sha256":"a3b2c1...","mime":"image/png","size":104857600}
```

#### Request error
```json
{"ts":"2025-10-19T14:23:47.123Z","ip":"127.0.0.1","method":"POST","path":"/v1/enqueue","status":400,"durMs":5,"error":"invalid_json"}
```

#### Metrics request
```json
{"ts":"2025-10-19T14:23:48.456Z","ip":"127.0.0.1","method":"GET","path":"/v1/metrics","status":200,"durMs":12}
```

#### Request with codec (T7103)
```json
{"ts":"2025-10-19T14:23:49.789Z","ip":"127.0.0.1","method":"POST","path":"/v1/enqueue","bytes":512,"status":200,"durMs":8,"codec":"msgpack"}
```

### Error Codes

Common error codes in the `error` field:

- `JSONTooLarge` - JSON body exceeds size limit
- `PayloadTooLarge` - Request body exceeds size limit
- `invalid_json` - Malformed JSON in request
- `enqueue_failed` - Failed to enqueue message
- `missing_stream` - Required stream parameter missing
- `stats_failed` - Failed to retrieve stats
- `metrics_failed` - Failed to retrieve metrics
- `not_found` - Endpoint not found (404)
- `internal_error` - Internal server error (500)

### Analyzing Logs

#### Using `jq`

```bash
# View all logs
cat reports/gateway-http.log.jsonl | jq

# Filter by event type
cat reports/gateway-http.log.jsonl | jq 'select(.event == "http_request_complete")'

# Calculate average duration
cat reports/gateway-http.log.jsonl | jq -s '[.[] | select(.durMs) | .durMs] | add / length'

# Find slow requests (> 1000ms)
cat reports/gateway-http.log.jsonl | jq 'select(.durMs > 1000)'

# Count requests by status code
cat reports/gateway-http.log.jsonl | jq -s 'group_by(.status) | map({status: .[0].status, count: length})'

# Calculate total bytes transferred
cat reports/gateway-http.log.jsonl | jq -s '[.[] | select(.bytes) | .bytes] | add'
```

#### Using `grep`

```bash
# Find errors
grep '"error"' reports/gateway-http.log.jsonl

# Find uploads
grep '/v1/upload' reports/gateway-http.log.jsonl

# Find slow requests
grep -E '"durMs":[0-9]{4,}' reports/gateway-http.log.jsonl
```

#### Real-time monitoring with `tail`

```bash
# Watch logs in real-time
tail -f reports/gateway-http.log.jsonl | jq

# Monitor errors
tail -f reports/gateway-http.log.jsonl | jq 'select(.error)'
```

### Privacy & Security

- **No PII by default**: Logs do not include request/response bodies
- **IP addresses**: Logged for debugging; can be stripped in production if needed
- **Headers**: Not logged (may contain auth tokens)
- **Query parameters**: Not logged (may contain sensitive data)

### Integration with Monitoring Systems

The JSONL format is compatible with:
- **ELK Stack**: Use Filebeat to ship logs to Elasticsearch
- **Prometheus**: Use json_exporter or mtail to extract metrics
- **DataDog/NewRelic**: Use log forwarders with JSON parsing
- **CloudWatch**: Use CloudWatch agent with JSON log format

### Performance

- **Async I/O**: Logs are written asynchronously to minimize latency
- **Buffered writes**: Uses Node.js streams with internal buffering
- **Error handling**: Log write failures do not affect request processing
- **Log rotation**: Use external tools (e.g., `logrotate`) for rotation

### Example: Log Rotation with `logrotate`

```bash
# /etc/logrotate.d/conduit
/srv/repos0/conduit/reports/gateway-http.log.jsonl {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0644 ubuntu ubuntu
}
```

## WebSocket Gateway JSONL Logging

The WebSocket gateway writes structured logs in JSONL format for lifecycle tracking and observability.

### Configuration

Logs are automatically written to `reports/gateway-ws.log.jsonl`.

### Log Format

Each log entry is a single-line JSON object with the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `ts` | string | ISO 8601 timestamp |
| `connId` | string | Unique connection identifier (e.g., `ws-1729350000000-1`) |
| `ip` | string | Client IP address |
| `stream` | string | Stream name (optional) |
| `credit` | number | Credit amount granted by client (optional) |
| `delivers` | number | Total deliveries on this connection (optional) |
| `closeCode` | number | WebSocket close code (optional) |
| `error` | string | Error message or code (optional) |
| `creditRemaining` | number | Credit remaining after delivery (optional) |
| `totalCredit` | number | Total accumulated credit (optional) |
| `durMs` | number | Connection duration in milliseconds (optional) |

### Example Log Entries

#### Connection established
```json
{"ts":"2025-10-19T14:30:00.123Z","connId":"ws-1729350000000-1","ip":"127.0.0.1","stream":"agents/worker/inbox"}
```

#### Credit granted
```json
{"ts":"2025-10-19T14:30:01.234Z","connId":"ws-1729350000000-1","ip":"127.0.0.1","stream":"agents/worker/inbox","credit":10,"totalCredit":10}
```

#### Message delivered
```json
{"ts":"2025-10-19T14:30:02.345Z","connId":"ws-1729350000000-1","ip":"127.0.0.1","stream":"agents/worker/inbox","delivers":1,"creditRemaining":9}
```

#### Connection closed
```json
{"ts":"2025-10-19T14:30:30.456Z","connId":"ws-1729350000000-1","ip":"127.0.0.1","stream":"agents/worker/inbox","closeCode":1000,"delivers":5,"durMs":30333}
```

#### Error
```json
{"ts":"2025-10-19T14:30:00.567Z","connId":"ws-1729350000000-2","ip":"127.0.0.1","stream":"agents/test/inbox","error":"RateLimitExceeded"}
```

### Analyzing Logs

#### Connection lifecycle analysis
```bash
# Find all connections from a specific IP
cat reports/gateway-ws.log.jsonl | jq 'select(.ip == "127.0.0.1")'

# Calculate average connection duration
cat reports/gateway-ws.log.jsonl | jq -s '[.[] | select(.durMs) | .durMs] | add / length'

# Count deliveries by stream
cat reports/gateway-ws.log.jsonl | jq -s 'group_by(.stream) | map({stream: .[0].stream, deliveries: [.[] | select(.delivers) | .delivers] | add})'
```

#### Error tracking
```bash
# Find all errors
cat reports/gateway-ws.log.jsonl | jq 'select(.error)'

# Count errors by type
cat reports/gateway-ws.log.jsonl | jq -r 'select(.error) | .error' | sort | uniq -c

# Find rate limit violations
cat reports/gateway-ws.log.jsonl | jq 'select(.error | contains("RateLimit"))'
```

#### Credit flow analysis
```bash
# Track credit usage for a connection
CONN_ID="ws-1729350000000-1"
cat reports/gateway-ws.log.jsonl | jq --arg id "$CONN_ID" 'select(.connId == $id) | {ts, credit, totalCredit, delivers, creditRemaining}'
```

## Expanded Metrics Endpoint

The `/v1/metrics` endpoint now includes comprehensive HTTP and WebSocket metrics.

### HTTP Metrics

```json
{
  "http": {
    "requestsTotal": 1234,
    "bytesIn": 104857600,
    "bytesOut": 524288,
    "requestsByPath": {
      "/v1/upload": 100,
      "/v1/enqueue": 500,
      "/v1/stats": 634
    },
    "requestsByStatus": {
      "200": 1100,
      "400": 50,
      "500": 84
    },
    "ruleHits": {
      "multipart_upload": 100,
      "enqueue_rule": 500
    },
    "durations": {
      "p50": 45,
      "p95": 250,
      "p99": 1200,
      "count": 1000
    },
    "uploads": {
      "count": 100,
      "bytesTotal": 104857600
    },
    "codecs": {
      "requestsByCodec": {
        "json": 950,
        "msgpack": 200,
        "cbor": 84
      },
      "bytesInByCodec": {
        "json": 95000000,
        "msgpack": 8000000,
        "cbor": 1857600
      },
      "bytesOutByCodec": {
        "json": 450000,
        "msgpack": 60000,
        "cbor": 14288
      },
      "decodeErrorsByCodec": {
        "json": 12,
        "msgpack": 3,
        "cbor": 1
      }
    }
  }
}
```

### WebSocket Metrics

```json
{
  "ws": {
    "connectionsTotal": 50,
    "activeConnections": 12,
    "messagesIn": 5000,
    "messagesOut": 4500,
    "creditsGranted": 10000,
    "deliveriesTotal": 4500,
    "errorsTotal": 15,
    "errorsByType": {
      "RateLimitExceeded": 10,
      "InvalidJSON": 5
    }
  }
}
```

### Querying Metrics

```bash
# Get all metrics
curl -sS http://127.0.0.1:9087/v1/metrics | jq

# Get HTTP request count
curl -sS http://127.0.0.1:9087/v1/metrics | jq '.http.requestsTotal'

# Get WebSocket active connections
curl -sS http://127.0.0.1:9087/v1/metrics | jq '.ws.activeConnections'

# Get p95 latency
curl -sS http://127.0.0.1:9087/v1/metrics | jq '.http.durations.p95'

# Monitor metrics in real-time
watch -n 1 'curl -sS http://127.0.0.1:9087/v1/metrics | jq'
```

### Codec Metrics (T7103, T7120)

When `CONDUIT_CODECS_HTTP=true` is enabled, the metrics endpoint includes per-codec observability data:

```bash
# Get codec usage breakdown
curl -sS http://127.0.0.1:9087/v1/metrics | jq '.http.codecs.requestsByCodec'

# Get bytes transferred by codec
curl -sS http://127.0.0.1:9087/v1/metrics | jq '.http.codecs.bytesInByCodec'

# Get codec decode errors
curl -sS http://127.0.0.1:9087/v1/metrics | jq '.http.codecs.decodeErrorsByCodec'

# Get decoded payload size cap violations (T7120)
curl -sS http://127.0.0.1:9087/v1/metrics | jq '.http.codecs.sizeCapViolations'

# Get decoded payload depth cap violations (T7120)
curl -sS http://127.0.0.1:9087/v1/metrics | jq '.http.codecs.depthCapViolations'

# Calculate efficiency: bytes out vs bytes in for msgpack
curl -sS http://127.0.0.1:9087/v1/metrics | jq '{
  in: .http.codecs.bytesInByCodec.msgpack,
  out: .http.codecs.bytesOutByCodec.msgpack,
  ratio: (.http.codecs.bytesOutByCodec.msgpack / .http.codecs.bytesInByCodec.msgpack)
}'
```

#### Decoded Payload Guardrails (T7120)

Conduit protects against pathological payloads by enforcing limits on decoded payload size and nesting depth:

**Configuration:**
```bash
export CONDUIT_CODEC_MAX_DECODED_SIZE=10485760  # 10MB default
export CONDUIT_CODEC_MAX_DEPTH=32               # 32 levels default
```

**HTTP Behavior:**
- Returns `400 Bad Request` when limits exceeded
- Logs violations with `capViolation`, `capLimit`, and `capActual` fields
- Tracks per-codec violation counts in metrics

**WebSocket Behavior:**
- Closes connection with code `1007 Invalid Frame Payload` when limits exceeded
- Logs violations with limit and actual values
- Tracks per-codec violation counts in metrics

**Monitoring Cap Violations:**
```bash
# HTTP: Find size cap violations in logs
cat reports/gateway-http.log.jsonl | jq 'select(.capViolation == "decoded_size_exceeded")'

# HTTP: Find depth cap violations in logs
cat reports/gateway-http.log.jsonl | jq 'select(.capViolation == "depth_exceeded")'

# WebSocket: Find cap violations in logs
cat reports/gateway-ws.log.jsonl | jq 'select(.error | contains("DecodedSizeExceeded") or contains("DepthExceeded"))'

# Check violation counts from metrics
curl -sS http://127.0.0.1:9087/v1/metrics | jq '{
  http_size: .http.codecs.sizeCapViolations,
  http_depth: .http.codecs.depthCapViolations,
  ws_size: .ws.sizeCapViolations,
  ws_depth: .ws.depthCapViolations
}'
```

#### Codec Log Analysis

When codec metrics are enabled, all HTTP logs include a `codec` field:

```bash
# Count requests by codec from logs
cat reports/gateway-http.log.jsonl | jq -r '.codec' | sort | uniq -c

# Find decode errors by codec
cat reports/gateway-http.log.jsonl | jq 'select(.error == "decode_error") | {codec, error, path}'

# Average request duration by codec
cat reports/gateway-http.log.jsonl | jq -s 'group_by(.codec) | map({
  codec: .[0].codec,
  avgDurMs: ([.[] | .durMs] | add / length)
})'
```
