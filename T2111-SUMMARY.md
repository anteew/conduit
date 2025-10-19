# T2111: HTTP Error Mapping - Implementation Summary

## ✓ Completed

Successfully implemented DSL-based HTTP error mapping for Courier control frame errors.

## Error Taxonomy

| Error Code | HTTP Status | Use Case |
|------------|-------------|----------|
| **InvalidJSON** | 400 | Malformed JSON in request body |
| **InvalidEnvelope** | 400 | Invalid envelope structure/format |
| **UnknownView** | 404 | Snapshot view does not exist |
| **UnknownStream** | 404 | Stats stream does not exist |
| **Internal** | 500 | Uncategorized server errors |

## HTTP Status Mapping Strategy

### Client Errors (4xx)
- **400**: Request is malformed or invalid (client should fix)
- **404**: Resource does not exist

### Server Errors (5xx)
- **500**: Internal processing failure

### Rationale
1. **Standards Compliance**: Follows REST/HTTP conventions
2. **Clear Responsibility**: Distinguishes client vs server errors
3. **Actionable Feedback**: Error codes help clients respond appropriately
4. **Debuggability**: Structured errors with code, message, and detail

## Files Modified/Created

### Core Implementation
- **src/dsl/interpreter.ts**: Added error handling with DSLError class and categorization
- **src/backend/demo.ts**: Enhanced to return proper error codes
- **src/connectors/http.ts**: Fixed import statements for ES modules
- **src/dsl/loader.ts**: Fixed import statements for ES modules

### Configuration
- **config/rules.yaml**: Created with default error mappings and HTTP routes
- **tsconfig.json**: Adjusted moduleResolution for proper compilation

### Documentation & Testing
- **docs/T2111-HTTP-ERRORS.md**: Complete implementation documentation
- **test-errors.sh**: Comprehensive error mapping test suite
- **verify-t2111.sh**: Quick verification script
- **T2111-SUMMARY.md**: This file

## Verification Results

```
Test Results:
UnknownView: 404      ✓
UnknownStream: 404    ✓
InvalidEnvelope: 400  ✓
ValidRequest: 200     ✓
```

## Error Response Format

All errors return structured JSON:

```json
{
  "error": "UnknownView",
  "message": "View not found",
  "detail": "View not found: __unknown__"
}
```

## Usage

Start Conduit with DSL rules:
```bash
CONDUIT_RULES=config/rules.yaml node --loader ts-node/esm src/index.ts
```

Test error responses:
```bash
# 404 - Unknown view
curl http://127.0.0.1:9087/v1/snapshot?view=__unknown__

# 404 - Unknown stream
curl http://127.0.0.1:9087/v1/stats?stream=__unknown__

# 400 - Invalid envelope
curl -X POST http://127.0.0.1:9087/v1/enqueue \
  -H 'Content-Type: application/json' \
  -d '{"to":"test","envelope":null}'
```

## Architecture Highlights

### 1. Declarative Error Mapping
Errors are mapped via DSL config, not hardcoded in connectors:

```yaml
defaults:
  onError:
    UnknownView:
      http:
        status: 404
        body:
          error: UnknownView
          message: View not found
```

### 2. Error Categorization
Raw errors from control frames are intelligently categorized:

```typescript
private categorizeError(error: any): DSLError {
  if (error?.code === 'UnknownView' || error?.detail?.includes('view')) {
    return new DSLError(DSLErrorCode.UnknownView, 'Unknown view', error?.detail);
  }
  // ... other cases
}
```

### 3. Context Preservation
Error context is preserved for debugging:

```typescript
ctx.$error = { 
  code: dslError.code, 
  message: dslError.message, 
  detail: dslError.detail 
};
```

## Design Benefits

1. **Separation of Concerns**: Error handling logic is in interpreter, not scattered across connectors
2. **Configurability**: Error mappings can be changed without code changes
3. **Consistency**: All HTTP endpoints use same error handling
4. **Extensibility**: Easy to add new error codes and mappings

## Future Enhancements

1. **Per-rule error overrides**: Custom error handling per DSL rule
2. **Error templates**: Variable substitution in error messages
3. **Error metrics**: Track error frequencies for monitoring
4. **Correlation IDs**: Pass through request IDs for tracing
