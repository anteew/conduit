# Rules.yaml Quick Reference

Complete reference for `config/rules.yaml` DSL configuration.

## Table of Contents
- [Default Rules Overview](#default-rules-overview)
- [Selectors](#selectors)
- [Frame Types](#frame-types)
- [Error Codes](#error-codes)
- [HTTP Matchers](#http-matchers)
- [WebSocket Matchers](#websocket-matchers)
- [Response Formats](#response-formats)
- [Examples](#examples)

## Default Rules Overview

### HTTP Endpoints

| Rule ID | Method | Path | Frame Type | Description |
|---------|--------|------|------------|-------------|
| health-check | GET | /health | - | Health check (direct response) |
| http-enqueue | POST | /v1/enqueue | enqueue | Queue message to stream |
| http-stats | GET | /v1/stats | stats | Get stream statistics |
| http-snapshot | GET | /v1/snapshot | snapshot | Get view snapshot |
| http-metrics | GET | /v1/metrics | metrics | Get system metrics |

### WebSocket Rules

| Rule ID | Trigger | Frame Type | Description |
|---------|---------|------------|-------------|
| ws-connection-subscribe | Connection to /v1/subscribe | subscribe | Subscribe to stream |
| ws-message-grant | Message with `credit` field | grant | Issue flow control credit |
| ws-message-ack | Message with `ack` field | ack | Acknowledge message |
| ws-message-nack | Message with `nack` field | nack | Negative acknowledge |

## Selectors

Selectors extract data from the request context:

| Selector | Description | Example |
|----------|-------------|---------|
| `$body.field` | HTTP request body field | `$body.to` |
| `$query.param` | URL query parameter | `$query.stream` |
| `$headers.name` | HTTP header (lowercase) | `$headers.authorization` |
| `$method` | HTTP method | `GET`, `POST` |
| `$path` | Request path | `/v1/enqueue` |
| `$message.field` | WebSocket message field | `$message.credit` |
| `$result` | Frame operation result | `$result.id` |
| `$error` | Error details | `$error.code` |

### Nested Fields

Access nested object fields with dot notation:
- `$body.envelope.id`
- `$result.streams[0].id`
- `$query.filter.status`

## Frame Types

Control protocol frames that can be sent:

| Frame Type | Purpose | Required Fields | Returns |
|------------|---------|----------------|---------|
| `enqueue` | Queue message | `to`, `envelope` | `{id: string}` |
| `subscribe` | Subscribe to stream | `stream` | `{subscribed: string}` |
| `grant` | Issue credit | `credit` | `{granted: number}` |
| `ack` | Acknowledge | `id` | `{acked: string}` |
| `nack` | Negative ack | `id`, `delayMs` | `{nacked: string}` |
| `stats` | Get stats | `stream` | `{depth, inflight, ...}` |
| `snapshot` | Get snapshot | `view` | View data |
| `metrics` | Get metrics | - | `{streams: [...]}` |
| `hello` | Handshake | `version`, `features` | Connection info |

## Error Codes

Default error codes and mappings:

| Code | HTTP Status | WS Close | Description |
|------|-------------|----------|-------------|
| InvalidJSON | 400 | 1007 | Malformed JSON |
| UnknownView | 404 | - | View not found |
| UnknownStream | 404 | - | Stream not found |
| InvalidEnvelope | 400 | - | Bad envelope format |
| UnknownOp | 400 | 1003 | Unknown operation |
| Unauthorized | 401 | - | Auth required |
| Forbidden | 403 | - | Access denied |
| Backpressure | 429 | - | Rate limited |
| Timeout | 504 | - | Request timeout |
| Internal | 500 | 1011 | Internal error |

## HTTP Matchers

### Basic Match

```yaml
when:
  http:
    method: POST
    path: /v1/enqueue
```

### Multiple Methods

```yaml
when:
  http:
    method: [GET, POST]
    path: /v1/data
```

### Query Parameters

```yaml
when:
  http:
    method: GET
    path: /v1/stats
    query:
      stream: test/stream  # Exact match
```

### Headers

```yaml
when:
  http:
    method: POST
    path: /v1/secure
    headers:
      authorization: "Bearer secret-token"
      content-type: application/json
```

### Path Wildcards

```yaml
when:
  http:
    method: GET
    path: /v1/streams/*  # Matches /v1/streams/foo, /v1/streams/bar
```

### Combinators

```yaml
# AND - All conditions must match
when:
  all:
    - http: { method: POST }
    - http: { path: /v1/enqueue }

# OR - Any condition matches
when:
  any:
    - http: { path: /v1/enqueue }
    - http: { path: /v1/publish }

# NOT - Condition must not match
when:
  not:
    http:
      headers:
        x-debug: "true"
```

## WebSocket Matchers

### Connection Match

```yaml
when:
  ws:
    path: /v1/subscribe
    query:
      stream: agents/test/inbox
```

### Message Match - Field Presence

```yaml
when:
  ws:
    message:
      json.has: credit  # Message must have 'credit' field
```

### Message Match - Field Value

```yaml
when:
  ws:
    message:
      json.match:
        type: subscribe
        stream: agents/*
```

### Message Type

```yaml
when:
  ws:
    message:
      type: text  # or 'binary'
      json.has: data
```

## Response Formats

### Direct HTTP Response

```yaml
send:
  http:
    status: 200
    body:
      ok: true
      message: "Success"
```

### Frame with HTTP Response

```yaml
send:
  frame:
    type: enqueue
    fields:
      to: $body.to
      envelope: $body.envelope
    respond:
      http:
        status: 200
        body: $result
```

### Custom HTTP Response from Frame Result

```yaml
send:
  frame:
    type: enqueue
    fields:
      to: $body.to
      envelope: $body.envelope
    respond:
      http:
        status: 202
        body:
          success: true
          messageId: $result.id
          enqueuedAt: $result.ts
```

### WebSocket Response

```yaml
send:
  ws:
    message:
      status: subscribed
      stream: $query.stream
```

### WebSocket Close

```yaml
send:
  ws:
    close:
      code: 1008
      reason: Stream required
```

## Examples

### Custom Authenticated Endpoint

```yaml
- id: secure-data
  when:
    http:
      method: GET
      path: /v1/secure/data
      headers:
        authorization: "Bearer secret-token"
  send:
    frame:
      type: snapshot
      fields:
        view: $query.view
      respond:
        http:
          status: 200
          body: $result
  onError:
    Unauthorized:
      http:
        status: 401
        body:
          error: Unauthorized
          message: Valid bearer token required
```

### Multi-Stream Stats

```yaml
- id: multi-stats
  when:
    http:
      method: POST
      path: /v1/stats/batch
  send:
    frame:
      type: stats
      fields:
        stream: $body.streams[0]
      respond:
        http:
          status: 200
          body:
            results: [$result]
```

### Conditional Response

```yaml
- id: enqueue-with-priority
  when:
    http:
      method: POST
      path: /v1/enqueue
  map:
    priority: $body.priority
  send:
    frame:
      type: enqueue
      fields:
        to: $body.to
        envelope: $body.envelope
      respond:
        http:
          status: 202
          body:
            id: $result.id
            priority: $priority
            queuedAt: $result.ts
```

### Custom WebSocket Command

```yaml
- id: ws-pause-stream
  when:
    ws:
      message:
        json.has: pause
  send:
    frame:
      type: grant
      fields:
        credit: 0
    respond:
      ws:
        message:
          paused: true
          stream: $message.stream
```

### Catch-All 404

```yaml
- id: http-404
  when:
    http:
      path: /*
  send:
    http:
      status: 404
      body:
        error: NotFound
        message: Endpoint not found
```

## Advanced Patterns

### Rate Limiting

```yaml
- id: rate-limited-enqueue
  when:
    http:
      method: POST
      path: /v1/enqueue
  send:
    frame:
      type: enqueue
      fields:
        to: $body.to
        envelope: $body.envelope
      respond:
        http:
          status: 200
          body: $result
  onError:
    Backpressure:
      http:
        status: 429
        headers:
          retry-after: "60"
        body:
          error: TooManyRequests
          retryAfter: 60
```

### Multi-Tenant Routing

```yaml
- id: tenant-enqueue
  when:
    http:
      method: POST
      path: /v1/enqueue
      headers:
        x-tenant-id: "*"
  send:
    frame:
      type: enqueue
      fields:
        to: "agents/$headers.x-tenant-id/$body.stream"
        envelope: $body.envelope
      respond:
        http:
          status: 200
          body: $result
```

### Validation with Assert

```yaml
- id: validated-enqueue
  when:
    http:
      method: POST
      path: /v1/enqueue
  assert:
    to: { required: true, type: string, minLength: 1 }
    envelope: { required: ["id", "type", "payload"] }
  send:
    frame:
      type: enqueue
      fields:
        to: $body.to
        envelope: $body.envelope
      respond:
        http:
          status: 200
          body: $result
```

## See Also

- [PROTO-DSL-v0.md](../docs/rfcs/PROTO-DSL-v0.md) - Complete DSL specification
- [CONTROL-PROTOCOL-v1.md](../docs/rfcs/CONTROL-PROTOCOL-v1.md) - Frame definitions
- [README.md](../README.md) - Getting started guide
