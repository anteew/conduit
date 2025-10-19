# T4062: 15-Minute Soak Test - Mixed Load

## Overview

Comprehensive stability and endurance test running for 15 minutes with mixed HTTP, WebSocket, and upload traffic to surface memory leaks, connection leaks, and throughput degradation.

## Implementation

**File**: `tests/soak_mixed.test.ts`

### Test Configuration

| Parameter | Value | Description |
|-----------|-------|-------------|
| **Duration** | 15 minutes | Configurable via `CONDUIT_SOAK_DURATION_MIN` |
| **Report Interval** | 30 seconds | Periodic metrics reporting |
| **HTTP Clients** | 20 concurrent | Alternating enqueue + stats requests |
| **WebSocket Clients** | 30 concurrent | Subscribe with credit flow control |
| **Upload Clients** | 10 concurrent | Multipart files 10-100KB each |
| **Memory Sampling** | Every 30s | RSS, heap used, heap total, external |

### Load Profile

#### HTTP Clients (20)
- **Pattern**: Alternate between `/v1/enqueue` POST and `/v1/stats` GET
- **Message payload**: Small JSON with client ID and sequence number
- **Inter-request delay**: 0-100ms random
- **Target rate**: ~200-400 req/s aggregate

#### WebSocket Clients (30)
- **Connection**: Subscribe to individual streams (`agents/SoakWS{id}/inbox`)
- **Flow control**: Initial 10 credit grant, then 5 credit every 1s
- **Message generation**: Self-enqueue via HTTP every 200-500ms
- **Delivery tracking**: Count all `deliver` frames received
- **Target rate**: ~60-150 msg/s aggregate

#### Upload Clients (10)
- **Endpoint**: `/v1/upload` with `application/octet-stream`
- **File size**: Random 10-100KB per upload
- **Content**: Buffer filled with upload metadata
- **Header**: `x-upload-id` for tracking
- **Inter-upload delay**: 500-2000ms random
- **Target rate**: ~5-10 uploads/s aggregate

### Metrics Tracked

**Throughput:**
- HTTP requests (cumulative and per-interval rate)
- WebSocket messages delivered
- Uploads completed
- Active WebSocket connections

**Memory (sampled every 30s):**
- RSS (Resident Set Size)
- Heap Used
- Heap Total
- External memory (buffers, etc.)

**Errors (by type):**
- `http_client`: HTTP request failures
- `ws_enqueue`: Failed to enqueue messages for WS delivery
- `ws_parse`: JSON parse errors on WS messages
- `ws_error`: WebSocket connection errors
- `upload_status`: Upload returned non-2xx status
- `upload_error`: Upload connection errors
- `upload_exception`: Upload client exceptions

### Reporting

#### Interval Reports (Every 30s)

Each report shows:
```
📊 SOAK TEST REPORT — X.X min elapsed
─────────────────────────────────────────

🔄 THROUGHPUT (interval):
  HTTP requests:     XXX.X req/s
  WS messages:       XXX.X msg/s
  Uploads:           XXX.X upload/s

📈 CUMULATIVE:
  HTTP requests:         XXXX
  WS messages:           XXXX
  Uploads:               XXXX
  Active WS:               XX

💾 MEMORY:
  RSS:               XX.XX MB
  Heap Used:         XX.XX MB
  Heap Total:        XX.XX MB
  External:          XX.XX MB

⚠️  ERRORS: (if any)
  error_type           count
```

#### Final Summary

At test completion, provides:

1. **Total Throughput**
   - Total requests processed (HTTP + WS + uploads)
   - Breakdown by type
   - Average rate (req/s)

2. **Memory Analysis**
   - Initial vs final heap usage
   - Growth percentage
   - Trend assessment (stable/growing/leaking)
   - Stability verdict (stable if growth <10% for 15min, <100% for <5min tests)

3. **Connection Stability**
   - Final active WebSocket count
   - Clean shutdown assessment (all connections closed)

4. **Error Summary**
   - Total errors
   - Error rate percentage
   - Assessment (excellent <0.1%, good <1%, acceptable <5%)
   - Breakdown by error type

5. **Stability Assessment (4 Checks)**
   - ✅ **Throughput**: >1000 total requests
   - ✅ **Error rate**: <1%
   - ✅ **Memory stable**: Growth within threshold
   - ✅ **Clean shutdown**: No lingering connections

## Usage

### Run Full 15-Minute Test

```bash
cd /srv/repos0/conduit
npm run build
npm run test:compile
node tests_compiled/soak_mixed.test.js
```

### Override Duration

```bash
# 30-minute soak
CONDUIT_SOAK_DURATION_MIN=30 node tests_compiled/soak_mixed.test.js

# 1-minute quick check
CONDUIT_SOAK_DURATION_MIN=1 node tests_compiled/soak_mixed.test.js
```

### With Upload Directory

```bash
mkdir -p uploads
CONDUIT_UPLOAD_DIR=uploads node tests_compiled/soak_mixed.test.js
```

## Expected Results

For a healthy 15-minute run:

| Metric | Expected Range | Pass Criteria |
|--------|----------------|---------------|
| **Total Requests** | 5,000 - 15,000 | >1,000 |
| **HTTP Requests** | 3,000 - 8,000 | >500 |
| **WS Messages** | 1,500 - 6,000 | >300 |
| **Uploads** | 500 - 1,500 | >100 |
| **Avg Throughput** | 8 - 20 req/s | >1 req/s |
| **Error Rate** | <0.1% | <1% |
| **Memory Growth** | ±10% | <20% for 15min |
| **Active Connections** | 0 at end | 0 |

### Memory Behavior

**Normal:**
- Initial: 8-15 MB heap used
- During test: 15-30 MB (with GC cycles)
- Final: 12-25 MB
- Growth: <20% over 15 minutes

**Warning Signs:**
- Monotonic increase without GC cycles
- >50% growth over 15 minutes
- >100 MB heap for this workload
- Growth continues after test ends

### Error Patterns

**Acceptable:**
- Occasional connection errors (<0.1%)
- Transient upload errors due to timing
- Rare parse errors

**Concerning:**
- >1% error rate
- Consistent `ws_error` on all connections
- Systematic upload failures
- `RateLimitExceeded` errors

## Troubleshooting

### High Error Rate

```bash
# Check server logs
tail -f server.out.log server.err.log

# Check recorded control frames
CONDUIT_RECORD=/tmp/soak.jsonl node tests_compiled/soak_mixed.test.js
node --loader ts-node/esm scripts/tail-frames.ts /tmp/soak.jsonl
```

### Memory Leak Detection

If memory is growing:

1. **Check GC activity**: Run with `--expose-gc` and force GC
2. **Profile heap**: Use `--inspect` and Chrome DevTools
3. **Check event listeners**: Verify WS cleanup removes all listeners
4. **Check timers**: Ensure all `setInterval` are cleared on close

### Connection Leaks

If connections don't close:

```bash
# Monitor active connections
while true; do
  netstat -an | grep -E ':(9087|9088).*ESTABLISHED' | wc -l
  sleep 5
done
```

### Low Throughput

- Check CPU usage (`top`, `htop`)
- Monitor network with `iftop` or `nethogs`
- Verify no rate limiting in effect
- Check for blocking operations in logs

## Integration with CI/CD

### Quick Smoke Test (1 minute)

```bash
CONDUIT_SOAK_DURATION_MIN=1 node tests_compiled/soak_mixed.test.js
# Exit code: 0 = pass, 1 = partial/fail
```

### Nightly Soak (30 minutes)

```bash
CONDUIT_SOAK_DURATION_MIN=30 node tests_compiled/soak_mixed.test.js > soak-report.txt
# Store report as build artifact
```

### Pre-Release Validation (60 minutes)

```bash
CONDUIT_SOAK_DURATION_MIN=60 node tests_compiled/soak_mixed.test.js
# Must pass all 4 checks for release
```

## Comparison with Other Tests

| Test | Focus | Duration | Load | Use Case |
|------|-------|----------|------|----------|
| **perf_small.test.ts** | Latency | 2 min | Burst + sustained HTTP | Latency SLA validation |
| **large_payload.test.ts** | Size limits | 30 sec | Single large payloads | Cap enforcement |
| **ws_bidir.test.ts** | Flow control | 10 sec | Credit flow | Protocol correctness |
| **soak_mixed.test.ts** | Stability | 15 min | Mixed sustained | **Memory/connection leaks** |

## Exit Codes

- `0`: All 4 checks passed
- `1`: Partial pass (1-3 checks) or complete failure

## Future Enhancements

1. **Heap snapshots**: Capture heap dumps at intervals for analysis
2. **CPU profiling**: Track CPU usage per client type
3. **Latency distribution**: Track p50/p95/p99 for all request types
4. **Rate ramping**: Gradually increase load to find breaking point
5. **Chaos injection**: Random connection drops, delays, malformed messages
6. **Memory pressure**: Run with `--max-old-space-size` limits
7. **Multiple backends**: Test with TCP/Unix backends, not just demo
8. **Graceful shutdown**: Test SIGTERM handling during load

## References

- **Control Protocol**: `docs/rfcs/CONTROL-PROTOCOL-v1.md`
- **Test Harness**: `tests/harness.ts`
- **HTTP Connector**: `src/connectors/http.ts`
- **WS Connector**: `src/connectors/ws.ts`

## Validation Status

✅ **Implemented**: Full 15-minute soak test with mixed load
✅ **Configurable**: Duration via `CONDUIT_SOAK_DURATION_MIN`
✅ **Comprehensive metrics**: Throughput, memory, errors, connections
✅ **Automated assessment**: 4-check pass/fail with recommendations
✅ **Documented**: This summary and README section

---

**Created**: 2025-10-19  
**Task**: T4062-Soak-15min  
**Status**: Complete
