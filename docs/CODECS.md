# Conduit Codec Guide

## Overview

Conduit supports multiple serialization formats (codecs) for both HTTP and WebSocket transports. Binary codecs like MessagePack reduce CPU and bandwidth usage compared to JSON while maintaining full protocol compatibility.

**Key Features:**
- **Opt-in by default:** JSON remains the default codec
- **Content negotiation:** HTTP uses Accept/Content-Type headers
- **WebSocket negotiation:** Query parameter `?codec=` or subprotocol
- **Full compatibility:** All codecs support the same message structure
- **Safety-first:** Same size limits and validation apply to all codecs

---

## Supported Codecs

| Codec | Content-Type | Description | Use Case |
|-------|--------------|-------------|----------|
| **JSON** | `application/json` | Default, human-readable | Development, debugging, universal compatibility |
| **MessagePack** | `application/msgpack`, `application/x-msgpack` | Binary, compact, fast | Production, high-throughput agent messaging |

**Future:** CBOR support planned for additional binary format option.

---

## Enabling Codecs

### Feature Flags

Codecs are **opt-in** via environment variables:

```bash
# Enable HTTP codec negotiation (Accept/Content-Type)
export CONDUIT_CODECS_HTTP=true

# Enable WebSocket codec negotiation (?codec= parameter)
export CONDUIT_CODECS_WS=true

# Set default when Accept is ambiguous or */*
export CONDUIT_DEFAULT_CODEC=json  # or 'msgpack'
```

**Default behavior (flags disabled):**
- HTTP: All requests/responses use JSON
- WebSocket: All frames use JSON text frames
- Safe for gradual rollout

### Configuration Example

```bash
# Production with binary codec support
CONDUIT_CODECS_HTTP=true
CONDUIT_CODECS_WS=true
CONDUIT_DEFAULT_CODEC=json  # Conservative default
CONDUIT_HTTP_PORT=9087
CONDUIT_WS_PORT=9088
```

---

## HTTP Usage

### Request Encoding

Clients specify encoding via `Content-Type` header:

```bash
# JSON request (always works)
curl -X POST http://localhost:9087/v1/enqueue \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer token123" \
  -d '{"stream":"agents/inbox","body":{"type":"task","data":"hello"}}'

# MessagePack request (requires CONDUIT_CODECS_HTTP=true)
curl -X POST http://localhost:9087/v1/enqueue \
  -H "Content-Type: application/msgpack" \
  -H "Authorization: Bearer token123" \
  --data-binary @payload.msgpack
```

**Behavior:**
- If `CONDUIT_CODECS_HTTP=false`: All requests decoded as JSON regardless of Content-Type
- If `CONDUIT_CODECS_HTTP=true`: Content-Type determines codec:
  - `application/msgpack` or `application/x-msgpack` → MessagePack
  - `application/json` or missing → JSON
  - Unsupported → `400 Bad Request`

### Response Encoding

Clients negotiate response format via `Accept` header:

```bash
# Request JSON response
curl http://localhost:9087/v1/metrics \
  -H "Accept: application/json"

# Request MessagePack response
curl http://localhost:9087/v1/metrics \
  -H "Accept: application/msgpack" \
  --output metrics.msgpack

# Content negotiation with quality values
curl http://localhost:9087/v1/metrics \
  -H "Accept: application/msgpack;q=0.9, application/json;q=0.5"
```

**Negotiation rules:**
1. Parse Accept header and sort by quality value (q=)
2. Return first supported codec from sorted list
3. If no match or `Accept: */*`: Use `CONDUIT_DEFAULT_CODEC`
4. If Accept missing: Default to JSON

### Content-Type Reference

| Content-Type | Codec | Notes |
|--------------|-------|-------|
| `application/json` | JSON | Default, always supported |
| `application/msgpack` | MessagePack | Primary binary format |
| `application/x-msgpack` | MessagePack | Alternative MIME type |
| `*/*` or missing | Default | Uses `CONDUIT_DEFAULT_CODEC` |

---

## WebSocket Usage

### Connection Negotiation

Codec is specified at connection time via query parameter:

```javascript
// JSON (default)
const ws = new WebSocket('ws://localhost:9088/v1/subscribe?stream=agents/inbox');

// MessagePack
const ws = new WebSocket('ws://localhost:9088/v1/subscribe?stream=agents/inbox&codec=msgpack');
```

**CLI examples:**
```bash
# JSON text frames
wscat -c "ws://localhost:9088/v1/subscribe?stream=agents/inbox&codec=json"

# MessagePack binary frames
wscat -c "ws://localhost:9088/v1/subscribe?stream=agents/inbox&codec=msgpack"
```

**Behavior:**
- Codec selected at connection open
- All frames on connection use same codec
- Client must encode/decode consistently
- Invalid codec → Falls back to JSON

### Frame Types

| Codec | WebSocket Frame Type | Opcode | Notes |
|-------|---------------------|--------|-------|
| JSON | Text | 0x1 | UTF-8 encoded JSON strings |
| MessagePack | Binary | 0x2 | Binary MessagePack payloads |

**Message structure (same for all codecs):**
```javascript
// Client → Server (credit)
{ type: 'credit', credit: 100 }

// Server → Client (delivery)
{
  type: 'delivery',
  msgId: 'msg-123',
  body: { /* user data */ },
  blobRef: 'sha256-abc...'  // optional
}

// Client → Server (ack/nack)
{ type: 'ack', msgId: 'msg-123' }
{ type: 'nack', msgId: 'msg-123' }
```

### Client Implementation Example

```javascript
import WebSocket from 'ws';
import { pack, unpack } from 'msgpackr';

// Connect with MessagePack
const ws = new WebSocket('ws://localhost:9088/v1/subscribe?stream=agents/inbox&codec=msgpack');

ws.on('open', () => {
  // Send credit (binary frame)
  const creditMsg = { type: 'credit', credit: 100 };
  ws.send(pack(creditMsg));
});

ws.on('message', (data) => {
  // Decode binary frame
  const msg = unpack(new Uint8Array(data));
  
  if (msg.type === 'delivery') {
    console.log('Received message:', msg.msgId);
    // Process and acknowledge
    ws.send(pack({ type: 'ack', msgId: msg.msgId }));
  }
});
```

---

## Migration Guide

### Phase 1: Enable with JSON Default (Zero Risk)

```bash
# Enable feature flags but keep JSON as default
export CONDUIT_CODECS_HTTP=true
export CONDUIT_CODECS_WS=true
export CONDUIT_DEFAULT_CODEC=json
```

**Impact:** 
- Existing clients continue working unchanged
- New clients can opt into MessagePack
- Monitor codec metrics to track adoption

### Phase 2: Gradual Client Migration

**HTTP clients:**
```javascript
// Before: implicit JSON
fetch('/v1/enqueue', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});

// After: explicit MessagePack
import { pack } from 'msgpackr';
fetch('/v1/enqueue', {
  method: 'POST',
  headers: { 'Content-Type': 'application/msgpack' },
  body: pack(payload)
});
```

**WebSocket clients:**
```javascript
// Before: implicit JSON
const ws = new WebSocket('ws://localhost:9088/v1/subscribe?stream=agents/inbox');

// After: explicit MessagePack
const ws = new WebSocket('ws://localhost:9088/v1/subscribe?stream=agents/inbox&codec=msgpack');
```

### Phase 3: Change Default (Optional)

Once majority of clients support MessagePack:

```bash
# Make MessagePack the default for ambiguous Accept headers
export CONDUIT_DEFAULT_CODEC=msgpack
```

**Impact:**
- Clients without explicit Accept header receive MessagePack
- Clients specifying `Accept: application/json` still get JSON
- Monitor error rates for incompatible clients

### Rollback

```bash
# Disable codec negotiation - revert to JSON-only
export CONDUIT_CODECS_HTTP=false
export CONDUIT_CODECS_WS=false
```

**Effect:** All traffic reverts to JSON immediately, no restart required.

---

## Observability

### Logs

**HTTP Gateway Logs** (`reports/gateway-http.log.jsonl`):
```json
{
  "ts": "2025-01-01T00:00:00.000Z",
  "method": "POST",
  "url": "/v1/enqueue",
  "status": 200,
  "codec": "msgpack",
  "bytesIn": 245,
  "bytesOut": 89,
  "durationMs": 5
}
```

**WebSocket Gateway Logs** (`reports/gateway-ws.log.jsonl`):
```json
{
  "ts": "2025-01-01T00:00:00.000Z",
  "event": "connect",
  "codec": "msgpack",
  "stream": "agents/inbox"
}
```

### Metrics

**Per-codec counters** (available via `/v1/metrics`):
```json
{
  "gateway": {
    "http": {
      "codecs": {
        "json": { "requests": 1000, "bytesIn": 500000, "bytesOut": 450000 },
        "msgpack": { "requests": 500, "bytesIn": 150000, "bytesOut": 135000 }
      }
    },
    "ws": {
      "codecs": {
        "json": { "messages": 5000, "bytes": 2500000 },
        "msgpack": { "messages": 3000, "bytes": 900000 }
      }
    }
  }
}
```

**Monitoring queries:**
```bash
# Track codec adoption
curl -s http://localhost:9087/v1/metrics | jq '.gateway.http.codecs'

# Compare bandwidth savings
curl -s http://localhost:9087/v1/metrics | jq '.gateway.ws.codecs | 
  to_entries | 
  map({codec: .key, avgBytes: (.value.bytes / .value.messages)}) |
  sort_by(.avgBytes)'
```

---

## Performance Benchmarks

### Typical Improvements (MessagePack vs JSON)

| Metric | Improvement | Notes |
|--------|-------------|-------|
| Payload size | 30-50% smaller | Depends on data structure |
| Encode speed | 2-3x faster | Server-side CPU reduction |
| Decode speed | 2-3x faster | Client-side CPU reduction |
| Latency | 5-10% lower | End-to-end for large messages |

### When to Use MessagePack

**Good candidates:**
- High-volume agent messaging (>100 msg/s)
- Large message bodies (>1KB)
- CPU-constrained clients (mobile, edge devices)
- Bandwidth-constrained networks

**Stick with JSON:**
- Interactive debugging (curl, browser DevTools)
- Low message volume (<10 msg/s)
- Integration with JSON-only clients
- Human readability required

### Run Benchmarks

```bash
# Compare JSON vs MessagePack performance
npm test -- tests/codec_perf_small.test.ts

# Load test with specific codec
CODEC=msgpack npm run test:load-ws
```

---

## Troubleshooting

### 400 Bad Request (HTTP)

**Symptom:** `400 Bad Request` with MessagePack Content-Type

**Causes:**
1. `CONDUIT_CODECS_HTTP=false` (codec support disabled)
2. Invalid MessagePack payload
3. Unsupported codec name

**Resolution:**
```bash
# Check feature flag
echo $CONDUIT_CODECS_HTTP  # Should be 'true'

# Verify payload encoding
msgpack-cli decode payload.msgpack  # Should decode cleanly

# Check logs for specific error
jq 'select(.status == 400 and .codec)' reports/gateway-http.log.jsonl
```

### WebSocket 1007 (Invalid Frame Data)

**Symptom:** Connection closed with code 1007

**Causes:**
1. Frame type mismatch (text frame with msgpack codec)
2. Corrupt MessagePack payload
3. Invalid JSON in text frame

**Resolution:**
```bash
# Check negotiated codec in logs
jq 'select(.event == "connect")' reports/gateway-ws.log.jsonl

# Verify client sends correct frame type
# JSON → text frames (ws.send(JSON.stringify(...)))
# MessagePack → binary frames (ws.send(pack(...)))
```

### Silent Fallback to JSON

**Symptom:** Server responds with JSON despite Accept: application/msgpack

**Causes:**
1. `CONDUIT_CODECS_HTTP=false` (disabled)
2. Ambiguous Accept header with JSON quality > msgpack
3. Response endpoint doesn't support negotiation

**Resolution:**
```bash
# Check feature flag
echo $CONDUIT_CODECS_HTTP

# Check response Content-Type
curl -v http://localhost:9087/v1/metrics \
  -H "Accept: application/msgpack" \
  2>&1 | grep -i content-type

# Use specific Accept header
curl -H "Accept: application/msgpack;q=1.0" http://localhost:9087/v1/metrics
```

### Performance Not Improving

**Symptom:** MessagePack not faster than JSON

**Causes:**
1. Small messages (<100 bytes) - overhead dominates
2. Network latency dominates (not CPU-bound)
3. msgpackr library not installed

**Resolution:**
```bash
# Verify msgpackr installed
npm list msgpackr

# Check message sizes in metrics
curl -s http://localhost:9087/v1/metrics | jq '.gateway.http.codecs'

# Run benchmarks
npm test -- tests/codec_perf_small.test.ts
```

---

## API Reference

### Codec Registry

```typescript
import { registerCodec, getCodecByName, listCodecs } from './codec/registry.js';

// List available codecs
const codecs = listCodecs();
// => [{ name: 'json', contentTypes: ['application/json'], ... }, ...]

// Get specific codec
const msgpack = getCodecByName('msgpack');
// => { name: 'msgpack', contentTypes: ['application/msgpack', ...], ... }

// Register custom codec
registerCodec({
  name: 'cbor',
  contentTypes: ['application/cbor'],
  isBinary: true,
  encode: (obj) => cborEncode(obj),
  decode: (buf) => cborDecode(buf)
});
```

### Codec Interface

```typescript
interface Codec {
  name: string;                    // 'json', 'msgpack', 'cbor'
  contentTypes: string[];           // MIME types
  isBinary: boolean;                // true for msgpack/cbor
  encode(obj: any): Uint8Array;    // Serialize
  decode(buf: Uint8Array): any;    // Deserialize
}
```

---

## Security Considerations

1. **Same validation applies:** All codecs enforce identical size limits, depth limits, and timeouts
2. **Decode errors → 400/1007:** Malformed payloads rejected immediately
3. **No schema requirements:** Codecs are transparent - same validation as JSON
4. **Binary safety:** MessagePack prevents prototype pollution and injection attacks

**Size limits (unchanged):**
- `CONDUIT_MAX_JSON_SIZE`: Applies to decoded size regardless of codec
- `CONDUIT_MULTIPART_MAX_PART_SIZE`: Pre-decode limit for all payloads
- WebSocket max message: Same 16MB limit for binary and text frames

---

## FAQ

**Q: Do I need to migrate all clients at once?**  
A: No. Enable flags with `CONDUIT_DEFAULT_CODEC=json` for gradual migration. Clients opt in individually.

**Q: Can I mix JSON and MessagePack clients?**  
A: Yes. Each HTTP request and WebSocket connection negotiates independently.

**Q: Will this break existing integrations?**  
A: No. With flags enabled and `DEFAULT=json`, all existing clients continue working. MessagePack is opt-in via explicit headers/params.

**Q: Does MessagePack support all JSON data types?**  
A: Yes, including nested objects, arrays, null, booleans, strings, numbers. Binary data more efficient in MessagePack.

**Q: How do I debug MessagePack payloads?**  
A: Use tools like `msgpack-cli` or online decoders. Alternatively, connect a JSON client for readable output.

**Q: Can I add custom codecs?**  
A: Yes, use `registerCodec()` from `src/codec/registry.ts`. See Codec Interface above.

**Q: Does compression (gzip) still work?**  
A: Yes. Codecs are orthogonal to Content-Encoding. Order: decompress → decode → process → encode → compress.

---

## Resources

- **Technical Design:** [docs/design/CODECS-TDS.md](./design/CODECS-TDS.md)
- **SRE Runbook:** [docs/SRE-RUNBOOK.md](./SRE-RUNBOOK.md) (Configuration reference)
- **Examples:** [examples/codec-comparison/](../examples/codec-comparison/) (Working code samples)
- **Tests:** [tests/codec_*.test.ts](../tests/) (Integration test suite)

**External:**
- MessagePack: https://msgpack.org/
- msgpackr library: https://github.com/kriszyp/msgpackr
- WebSocket protocol: https://datatracker.ietf.org/doc/html/rfc6455
