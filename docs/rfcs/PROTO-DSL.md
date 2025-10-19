# Proto DSL — Mapping External Protocols to Control Frames (Draft)

## Goals
- Declarative mapping of HTTP/WS messages ↔ control frames
- Small surface: when (match), map (transform), send (frame/response), onError

## Primitives
- when: match path, method, headers (regex/glob); ws.message.type for WS op
- map: JSONPath/JSONPointer select; simple functions (coalesce, default, pick)
- send: toFrame(type, fields) or toHttp(status, body)
- onError: map error codes to HTTP/WS responses

## Example (HTTP → enqueue)
```yaml
- when:
    method: POST
    path: /v1/enqueue
  map:
    to: $.body.to
    env: $.body.envelope
  send:
    frame:
      type: enqueue
      fields: { to: $to, env: $env }
  onError:
    InvalidEnvelope: { http: 400 }
    default: { http: 500 }
```

## Example (WS → grant/ack/nack)
```yaml
- when: { ws: message }
  map:
    credit: $.msg.credit
    ack: $.msg.ack
    nack: $.msg.nack
    delayMs: $.msg.delayMs
  send:
    frame: { type: grant, fields: { n: $credit } }
    frame: { type: ack, fields: { id: $ack } }
    frame: { type: nack, fields: { id: $nack, delayMs: $delayMs } }
```

## Safety & Limits
- Allowlisted paths and fields; body size caps; timeouts
- Deterministic order; explicit fallthrough

