# Conduit HTTP Gateway — Developer UX v0

Status: Draft v0
Editors: Ava

Scope: Expected behaviors for Conduit’s HTTP protocol server so developers can rely on “common HTTP assumptions” without learning internals first. Configurable via DSL and env.

## 1. Endpoints & Semantics

- Health: `GET /health` → `{ok,version,features}` (200)
- Enqueue: `POST /v1/enqueue` (application/json)
  - Body: `{ to: string, envelope: object }`
  - Response: `{ id }` (200), common errors mapped to JSON
- Stats: `GET /v1/stats?stream=...` → `{ depth, inflight, ... }` (200)
- Metrics: `GET /v1/metrics` → metrics JSON (200)
- Subscribe (WS): `GET /v1/subscribe?stream=...` upgrades to WebSocket (see WS UX)
- Upload (large bodies): `POST /v1/upload`
  - `Content-Type: application/octet-stream` (v0)
  - Default: 202 immediately; server drains in background (async mode)
  - `X-Upload-Mode: sync` or `CONDUIT_UPLOAD_SYNC=true`: drain fully then respond (measure end‑to‑end time)
  - Optional server sink: `CONDUIT_UPLOAD_FILE` or `CONDUIT_UPLOAD_DIR`

## 2. Content Types & Size Limits

- JSON (`application/json`)
  - Parsed for normal endpoints; capped by `CONDUIT_MAX_BODY` (default 1MB) → 413 on exceed
  - Encourage gzip for larger JSON (future: opt‑in `CONDUIT_REQUIRE_GZIP_JSON`)
- Binary/large (`application/octet-stream`)
  - Routed to upload path; streaming drain (no JSON parse)
  - Future: add `multipart/form-data` streaming of the file part (see §6)
- NDJSON/CSV (future)
  - Streamed line‑by‑line with limits; separate handlers

## 3. Errors & Status Codes

- 400 Invalid JSON, 404 UnknownStream/View, 429 Backpressure, 500 Internal
- Upload: 202 (async) or 200/204 (sync) — currently 202 always, body `{ok:true}`; sync preserves 202 but drains before finishing
- 413 Payload Too Large for JSON beyond cap

## 4. Auth, CORS, Rate Limits (future knobs)

- Token allowlist via `CONDUIT_TOKENS`
- CORS default deny; allowlist via env/DSL for static UI or external clients
- Basic per‑IP rate limit knobs for uploads and enqueue (to be added)

## 5. Observability

- Rule hits tagged by `ruleId`
- Upload drain logs: progress (~10MB) + final MB/s
- Optional sink verifies byte‑exact writes
- Record/replay (frames) remains available for control‑plane traffic

## 6. Multipart Form Uploads (T5010 - Implemented)

**Status:** ✅ Implemented with comprehensive safety limits

### Overview
Browser form uploads (`multipart/form-data`) are fully supported with streaming without buffering whole body.

### Implementation Details

**Endpoint:** `POST /v1/upload`

**Safety Limits:**
- Max file parts per request: 10 (default, configurable via `CONDUIT_MULTIPART_MAX_PARTS`)
- Max form fields: 50 (default, configurable via `CONDUIT_MULTIPART_MAX_FIELDS`)
- Max file size per part: 100MB (default, configurable via `CONDUIT_MULTIPART_MAX_PART_SIZE`)
- Exceeds limit → immediate 413 rejection with detailed error

**Features:**
- Accepts `multipart/form-data` with multiple files and fields
- Streams file bytes directly to disk (async mode) or buffers in memory (sync mode)
- Preserves all form fields in response
- Comprehensive instrumentation: per-file and total metrics
- Enhanced logging: file count, field count, bytes processed, MB/s rate, mode

**Upload Modes:**
- **async (default):** Stream files directly to disk using `fs.createWriteStream()` - minimal memory
- **sync:** Buffer files in memory then write with `fs.writeFileSync()` - higher memory usage

**Response Format:**
```json
{
  "success": true,
  "mode": "async",
  "fileCount": 2,
  "fieldCount": 1,
  "totalBytes": 10485760,
  "totalDuration": "4.50",
  "totalMbps": "2.22",
  "files": [
    {
      "fieldname": "file",
      "filename": "document.pdf",
      "encoding": "7bit",
      "mimeType": "application/pdf",
      "size": 5242880,
      "path": "/tmp/uploads/1729350000000-document.pdf",
      "duration": "2.15",
      "mbps": "2.32"
    }
  ]
}
```

**Error Response (Limits Exceeded):**
```json
{
  "error": "Upload limits exceeded",
  "code": "PayloadTooLarge",
  "reason": "File count exceeded: 11 > 10",
  "limits": {
    "maxParts": 10,
    "maxFields": 50,
    "maxPartSize": "100MB"
  }
}
```

**Environment Variables:**
```bash
CONDUIT_MULTIPART_MAX_PARTS=10          # Max file parts per request
CONDUIT_MULTIPART_MAX_FIELDS=50         # Max form fields
CONDUIT_MULTIPART_MAX_PART_SIZE=104857600  # Max file size per part (bytes)
CONDUIT_UPLOAD_MODE=async               # async (streaming) or sync (buffering)
CONDUIT_UPLOAD_DIR=/tmp/uploads         # Upload directory
```

**Enhanced Logging:**
- Console: Real-time progress with file name, bytes, duration, MB/s, mode
- JSONL (if `CONDUIT_HTTP_LOG` set): Structured logs with all metrics including `rateMBps`

**Usage Example:**
```bash
# Single file
curl -X POST http://127.0.0.1:9087/v1/upload -F "file=@document.pdf"

# Multiple files with fields
curl -X POST http://127.0.0.1:9087/v1/upload \
  -F "file=@file1.pdf" \
  -F "file=@file2.jpg" \
  -F "description=test upload"
```


## 7. Large & Binary Auto-Detection (T5020)

**Status:** ✅ Implemented

- **Threshold:** 5MB default (`CONDUIT_LARGE_THRESHOLD`)
- **Detection:** Content-Length header OR binary MIME types
- **Binary MIME types:**
  - `application/octet-stream`, `application/pdf`, `application/zip`
  - `video/*`, `audio/*`, `image/*` (except SVG)
- **Routing:** Large/binary → `/v1/upload` path automatically
- **Purpose:** Prevents JSON parser overhead for large binary uploads

## 8. JSON Caps & Compression (T5021)

**Status:** ✅ Implemented

- **JSON body cap:** 10MB default (`CONDUIT_MAX_JSON_SIZE`)
- **Gzip support:** Automatic decompression of `Content-Encoding: gzip`
- **413 Response:** Provides actionable guidance
  - Non-gzipped: Suggests compression
  - Gzipped: Suggests breaking into smaller requests
- **Compression ratio:** Typically 5-10x for JSON

## 9. CORS Configuration (T5022)

**Status:** ✅ Implemented

- **Origin allowlist:** `CONDUIT_CORS_ORIGINS` (comma-separated)
- **Wildcard support:** `*` allows all origins
- **Preflight:** Automatic OPTIONS handling for `/v1/*` endpoints
- **Headers:**
  - `Access-Control-Allow-Origin`: Origin-specific or wildcard
  - `Access-Control-Allow-Methods`: GET, POST, PUT, DELETE, OPTIONS, PATCH
  - `Access-Control-Allow-Headers`: content-type, authorization, x-token
  - `Access-Control-Max-Age`: 86400 (24 hours)

## 10. HTTP Logging (T5040)

**Status:** ✅ Implemented

- **Format:** Structured JSONL to `reports/gateway-http.log.jsonl`
- **Auto-initialized:** No env var required (created on startup)
- **Fields:**
  - `ts`: ISO 8601 timestamp
  - `ip`: Client IP address
  - `method`: HTTP method (GET, POST, etc.)
  - `path`: Request path
  - `bytes`: Request body size
  - `mode`: Upload mode (async/sync)
  - `ruleId`: Matched DSL rule ID
  - `status`: HTTP status code
  - `durMs`: Request duration in milliseconds
  - `rateMBps`: Transfer rate for uploads
  - `error`: Error code if request failed
  - **T5013 integrity fields:** `sha256`, `mime`, `size` for file uploads

**Example:**
```json
{"ts":"2025-10-19T14:23:46.789Z","ip":"127.0.0.1","method":"POST","path":"/v1/upload","bytes":104857600,"mode":"async","status":200,"durMs":1234,"rateMBps":85.3}
```

## 11. Rate Limits & Quotas (T5030)

**Status:** ✅ Implemented

- **Algorithm:** Token bucket with continuous refill
- **Per-IP tracking:** Isolated buckets per client IP
- **Per-endpoint limits:** Configurable rate/burst per path
- **Configuration:**
  ```bash
  CONDUIT_RATE_LIMIT_ENABLED=true
  CONDUIT_RATE_LIMIT_RATE=100          # Requests per window
  CONDUIT_RATE_LIMIT_WINDOW_MS=60000   # 60 seconds
  CONDUIT_RATE_LIMIT_BURST_ENQUEUE=200  # Burst for /v1/enqueue
  CONDUIT_RATE_LIMIT_BURST_UPLOAD=50    # Burst for /v1/upload
  ```
- **Response:** HTTP 429 with `Retry-After` header (in seconds)

## 12. Defaults vs Overrides

- Defaults aim to "do the right thing":
  - Small JSON → normal handlers
  - Large/binary → upload path
  - Multipart streaming with safety limits
  - CORS deny by default
  - Rate limiting per IP/endpoint
- DSL/Env overrides for special cases (per endpoint sync mode, custom error maps, auth)

---

## 13. Resumable/Chunked Uploads (T5091 - Design)

**Status:** 🔮 Design Exploration (Wave 8)

### 13.1 Problem Statement

Current `/v1/upload` requires full file transmission in a single request. This is fragile for:
- **Large files (>1GB):** Network interruptions force full restart
- **Slow connections:** Timeout risks increase with file size
- **Mobile/unstable networks:** Packet loss and reconnection common
- **Bandwidth constraints:** No pause/resume capability

**Goal:** Enable robust, interruptible uploads with failure recovery and progress tracking.

### 13.2 Design Sketch

**Protocol:** HTTP Range Requests (RFC 7233) + Server-Side Chunk Tracking

**Core Concepts:**
1. **Upload Session:** Unique `uploadId` issued on initiation
2. **Chunked Transfer:** Client sends file in fixed-size chunks (1-10MB)
3. **Server-Side Tracking:** Server maintains chunk state (received/missing)
4. **Resumption:** Client queries state and resumes from last chunk
5. **Finalization:** Server assembles chunks into final blob on completion

### 13.3 Protocol Flow

#### Phase 1: Initiate Upload Session

**Request:**
```http
POST /v1/upload/initiate
Content-Type: application/json
Authorization: Bearer <token>

{
  "filename": "large-video.mp4",
  "totalSize": 1073741824,
  "chunkSize": 5242880,
  "sha256": "abc123..." // Optional: final hash for verification
}
```

**Response:**
```json
{
  "uploadId": "upload-1729350000-abc123",
  "chunkSize": 5242880,
  "totalChunks": 205,
  "expiresAt": "2025-10-20T14:30:00Z"
}
```

#### Phase 2: Upload Chunks

**Request:**
```http
PUT /v1/upload/{uploadId}/chunk/{chunkIndex}
Content-Type: application/octet-stream
Content-Length: 5242880
Content-Range: bytes 0-5242879/1073741824

<binary chunk data>
```

**Response (Success):**
```json
{
  "uploadId": "upload-1729350000-abc123",
  "chunkIndex": 0,
  "received": true,
  "sha256": "chunk-hash-abc"
}
```

**Response (Failure - Resume):**
```http
HTTP/1.1 409 Conflict
Content-Type: application/json

{
  "error": "Connection lost",
  "uploadId": "upload-1729350000-abc123",
  "receivedChunks": [0, 1, 2, 5, 6],
  "missingChunks": [3, 4, 7, 8, 9, ...]
}
```

#### Phase 3: Query Upload Status

**Request:**
```http
GET /v1/upload/{uploadId}/status
Authorization: Bearer <token>
```

**Response:**
```json
{
  "uploadId": "upload-1729350000-abc123",
  "filename": "large-video.mp4",
  "totalSize": 1073741824,
  "totalChunks": 205,
  "receivedChunks": 150,
  "missingChunks": [151, 152, ..., 204],
  "percentComplete": 73.2,
  "expiresAt": "2025-10-20T14:30:00Z"
}
```

#### Phase 4: Finalize Upload

**Request:**
```http
POST /v1/upload/{uploadId}/finalize
Authorization: Bearer <token>

{
  "sha256": "abc123..." // Optional: verify integrity
}
```

**Response (Success):**
```json
{
  "success": true,
  "uploadId": "upload-1729350000-abc123",
  "blobId": "blob-sha256-abc123",
  "size": 1073741824,
  "sha256": "abc123...",
  "mimeType": "video/mp4",
  "path": "/blobs/abc123.mp4"
}
```

**Response (Error - Missing Chunks):**
```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "error": "Upload incomplete",
  "missingChunks": [203, 204],
  "receivedChunks": 203,
  "totalChunks": 205
}
```

### 13.4 Server-Side Implementation

**Chunk Storage:**
- Store chunks in temporary directory: `/tmp/uploads/{uploadId}/chunk-{index}.bin`
- Track metadata in memory or Redis:
  ```json
  {
    "uploadId": "upload-1729350000-abc123",
    "filename": "large-video.mp4",
    "totalSize": 1073741824,
    "chunkSize": 5242880,
    "totalChunks": 205,
    "receivedChunks": [0, 1, 2, ...],
    "createdAt": "2025-10-19T14:30:00Z",
    "expiresAt": "2025-10-20T14:30:00Z"
  }
  ```

**Finalization:**
1. Verify all chunks received
2. Concatenate chunks in order: `cat chunk-*.bin > final.bin`
3. Compute SHA256 and validate
4. Move to blob storage (S3/MinIO/local)
5. Return blobRef to client
6. Cleanup temp chunks

**Expiration:**
- Delete incomplete uploads after 24 hours (configurable)
- Cron job or TTL in Redis

### 13.5 Failure Recovery Mechanisms

**Network Interruption:**
- Client detects connection loss
- Client calls `GET /v1/upload/{uploadId}/status`
- Client resumes from `missingChunks`

**Server Restart:**
- Persist upload metadata to Redis or disk
- Recover in-progress uploads on startup
- Clients query status and resume

**Chunk Corruption:**
- Validate SHA256 per chunk
- Reject corrupted chunks with 400
- Client retries corrupted chunk

**Timeout Handling:**
- Client implements exponential backoff
- Server extends `expiresAt` on activity

**Duplicate Chunks:**
- Idempotent: Accept duplicate chunks, return existing hash
- No duplicate storage

### 13.6 Configuration

**Environment Variables:**
```bash
# Resumable uploads (feature flag)
CONDUIT_RESUMABLE_UPLOADS_ENABLED=false

# Chunk storage
CONDUIT_RESUMABLE_UPLOAD_DIR=/tmp/uploads/resumable
CONDUIT_RESUMABLE_CHUNK_SIZE=5242880  # 5MB default

# Session management
CONDUIT_RESUMABLE_SESSION_TTL=86400  # 24 hours
CONDUIT_RESUMABLE_MAX_SESSIONS=1000  # Per-server limit

# Finalization
CONDUIT_RESUMABLE_FINALIZE_TIMEOUT_MS=300000  # 5 minutes
```

### 13.7 Integration with Blob System (T5010/T5011)

**Finalized uploads integrate seamlessly:**
1. Client calls `/v1/upload/{uploadId}/finalize`
2. Server assembles chunks into final blob
3. Blob backend (S3/MinIO/local) stores final file
4. Server returns `blobRef` with integrity metadata
5. Optional: DSL rule auto-enqueues with `blobRef`

**Example DSL rule:**
```yaml
- id: resumable-upload-complete
  when: { http: { method: POST, path: /v1/upload/*/finalize } }
  map:
    uploadId: $path[3]
    blobRef: $result.blobId
    metadata: $result
  send:
    frame:
      type: enqueue
      fields:
        to: agents/uploads
        env:
          type: upload_complete
          blobRef: $blobRef
          metadata: $metadata
```

### 13.8 Client Libraries (Future)

**JavaScript Example:**
```javascript
const uploader = new ConduitResumableUploader({
  endpoint: 'http://127.0.0.1:9087',
  token: 'dev-token-123',
  chunkSize: 5 * 1024 * 1024  // 5MB
});

const upload = await uploader.initiate({
  file: largeFile,
  onProgress: (percent) => console.log(`${percent}% complete`),
  onChunkComplete: (index) => console.log(`Chunk ${index} uploaded`)
});

// Automatic retry on failure
await upload.start();

// Or manual resume
if (upload.interrupted) {
  await upload.resume();
}
```

### 13.9 Phased Implementation Plan

**Phase 1: Core Protocol (4 weeks)**
- Implement `/v1/upload/initiate`, `/v1/upload/{uploadId}/chunk/{index}`, `/v1/upload/{uploadId}/status`, `/v1/upload/{uploadId}/finalize`
- In-memory session tracking (single-server)
- File-based chunk storage
- Basic tests for happy path

**Phase 2: Resilience (2 weeks)**
- Redis-backed session tracking (multi-server)
- Chunk SHA256 validation
- Expiration and cleanup cron
- Failure recovery tests

**Phase 3: Integration (2 weeks)**
- Integrate with blob backend (S3/MinIO/local)
- DSL rules for auto-enqueue on finalization
- Update observability (JSONL logs, metrics)
- Load testing (100 concurrent resumable uploads)

**Phase 4: Client Libraries (4 weeks)**
- JavaScript/TypeScript client library
- Python client library
- CLI tool (`conduit-upload --resumable large-file.bin`)
- Documentation and examples

**Total Estimated Effort:** 12 weeks (3 months)

### 13.10 Performance Considerations

**Benefits:**
- Reduced bandwidth waste (resume from last chunk, not start)
- Lower timeout risk (small chunks vs monolithic upload)
- Better UX (progress tracking, pause/resume)

**Costs:**
- Increased server storage (temporary chunks)
- Additional HTTP requests (per chunk + status queries)
- Metadata tracking overhead (Redis or in-memory)

**Benchmarks (Projected):**
- 1GB file: 200 chunks × 5ms/chunk = ~1s overhead (negligible)
- 10 concurrent resumable uploads: ~50MB temp storage per upload
- Session metadata: ~1KB per upload (scales to millions in Redis)

### 13.11 Security Considerations

**Authentication:**
- All endpoints require Bearer token or X-Token header
- `uploadId` tied to authenticated user/tenant

**Authorization:**
- Only creator can upload chunks or finalize
- Status endpoint requires authentication

**Abuse Prevention:**
- Rate limit initiation (10 sessions/min per IP)
- Max concurrent sessions per user (e.g., 10)
- Expiration prevents storage exhaustion

**Validation:**
- Chunk index must be within `[0, totalChunks)`
- Chunk size must match declared size (except last chunk)
- SHA256 verification prevents corruption

### 13.12 Monitoring & Observability

**Metrics:**
- `resumable_uploads_initiated_total`: Counter
- `resumable_chunks_uploaded_total`: Counter
- `resumable_uploads_finalized_total`: Counter
- `resumable_uploads_expired_total`: Counter
- `resumable_upload_duration_seconds`: Histogram (initiate → finalize)

**JSONL Logs:**
```json
{
  "ts": "2025-10-19T14:30:00.000Z",
  "event": "resumable_upload_initiated",
  "uploadId": "upload-1729350000-abc123",
  "ip": "127.0.0.1",
  "filename": "large-video.mp4",
  "totalSize": 1073741824,
  "totalChunks": 205
}
```

```json
{
  "ts": "2025-10-19T14:45:00.000Z",
  "event": "resumable_upload_finalized",
  "uploadId": "upload-1729350000-abc123",
  "blobId": "blob-sha256-abc123",
  "duration": "900.5",
  "chunksReceived": 205
}
```

### 13.13 Alternative Approaches Considered

**1. TUS Protocol (tus.io):**
- **Pros:** Open standard, client libraries exist
- **Cons:** Heavier protocol, more complex than needed
- **Decision:** Deferred; custom protocol simpler for v1

**2. Multipart Upload (S3-style):**
- **Pros:** Directly maps to S3 API
- **Cons:** Tight coupling to S3, no abstraction for local/MinIO
- **Decision:** Use for S3 backend, abstract for others

**3. WebSocket Streaming:**
- **Pros:** Bidirectional, real-time progress
- **Cons:** Not RESTful, harder to debug, firewall issues
- **Decision:** Stick with HTTP/REST for simplicity

---

## 14. Summary of Future Enhancements

1. **HTTP/2 Support (T5090):** Multiplexing, header compression, lower latency
2. **Resumable Uploads (T5091):** Chunked transfer, failure recovery, progress tracking
3. **CBOR/MessagePack Codecs (T5092):** Compact binary serialization for control frames

These explorations inform the roadmap for Conduit v1.3+ and v2.0.
