# T5043: Record/Replay Edge Environment Documentation

## Summary

Added comprehensive documentation for record/replay functionality to help reproduce issues across edge environments. This enables developers to capture production traffic from edge instances and replay it locally for debugging, testing, and performance analysis.

## Documentation Added

### 1. README.md Updates

**Section:** Control Frame Recording & Debugging → Record/Replay for Edge Debugging

**Content Added:**
- **Use Cases** (4 scenarios):
  - Reproduce edge-only bugs
  - Performance testing with real traffic
  - Integration test generation
  - Multi-region debugging

- **Capture Best Practices**:
  - Production edge environment configuration
  - Targeted issue capture workflow
  - Time-bounded capture with `timeout`

- **Replay Pipeline** (planned feature):
  - Filter & Prepare: Time windows, streams, frame types, sanitization
  - Replay: Different speeds, assertions, output recording
  - Compare Outputs: Baseline vs modified, validation

- **Analyzing Recorded Frames**:
  - Find error patterns
  - Count frame types
  - Extract timing info
  - Find frames by reqId
  - Correlate with HTTP logs

- **Privacy Considerations**:
  - Edge deployment security (encryption at rest/in-transit)
  - Retention policies

### 2. docs/OBSERVABILITY.md Updates

**New Section:** Control Frame Recording & Replay

**Content Added:**

#### Configuration & Format
- Environment variables: `CONDUIT_RECORD`, `CONDUIT_RECORD_REDACT`
- JSONL record format with examples
- Redaction behavior

#### Edge Environment Use Cases (4 detailed scenarios)
1. **Reproduce Production Issues Locally**
   - Full workflow from edge capture to local replay
   - Example: `scp` download, `jq` analysis, replay command

2. **Multi-Region Traffic Analysis**
   - Compare behavior across regions
   - Error rate comparison
   - Frame type distribution analysis

3. **Integration Test Fixture Generation**
   - Record known-good scenarios
   - Validate fixtures
   - Use in automated tests

4. **Performance Regression Testing**
   - Baseline recording
   - Modified version recording
   - Timing comparison

#### Replay Pipeline (Planned)
- **Step 1: Filter & Prepare**
  - Extract time windows
  - Filter by stream/frame type
  - Extract request flows by reqId
  - Sanitize sensitive data

- **Step 2: Replay**
  - Basic replay commands
  - Speed control (real-time, 10x, max)
  - Assertions (expect-success, fail-on-error)
  - Output recording for comparison

- **Step 3: Compare & Validate**
  - Baseline vs modified comparison
  - Expected behavior validation
  - Error detection

#### Live Monitoring
- Real-time tailer usage
- Filter specific frame types
- Monitor specific streams
- Detect latency issues

#### Analyzing Recorded Frames
- **Common Queries** (7 examples):
  - Count frames by type
  - Find errors and error codes
  - Find frames by reqId
  - Calculate frame rate
  - Correlate with HTTP logs
  - Detect frame order anomalies

#### Best Practices

**Production Edge Deployments:**
- Always enable redaction
- Log rotation configuration
- Retention policies (7-day example)
- Encryption at rest

**Development & Debugging:**
- Test-specific recording
- Time-bounded recording
- Conditional recording (error-only)

#### Security Considerations
- Sensitive data handling
- Access control (`chmod`/`chown`)
- Transfer security (`scp`/`rsync`)
- Compliance (GDPR, HIPAA, PCI)

## Key Features

### Comprehensive Coverage
- ✅ Configuration instructions for `CONDUIT_RECORD`
- ✅ Documented replay pipeline process (3-step)
- ✅ Extensive examples of capturing traffic
- ✅ Multiple use cases for edge debugging
- ✅ Security and compliance guidance

### Real-World Scenarios
- Edge-only bug reproduction workflow
- Multi-region traffic analysis
- Performance regression testing
- Integration test fixture generation

### Practical Examples
- 40+ code examples with actual commands
- `jq` queries for log analysis
- `scp`/`rsync` for secure transfer
- Log rotation configuration
- Encryption setup

## File Changes

| File | Lines Added | Content |
|------|-------------|---------|
| README.md | ~145 | Edge use cases, capture practices, replay pipeline, frame analysis |
| docs/OBSERVABILITY.md | ~380 | Configuration, detailed scenarios, replay pipeline, best practices, security |

## Verification

Manual doc check completed:

✅ **README.md**
- Instructions for `CONDUIT_RECORD` environment variable
- Record/replay guidance for edge environments
- Examples of capturing and replaying traffic
- Use cases clearly explained

✅ **docs/OBSERVABILITY.md**
- Comprehensive edge environment use cases (4 scenarios)
- Complete replay pipeline documentation (3 steps)
- Live monitoring and analysis techniques
- Production best practices and security considerations

## Use Case Examples

### Example 1: Edge Bug Reproduction
```bash
# On edge
CONDUIT_RECORD=/var/log/conduit/issue.jsonl CONDUIT_RECORD_REDACT=true npm start

# Download & analyze
scp edge:/var/log/conduit/issue.jsonl ./
cat issue.jsonl | jq 'select(.frame.type == "error")'

# Replay (future)
node scripts/replay-frames.ts issue.jsonl --target tcp://localhost:9099
```

### Example 2: Multi-Region Analysis
```bash
# Collect from multiple regions
scp us-east:/var/log/conduit/frames.jsonl ./us-east.jsonl
scp eu-west:/var/log/conduit/frames.jsonl ./eu-west.jsonl

# Compare error rates
cat us-east.jsonl | jq 'select(.frame.type == "error")' | wc -l
cat eu-west.jsonl | jq 'select(.frame.type == "error")' | wc -l
```

### Example 3: Performance Baseline
```bash
# Record baseline
CONDUIT_RECORD=/tmp/baseline.jsonl npm start

# Make changes, record again
CONDUIT_RECORD=/tmp/modified.jsonl npm start

# Compare
diff <(jq -c '.frame' baseline.jsonl) <(jq -c '.frame' modified.jsonl)
```

## Impact

This documentation enables:
- **Developers**: Debug edge-only issues by capturing and replaying production traffic locally
- **QA Engineers**: Generate integration test fixtures from real traffic
- **DevOps**: Analyze multi-region behavior and performance degradation
- **Security Teams**: Audit control frame communication with proper redaction

## Next Steps (Future Enhancements)

1. Implement `scripts/replay-frames.ts` tool
2. Add automated baseline comparison tool
3. Implement `CONDUIT_RECORD_FILTER` for selective recording
4. Create dashboard for visualizing recorded frames
5. Add performance profiling based on recorded timing

## Related Tasks

- T2131: Initial control frame recording implementation
- T5010: Multipart upload safety (referenced in capture examples)
- T4062: Soak testing (mentioned for long-running captures)
