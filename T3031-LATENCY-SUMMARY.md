# T3031: Latency Measurement Implementation

## Overview
Enhanced `tests/perf_small.test.ts` with comprehensive latency tracking and percentile analysis under various load conditions.

## Implementation Details

### Features Added
1. **Per-request timing**: High-resolution timing using `process.hrtime.bigint()` for microsecond accuracy
2. **Statistics**: min, max, mean, median (p50), p95, p99 percentiles
3. **Histogram**: 7-bucket latency distribution (<1ms, 1-5ms, 5-10ms, 10-20ms, 20-50ms, 50-100ms, >100ms)
4. **Visual reporting**: Bar charts and formatted output with target validation

### Test Scenarios
1. **Sequential Baseline**: 100 requests, no concurrency - pure latency measurement
2. **Low Load**: 1 concurrent, 1000 requests - minimal contention
3. **Medium Load**: 10 concurrent, 2000 requests - moderate contention
4. **High Load**: 50 concurrent, 5000 requests - high contention
5. **Sustained Load**: 10 concurrent, 60 seconds continuous - stability test

## Benchmark Results

### Sequential Baseline
- **p50 (median)**: 1.698 ms
- **p95**: 3.387 ms
- **p99**: 28.503 ms
- **Throughput**: 456.62 req/sec

### Low Load (1 concurrent)
- **p50**: 1.253 ms
- **p95**: 1.890 ms ✓ (target: <10ms)
- **p99**: 2.179 ms
- **Throughput**: 736.38 req/sec
- **Distribution**: 90.3% of requests in 1-5ms range

### Medium Load (10 concurrent)
- **p50**: 1.605 ms
- **p95**: 4.226 ms ✓ (target: <10ms)
- **p99**: 5.960 ms
- **Throughput**: 3,007.52 req/sec
- **Distribution**: 87.8% in 1-5ms, 10.1% sub-millisecond

### High Load (50 concurrent)
- **p50**: 5.421 ms
- **p95**: 11.827 ms ✗ (target: <10ms) - **FAILED**
- **p99**: 35.006 ms
- **Throughput**: 4,432.62 req/sec
- **Distribution**: 42.5% in 1-5ms, 49.9% in 5-10ms
- **Issue**: Contention at 50 concurrent connections pushes p95 above target

### Sustained Load (60 seconds)
- **p50**: 1.215 ms
- **p95**: 2.432 ms ✓ (target: <10ms)
- **p99**: 2.716 ms
- **Throughput**: 7,292.20 req/sec
- **Total requests**: 437,532 in 60 seconds
- **Stability**: Excellent - 96.3% in 1-5ms range, very stable over time

## Analysis

### Key Findings

1. **Baseline Performance**: Sequential latency shows ~1.7ms median, indicating efficient DSL interpreter and routing logic

2. **Scalability**:
   - Linear performance degradation up to 10 concurrent
   - Good throughput scaling (736 → 3,007 → 4,432 req/sec)
   - p95 crosses target threshold at 50 concurrent

3. **Stability**: Sustained test shows excellent stability with 437K+ requests maintaining p95 < 2.5ms

4. **Bottleneck Identification**: 
   - High load (50 concurrent) shows bimodal distribution
   - Likely I/O or connection pool saturation
   - 6.7% of requests in 10-50ms range suggest queueing delays

### Sequential vs Concurrent Performance

| Metric | Sequential | Low (1c) | Medium (10c) | High (50c) |
|--------|-----------|---------|--------------|-----------|
| p50    | 1.698 ms  | 1.253 ms | 1.605 ms    | 5.421 ms  |
| p95    | 3.387 ms  | 1.890 ms | 4.226 ms    | 11.827 ms |
| p99    | 28.503 ms | 2.179 ms | 5.960 ms    | 35.006 ms |
| Throughput | 456.6 | 736.4   | 3,007.5     | 4,432.6   |

**Observations**:
- Concurrent execution improves throughput significantly
- p95 latency remains excellent up to 10 concurrent
- p99 shows outliers in sequential and high-load scenarios

## Target Validation

**Target**: p95 < 10ms for small messages

| Test Scenario | p95 | Status |
|--------------|-----|--------|
| Sequential   | 3.387 ms | ✓ PASS |
| Low Load     | 1.890 ms | ✓ PASS |
| Medium Load  | 4.226 ms | ✓ PASS |
| High Load    | 11.827 ms | ✗ FAIL |
| Sustained    | 2.432 ms | ✓ PASS |

**Result**: 4/5 scenarios meet target. High load scenario requires optimization.

## Recommendations

1. **Connection Pooling**: Investigate HTTP connection management at 50+ concurrent
2. **Backpressure**: Consider implementing flow control for high concurrency
3. **Resource Limits**: Profile CPU/memory usage under high load
4. **Queue Management**: Analyze DSL interpreter queue behavior
5. **Target Adjustment**: Consider 50 concurrent as edge case; 10 concurrent shows excellent performance

## Time-to-First-Byte (TTFB)

Current implementation measures end-to-end latency including:
- Network round-trip
- Server request parsing
- DSL rule evaluation
- Envelope routing
- Response serialization

All measured times include full TTFB + response time. For sub-millisecond requests, TTFB dominates.

## DSL Interpreter Overhead

Estimated overhead from sequential baseline:
- Minimum latency: 1.279 ms
- Likely breakdown:
  - Network/HTTP: ~0.5-0.8 ms
  - DSL parsing/eval: ~0.3-0.5 ms
  - Routing: ~0.2-0.3 ms

Low overhead suggests efficient DSL implementation.

## Verification

```bash
cd /srv/repos0/conduit
npm run bench:small
```

## Files Modified
- `tests/perf_small.test.ts` - Complete rewrite with latency tracking
