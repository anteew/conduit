# T2111: HTTP Error Mapping Implementation

## Overview

Implemented DSL-based error handling that maps Courier control frame errors to HTTP status codes. The system uses a standardized error taxonomy and provides declarative error mappings via the `onError` clause in DSL rules.

## Error Taxonomy

### Standard Error Codes

| Code | Description | Default HTTP Status |
|------|-------------|-------------------|
| `InvalidJSON` | Request body contains malformed JSON | 400 Bad Request |
| `InvalidEnvelope` | Envelope structure is invalid | 400 Bad Request |
| `UnknownView` | Requested view does not exist | 404 Not Found |
| `UnknownStream` | Requested stream does not exist | 404 Not Found |
| `Internal` | Unclassified internal server error | 500 Internal Server Error |

## Implementation Components

### 1. DSL Interpreter Enhancement (`src/dsl/interpreter.ts`)

**Added:**
- `DSLErrorCode` enum: Defines standard error codes
- `DSLError` class: Structured error with code, message, and optional detail
- `handleError()`: Processes caught errors and applies onError mappings
- `categorizeError()`: Maps raw errors to DSL error codes

**Error Handling Flow:**
```typescript
try {
  return await this.executeRule(rule, ctx);
} catch (error) {
  return this.handleError(error, rule, ctx);
}
```

**Error Categorization Logic:**
1. Check if error is already a `DSLError`
2. Inspect error code/message for known patterns
3. Map to appropriate `DSLErrorCode`
4. Fall back to `Internal` for unrecognized errors

### 2. Config-Based Error Mapping (`config/rules.yaml`)

**Global defaults:**
```yaml
defaults:
  onError:
    InvalidJSON:
      http:
        status: 400
        body:
          error: InvalidJSON
          message: Request contains invalid JSON
    # ... other mappings
```

**Per-rule overrides:**
Rules can override global error mappings by defining their own `onError` blocks.

### 3. Backend Error Responses (`src/backend/demo.ts`)

Enhanced demo backend to return proper error codes:

```typescript
case 'snapshot':
  if (!(f as any).view || (f as any).view.startsWith('__unknown__')) {
    this.send(stream, {
      type: 'error',
      reqId: f.reqId,
      code: 'UnknownView',
      detail: `View not found: ${(f as any).view}`
    });
  }
```

### 4. HTTP Connector Integration (`src/connectors/http.ts`)

- Removed try-catch wrapper around `applyRules()` to let interpreter handle errors
- Errors are caught and mapped inside the interpreter
- HTTP responses are returned with appropriate status codes

## Error Response Format

All error responses follow this structure:

```json
{
  "error": "UnknownView",
  "message": "View not found",
  "detail": "View not found: __unknown__"
}
```

## Testing

Run the test suite with:
```bash
bash test-errors.sh
```

**Test Coverage:**
1. UnknownView → 404
2. UnknownStream → 404
3. InvalidEnvelope → 400
4. Valid requests → 200

**Sample Test Results:**
```
Test 1 (UnknownView): UnknownView ✓
Test 2 (UnknownStream): UnknownStream ✓
Test 3 (InvalidEnvelope): InvalidEnvelope ✓
```

## HTTP Status Mapping Strategy

### Client Errors (4xx)
- **400 Bad Request**: Malformed request (InvalidJSON, InvalidEnvelope)
- **404 Not Found**: Resource doesn't exist (UnknownView, UnknownStream)

### Server Errors (5xx)
- **500 Internal Server Error**: Unclassified errors (Internal)

### Rationale

1. **Clear Distinction**: Client vs. server responsibility
2. **REST Conventions**: Follows standard HTTP semantics
3. **Debuggability**: Error code + message + detail for troubleshooting
4. **Extensibility**: Easy to add new error codes

## Configuration

Enable DSL error handling by setting:
```bash
export CONDUIT_RULES=config/rules.yaml
```

## Future Enhancements

1. Custom error codes per rule
2. Error response templates with variable substitution
3. Logging/metrics for error frequencies
4. Client-provided correlation IDs in error responses
