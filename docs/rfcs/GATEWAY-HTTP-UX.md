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

## 6. Multipart Form Uploads (Plan)

- Developer expectation: browser form uploads (`multipart/form-data`) are accepted and the file part is streamed server‑side without buffering whole body
- v1 target behavior:
  - Accept `multipart/form-data`; extract first file part (name `file` by default)
  - Stream extracted file bytes into the same upload sink path as octet-stream
  - Preserve form fields (optional: map into headers/metadata)
  - Maintain async/sync modes + instrumentation

## 7. Defaults vs Overrides

- Defaults aim to “do the right thing”:
  - Small JSON → normal handlers
  - Large/binary → upload path
- DSL/Env overrides for special cases (per endpoint sync mode, custom error maps, auth)

