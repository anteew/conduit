# Conduit WebSocket Gateway — Developer UX v0

Status: Draft v0
Editors: Ava

Scope: Expected behaviors for Conduit’s WS protocol server to match typical developer assumptions for subscribe/flow control and errors.

## 1. Connect & Subscribe

- Endpoint: `GET /v1/subscribe?stream=...`
- On connect: optional `{status:"subscribed", stream}` message (DSL rule can emit)
- Delivery: server pushes `{deliver: { id?, type, payload, ... }}` frames

## 2. Flow Control (Credit) - T5052 Strict Backpressure

**Status:** ✅ Implemented with strict enforcement

- Client sends `{credit: n}` to grant delivery capacity (n messages)
- Server respects credit window strictly; one deliver decrements window by 1
- **Strict enforcement:** No delivery without available credit
- **Window tracking:** Per-connection credit counter
- **Backpressure logging:** Blocked deliveries logged when credit exhausted
- Acknowledgements:
  - `{ack: id}` — confirm handled; server may advance offset (future)
  - `{nack: id, delayMs?}` — request redelivery; may delay

**Example Flow:**
```javascript
// Client grants credit
> {"credit": 5}
// Server can deliver up to 5 messages
← {"deliver": {...}}  // credit now 4
← {"deliver": {...}}  // credit now 3
// No more deliveries when credit = 0
```

## 3. Message Size Caps (T5050)

**Status:** ✅ Implemented

- **Default limit:** 1MB (1,048,576 bytes) configurable via `CONDUIT_WS_MAX_MESSAGE_SIZE`
- **Enforcement:** Before JSON parsing (efficient)
- **Close code:** 1009 (Message Too Big) per RFC 6455
- **Error frame:** `{"error": {"code": "MessageTooLarge", "message": "..."}}`
- **Security:** Prevents memory exhaustion from oversized messages

**Configuration:**
```bash
CONDUIT_WS_MAX_MESSAGE_SIZE=1048576  # 1MB default
```

## 4. Rate Limits (T5051)

**Status:** ✅ Implemented

- **Algorithm:** Token bucket with continuous refill
- **Scope:** Per-connection (isolated tracking by `connId`)
- **Default:** 1000 messages per 60 seconds (16.6 msg/sec average)
- **Close code:** 1008 (Policy Violation)
- **Configuration:**
  ```bash
  CONDUIT_WS_MESSAGE_RATE_LIMIT=1000    # Messages per window
  CONDUIT_WS_RATE_WINDOW_MS=60000       # 60 seconds
  ```
- **Behavior:**
  - Token bucket refills continuously at average rate
  - Burst capacity = full bucket size
  - On exceed: Error frame → connection closed
  - Automatic cleanup on close

## 5. Messages & Errors

- Messages expected as JSON text frames
- Error mapping to close codes:
  - **1003 UnknownOp** — Unexpected message shape
  - **1007 Invalid JSON** — JSON parsing failed
  - **1008 Policy Violation** — Rate limit exceeded (T5051)
  - **1009 Message Too Big** — Size cap exceeded (T5050)
  - **1011 Internal error** — Server-side failure
- Server sends `{error:{code,message}}` frame prior to close

**Close Code Reference:**
```
1000: Normal closure
1003: UnknownOp (unsupported data)
1007: Invalid JSON
1008: Policy Violation (rate limit)
1009: Message Too Big (size cap)
1011: Internal Server Error
```

## 6. WebSocket Logging (T5041)

**Status:** ✅ Implemented

- **Format:** Structured JSONL to `reports/gateway-ws.log.jsonl`
- **Auto-initialized:** WriteStream created on startup
- **Lifecycle tracking:** Complete subscribe → credit → deliver → close flow
- **Fields:**
  - `ts`: ISO 8601 timestamp
  - `connId`: Unique connection identifier
  - `ip`: Client IP address
  - `stream`: Stream name for subscription
  - `credit`: Credit granted by client
  - `delivers`: Total deliveries on connection
  - `closeCode`: WebSocket close code
  - `error`: Error message or code
  - `creditRemaining`: Credit remaining after delivery
  - `totalCredit`: Total accumulated credit
  - `durMs`: Connection duration (on close)

**Example Log Sequence:**
```json
{"ts":"2025-10-19T14:30:00.123Z","connId":"ws-1729350000000-1","ip":"127.0.0.1","stream":"agents/worker/inbox"}
{"ts":"2025-10-19T14:30:01.234Z","connId":"ws-1729350000000-1","ip":"127.0.0.1","stream":"agents/worker/inbox","credit":10,"totalCredit":10}
{"ts":"2025-10-19T14:30:02.345Z","connId":"ws-1729350000000-1","ip":"127.0.0.1","stream":"agents/worker/inbox","delivers":1,"creditRemaining":9}
{"ts":"2025-10-19T14:30:30.456Z","connId":"ws-1729350000000-1","ip":"127.0.0.1","stream":"agents/worker/inbox","closeCode":1000,"delivers":5,"durMs":30333}
```

## 7. Connection Rate Limits (T5030)

**Status:** ✅ Implemented

- **Per-IP tracking:** Token bucket per client IP
- **Default:** 60 connections per minute
- **Configuration:**
  ```bash
  CONDUIT_WS_CONN_RATE_LIMIT=60        # Connections per window
  CONDUIT_WS_CONN_RATE_WINDOW_MS=60000 # 60 seconds
  ```
- **Behavior:** Connection rejected if rate limit exceeded

## 8. Observability

- Log subscribe/unsubscribe events tagged by stream
- Expose counters for delivers, acks/nacks, credit grants, and window size
- Metrics available via `GET /v1/metrics`:
  - `connectionsTotal`: Total connections ever
  - `activeConnections`: Current active connections
  - `messagesIn`: Total messages received
  - `messagesOut`: Total deliveries
  - `creditsGranted`: Total credit granted
  - `backpressureEvents`: Credit exhaustion events
  - `closeCodes`: Distribution of close codes
  - `rateLimitHits`: Rate limit violations

## 9. Defaults vs Overrides

- Defaults: JSON frames, credit model required for flow
- Size caps: 1MB messages (configurable)
- Rate limits: 1000 msg/min per connection, 60 conn/min per IP
- Strict backpressure: No over-delivery
- Overrides: DSL can map initial hello message, custom error codes, or per‑tenant limits

