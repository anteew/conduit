# T7103: HTTP Codec Observability - Implementation Summary

## Overview
Added comprehensive per-codec observability metrics and logging to track codec usage, performance, and errors across the HTTP gateway.

## Implementation Details

### 1. Enhanced Codec Metrics (`src/connectors/http.ts`)

**Replaced simple counters with per-codec tracking:**
```typescript
const codecMetrics = {
  requestsByCodec: Map<string, number>,      // Requests per codec (json, msgpack, cbor)
  bytesInByCodec: Map<string, number>,       // Request bytes per codec
  bytesOutByCodec: Map<string, number>,      // Response bytes per codec
  decodeErrorsByCodec: Map<string, number>   // Decode errors per codec
};
```

**Updated `recordCodecMetrics()` function:**
- Tracks per-codec request counts
- Tracks per-codec bytes in/out
- Tracks per-codec decode errors
- Only runs when `CONDUIT_CODECS_HTTP=true`
- Accepts optional `bytes` parameter for byte tracking

### 2. Added Codec Field to HTTP Logs

**Updated `HttpLogEntry` interface:**
```typescript
interface HttpLogEntry {
  // ... existing fields ...
  codec?: string;  // T7103: Codec used for request (json, msgpack, cbor)
}
```

**Log entries now include codec field:**
```json
{"ts":"2025-10-19T14:23:49.789Z","ip":"127.0.0.1","method":"POST","path":"/v1/enqueue","bytes":512,"status":200,"durMs":8,"codec":"msgpack"}
```

**Added to all HTTP request logs:**
- `/v1/enqueue` (all success/error cases)
- `/v1/queue` (all success/error cases)
- Any endpoint using `decodeBody()`

### 3. Metrics Endpoint Integration

**Updated `getMetricsSummary()` function:**
- Includes codec metrics when `CONDUIT_CODECS_HTTP=true`
- Exposes metrics at `/v1/metrics` under `http.codecs`

**Example metrics output:**
```json
{
  "http": {
    "requestsTotal": 1234,
    "bytesIn": 104857600,
    "bytesOut": 524288,
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

### 4. Response Encoding Metrics

**Updated `send()` function:**
- Tracks encoded response size
- Records per-codec bytes out on successful encoding
- Records encode failures (fallback to JSON)

### 5. Request Decoding Metrics

**Updated `decodeBody()` function:**
- Calculates request body size in bytes
- Records per-codec bytes in on successful decode
- Records per-codec decode errors on failure
- Returns codec name in result object for logging

### 6. Documentation Updates (`docs/OBSERVABILITY.md`)

**Added codec metrics section:**
- Example queries for codec metrics
- Per-codec efficiency calculations
- Log analysis commands

**Example queries:**
```bash
# Get codec usage breakdown
curl -sS http://127.0.0.1:9087/v1/metrics | jq '.http.codecs.requestsByCodec'

# Count requests by codec from logs
cat reports/gateway-http.log.jsonl | jq -r '.codec' | sort | uniq -c

# Find decode errors by codec
cat reports/gateway-http.log.jsonl | jq 'select(.error == "decode_error") | {codec, error, path}'
```

## Feature Flag Behavior

All codec observability features are **gated by `CONDUIT_CODECS_HTTP=true`**:
- When **disabled**: No codec metrics collected, logs don't include codec field
- When **enabled**: Full per-codec tracking and logging

## Operator Benefits

1. **Codec Adoption Tracking**: See which codecs are being used in production
2. **Efficiency Analysis**: Compare bytes in/out across codecs to measure compression
3. **Error Detection**: Identify codec-specific decode/encode issues
4. **Performance Insights**: Correlate codec choice with request duration
5. **Migration Planning**: Monitor codec usage during transitions (e.g., JSON → msgpack)

## Verification

The implementation can be verified when the server is running with `CONDUIT_CODECS_HTTP=true`:

```bash
# Check metrics endpoint includes codec data
CONDUIT_CODECS_HTTP=true npm start &
sleep 2
curl -sS http://127.0.0.1:9087/v1/metrics | jq '.http.codecs'

# Verify logs include codec field
curl -X POST http://127.0.0.1:9087/v1/enqueue \
  -H "Content-Type: application/json" \
  -d '{"to":"test","envelope":{"msg":"test"}}'
cat reports/gateway-http.log.jsonl | tail -1 | jq '.codec'
```

## Files Modified

1. **src/connectors/http.ts**
   - Added `codec` field to `HttpLogEntry` interface (line 45)
   - Replaced codec metrics structure with per-codec maps (lines 373-378)
   - Enhanced `recordCodecMetrics()` with byte tracking (lines 381-403)
   - Updated `send()` to track encoded bytes (line 208)
   - Updated `decodeBody()` to track decoded bytes (lines 533, 552-554, 562-564)
   - Updated `/v1/enqueue` logs to include codec (lines 1340, 1349, 1354, 1361)
   - Updated `/v1/queue` logs to include codec (lines 1386, 1396, 1402, 1417, 1431)
   - Updated `getMetricsSummary()` to include codec metrics (lines 469-477)

2. **docs/OBSERVABILITY.md**
   - Added codec request example (lines 437-439)
   - Added codec metrics to HTTP metrics example (lines 660-682)
   - Added codec metrics query examples section (lines 727-765)

## Status

✅ Implementation complete
✅ All changes behind `CONDUIT_CODECS_HTTP` flag
✅ TypeScript compilation passes (no errors in modified code)
✅ Documentation updated with examples
✅ Ready for operator visibility when feature flag is enabled
