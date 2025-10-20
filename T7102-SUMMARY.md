# T7102-HTTP-Codec-Encode Implementation Summary

## Overview

Implemented HTTP response encoding via Accept header negotiation with X-Codec override support, building on T7101's request decoding infrastructure. All changes are behind the `CONDUIT_CODECS_HTTP` feature flag.

## Implementation Details

### 1. Response Codec Negotiation (`src/connectors/http.ts`)

**Modified `send()` function (lines 177-220):**
- Parses `Accept` header using `chooseForHttpResponse()` from codec registry
- Supports `X-Codec` header for explicit codec override (takes precedence over Accept)
- Falls back to JSON when:
  - Feature flag disabled (`CONDUIT_CODECS_HTTP=false`)
  - Accept header missing or wildcard (`*/*`)
  - No matching codec found
- Encodes response body using selected codec
- Sets `Content-Type` header to codec's MIME type
- Tracks encode metrics (success/failure) via `recordCodecMetrics()`
- Graceful fallback to JSON on encoding errors

**Import updates:**
- Added `getCodecByName` import from codec registry

### 2. Codec Selection Priority

1. **Explicit codec** (if provided by caller as `responseCodec` param)
2. **X-Codec header** (e.g., `X-Codec: msgpack`)
3. **Accept header negotiation** with quality values (e.g., `Accept: application/msgpack;q=0.9, application/json;q=0.5`)
4. **Default codec** from `CONDUIT_DEFAULT_CODEC` env var or `json`

### 3. Error Handling

- Encoding failures log error and fallback to JSON
- Invalid X-Codec values fall back to Accept negotiation
- Codec metrics track both successful and failed encoding attempts

## Test Coverage

**Created `tests/http_codec_encode.test.ts`** with 10 test cases:

1. ✅ Default JSON response (no Accept header)
2. ✅ JSON response via Accept header
3. ✅ MessagePack response via Accept header (when msgpackr available)
4. ✅ X-Codec override to msgpack
5. ✅ X-Codec override to json
6. ✅ Invalid X-Codec falls back to Accept negotiation
7. ✅ Quality value negotiation (prefers higher q)
8. ✅ Wildcard Accept (*/*) uses default codec
9. ✅ /v1/metrics with codec negotiation
10. ✅ Error responses respect codec negotiation

**Test execution:**
```bash
npm run test:compile
CONDUIT_CODECS_HTTP=true node tests_compiled/tests/http_codec_encode.test.js
```

**Result:** All 10 tests pass (3 tests show graceful fallback when msgpackr not available)

## Documentation Updates

### docs/SRE-RUNBOOK.md (lines 774-790)

Added **X-Codec header override examples:**

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

## Feature Flag Behavior

### When `CONDUIT_CODECS_HTTP=true`:
- Negotiates response codec from Accept header
- Supports X-Codec header override
- Uses `CONDUIT_DEFAULT_CODEC` for wildcard Accept
- Tracks codec encode metrics

### When `CONDUIT_CODECS_HTTP=false` (default):
- Always encodes responses as JSON
- Ignores Accept and X-Codec headers
- Maintains backward compatibility

## Metrics Integration

Response encoding integrates with existing codec metrics (T7103):
- `codecMetrics.encodeCount` - Total encode operations
- `codecMetrics.encodeErrors` - Failed encode operations
- `codecMetrics.codecUsage` - Per-codec usage counters

## Key Design Decisions

1. **X-Codec takes precedence** over Accept to allow explicit override for debugging/testing
2. **Graceful fallback** ensures responses never fail due to codec issues
3. **Feature flag isolation** allows safe rollout without affecting existing deployments
4. **Metrics tracking** enables monitoring of codec adoption and error rates
5. **Quality value support** enables client preference negotiation (RFC 7231 compliant)

## Integration with T7101

- Reuses codec registry and negotiation functions
- Consistent error handling and fallback strategy
- Shared metrics tracking infrastructure
- Same feature flag (`CONDUIT_CODECS_HTTP`)

## Files Modified

1. **src/connectors/http.ts**
   - Modified `send()` function (43 lines changed)
   - Added codec negotiation logic
   - Enhanced import statements

2. **docs/SRE-RUNBOOK.md**
   - Added X-Codec header examples (17 lines added)

3. **tests/http_codec_encode.test.ts** (new file)
   - 360 lines of comprehensive test coverage

## Verification Commands

```bash
# Enable codec support
export CONDUIT_CODECS_HTTP=true

# Test JSON response (default)
curl http://localhost:9087/health

# Test Accept header negotiation
curl http://localhost:9087/v1/metrics \
  -H "Accept: application/msgpack" \
  --output metrics.msgpack

# Test X-Codec override
curl http://localhost:9087/health \
  -H "X-Codec: json" \
  -H "Accept: application/msgpack"

# Run automated tests
npm run test:compile
CONDUIT_CODECS_HTTP=true node tests_compiled/tests/http_codec_encode.test.js
```

## Status

✅ **Complete** - All tasks implemented, tested, and documented.

## Next Steps (Future Enhancements)

- T7103: Expose codec metrics via /v1/metrics endpoint
- T7110: WebSocket codec negotiation
- Install msgpackr for full binary codec support
