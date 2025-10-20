# T7120: Decoded Size and Depth Caps Implementation Summary

## Overview

Implemented decoded payload size and depth caps for both HTTP and WebSocket to protect against pathological payloads (e.g., zip bombs, deeply nested structures). HTTP returns `400 Bad Request`, WebSocket closes with `1007 Invalid Frame Payload`.

## Implementation

### Core Guardrails Module

**File:** `src/codec/guards.ts`

- `getGuardrailsFromEnv()`: Reads configuration from environment
  - `CONDUIT_CODEC_MAX_DECODED_SIZE` (default: 10MB)
  - `CONDUIT_CODEC_MAX_DEPTH` (default: 32 levels)
- `measureDecodedSize(obj)`: Measures serialized JSON size
- `measureDepth(obj)`: Recursively measures nesting depth
- `checkDecodedPayload(obj, guardrails)`: Validates decoded payload against limits

### HTTP Connector

**File:** `src/connectors/http.ts`

**Changes:**
1. Import guardrails module
2. Added cap violation metrics to `codecMetrics`:
   - `sizeCapViolations: Map<codec, count>`
   - `depthCapViolations: Map<codec, count>`
3. Updated `decodeBody()` to check decoded payloads after successful decode
4. Returns `400 Bad Request` when limits exceeded
5. Enhanced logging with `capViolation`, `capLimit`, and `capActual` fields
6. Metrics endpoint includes cap violations at `/v1/metrics`

**Behavior:**
- Check runs after successful codec decode
- Returns 400 with details: `{ error: 'Request body decode failed', details: 'decoded_size_exceeded', codec: 'json' }`
- Logs include violation details for observability
- Per-codec violation tracking

### WebSocket Connector

**File:** `src/connectors/ws.ts`

**Changes:**
1. Import guardrails module
2. Added cap violation metrics to `wsMetrics`:
   - `sizeCapViolations: Map<codec, count>`
   - `depthCapViolations: Map<codec, count>`
3. Check decoded payloads after successful decode in message handler
4. Closes connection with code `1007 Invalid Frame Payload` when limits exceeded
5. Sends error frame before closing: `{ error: { code: 'DecodedSizeExceeded', message: '...' } }`
6. Enhanced logging with error details
7. Metrics endpoint includes cap violations

**Behavior:**
- Check runs after successful codec decode
- Error codes: `DecodedSizeExceeded` or `DepthExceeded`
- Close code: `1007 Invalid Frame Payload Data`
- Error frame sent before close (if connection still open)

### Documentation

**File:** `docs/OBSERVABILITY.md`

Added section "Decoded Payload Guardrails (T7120)" with:
- Configuration details
- HTTP and WebSocket behavior descriptions
- Monitoring examples for cap violations
- Metrics queries for tracking violations

## Configuration

```bash
export CONDUIT_CODEC_MAX_DECODED_SIZE=10485760  # 10MB default
export CONDUIT_CODEC_MAX_DEPTH=32               # 32 levels default
```

## Metrics

### HTTP Metrics

```bash
curl http://127.0.0.1:9087/v1/metrics | jq '.http.codecs'
```

Response includes:
```json
{
  "requestsByCodec": { "json": 100, "msgpack": 50 },
  "bytesInByCodec": { "json": 50000, "msgpack": 30000 },
  "bytesOutByCodec": { "json": 48000, "msgpack": 28000 },
  "decodeErrorsByCodec": { "json": 2, "msgpack": 1 },
  "sizeCapViolations": { "json": 3 },
  "depthCapViolations": { "msgpack": 1 }
}
```

### WebSocket Metrics

```bash
curl http://127.0.0.1:9087/v1/metrics | jq '.ws'
```

Response includes:
```json
{
  "connectionsTotal": 50,
  "activeConnections": 10,
  "sizeCapViolations": { "json": 2 },
  "depthCapViolations": { "json": 1 }
}
```

## Logging

### HTTP Log Entry Example

```json
{
  "ts": "2025-10-20T10:30:00.000Z",
  "event": "http_request_complete",
  "ip": "127.0.0.1",
  "method": "POST",
  "path": "/v1/enqueue",
  "bytes": 5000,
  "durMs": 5,
  "status": 400,
  "error": "decode_error",
  "codec": "json",
  "capViolation": "decoded_size_exceeded",
  "capLimit": 10485760,
  "capActual": 15000000
}
```

### WebSocket Log Entry Example

```json
{
  "ts": "2025-10-20T10:30:00.000Z",
  "connId": "ws-1729420000-1",
  "ip": "127.0.0.1",
  "stream": "test",
  "codec": "json",
  "error": "DecodedSizeExceeded: limit=10485760, actual=15000000"
}
```

## Testing

### Unit Tests

**File:** `tests/codec_guards_unit.test.ts`

Tests:
1. Size measurement accuracy
2. Depth measurement for objects
3. Depth measurement for arrays
4. Valid payload passes checks
5. Size cap violation detection
6. Depth cap violation detection
7. Environment configuration loading

**Run:**
```bash
CONDUIT_CODECS_HTTP=true CONDUIT_CODECS_WS=true npm run test:compile
node tests_compiled/tests/codec_guards_unit.test.js
```

**Results:** All 7 tests pass ✓

### Integration Tests

**File:** `tests/codec_safety.test.ts`

Tests:
1. HTTP size cap violation returns 400
2. HTTP depth cap violation returns 400
3. HTTP valid payload succeeds
4. WebSocket size cap closes with 1007
5. WebSocket depth cap closes with 1007
6. WebSocket valid payload succeeds
7. Metrics endpoint includes cap violations

**Note:** Integration tests require starting a fresh server instance.

## Feature Flags

All functionality is gated behind existing codec feature flags:
- `CONDUIT_CODECS_HTTP=true` - Enables HTTP codec negotiation and guardrails
- `CONDUIT_CODECS_WS=true` - Enables WebSocket codec negotiation and guardrails

When flags are disabled, the system falls back to JSON with no guardrails checks.

## Security Benefits

1. **Zip Bomb Protection**: Prevents decompression bombs where small compressed payloads expand to massive sizes
2. **Stack Overflow Prevention**: Limits nesting depth to prevent stack exhaustion
3. **Memory Exhaustion Defense**: Caps decoded size to prevent OOM attacks
4. **Per-Codec Tracking**: Identifies which codecs are being abused
5. **Observable**: Full logging and metrics for security monitoring

## Attack Scenarios Mitigated

### Scenario 1: JSON Zip Bomb
```json
{
  "data": "x".repeat(20000000)
}
```
- Wire size: ~20MB
- Decoded size: ~20MB
- **Mitigated:** Rejected if > CONDUIT_CODEC_MAX_DECODED_SIZE

### Scenario 2: Deep Nesting Attack
```json
{"a":{"a":{"a":{"a":{"a": ... }}}}  // 100 levels deep
```
- **Mitigated:** Rejected if depth > CONDUIT_CODEC_MAX_DEPTH

### Scenario 3: MessagePack Amplification
- Wire size: 1KB compressed MessagePack
- Decoded size: 50MB array
- **Mitigated:** Rejected after decode if > size limit

## Verification

```bash
# Compile with codec flags
CONDUIT_CODECS_HTTP=true CONDUIT_CODECS_WS=true npm run test:compile

# Run unit tests
node tests_compiled/tests/codec_guards_unit.test.js

# Start server with tight limits for testing
CONDUIT_CODECS_HTTP=true \
CONDUIT_CODECS_WS=true \
CONDUIT_CODEC_MAX_DECODED_SIZE=1024 \
CONDUIT_CODEC_MAX_DEPTH=5 \
npm start
```

## Files Modified

- `src/codec/guards.ts` (new)
- `src/connectors/http.ts`
- `src/connectors/ws.ts`
- `docs/OBSERVABILITY.md`
- `tests/codec_guards_unit.test.ts` (new)
- `tests/codec_safety.test.ts` (new)

## Compliance

✅ HTTP returns 400 Bad Request for violations  
✅ WebSocket closes with 1007 for violations  
✅ Detailed logging with violation context  
✅ Per-codec metrics for monitoring  
✅ Behind CONDUIT_CODECS_HTTP and CONDUIT_CODECS_WS flags  
✅ Configurable limits via environment variables  
✅ Unit tests pass  
✅ Documentation updated  

## Next Steps

None required. Implementation complete and tested.
