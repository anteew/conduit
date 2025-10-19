# Conduit Testing Plan (Stage 2)

Goals
- Verify DSL interpreter correctness (match/map/send/onError) and safety limits
- Prove HTTP and WS adapters translate bidirectionally
- Exercise throughput/latency; ensure the translation path handles load
- Include large payload scenario (100MB) via side-channel or streaming-safe path
- Provide a harness agents can run locally and in CI

Test Matrix
- Unit (DSL)
  - when: method/path/headers/query
  - map: JSONPointer/JSONPath, helpers (coalesce/default/pick/regex/toInt/toFloat/toString)
  - onError: mapping IR errors to HTTP/WS codes
- Integration (HTTP)
  - HTTP→IR: enqueue/stats/snapshot/metrics
  - IR→HTTP: ok/error mapping, status codes, JSON bodies
  - MIME: application/json, text/plain, application/octet-stream
- Integration (WS)
  - Subscribe/open; grant/ack/nack; deliver frames; error frames & close codes
- Performance
  - Small messages: N=100k messages (e.g., 32–256 bytes payload); measure throughput and p50/p95 latency
  - Backpressure: controlled grant window; ensure no unbounded buffers
- Large payload
  - 100MB file via HTTP path (octet-stream) streamed to a sink rule (no JSON parse)
  - Side-channel plan: pass blob refs in IR frames; validate ref wiring (bytes not sent inline)

Harness Design
- tests/harness.ts: shared helpers to start/stop server with config (rules, bind, ports), make HTTP/WS calls, and measure timing
- scripts/gen-large-file.sh: generate test blobs (size param)
- tests/http_bidir.test.ts: round-trip HTTP scenarios
- tests/ws_bidir.test.ts: subscribe and flow-control scenarios
- tests/perf_small.test.ts: small-message load
- tests/large_payload.test.ts: 100MB upload to a no-op sink; assert server remains responsive

Runbook
- npm run dev (local manual)
- npm run test:unit (DSL)
- npm run test:int (HTTP/WS)
- npm run bench:small (throughput)
- npm run bench:large (100MB streaming)

Safety & Limits
- Enforce allowlists, max body size/timeout in connectors and interpreter; default caps in config/.env.dev

Artifacts
- JSON/CSV metrics under /tmp or artifacts directory; CI uploads minimal artifacts for inspection
