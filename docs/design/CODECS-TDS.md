# Technical Design Specification — Conduit Codecs v1

Status: Draft

Owner: Ava (Architect)

Purpose
- Add binary codecs (MessagePack primary, CBOR optional) to reduce CPU/bytes for agent envelopes while preserving existing HTTP/WS behaviors and safety limits. Keep JSON as baseline and DSL unchanged.

Non-goals
- Replacing JSON by default; encoding large binaries (use blobRef); introducing schema-heavy IDLs in v1.

Architecture
- Registry (src/codec/*)
  - interface Codec { name: string; contentTypes: string[]; isBinary: boolean; encode(obj): Uint8Array; decode(buf: Uint8Array): any }
  - registerCodec(), getCodecByName(), detectForHttp(contentType), chooseForHttpResponse(accept, def)
  - Built-ins: json, msgpack (msgpackr). CBOR adapter optional.
- Connectors
  - HTTP decode: if Content-Type == application/msgpack → decode via msgpack; else if application/cbor → decode via cbor; else JSON.
  - HTTP encode: parse Accept; prefer msgpack/cbor if negotiated; otherwise JSON. Optional override header X-Codec (lower priority than explicit Accept match).
  - WS: negotiate via ?codec=msgpack|cbor|json (default json). Use binary frames for msgpack/cbor and text for json. Reply using same codec.
  - Control Plane: unchanged (JSONL). Optional phase 2: length‑prefixed msgpack frames behind hello negotiation.

Safety & Limits
- Same limits apply regardless of codec: body caps (decoded), headersTimeout/requestTimeout, header-size/cookie-size. WS max message size with 1009 close.
- Add decoded size/depth caps to guard against pathological payloads. Map decode failures to 400 (HTTP) or 1007 (WS).

Observability
- Logs: include codec and bytes in/out (post-decode/pre-encode). WS logs include negotiated codec at open.
- Metrics: per-codec counters (requests/messages) and bytes in/out.

Compression Interplay
- Codecs are orthogonal to Content-Encoding (gzip/br/zstd). Decompress first, then decode; encode then (optionally) compress.
- Intermediaries may add/remove Content-Encoding; Conduit should honor it transparently.

Negotiation Details
- HTTP request decode: Content-Type exact match for application/msgpack|application/cbor; otherwise JSON.
- HTTP response encode: parse Accept header (q-values) and choose best supported; fallback to JSON; env default when Accept is */*.
- WS: query parameter (?codec=) or future subprotocol; store per-connection.

Config Flags (initial)
- CONDUIT_DEFAULT_CODEC=json|msgpack|cbor (response default when ambiguous)
- CONDUIT_CODECS_HTTP=true|false (gate HTTP wiring)
- CONDUIT_CODECS_WS=true|false (gate WS wiring)

Testing & Perf
- Repeat http_bidir/ws_bidir across json/msgpack/cbor; ws_errors with binary; oversize 1009 unchanged.
- perf_small: compare JSON vs msgpack latency/throughput with p50/p95.

Rollout
- Ship registry + adapters first (no behavior change). Then enable HTTP/WS behind flags and land tests. JSON remains default.

