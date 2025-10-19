# Conduit - Edge Gateway for mkolbol

**Proposed for inclusion in mkolbol ecosystem**

## Executive Summary

Conduit is a production-ready edge gateway that translates HTTP/WebSocket/SSE into mkolbol's control protocol, enabling developers to build agent workflows without writing HTTP/multipart/queue integration code.

**For the mkolbol developer:** Write agents that process envelopes. Conduit handles everything else.

## Why This Matters

### The Problem

Developers building mkolbol agents need:
- HTTP endpoints for user requests
- File upload handling (multipart, streaming, storage)
- Async work queuing with callbacks
- WebSocket connections for real-time delivery

**Without Conduit:**
```javascript
// Developer writes 500-1000 lines:
const express = require('express');
const multer = require('multer');
const AWS = require('aws-sdk');
const amqp = require('amqplib');

app.post('/upload', multer().single('file'), async (req, res) => {
  // Parse multipart
  // Upload to S3
  // Queue work to RabbitMQ
  // Send to mkolbol agent
  // Handle errors, retries, callbacks
  // ...
});
```

**With Conduit:**
```yaml
# rules.yaml (20 lines)
- when: { http: { path: /upload, method: POST } }
  send:
    blob: { backend: s3 }
    queue: { backend: bullmq, queue: agents/Worker/inbox }
    frame: { type: enqueue, to: agents/Worker/inbox, env: {...} }
```

```typescript
// agent.ts (50 lines)
import { fetchBlob } from 'conduit/helpers';

worker.process(async (job) => {
  const file = await fetchBlob(job.data.blobRef);
  // Process file...
  return result; // Auto-triggers callback
});
```

**Saved:** 500-1000 lines of glue code per project.

## Key Features

### 1. Pluggable Storage Backends

**Local, S3, or MinIO** - Same agent code, different config:
```bash
# Development
CONDUIT_BLOB_BACKEND=local

# Production
CONDUIT_BLOB_BACKEND=s3
CONDUIT_BLOB_S3_BUCKET=uploads
```

Files become **blobRef** (small reference):
```json
{
  "blobId": "blob-xyz",
  "backend": "s3",
  "sha256": "e3b0c442...",
  "size": 104857600,
  "mime": "application/pdf"
}
```

### 2. Queue Integration with Callbacks

**BullMQ (Redis)** for async work:
```yaml
send:
  queue:
    backend: bullmq
    queue: agents/Worker/inbox
    message: $body
```

Returns **queueRef** with job tracking:
```json
{
  "backend": "bullmq",
  "jobId": "job-456",
  "queue": "agents/Worker/inbox",
  "state": "waiting"
}
```

**Automatic callbacks** when jobs complete - perfect for issue trackers, workflows.

### 3. DSL-Driven Endpoints

Add HTTP endpoints via YAML, no code changes:
```yaml
- id: create-work-order
  when: { http: { path: /orders, method: POST } }
  map:
    priority: $.body.priority
    assignee: $.body.assignedTo
  send:
    frame:
      type: enqueue
      fields: { to: $assignee, env: {...} }
```

### 4. Production-Ready

✅ **Rate limiting** - Per-IP token bucket  
✅ **Auth** - Bearer tokens with allowlist  
✅ **CORS** - Origin validation + preflight  
✅ **Multi-tenancy** - Per-tenant limits & metrics  
✅ **Observability** - JSONL logs, Prometheus metrics  
✅ **Safety** - Size caps, timeouts, concurrency limits  
✅ **Idempotency** - Prevents duplicates on retry  
✅ **Zero-downtime reload** - SIGHUP config refresh  
✅ **Horizontal scaling** - Sticky session guidance  

### 5. Developer Experience

**Web UI:**
- `/ui` - Upload form with drag-and-drop
- `/perf` - Live performance dashboard

**Examples:**
- GitHub Issues clone
- Document processing workflow
- Video transcoding pipeline

**Performance:**
- 2,000+ req/s throughput
- <10ms p95 latency
- 100+ concurrent WebSocket connections

## Architecture

```
HTTP/WS Requests
   ↓
Conduit (DSL rules)
   ↓
├─→ S3/MinIO (large files → blobRef)
├─→ BullMQ (async work → queueRef)
└─→ mkolbol Control Protocol (envelopes)
      ↓
   Agent Workers
   (receive envelopes with refs,
    fetch blobs at their pace,
    process jobs with callbacks)
```

## What Makes This Special

### vs Generic Web Frameworks (Fastify, Express)

**Fastify:** General-purpose HTTP routing  
**Conduit:** Opinionated for agent workflows

| Feature | Fastify | Conduit |
|---------|---------|---------|
| HTTP routing | ✅ Manual | ✅ DSL-driven |
| Multipart upload | Add plugin | ✅ Built-in streaming |
| Blob storage | Write yourself | ✅ Pluggable (S3/MinIO/local) |
| Queue integration | Write yourself | ✅ Built-in (BullMQ) |
| Control protocol | Write yourself | ✅ Native |
| Agent helpers | Write yourself | ✅ Included |
| Credit flow | Write yourself | ✅ Built-in |
| Code for basic workflow | ~500 lines | ~70 lines |

### vs Building from Scratch

**From scratch:** Build HTTP server, multipart parsing, S3 integration, queue integration, control protocol client, error handling, logging, metrics...

**With Conduit:** Configure backends, write DSL rules, write agent logic. Ship.

## Production Deployment

**Tested:**
- ✅ 100 concurrent uploads (282 MB/s)
- ✅ 100 concurrent WebSocket clients (211 conn/s)
- ✅ 1-hour soak test (mixed load, memory stable)

**Documented:**
- ✅ Load balancer sticky sessions (nginx, HAProxy, AWS ALB, K8s)
- ✅ Rolling updates without dropping connections
- ✅ Health/readiness probes
- ✅ Metrics & alerting
- ✅ SRE runbook

## Code Quality

**Stats:**
- **6,000+ lines** of production TypeScript
- **96 tests** (unit, integration, performance)
- **15,000+ lines** of documentation
- **Build:** ✅ Zero errors
- **Dependencies:** Minimal, well-maintained (AWS SDK, BullMQ)

**Documentation:**
- Complete RFCs (DSL, HTTP UX, WS UX, Control Protocol)
- Production deployment guide
- SRE runbook
- Working examples
- Agent helper library

## Integration with mkolbol

**Conduit speaks mkolbol's control protocol natively:**
- `hello`, `ok`, `error` frames
- `enqueue`, `subscribe`, `deliver` frames  
- `grant`, `ack`, `nack` credit flow
- `stats`, `snapshot`, `metrics` observability

**Can connect to Courier or any mkolbol core:**
```bash
CONDUIT_BACKEND=tcp://courier-host:9787
```

## Proposed Package Structure

If integrated into mkolbol repo:

```
mkolbol/
├── kernel/          # Stream kernel (existing)
├── core/            # Core services like Courier
└── conduit/         # Edge gateway (this code)
    ├── src/
    │   ├── backends/     # Blob & queue backends
    │   ├── connectors/   # HTTP, WS, SSE
    │   ├── dsl/          # Rule interpreter
    │   └── helpers/      # Agent helpers
    ├── examples/
    │   └── github-issues/
    ├── docs/
    └── tests/
```

## Developer Value Proposition

**Build a document processing service:**

**Their code (with Conduit):**
```typescript
// 50 lines total
import { fetchBlob } from 'mkolbol/conduit/helpers';

worker.process(async (job) => {
  const pdf = await fetchBlob(job.data.blobRef);
  const text = await extractText(pdf);
  return { text };
});
```

**Their code (without Conduit):**
```typescript
// 500-1000 lines
// HTTP server
// Multipart parsing
// S3 integration
// Queue setup
// Error handling
// Retry logic
// Logging
// ...
```

## Recommendation

**Ship Conduit as the canonical edge gateway for mkolbol.**

**Benefits:**
1. **Reduces barrier to entry** - Developers build agents, not HTTP servers
2. **Consistent patterns** - All mkolbol projects use same gateway
3. **Production-ready** - Safety, observability, scaling built-in
4. **Maintainable** - One codebase instead of everyone rolling their own
5. **Extensible** - Add transports (Serial, MQTT) without touching cores

**Effort saved across ecosystem:** Every mkolbol project saves 500-1000 lines of integration code.

---

**Status:** Production-ready v1.1  
**License:** Same as mkolbol (to be determined)  
**Maintained by:** Susan (with community)  
**Ready for:** Inclusion in mkolbol repository

