# T7112: WebSocket Decode Error Mapping - Implementation Summary

## Overview
Implemented comprehensive error mapping for WebSocket codec decode errors, distinguishing between oversize, malformed data, and internal errors with appropriate WebSocket close codes.

## Implementation

### 1. mapCodecError() Function (src/connectors/ws.ts:99-144)
Maps codec errors to WebSocket close codes based on error message patterns:

**Error Type Mappings:**
- **1009 Message Too Big**: Oversize errors
  - Patterns: "too large", "too big", "exceeds", "maximum", "size limit"
  - Example: `Message size 2097174 exceeds limit 1048576`

- **1007 Invalid Frame Payload**: Decode errors (malformed data)
  - Patterns: "parse", "invalid", "malformed", "unexpected", "decode", "json", "msgpack", "cbor"
  - Returns "InvalidJSON" for json codec, "DecodeError" for others
  - Example: `JSON decoding failed: Expected property name...`

- **1011 Internal Error**: All other codec errors
  - Fallback for unexpected codec failures

### 2. Decode Error Handling (src/connectors/ws.ts:441-461)
Enhanced decode error handling with:
- **Error mapping**: Uses `mapCodecError()` to determine error code and close code
- **Full context logging**: Logs connId, codec name, stream, and complete error message
- **Error frame transmission**: Sends error frame before closing connection
- **Console logging**: Logs decode errors with codec context for debugging

### 3. Fallback Error Handler (src/connectors/ws.ts:490-503)
Catches any non-decode errors in message processing:
- Returns error code "InternalError" with close code 1011
- Logs as "UnknownError" in metrics
- Prevents crashes from unexpected error types

## Tests

### tests/ws_decode_errors.test.ts
Comprehensive test suite with 5 test cases:

1. **JSON decode error → 1007**: Validates malformed JSON returns InvalidJSON + 1007
2. **MessagePack decode error → 1007**: Validates invalid msgpack returns DecodeError + 1007
3. **Oversize message → 1009**: Validates 2MB message returns MessageTooLarge + 1009
4. **Multiple decode errors**: Verifies connection closes after first decode error
5. **Error logging context**: Confirms error frames include both code and message

### tests/ws_oversize.test.ts
Focused oversize message tests:

1. **JSON oversize → 1009**: 2MB JSON message correctly returns 1009
2. **MessagePack oversize → 1009**: 2MB msgpack message correctly returns 1009
3. **Message under limit**: 950KB message is accepted without error

## Test Results

All tests pass with CONDUIT_CODECS_WS flag enabled:

```
✓ JSON decode error correctly mapped to 1007
✓ MessagePack decode error correctly mapped to 1007
✓ Oversize message correctly mapped to 1009
✓ Connection closes after first decode error
✓ Error logging includes full context
✓ JSON oversize correctly returns 1009
✓ MessagePack oversize correctly returns 1009
✓ Message under limit accepted successfully
```

## Error Response Format

All errors send a frame before closing:
```json
{
  "error": {
    "code": "InvalidJSON|DecodeError|MessageTooLarge|CodecError",
    "message": "Detailed error message"
  }
}
```

## Logging

Codec errors are logged to:
1. **Console**: `[WS] Codec decode error for <connId> (codec=<name>): <message>`
2. **JSONL log**: `reports/gateway-ws.log.jsonl` with full context including codec name
3. **Metrics**: Error counts by type in `wsMetrics.errorsByType`

## Feature Flag

All functionality is gated behind `CONDUIT_CODECS_WS=true` flag, ensuring backward compatibility.

## Files Modified

- **src/connectors/ws.ts**:
  - Implemented `mapCodecError()` function (replaces stub from T7110)
  - Enhanced decode error handling with error mapping
  - Added fallback error handler
  - Added codec context to error logs

## Files Added

- **tests/ws_decode_errors.test.ts**: Comprehensive decode error tests
- **tests/ws_oversize.test.ts**: Focused oversize message tests
- **T7112-WS-DECODE-ERRORS-SUMMARY.md**: This summary

## Verification Command

```bash
CONDUIT_CODECS_WS=true node tests_compiled/ws_oversize.test.js
CONDUIT_CODECS_WS=true node tests_compiled/ws_decode_errors.test.js
```

## WebSocket Close Codes Reference

- **1003**: Unsupported Data (used for UnknownOp)
- **1007**: Invalid Frame Payload (decode errors, malformed data)
- **1008**: Policy Violation (rate limits, auth errors)
- **1009**: Message Too Big (oversize messages)
- **1011**: Internal Error (codec internal failures)

## Next Steps

- T7103: Implement detailed codec metrics tracking
- Consider enhancing codec error messages with more context
- Add performance monitoring for error handling paths
