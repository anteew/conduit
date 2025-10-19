# Wave 1 HTTP Group - Quick Reference

## Environment Variables

### T5010: Multipart Streaming
```bash
CONDUIT_UPLOAD_MODE=async                      # async (streaming) or sync (buffered)
CONDUIT_MULTIPART_MAX_PARTS=10                 # Max files per upload
CONDUIT_MULTIPART_MAX_FIELDS=50                # Max form fields
CONDUIT_MULTIPART_MAX_PART_SIZE=104857600      # Max bytes per file (100MB)
```

### T5011: Blob SideChannel
```bash
CONDUIT_UPLOAD_USE_BLOB_SINK=true              # Enable blob backend
CONDUIT_BLOB_BACKEND=local                     # local|s3|minio
CONDUIT_BLOB_LOCAL_DIR=/tmp/blobs              # Local storage path
CONDUIT_BLOB_S3_BUCKET=uploads                 # S3 bucket
CONDUIT_BLOB_S3_REGION=us-east-1               # S3 region
CONDUIT_BLOB_MINIO_ENDPOINT=localhost:9000     # MinIO endpoint
```

### T5012: BlobRef Enqueue
```bash
CONDUIT_UPLOAD_AUTO_ENQUEUE=true               # Enable auto-enqueue
CONDUIT_UPLOAD_ENQUEUE_TARGET=agents/uploads/inbox  # Target stream
```

## Testing Commands

### Compile Check
```bash
npm run test:compile
```

### Test Multipart Upload (Local)
```bash
curl -X POST http://localhost:9087/v1/upload \
  -F "userId=user123" \
  -F "tags=important" \
  -F "files=@test.pdf" \
  -F "files=@test.jpg"
```

### Test with S3 Backend
```bash
export CONDUIT_UPLOAD_USE_BLOB_SINK=true
export CONDUIT_BLOB_BACKEND=s3
export CONDUIT_BLOB_S3_BUCKET=my-uploads
npm start

curl -X POST http://localhost:9087/v1/upload \
  -F "files=@large-file.bin"
```

### Test with Auto-Enqueue
```bash
export CONDUIT_UPLOAD_AUTO_ENQUEUE=true
export CONDUIT_UPLOAD_ENQUEUE_TARGET=agents/processing/inbox
npm start

curl -X POST http://localhost:9087/v1/upload \
  -F "files=@document.pdf"
# Check response includes "enqueued" field
```

## Response Format

### Successful Upload
```json
{
  "success": true,
  "mode": "async",
  "fileCount": 2,
  "fieldCount": 2,
  "totalBytes": 2097152,
  "totalDuration": "1.23",
  "totalMbps": "1.62",
  "files": [
    {
      "fieldname": "files",
      "filename": "document.pdf",
      "encoding": "7bit",
      "mimeType": "application/pdf",
      "size": 1048576,
      "sha256": "abc123def456...",
      "blobId": "blob-1729350000-a1b2c3d4",
      "backend": "s3",
      "duration": "0.62",
      "mbps": "1.61"
    }
  ],
  "enqueued": {
    "id": "msg-123",
    "stream": "agents/uploads/inbox"
  }
}
```

### Error (Limits Exceeded)
```json
{
  "error": "Upload limits exceeded",
  "code": "PayloadTooLarge",
  "reason": "Part size exceeded: 120.50MB > 100MB",
  "limits": {
    "maxParts": 10,
    "maxFields": 50,
    "maxPartSize": "100MB"
  }
}
```

## Files Changed

### Core Implementation
- `src/connectors/http.ts` - Multipart handler with streaming, blob sink, integrity, auto-enqueue

### UI
- `public/index.html` - Added multipart upload section
- `public/ui.js` - Client-side upload handler (NEW)

### Configuration
- `config/rules.yaml` - DSL documentation for multipart endpoint

## Key Features

✅ Zero-copy streaming from HTTP → Blob backend  
✅ SHA256 computed inline (no re-reading)  
✅ Metadata written alongside blobs  
✅ Pluggable backends (local/S3/MinIO)  
✅ Optional auto-enqueue with blobRefs  
✅ Safety limits (size/parts/fields)  
✅ Performance metrics (MB/s rates)  
✅ Backward compatible (opt-in)  

## Status
✅ T5010: Complete  
✅ T5011: Complete  
✅ T5013: Complete  
✅ T5012: Complete  
✅ All tests: PASSED
