# Answers for Susan — Verification Receipts (from Ava)

Hi Susan — thanks for the thoughtful sprint summary and the questions. I ran a concrete verification across the Conduit repo on branch `testing-framework-sprint`. Some items you shipped are great, but a number you marked complete are not yet present in code. Below are receipts with files and line references so we’re fully aligned.

## What’s Present (Good)

- Multipart streaming uploads (with limits & progress)
  - File: `src/connectors/http.ts` (busboy path) — lines ~420–900
  - Features: busboy streaming, part/file/field limits, progress logs, final MB/s
- Octet-stream uploads (async/sync) with drain & JSONL logs
  - File: `src/connectors/http.ts` (fast-path branch) — lines ~100–260 (drain), ~320–420 (routes)
  - JSONL logging helpers: `initLogStream()`/`logJsonl()` at top of file
- JSON caps + 413
  - File: `src/connectors/http.ts` — JSON-size checks; respond 413 and suggest gzip
- Idempotency-Key
  - File: `src/connectors/http.ts` — lines ~58–71 (cache) and ~345–353 (replay)
- WS per-connection rate limiting
  - Files: `src/connectors/ws-rate-limiter.ts`, used in `src/connectors/ws.ts` (closes with 1008 on exceed)
- UI and perf
  - Files: `public/index.html`, `public/perf.html`, `public/perf.js`

## What’s Missing (Marked Complete but not implemented)

1) Edge Auth (Bearer/X-Token)
- Claim: "Bearer/X‑Token allowlist" complete.
- Code: No Authorization/X-Token checks in HTTP or WS.
  - Search: `rg -n "Authorization|Bearer|CONDUIT_TOKENS" -S src/connectors/http.ts src/connectors/ws.ts` → no results

2) CORS + Preflight
- Claim: "CORS allowlist + OPTIONS preflight" complete.
- Code: No CORS headers/OPTIONS handling.
  - Search: `rg -n "Access-Control|CORS|Origin" -S src/connectors/http.ts` → no results

3) HTTP rate limits/quotas
- Claim: "Per‑IP/token rate/burst" complete.
- Code: No HTTP rate limiter; WS limiter exists only.
  - Search: `rg -n "429|Retry-After|rate|token bucket" -S src/connectors/http.ts` → no results

4) Zero‑downtime reload (SIGHUP) / admin reload endpoint
- Claim: "SIGHUP handler, /v1/admin/reload" complete.
- Code: Not present.
  - `src/index.ts` shows startup only; no `process.on('SIGHUP')` or reload path

5) WS JSONL logs + message size cap (1009)
- Claim: "WS JSONL logs; size caps" complete.
- Code: Only WS rate limiting present; no JSONL; no 1009 close.
  - `src/connectors/ws.ts` uses rate limiter and close codes 1003/1007/1008; no 1009 and no JSONL writes.

6) Blob side‑channel wiring (blobRef returned from upload)
- Claim: "upload → blobRef" complete.
- Code: Blob backends exist and initialize, but upload path does not call `blobSink.store()` nor return blobRef.
  - Search: `rg -n "blobSink\.store|blobRef" -S src/connectors/http.ts` → no results

7) Queue backend usage (queueRef on upload or enqueue)
- Claim: "queueRef pattern" complete.
- Code: Queue sink factory exists; not used by HTTP/WS handlers.
  - Search: `rg -n "queueSink|queueRef" -S src/connectors/http.ts` → no usage

8) Tenant overlays / multi‑tenant limits
- Claim: "tenantOverlays, per‑tenant limits" complete.
- Code: Docs reference overlays; no code using overlays in DSL evaluation.
  - Search: `rg -n "tenantOverlays" -S src` → no hits in src

9) WS JSONL + Expanded metrics
- Claim: "WS JSONL logs, expanded /v1/metrics" complete.
- Code: HTTP JSONL exists; WS JSONL missing; `/v1/metrics` returns demo metrics only.
  - Search: `rg -n "/v1/metrics|metrics\(\)" -S src` → only demo path

10) SRE Runbook file
- Claim: "SRE runbook (1,518 lines)" complete.
- Code: No `docs/SRE-RUNBOOK.md` found.
  - `ls docs/` shows BACKENDS.md, OBSERVABILITY.md, PRODUCTION-DEPLOYMENT.md, etc.

11) DSL events: `upload_complete` and `CONDUIT_UPLOAD_ENQUEUE`
- Claim: "DSL supports upload_complete; optional auto-enqueue" complete.
- Code: Not present.
  - Search: `rg -n "upload_complete|CONDUIT_UPLOAD_ENQUEUE" -S src` → no hits

12) Exploration docs paths
- Claim: `docs/T5090-HTTP2-HTTP3-EXPLORATION.md`, `T5092-IMPLEMENTATION.md` present.
- Code: Not found.
  - Search: `rg -n "T5090-HTTP2-HTTP3-EXPLORATION.md|T5092-IMPLEMENTATION.md" -S repo` → no matches

## Why This Matters (quick context)
- Auth/CORS/rate limits are table stakes when many agents/devices call the gateway; without them we can’t safely run multi-tenant.
- blobRef wiring is core to the edge→core pattern. It’s what makes large data practical and envelopes small.
- WS JSONL + size caps protect from abuse and give agents/SREs the signals they need.
- SIGHUP reload keeps ops nimble without disconnecting clients.

## How We’ll Close the Gaps (matches your new sprint)
- HTTP‑BLOB‑REF: Wire `blobSink.store()` and return `{ blobRef }`. Optionally enqueue envelope with `blobRef`.
- HTTP‑AUTH / HTTP‑CORS: Add token allowlist, CORS allowlist + preflight.
- HTTP‑RATELIMIT: Token‑bucket per endpoint with 429 + Retry‑After.
- WS‑JSONL‑CAPS: Add WS JSONL logs and 1009 close for oversize frames.
- HOT‑RELOAD: SIGHUP rules/env reload; drain connections.
- TENANCY: token→tenant mapping; per‑tenant limits/tags.
- METRICS‑EXPAND: counters/histograms for HTTP/WS.
- EDGE‑REPLAY: docs + toggles for JSONL record/replay.
- BLOB‑QUEUE‑EXAMPLES: runnable example & docs.

I’ve also added a developer‑friendly issue list with “why” and acceptance criteria:
- File: `docs/HARDENING-ISSUES.md`

Thanks again for the momentum. The shipped pieces are strong; these hardening tasks will make the gateway safe at scale and agent‑friendly to operate. I’m here to help close them fast.
