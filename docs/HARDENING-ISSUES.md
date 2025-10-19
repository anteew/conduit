# Conduit — Hardening & Feature Gaps (Issue List)

Audience: Architect, Susan (implementation), future contributors  
Purpose: Capture concrete gaps with rationale so we do not skip critical items during “ship now” pressure.

Legend
- P0 = must-have for correctness/safety; P1 = near-term; P2 = nice-to-have
- Cat: Security, Stability, Observability, UX, Scale

---

## 1) Upload → Blob Side‑Channel (blobRef)
- ID: HTTP-BLOB-REF — P0 — Cat: Stability/Scale/UX
- Why: Current /v1/upload writes to local files. Real deployments need durable blob stores and small envelopes with `blobRef`. Prevents memory/disk pressure and enables agent workflows to fetch lazily.
- What: Wire `blobSink.store(stream, metadata)` for both octet-stream and multipart; compute sha256/mime/size; return `{ blobRef }` and (optionally) enqueue a small envelope containing `blobRef`.
- Where: `src/connectors/http.ts` (upload path), `src/backends/*`, `src/helpers/agent-helpers.ts`
- Acceptance:
  - POST 1GB (sync): HTTP completes; JSON body returns `{ blobRef: { backend, sha256, size, mime, ... } }`.
  - File exists in configured backend; sha256 matches; local disk path not used when backend != local.

## 2) HTTP Auth (API Key / Bearer)
- ID: HTTP-AUTH — P0 — Cat: Security
- Why: Multi-agent/multi-tenant environments require an edge guard. Without auth, anyone on the network can enqueue or upload.
- What: Allowlist tokens via `CONDUIT_TOKENS` (`Authorization: Bearer …` or `X-Token`). Exempt `/health` & static `/ui`.
- Where: `src/connectors/http.ts`, `src/connectors/ws.ts` (optional token during connect)
- Acceptance:
  - Missing/invalid token → 401 JSON error; valid token → normal behavior; configurable protected paths.

## 3) CORS + Preflight
- ID: HTTP-CORS — P0 — Cat: Security/UX
- Why: Browser clients (UI, partner apps) need cross-origin access with predictable preflight. Today CORS headers not emitted.
- What: Env `CONDUIT_CORS_ORIGINS` (CSV); handle `OPTIONS` on `/v1/*` and `/ui/*`; emit `Access-Control-Allow-*`.
- Where: `src/connectors/http.ts`
- Acceptance: Browser fetch from allowed origin succeeds; disallowed origin blocked.

## 4) Rate Limits & Quotas (HTTP)
- ID: HTTP-RATELIMIT — P0 — Cat: Stability/Security
- Why: Protect gateway under agent/device load and abuse; fairness across tenants.
- What: Token-bucket per IP/token for `/v1/enqueue` and `/v1/upload`; 429 + `Retry-After` JSON; env knobs for burst/window.
- Where: `src/connectors/http.ts`
- Acceptance: Exceeding rate returns 429; counters visible in metrics; configurable per endpoint.

## 5) WS JSONL Logs + Message Size Cap
- ID: WS-JSONL-CAPS — P0 — Cat: Observability/Stability
- Why: We have HTTP JSONL logs but not WS. Need agent-first logs and hard caps to prevent oversized frames.
- What: Add `reports/gateway-ws.log.jsonl` with connect/credit/deliver/close entries; cap message size; close with 1009.
- Where: `src/connectors/ws.ts`
- Acceptance: Log lines present; large frames rejected; tests cover 1009 behavior.

## 6) Expanded Metrics (HTTP/WS)
- ID: METRICS-EXPAND — P1 — Cat: Observability
- Why: SRE/agents need counters/histograms for rate, latency, bytes, rule hits, WS deliveries.
- What: Extend `/v1/metrics` to include per-endpoint counters, p50/p95 latencies, bytes in/out, WS credit usage.
- Where: `src/connectors/http.ts`, `src/connectors/ws.ts`, backend metrics aggregator
- Acceptance: Metrics JSON includes above fields; scrape-friendly.

## 7) Zero-Downtime Reload (SIGHUP)
- ID: HOT-RELOAD — P1 — Cat: UX/Stability
- Why: Change rules/env without dropping agents/users; shrink deploy MTTR.
- What: Handle SIGHUP: reload DSL and selected env-driven knobs; gracefully drain old connections.
- Where: `src/index.ts`, `src/connectors/http.ts`, `src/connectors/ws.ts`
- Acceptance: `kill -HUP <pid>` reloads rules; in-flight remains stable; health flips during reload window as needed.

## 8) Multi-Tenant Partitioning & Overlays
- ID: TENANCY — P1 — Cat: Scale/UX
- Why: Many agents/devices; enforce per-tenant limits and allow rule overlays without forking.
- What: Map token→tenant; tag logs/metrics; apply per-tenant quotas; document overlays (already drafted) + example.
- Where: `src/connectors/http.ts`, `src/connectors/ws.ts`, docs
- Acceptance: Two tenants show isolated counters/limits and rule override takes effect.

## 9) Header/Request Limits & Timeouts
- ID: HTTP-LIMITS — P1 — Cat: Security/Stability
- Why: Prevent slowloris and header abuse; bound resource use.
- What: Request timeout, header size/cookie limits (431), keep-alive tuning; idle timeouts.
- Where: `src/connectors/http.ts`
- Acceptance: Exceed limits → proper status; idle/slowloris closed; documented knobs.

## 10) Record/Replay at Edge
- ID: EDGE-REPLAY — P1 — Cat: Observability/Debug
- Why: Reproduce production issues; feed agent diagnostics.
- What: Document/implement `CONDUIT_RECORD` for HTTP/WS (redaction) and replay harness.
- Where: README, docs/OBSERVABILITY.md; minimal code hook
- Acceptance: Toggle writes JSONL; replay CLI can simulate traffic.

## 11) Blob/Queue Helper & Examples
- ID: BLOB-QUEUE-EXAMPLES — P2 — Cat: UX
- Why: Developers need patterns for `blobRef`/`queueRef` end-to-end.
- What: Example rules + agent helper usage; small “issue tracker” demo.
- Where: examples/, docs/; `src/helpers/agent-helpers.ts`
- Acceptance: Example runs locally; docs show how to fetch blobs and check job state.

---

Notes
- Multipart streaming is present with limits; align octet-stream and multipart to share the blobRef path.
- HTTP JSONL logs exist; WS JSONL logs need adding.
- Idempotency is implemented; document semantics and TTL.
- Production docs exist; add SRE runbook file with concrete checklists.

References
- `src/connectors/http.ts`, `src/connectors/ws.ts`, `src/backends/*`, `src/helpers/agent-helpers.ts`  
- `docs/rfcs/GATEWAY-HTTP-UX.md`, `docs/rfcs/GATEWAY-WS-UX.md`, `docs/OBSERVABILITY.md`, `docs/BACKENDS.md`, `docs/PRODUCTION-DEPLOYMENT.md`
