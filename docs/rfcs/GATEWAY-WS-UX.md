# Conduit WebSocket Gateway — Developer UX v0

Status: Draft v0
Editors: Ava

Scope: Expected behaviors for Conduit’s WS protocol server to match typical developer assumptions for subscribe/flow control and errors.

## 1. Connect & Subscribe

- Endpoint: `GET /v1/subscribe?stream=...`
- On connect: optional `{status:"subscribed", stream}` message (DSL rule can emit)
- Delivery: server pushes `{deliver: { id?, type, payload, ... }}` frames

## 2. Flow Control (Credit)

- Client sends `{credit: n}` to grant delivery capacity (n messages)
- Server respects credit window; one deliver decrements window by 1
- Acknowledgements:
  - `{ack: id}` — confirm handled; server may advance offset (future)
  - `{nack: id, delayMs?}` — request redelivery; may delay

## 3. Messages & Errors

- Messages expected as JSON text frames
- Error mapping to close codes:
  - 1003 UnknownOp (e.g., unexpected message shape)
  - 1007 Invalid JSON
  - 1011 Internal error
- Server may send `{error:{code,message}}` prior to close

## 4. Observability

- Log subscribe/unsubscribe events tagged by stream
- Expose counters for delivers, acks/nacks, credit grants, and window size

## 5. Defaults vs Overrides

- Defaults: JSON frames, credit model required for flow
- Overrides: DSL can map initial hello message, custom error codes, or per‑tenant limits

