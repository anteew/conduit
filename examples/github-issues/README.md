# GitHub Issues Clone - Built with Conduit

This example shows how to build a GitHub Issues-like system using Conduit's blob and queue backends.

## Architecture

```
Browser/API Client
   ↓ POST /issues (with attachment)
Conduit Gateway
   ↓ Routes via DSL
   ├─→ S3/MinIO (attachment → blobRef)
   ├─→ BullMQ (work order → queueRef)
   └─→ Control Protocol (envelope with refs)
        ↓
Agent: IssueTracker
   ↓ Receives envelope with blobRef + queueRef
   ↓ Fetches attachment from S3
   ↓ Processes issue
   ↓ Completes BullMQ job (triggers callback)
        ↓
Agent: Creator (gets callback)
   ↓ Receives "issue created" notification
```

## Setup

### 1. Start Redis (for BullMQ)

```bash
docker run -d -p 6379:6379 redis:alpine
```

### 2. Configure Conduit

```bash
# config/.env
CONDUIT_BLOB_BACKEND=local
CONDUIT_BLOB_LOCAL_DIR=./uploads

CONDUIT_QUEUE_BACKEND=bullmq
CONDUIT_QUEUE_REDIS_URL=redis://localhost:6379

CONDUIT_RULES=examples/github-issues/rules.yaml
```

### 3. Start Conduit

```bash
npm run dev
```

## Usage

### Create Issue (with attachment)

```bash
curl -X POST http://localhost:9087/issues \
  -F "title=Add dark mode" \
  -F "description=Users want dark mode" \
  -F "assignedTo=agents/Jen/inbox" \
  -F "attachment=@mockup.png"
```

**Response:**
```json
{
  "issueId": "issue-123",
  "queueRef": {
    "backend": "bullmq",
    "jobId": "job-456",
    "queue": "agents/Jen/inbox"
  },
  "attachments": [{
    "blobRef": {
      "blobId": "blob-1729...",
      "backend": "local",
      "sha256": "e3b0c442...",
      "size": 45678,
      "mime": "image/png"
    }
  }]
}
```

### Agent Receives Envelope

```json
{
  "to": "agents/Jen/inbox",
  "type": "issue.created",
  "payload": {
    "issueId": "issue-123",
    "title": "Add dark mode",
    "description": "Users want dark mode",
    "queueRef": {...},
    "attachments": [{
      "blobRef": {...},
      "filename": "mockup.png"
    }]
  }
}
```

### Agent Code

```typescript
import { fetchBlob, getQueueStatus } from 'conduit/helpers';

// Agent receives envelope
async function onEnvelope(env) {
  if (env.type === 'issue.created') {
    // Download attachment
    const mockup = await fetchBlob(env.payload.attachments[0].blobRef);
    
    // Process issue
    console.log('Implementing:', env.payload.title);
    await implementFeature(env.payload.description, mockup);
    
    // Complete job (triggers callback to creator)
    await completeJob(env.payload.queueRef, {
      resolution: 'Implemented dark mode',
      completedAt: new Date()
    });
  }
}
```

### Creator Gets Callback

```json
{
  "to": "agents/ProductOwner/inbox",
  "type": "issue.completed",
  "payload": {
    "issueId": "issue-123",
    "completedBy": "Jen",
    "resolution": "Implemented dark mode",
    "completedAt": "2025-10-19T..."
  }
}
```

## Features Demonstrated

✅ **File uploads** → blobRef (S3/local storage)  
✅ **Work queuing** → queueRef (BullMQ with Redis)  
✅ **Async callbacks** → completion notifications  
✅ **Agent helpers** → easy blob fetching  
✅ **Zero HTTP code** → agents only process envelopes  

## Developer Experience

**Without Conduit:** ~500-1000 lines
- HTTP server setup
- Multipart parsing
- S3 integration
- Redis/BullMQ setup
- Callback wiring

**With Conduit:** ~50-100 lines
- YAML rules (20 lines)
- Agent logic (30-80 lines)
