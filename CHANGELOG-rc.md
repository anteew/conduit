# Conduit v1.0-rc — Change Log (Release Candidate)

Date: 2025-10-20

Highlights
- Admin reload + SIGHUP
  - POST /v1/admin/reload reloads DSL rules, tenants, and guardrails without dropping connections
  - SIGHUP triggers the same reload path; health reflects draining when enabled
- Codecs (HTTP/WS)
  - JSON (default) and MessagePack (`application/msgpack`, `application/vnd.msgpack`) with guardrails
  - Per‑codec metrics: requests, bytes, decode errors, size/depth violations, encode/decode p50/p95
  - Negotiation via `Accept` header (HTTP) and query/subprotocol (WS)
- Uploads
  - Octet‑stream fast‑path on `/v1/upload` (optional synchronous `{ blobRef }` via `X-Upload-Mode: sync`)
  - Multipart with strict limits (parts, fields, per‑part size) and structured errors
- Tenancy & Quotas
  - Per‑tenant HTTP rate limits (429 + Retry‑After) and WS connection caps (1008)
  - Metrics per tenant where configured
- Observability
  - Expanded `/v1/metrics`: HTTP/WS core, codec summaries, durations p50/p95/p99
  - Structured JSONL logs: `reports/gateway-http.log.jsonl`, `reports/gateway-ws.log.jsonl`
- Docs & Examples
  - README updates, SRE-RUNBOOK.md, CODECS.md, example scripts (HTTP/WS + codec comparison)

Breaking Changes
- None expected for default JSON paths. New features are opt‑in via env flags.

Flags to remember
- `CONDUIT_CODECS_HTTP=true`, `CONDUIT_CODECS_WS=true` to enable codec metrics/paths
- `CONDUIT_RULES=config/rules.yaml` to load DSL rules
- `CONDUIT_UPLOAD_SYNC=true` or `X-Upload-Mode: sync` for synchronous blobRef responses
- `CONDUIT_TENANT_CONFIG` + `CONDUIT_TOKENS` to enable quotas/auth

Upgrade Notes
- If enabling MessagePack, client libraries must set `Accept: application/msgpack` for HTTP or `?codec=msgpack` / subprotocol for WS.
- On constrained environments, keep guardrails conservative (`CONDUIT_CODEC_MAX_DECODED_SIZE`, `CONDUIT_CODEC_MAX_DEPTH`).

Validation
- Quick soak: run `scripts/soak_metrics.sh 20` then `jq` the saved `reports/metrics-soak-*.json` to verify `gateway.http.codecs` and `gateway.ws` sections.

