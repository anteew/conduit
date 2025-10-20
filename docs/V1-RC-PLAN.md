# v1.0‑rc Plan — Conduit

Scope: P0/P1 items required to tag v1.0‑rc. Each item has acceptance criteria and test notes.

1) Admin reload endpoint (HTTP)
- Endpoint: `POST /v1/admin/reload` (protected: tokens allowlist)
- Behavior: reload DSL, tenants, and guardrails config; respond `{ ok: true, reloaded: [...] }`
- Tests: unit/integration for 200 path and error path; confirm reload updates rules without restart

2) Upload fast‑path blobRef (octet‑stream)
- Stream octet‑stream uploads to `blobSink.store()` and return `{ blobRef }` when `CONDUIT_UPLOAD_SYNC=true`
- Include progress JSONL logs and integrity metadata (sha256, size, mime)
- Tests: large payload (100MB) returns blobRef; basic integrity fields populated

3) Expanded codec metrics
- `/v1/metrics`: include codec encode/decode counts, bytes in/out, and p50/p95 per op
- Tests: exercise JSON + MessagePack paths and assert metrics fields present and monotonic

4) Guardrails reload
- Cache guardrails at startup (done); add reload path via SIGHUP and admin endpoint
- `/v1/admin/guardrails` (optional for v1‑rc): GET current; POST to update in‑process
- Tests: change limits → verify enforcement without restart

5) Tenancy quotas enforcement
- Enforce per‑tenant request rate (HTTP) and per‑tenant WS connections; surface per‑tenant metrics consistently
- Tests: exceed quotas → 429/1008 with logs/metrics increments

6) Docs & SRE
- README: codecs (media types, flags), guardrails, close codes (1007/1009/1011)
- SRE‑RUNBOOK: troubleshooting and metrics quick reference

Out of scope (post‑rc, tracked in outstanding‑chore‑list.md)
- Additional codecs (CBOR/Avro), mkctl helpers, broader perf dashboards

