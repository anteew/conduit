# Observability

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
| `event` | string | Event type: `http_request_start`, `http_request_complete`, `http_upload_progress` |
| `ip` | string | Client IP address |
| `method` | string | HTTP method (GET, POST, etc.) |
| `path` | string | Request path |
| `bytes` | number | Request body size in bytes (optional) |
| `durMs` | number | Duration in milliseconds (optional) |
| `rateMBps` | number | Transfer rate in MB/s (optional, for uploads) |
| `ruleId` | string | Matched DSL rule ID (optional) |
| `status` | number | HTTP status code (optional) |
| `error` | string | Error code if request failed (optional) |

### Event Types

#### `http_request_start`
Logged when a request is received.

```json
{"ts":"2025-10-19T14:23:45.678Z","event":"http_request_start","ip":"127.0.0.1","method":"POST","path":"/v1/upload","ruleId":"dsl_rule"}
```

#### `http_request_complete`
Logged when a request finishes (success or error).

```json
{"ts":"2025-10-19T14:23:46.789Z","event":"http_request_complete","ip":"127.0.0.1","method":"POST","path":"/v1/upload","bytes":104857600,"durMs":1234,"rateMBps":85.3,"ruleId":"dsl_rule","status":202}
```

#### `http_upload_progress`
Logged every 10MB during large uploads.

```json
{"ts":"2025-10-19T14:23:46.123Z","event":"http_upload_progress","ip":"127.0.0.1","method":"POST","path":"/v1/upload","bytes":10485760,"durMs":456,"rateMBps":23.0,"ruleId":"dsl_rule"}
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
