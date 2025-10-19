# Backend Routing - Blob & Queue References (v1.1)

**Status:** Design  
**Created:** 2025-10-19  
**Scope:** Universal edge gateway routing to storage and queue backends

## Problem Statement

Developers building agent workflows need to:
1. Accept large file uploads (can't fit in control frames)
2. Route work to existing queue systems (RabbitMQ, Kafka, etc.)
3. **NOT write HTTP/multipart/queue integration glue code**

Agents should receive small envelopes with **references** to stored data, then fetch at their own pace.

## Solution: Reference Pattern

### Two Reference Types

**1. blobRef** - For large binary data
```json
{
  "blobId": "blob-1729372800000-a1b2c3",
  "backend": "s3",
  "sha256": "e3b0c44298fc...",
  "size": 104857600,
  "mime": "application/pdf",
  "bucket": "uploads",
  "key": "2025/10/19/blob-xyz.pdf"
}
```

**2. queueRef** - For async work/events
```json
{
  "backend": "bullmq",
  "jobId": "job-456",
  "queue": "agents/Worker/inbox",
  "state": "waiting",
  "timestamp": "2025-10-19T...",
  "priority": 1
}
```

## DSL Integration

### Blob Backend Routing

```yaml
rules:
  - id: upload-to-s3
    when:
      http:
        method: POST
        path: /upload
        contentType: multipart/form-data
    send:
      blob:
        backend: s3
        bucket: uploads
        computeHash: true
      respond:
        http:
          status: 201
          body:
            blobRef: $blobRef
    onComplete:
      # Optional: enqueue envelope with blobRef
      frame:
        type: enqueue
        fields:
          to: agents/FileProcessor/inbox
          env:
            type: file_uploaded
            payload: { blobRef: $blobRef }
```

### Queue Backend Routing

```yaml
rules:
  - id: work-order-to-queue
    when:
      http:
        method: POST
        path: /work-orders
    send:
      queue:
        backend: bullmq
        queue: work-orders
        message: $body
        options:
          priority: $body.priority
          jobId: $body.idempotencyKey
      respond:
        http:
          status: 202
          body:
            accepted: true
            queueRef: $queueRef
    onComplete:
      # Notify monitoring agent
      frame:
        type: enqueue
        fields:
          to: agents/Monitor/inbox
          env:
            type: work_queued
            payload: { queueRef: $queueRef, workOrder: $body }

  - id: notification-to-queue
    when:
      http:
        path: /notifications
    send:
      queue:
        backend: bullmq
        queue: notifications
        message: $body
      # No HTTP response - fire and forget
```

## Implementation Architecture

### Backend Interface

```typescript
// src/backends/backend-sink.ts

export interface BlobRef {
  blobId: string;
  backend: string;
  sha256: string;
  size: number;
  mime: string;
  // Backend-specific fields
  bucket?: string;      // S3/MinIO
  key?: string;         // S3/MinIO
  path?: string;        // Local
  url?: string;         // Presigned URL
}

export interface QueueRef {
  backend: string;
  jobId: string;
  queue: string;
  state?: 'waiting' | 'active' | 'completed' | 'failed';
  timestamp: string;
  // Backend-specific fields
  offset?: number;      // Kafka
  partition?: number;   // Kafka
  messageId?: string;   // RabbitMQ/SQS
  priority?: number;    // BullMQ/RabbitMQ
}

export interface BlobSink {
  store(stream: NodeJS.ReadableStream, metadata: BlobMetadata): Promise<BlobRef>;
  fetch(blobRef: BlobRef): Promise<NodeJS.ReadableStream>;
  delete(blobRef: BlobRef): Promise<void>;
}

export interface QueueSink {
  send(message: any, options?: QueueOptions): Promise<QueueRef>;
  getStatus(ref: QueueRef): Promise<QueueStatus>;
}
```

### Blob Backend Implementations

```typescript
// src/backends/blob/local.ts
export class LocalBlobSink implements BlobSink {
  async store(stream, metadata) {
    const blobId = generateBlobId();
    const filePath = path.join(this.dir, blobId);
    const hash = crypto.createHash('sha256');
    
    // Stream to disk + compute SHA256
    await pipeline(stream, hash, fs.createWriteStream(filePath));
    
    // Write metadata
    await fs.writeFile(`${filePath}.meta.json`, JSON.stringify({
      blobId, sha256: hash.digest('hex'), ...metadata
    }));
    
    return { blobId, backend: 'local', path: filePath, ... };
  }
}

// src/backends/blob/s3.ts
export class S3BlobSink implements BlobSink {
  async store(stream, metadata) {
    const key = `${new Date().toISOString().split('T')[0]}/${generateBlobId()}`;
    
    const upload = await this.s3.upload({
      Bucket: this.bucket,
      Key: key,
      Body: stream,
      ContentType: metadata.mime,
      Metadata: { sha256: '...', uploadedBy: metadata.clientIp }
    }).promise();
    
    return {
      blobId: key,
      backend: 's3',
      bucket: this.bucket,
      key,
      url: upload.Location,
      ...
    };
  }
}
```

### Queue Backend Implementations

```typescript
// src/backends/queue/bullmq.ts
import { Queue } from 'bullmq';

export class BullMQSink implements QueueSink {
  private queues = new Map<string, Queue>();
  
  async send(message: any, options?: any) {
    const queue = this.getQueue(options.queue);
    
    const job = await queue.add(
      options.jobName || 'task',
      message,
      {
        jobId: options.jobId,        // Idempotency
        priority: options.priority,
        delay: options.delayMs,
        attempts: options.maxRetries || 3,
        backoff: { type: 'exponential', delay: 1000 }
      }
    );
    
    return {
      backend: 'bullmq',
      jobId: job.id,
      queue: options.queue,
      state: 'waiting',
      timestamp: new Date().toISOString()
    };
  }
  
  async getStatus(ref: QueueRef) {
    const queue = this.getQueue(ref.queue);
    const job = await queue.getJob(ref.jobId);
    return {
      state: await job.getState(),
      progress: job.progress,
      returnvalue: job.returnvalue
    };
  }
}
```

## Configuration

**Environment Variables:**

```bash
# Blob Backends
CONDUIT_BLOB_BACKEND=local|s3|minio
CONDUIT_BLOB_LOCAL_DIR=/tmp/blobs
CONDUIT_BLOB_S3_REGION=us-east-1
CONDUIT_BLOB_S3_BUCKET=uploads
CONDUIT_BLOB_S3_ACCESS_KEY_ID=...
CONDUIT_BLOB_S3_SECRET_ACCESS_KEY=...
CONDUIT_BLOB_MINIO_ENDPOINT=http://localhost:9000

# Queue Backends
CONDUIT_QUEUE_BACKEND=bullmq|kafka|mqtt|none
CONDUIT_QUEUE_REDIS_URL=redis://localhost:6379
CONDUIT_QUEUE_KAFKA_BROKERS=localhost:9092
CONDUIT_QUEUE_MQTT_URL=mqtt://localhost:1883
```

**config/backends.yaml** (optional):
```yaml
blob:
  default: s3
  backends:
    s3:
      bucket: uploads
      region: us-east-1
      acl: private
    minio:
      endpoint: http://localhost:9000
      bucket: uploads
    local:
      dir: /tmp/blobs

queue:
  default: bullmq
  backends:
    bullmq:
      redis: redis://localhost:6379
      defaultJobOptions:
        attempts: 3
        backoff: exponential
```

## Use Case: GitHub Issues Clone

**User creates issue via browser form:**

```
POST /issues
{
  "title": "Add dark mode",
  "description": "...",
  "attachments": [<file upload>],
  "assignedTo": "agents/Jen/inbox"
}
```

**Conduit processes via DSL:**
1. Extract file attachment → upload to S3 → get blobRef
2. Queue work order to BullMQ → get queueRef
3. Enqueue envelope to assigned agent:

```json
{
  "to": "agents/Jen/inbox",
  "type": "issue.created",
  "payload": {
    "issueId": "issue-123",
    "title": "Add dark mode",
    "queueRef": {
      "backend": "bullmq",
      "jobId": "job-456",
      "queue": "agents/Jen/inbox"
    },
    "attachments": [{
      "blobRef": {
        "blobId": "blob-789",
        "backend": "s3",
        "sha256": "...",
        "mime": "image/png"
      },
      "filename": "mockup.png"
    }]
  }
}
```

**Agent Jen processes:**
```typescript
// Jen's agent receives envelope
onEnvelope(async (env) => {
  if (env.type === 'issue.created') {
    // Download attachment if needed
    const mockup = await fetchBlob(env.payload.attachments[0].blobRef);
    
    // Process issue
    await implementFeature(env.payload);
    
    // Complete (BullMQ auto-notifies creator)
    await completeJob(env.payload.queueRef.jobId, {
      resolution: "Implemented dark mode"
    });
  }
});
```

**Creator gets callback:**
```json
{
  "to": "agents/Creator/inbox",
  "type": "issue.completed",
  "payload": {
    "issueId": "issue-123",
    "completedBy": "Jen",
    "resolution": "Implemented dark mode"
  }
}
```

## Why This is Powerful

**Developer writes:**
- ✅ YAML routing rules (10-20 lines)
- ✅ Agent processing logic (~50-100 lines)

**Developer does NOT write:**
- ❌ HTTP server code
- ❌ Multipart parsing
- ❌ S3 SDK integration
- ❌ BullMQ job creation
- ❌ Callback wiring
- ❌ Retry logic

**Saved: 500-1000 lines of glue code per agent!**

## Next Steps

I'll implement:
1. **Blob backends** (S3, MinIO, Local) - production-ready
2. **Queue backend** (BullMQ) - with callbacks
3. **DSL integration** - `send.blob` and `send.queue`
4. **Helper libraries** - For agents to fetch blobs/check queue status
5. **Examples** - GitHub Issues clone
6. **Tests** - Integration tests

Should I start building? 🚀
