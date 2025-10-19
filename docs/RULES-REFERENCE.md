# Rules.yaml Quick Reference

Complete reference for `config/rules.yaml` DSL configuration.

## Table of Contents
- [Default Rules Overview](#default-rules-overview)
- [Per-Tenant Overlays](#per-tenant-overlays)
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

## Per-Tenant Overlays

**T5062**: Tenant overlays enable per-tenant endpoint customization in multi-tenant deployments without requiring separate Conduit instances.

### How Overlays Work

1. **Tenant identification**: Typically via `x-tenant-id` header (requires T5061 for automatic extraction)
2. **Rule precedence**: Tenant rules are evaluated FIRST, before base rules
3. **Fallback behavior**: If no tenant rule matches, base rules apply
4. **Override vs Extend**: Tenant rules completely override (not merge) matching base rules

### Configuration Structure

```yaml
version: proto-dsl/v0

# Base rules apply to all tenants
rules:
  - id: health
    when: { http: { path: /health } }
    ...

# Tenant overlays (optional)
tenantOverlays:
  tenant-a:
    rules:
      - id: tenant-a-custom-webhook
        when:
          http:
            path: /v1/webhook/incoming
            headers:
              x-tenant-id: tenant-a
        ...
  
  tenant-b:
    rules:
      - id: tenant-b-priority-enqueue
        ...
```

### Precedence Rules

**Order of evaluation:**
1. Tenant overlay rules (if tenant identified and overlay exists)
2. Base rules (default for all tenants)
3. Hardcoded fallbacks (if no DSL rules configured)

**Example:**
- Request with `x-tenant-id: tenant-a` to `POST /v1/enqueue` → Checks `tenant-a` overlay first
- If tenant-a overlay has matching rule → Use tenant rule
- If no match in tenant-a overlay → Fall through to base rules
- If no match in base rules → Hardcoded endpoint (legacy support)

### Common Use Cases

#### 1. Tenant-Specific Endpoints

Add custom endpoints only for specific tenants:

```yaml
tenantOverlays:
  premium-tenant:
    rules:
      - id: premium-analytics
        when:
          http:
            path: /v1/analytics/advanced
            headers:
              x-tenant-id: premium-tenant
        send:
          frame:
            type: snapshot
            fields:
              view: analytics/premium/$query.metric
          respond:
            http:
              status: 200
              body: $result
```

#### 2. Tenant-Specific Auth Requirements

Enforce stricter authentication for specific tenants:

```yaml
tenantOverlays:
  secure-tenant:
    rules:
      - id: secure-tenant-enqueue
        when:
          http:
            method: POST
            path: /v1/enqueue
            headers:
              x-tenant-id: secure-tenant
              authorization: "Bearer *"
              x-api-key: "*"
        send:
          frame:
            type: enqueue
            fields:
              to: agents/secure-tenant/$body.to
              envelope: $body.envelope
          respond:
            http:
              status: 200
              body: $result
        onError:
          Unauthorized:
            http:
              status: 401
              body:
                error: MultiFactorRequired
                message: This tenant requires both Bearer token and API key
```

#### 3. Custom Error Handling

Provide tenant-specific error formats:

```yaml
tenantOverlays:
  enterprise-tenant:
    rules:
      - id: enterprise-snapshot
        when:
          http:
            path: /v1/snapshot
            headers:
              x-tenant-id: enterprise-tenant
        send:
          frame:
            type: snapshot
            fields:
              view: $query.view
          respond:
            http:
              status: 200
              body:
                status: success
                tenant: enterprise-tenant
                data: $result
        onError:
          UnknownView:
            http:
              status: 404
              body:
                status: error
                errorCode: ENTERPRISE_VIEW_NOT_FOUND
                errorMessage: View not found in enterprise catalog
                tenant: enterprise-tenant
                supportContact: support@enterprise.com
```

#### 4. Tenant-Specific Stream Routing

Route tenant traffic to isolated stream namespaces:

```yaml
tenantOverlays:
  isolated-tenant:
    rules:
      - id: isolated-subscribe
        when:
          ws:
            path: /v1/subscribe
            headers:
              x-tenant-id: isolated-tenant
        send:
          frame:
            type: subscribe
            fields:
              stream: isolated/tenant-namespace/$query.stream
          respond:
            ws:
              message:
                subscribed: true
                tenant: isolated-tenant
                isolation: namespace
```

### Best Practices

#### When to Use Overlays

**✅ Use overlays when:**
- You need tenant-specific endpoints (webhooks, custom APIs)
- You want different auth requirements per tenant
- You need custom error formats or response structures
- Tenants share the same infrastructure but need custom behavior
- You want to A/B test new features with specific tenants

**❌ Don't use overlays when:**
- Tenants require complete data isolation (use separate instances)
- Tenants need different performance SLAs (use separate instances)
- Compliance requires physical separation (use separate instances)
- Overhead of tenant routing impacts all tenants

#### Security Considerations

**1. Always validate tenant identity:**
```yaml
# BAD: No tenant validation
when:
  http:
    path: /v1/webhook/incoming

# GOOD: Explicit tenant header requirement
when:
  http:
    path: /v1/webhook/incoming
    headers:
      x-tenant-id: specific-tenant
```

**2. Namespace tenant data:**
```yaml
# GOOD: Tenant prefix on stream names
fields:
  to: agents/$headers.x-tenant-id/$body.stream
```

**3. Avoid tenant information in URLs:**
```yaml
# BAD: Tenant in path (can be spoofed)
path: /v1/tenants/tenant-a/data

# GOOD: Tenant in validated header
headers:
  x-tenant-id: tenant-a
```

**4. Audit tenant-specific rules:**
- Log all tenant rule matches
- Monitor for unauthorized cross-tenant access
- Regularly review tenant overlay configurations

#### Performance Implications

**Rule evaluation overhead:**
- Each request checks tenant overlays first (minimal overhead: ~0.1ms)
- Tenant overlays increase rule count (use specific matchers to optimize)
- Path wildcards in overlays can slow matching (prefer exact paths)

**Memory overhead:**
- Each tenant overlay adds to rule set in memory
- 100 tenants × 10 rules = 1000 additional rules (~50KB)
- Negligible for typical deployments (<1000 tenants)

**Optimization tips:**
1. Use specific path matchers (not wildcards) in overlays
2. Limit overlay rules to truly custom behavior
3. Share common logic in base rules
4. Monitor rule evaluation time in metrics

#### Testing Overlays

**Unit test each tenant overlay:**
```bash
# Test tenant-specific endpoint
curl -H "x-tenant-id: tenant-a" \
     -H "Authorization: Bearer token" \
     -X POST http://localhost:9087/v1/enqueue \
     -d '{"to":"test","envelope":{}}'

# Verify fallback to base rules
curl -H "x-tenant-id: unknown-tenant" \
     -X POST http://localhost:9087/v1/enqueue \
     -d '{"to":"test","envelope":{}}'

# Verify no tenant header uses base rules
curl -X POST http://localhost:9087/v1/enqueue \
     -d '{"to":"test","envelope":{}}'
```

**Integration test tenant isolation:**
```typescript
// Verify tenant A cannot access tenant B resources
const tenantAResponse = await fetch('/v1/snapshot?view=data', {
  headers: { 'x-tenant-id': 'tenant-a' }
});
const tenantBResponse = await fetch('/v1/snapshot?view=data', {
  headers: { 'x-tenant-id': 'tenant-b' }
});
// Responses should differ or isolate data
```

### Deployment Considerations

**1. Configuration size:**
- Large overlay sets should be validated on startup
- Consider splitting overlays into separate files (future enhancement)

**2. Hot reload:**
- Overlay changes require service restart (no hot reload in v0)
- Plan maintenance windows for overlay updates

**3. Monitoring:**
- Track rule match rates per tenant
- Alert on tenants with no matching rules (misconfigurations)
- Monitor overlay evaluation latency

**4. Documentation:**
- Document each tenant's custom endpoints
- Maintain changelog of tenant overlay updates
- Share overlay examples with tenant integration teams

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
