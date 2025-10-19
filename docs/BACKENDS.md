# Backend Configuration Guide

Conduit supports pluggable backends for blob storage and message queuing, enabling agents to work with references instead of raw data.

## Blob Backends

Store large files and binary data outside the control protocol.

### Local Filesystem

**Best for:** Development, small deployments

```bash
CONDUIT_BLOB_BACKEND=local
CONDUIT_BLOB_LOCAL_DIR=/var/lib/conduit/blobs
```

**Pros:** Simple, no dependencies  
**Cons:** Not distributed, no redundancy

### Amazon S3

**Best for:** Production, AWS deployments

```bash
CONDUIT_BLOB_BACKEND=s3
CONDUIT_BLOB_S3_REGION=us-east-1
CONDUIT_BLOB_S3_BUCKET=my-uploads
CONDUIT_BLOB_S3_ACCESS_KEY_ID=AKIA...
CONDUIT_BLOB_S3_SECRET_ACCESS_KEY=...
```

**Pros:** Durable, scalable, integrated with AWS  
**Cons:** Costs, external dependency

### MinIO

**Best for:** Self-hosted, S3-compatible storage

```bash
CONDUIT_BLOB_BACKEND=minio
CONDUIT_BLOB_MINIO_ENDPOINT=http://localhost:9000
CONDUIT_BLOB_MINIO_BUCKET=uploads
CONDUIT_BLOB_MINIO_ACCESS_KEY=minioadmin
CONDUIT_BLOB_MINIO_SECRET_KEY=minioadmin
```

**Pros:** Self-hosted, S3-compatible API  
**Cons:** Requires MinIO service

## Queue Backends

Route work to job queues with callbacks and retries.

### BullMQ (Redis)

**Best for:** Node.js workflows, job processing

```bash
CONDUIT_QUEUE_BACKEND=bullmq
CONDUIT_QUEUE_REDIS_URL=redis://localhost:6379
CONDUIT_QUEUE_PREFIX=conduit
```

**Features:**
- ✅ Job priorities
- ✅ Delays and scheduling
- ✅ Retries with exponential backoff
- ✅ Parent-child jobs (callbacks)
- ✅ Web UI (Bull Board)

**Pros:** Full-featured, great for task queues  
**Cons:** Requires Redis

### None (Disabled)

```bash
CONDUIT_QUEUE_BACKEND=none
# or omit CONDUIT_QUEUE_BACKEND entirely
```

Queue features disabled, only blob storage and control protocol.

## Reference Types

### BlobRef

```json
{
  "blobId": "blob-1729372800000-a1b2c3d4e5f6g7h8",
  "backend": "s3",
  "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "size": 3145728,
  "mime": "application/pdf",
  "uploadedAt": "2025-10-19T12:00:00.000Z",
  "bucket": "uploads",
  "key": "2025/10/19/blob-xyz.pdf",
  "region": "us-east-1"
}
```

### QueueRef

```json
{
  "backend": "bullmq",
  "jobId": "job-456",
  "queue": "agents/Worker/inbox",
  "state": "waiting",
  "timestamp": "2025-10-19T12:00:00.000Z",
  "priority": 1
}
```

## Agent Helpers

```typescript
import { fetchBlob, getBlobAsBuffer, getQueueStatus } from 'conduit/helpers';

// Fetch blob as stream
const stream = await fetchBlob(blobRef);

// Fetch blob as buffer (for small files)
const buffer = await getBlobAsBuffer(blobRef);

// Fetch blob as string
const text = await getBlobAsString(blobRef, 'utf8');

// Check job status
const status = await getQueueStatus(queueRef);
console.log(status.state); // 'waiting' | 'active' | 'completed' | 'failed'

// Cancel job
await cancelJob(queueRef);
```

## Production Recommendations

### Blob Storage
- **Dev:** Local filesystem
- **Staging:** MinIO
- **Production:** S3 with lifecycle rules, versioning, encryption

### Queue Backend
- **All environments:** BullMQ + Redis Sentinel (HA)
- **Alternative:** Consider PostgreSQL-based queue (pg-boss) if already using Postgres

### Security
- S3: Use IAM roles, not access keys in env vars
- Redis: Enable AUTH, use TLS
- MinIO: Use strong passwords, network isolation

### Monitoring
- Track blob storage usage (disk/S3 costs)
- Monitor queue depth and processing rate
- Alert on failed jobs

## Comparison: Control Protocol vs Backends

| Data Type | Size | Method | Why |
|-----------|------|--------|-----|
| Small JSON | <100KB | Control protocol envelope | Fast, efficient |
| Large JSON | 100KB-10MB | Upload → blobRef | Memory protection |
| Binary files | Any | Upload → blobRef | Can't encode in JSON |
| Work orders | Any | Queue → queueRef | Async processing, retries |
| Events | Small | Control protocol | Real-time delivery |

## Example: Multi-Backend Workflow

**Scenario:** Document processing service

1. User uploads 50MB PDF via browser form
2. Conduit streams to S3 → returns blobRef
3. Conduit queues to BullMQ "ocr-jobs" → returns queueRef
4. Conduit enqueues envelope to agents/OCRWorker/inbox with both refs
5. OCR agent receives envelope
6. Agent fetches PDF from S3 (at its pace)
7. Agent processes OCR
8. Agent completes BullMQ job → triggers callback
9. Original requester gets notification

**Total glue code developer writes:** ~50 lines (agent logic only)
