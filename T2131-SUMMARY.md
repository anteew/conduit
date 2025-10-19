# T2131 Summary: Control Frame Recorder & Tailer

## Implementation Complete ✓

Implemented JSONL-based control frame recording and live tailer for debugging and reproducibility in Conduit.

## Components Delivered

### 1. Recorder Class (`src/control/record.ts`)
- **Format**: JSONL (JSON Lines) with one frame per line
- **Entry Structure**: 
  ```json
  {"ts": "ISO-8601", "dir": "in|out", "frame": {...}}
  ```
- **Features**:
  - Writes all control frames with timestamp and direction
  - Optional redaction of sensitive fields (`token`, `auth`, `password`, `secret`)
  - Append-mode file writing (safe for long-running processes)
  - Graceful handling when recording disabled

### 2. Control Client Integration
- Modified `src/control/client.ts` to accept optional recorder callback
- Modified `src/connectors/http.ts` to pass recorder to client
- Modified `src/index.ts` to initialize recorder from environment

**Environment Variables**:
- `CONDUIT_RECORD=/path/to/frames.jsonl` — enables recording
- `CONDUIT_RECORD_REDACT=false` — disables sensitive field redaction (default: true)

### 3. Live Tailer (`scripts/tail-frames.ts`)
- Real-time monitoring with `tail -f` behavior
- **Color-coded output**:
  - Frame types: hello/magenta, ok/green, error/red, enqueue/blue, deliver/blue, stats/cyan, etc.
  - Direction: `→` (out/yellow), `←` (in/green)
  - Timestamp: dimmed, millisecond precision
- **Key field extraction**: Shows reqId, to, stream, id, n, code inline
- **Usage**:
  ```bash
  node --loader ts-node/esm scripts/tail-frames.ts /path/to/frames.jsonl
  # Or with env var:
  CONDUIT_RECORD=/tmp/frames.jsonl node --loader ts-node/esm scripts/tail-frames.ts
  ```

### 4. Documentation
- Updated `README.md` with comprehensive recording/debugging section
- Includes enable/disable instructions, tailer usage, privacy considerations
- Notes on future replay patterns and log rotation

## Design Highlights

### Recorder Architecture
- **Minimal overhead**: Only active when `CONDUIT_RECORD` is set
- **Privacy-first**: Default redaction prevents token leakage
- **Append-safe**: Uses `fs.createWriteStream` with append flag
- **Format**: Standard JSONL for easy parsing with `jq`, `grep`, or streaming tools

### Tailer Features
- **Live monitoring**: Uses `tail -f` for real-time frame visibility
- **Visual clarity**: Color-coded frame types and directions
- **Compact display**: Single line per frame with key fields
- **Standard tools**: Works with any JSONL file, not Conduit-specific

### Integration Pattern
```typescript
const recorder = process.env.CONDUIT_RECORD 
  ? new Recorder(process.env.CONDUIT_RECORD, { redact: true })
  : undefined;

const client = new PipeClient(stream, 
  recorder ? (f, d) => recorder.write(f, d) : undefined
);
```

## Verification

Tested with `verify-t2131.sh`:
```bash
cd /srv/repos0/conduit
bash verify-t2131.sh
```

**Test Coverage**:
- ✓ Frame recording creates JSONL file
- ✓ hello, enqueue, ok frames captured
- ✓ JSONL format validation (ts, dir, frame fields)
- ✓ Direction markers ('in'/'out') present
- ✓ Tailer script executable and functional

## Example Output

**Recorded frame** (`/tmp/conduit.ctrl.jsonl`):
```json
{"ts":"2025-10-19T03:49:00.843Z","dir":"out","frame":{"type":"hello","version":"v1","features":[]}}
{"ts":"2025-10-19T03:49:00.849Z","dir":"in","frame":{"type":"ok","reqId":"hello","result":{"version":"v1","features":["credit","views"]}}}
{"ts":"2025-10-19T03:49:06.536Z","dir":"out","frame":{"type":"enqueue","to":"test.stream","env":{"id":"msg1"},"reqId":"r1"}}
```

**Tailer output**:
```
03:49:00.843 → hello
03:49:00.849 ← ok         reqId=hello
03:49:06.536 → enqueue    reqId=r1 to=test.stream
03:49:06.537 ← ok         reqId=r1
```

## Future Enhancements

- **Replay**: Load JSONL and replay frame sequences for testing
- **Rotation**: Size-based rotation (e.g., 100MB limit) or time-based
- **Filtering**: Filter by frame type or direction in tailer
- **Statistics**: Frame rate, type distribution, latency analysis
- **Binary format**: Optional msgpack or protobuf for production high-throughput scenarios

## Privacy & Production

⚠️ **Security Notes**:
- Sensitive fields redacted by default (`[REDACTED]`)
- Envelope payloads logged as-is; may contain PII
- Recommend **not** enabling `CONDUIT_RECORD` in production
- If needed in prod: use log rotation, encrypt at rest, redact envelopes

## References

- Recorder: `src/control/record.ts`
- Client integration: `src/control/client.ts`, `src/index.ts`
- Tailer: `scripts/tail-frames.ts`
- Documentation: `README.md` (Control Frame Recording & Debugging section)
- Tests: `verify-t2131.sh`
