# Codec Comparison Examples

This directory contains practical examples demonstrating HTTP and WebSocket codec usage with Conduit.

## Prerequisites

```bash
# Install dependencies
npm install msgpackr ws node-fetch

# Start Conduit with codec support
export CONDUIT_CODECS_HTTP=true
export CONDUIT_CODECS_WS=true
export CONDUIT_DEFAULT_CODEC=json
npm run dev
```

## Examples

### 1. HTTP with JSON (Default)

```bash
# Send JSON request
curl -X POST http://localhost:9087/v1/enqueue \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev-token" \
  -d '{
    "stream": "agents/test/inbox",
    "body": {
      "type": "task",
      "priority": "high",
      "data": "Process this message"
    }
  }'

# Request JSON response
curl http://localhost:9087/v1/metrics \
  -H "Accept: application/json" | jq .
```

### 2. HTTP with MessagePack

```bash
# Encode payload to MessagePack
node -e "
const { pack } = require('msgpackr');
const fs = require('fs');
const payload = {
  stream: 'agents/test/inbox',
  body: {
    type: 'task',
    priority: 'high',
    data: 'Process this message'
  }
};
fs.writeFileSync('/tmp/payload.msgpack', pack(payload));
console.log('Payload written to /tmp/payload.msgpack');
"

# Send MessagePack request
curl -X POST http://localhost:9087/v1/enqueue \
  -H "Content-Type: application/msgpack" \
  -H "Authorization: Bearer dev-token" \
  --data-binary @/tmp/payload.msgpack

# Request MessagePack response and decode
curl http://localhost:9087/v1/metrics \
  -H "Accept: application/msgpack" \
  --output /tmp/metrics.msgpack

node -e "
const { unpack } = require('msgpackr');
const fs = require('fs');
const data = unpack(fs.readFileSync('/tmp/metrics.msgpack'));
console.log(JSON.stringify(data, null, 2));
"
```

### 3. WebSocket with JSON

See [http-json-example.js](./http-json-example.js):

```bash
node examples/codec-comparison/http-json-example.js
```

### 4. WebSocket with MessagePack

See [ws-msgpack-example.js](./ws-msgpack-example.js):

```bash
node examples/codec-comparison/ws-msgpack-example.js
```

### 5. Compare Performance

See [compare-codecs.js](./compare-codecs.js):

```bash
node examples/codec-comparison/compare-codecs.js
```

## File Descriptions

- **http-json-example.js** - HTTP client using JSON (baseline)
- **http-msgpack-example.js** - HTTP client using MessagePack
- **ws-json-example.js** - WebSocket client using JSON text frames
- **ws-msgpack-example.js** - WebSocket client using MessagePack binary frames
- **compare-codecs.js** - Benchmark comparing JSON vs MessagePack performance

## Expected Results

**Payload size reduction (MessagePack vs JSON):**
- Simple messages: ~30% smaller
- Complex nested objects: ~40-50% smaller
- Large arrays: ~35% smaller

**Encode/decode speed:**
- MessagePack: 2-3x faster than JSON.stringify/parse
- More noticeable with larger payloads (>1KB)

**Latency:**
- Minimal difference for small messages (<100 bytes)
- 5-10% improvement for large messages (>10KB)
- Network latency often dominates

## Troubleshooting

**Error: msgpackr not available**
```bash
npm install msgpackr
```

**Error: 400 Bad Request with Content-Type: application/msgpack**
```bash
# Ensure codec support enabled
export CONDUIT_CODECS_HTTP=true
npm run dev
```

**WebSocket closes with code 1007**
```bash
# Ensure frame type matches codec:
# - JSON: ws.send(JSON.stringify(msg))  # text frame
# - MessagePack: ws.send(pack(msg))     # binary frame
```

## Learn More

- [CODECS.md](../../docs/CODECS.md) - Complete codec documentation
- [SRE-RUNBOOK.md](../../docs/SRE-RUNBOOK.md) - Configuration reference
- [CODECS-TDS.md](../../docs/design/CODECS-TDS.md) - Technical design
