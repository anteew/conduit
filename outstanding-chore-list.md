# Outstanding Chore List (Conduit)

A living checklist of small, well-scoped follow‑ups. We can add/remove as we ship.

## Codecs
- Remove legacy `application/x-msgpack` in a future major (keep for backward compat in v1). File: `src/codec/msgpack.ts`.
- Add response negotiation tests for MessagePack on endpoints beyond `/v1/metrics` (e.g., errors and queueRefs). Files: `tests/http_codec_encode.test.ts` (+ new cases).
- Consider optional CBOR/Avro codecs behind flags; document trade‑offs and guardrails. New files under `src/codec/*` + registry wiring.
 - Enable MessagePack request‑body decode on protected endpoints (e.g., `/v1/enqueue`, `/v1/queue`) when `CONDUIT_CODECS_HTTP=true`. Today, the request decode path may default to JSON even for `Content-Type: application/msgpack`; tests added in `tests/codec_guardrails_msgpack.test.ts` currently skip HTTP guardrail assertions if decode falls back to JSON. Wire `decodeBody` to use the codec registry for request payloads and update tests to assert guardrail codes (DecodedSizeExceeded/DepthExceeded) for MessagePack bodies.

## Guardrails & Reload
- Wire guardrail reload into SIGHUP/admin endpoint similar to DSL/tenants (currently cached at module/process load). Files: `src/connectors/http.ts`, `src/connectors/ws.ts`, `src/index.ts`.
- Add admin: GET `/v1/admin/guardrails` to surface current limits; POST to update (v2+). File: `src/connectors/http.ts`.

## WS Error Mapping & Types
- Prefer structured error codes from decoders when available; propose a minimal shared error enum on codec boundary (JSON, MessagePack). Files: `src/codec/types.ts`, `src/connectors/ws.ts`.
- Expand tests to assert binary error frames when msgpack registry is active, while still tolerating JSON fallback in minimal setups. Files: `tests/ws_decode_errors.test.ts`.

## Size/Depth Measurement
- Validate the new `measureDecodedSize` estimator vs. representative payloads; add a micro-bench and corner‑case tests (cycles, Buffers, Dates, typed arrays). Files: `src/codec/guards.ts`, new `tests/codec_guards_unit.test.ts` cases.
- Consider configurable “cap policy” (drop/close vs. truncate/respond 4xx) with observability counters. Files: `src/connectors/http.ts`, `src/connectors/ws.ts`.

## Caching/Perf
- Audit remaining hot‑path calls that re‑read env per message/request; cache where safe and expose reload hooks. Files: `src/connectors/http.ts`, `src/connectors/ws.ts`.
- Add p50/p95/p99 timing histograms for codec encode/decode, and include in `/v1/metrics`. Files: `src/connectors/http.ts`, `src/connectors/ws.ts`.

## Tests & CI
- Add explicit tests for `application/vnd.msgpack` (accept/response negotiation). Files: `tests/http_codec_decode.test.ts`, `tests/http_codec_encode.test.ts`.
- Run WS tests with and without `CONDUIT_CODECS_WS=true` to validate both paths (binary and JSON fallbacks). CI matrix.
- Add a tiny readyness/poll instead of fixed sleeps in WS tests (port probe or `/health`). Files: `tests/ws_*`.

## Docs
- Document media types supported, flags (`CONDUIT_CODECS_HTTP/WS`), and guardrails in README. Files: `README.md` (Codecs section).
- Add troubleshooting for close codes (1007/1009/1011) and codec negotiation to `docs/SRE-RUNBOOK.md`.

## Nice‑to‑Have
- mkctl helpers to query `/v1/metrics`, `/health`, and toggle guardrails (if admin endpoint added). New script(s) under `scripts/`.
