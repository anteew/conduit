# Proto‑DSL v0 — Mapping External Protocols to Control Frames
**Status:** Proposal (Draft v0)  
**Editors:** Friday (with Danny)  
**Last Updated:** 2025‑10‑19  
**Scope:** Conduit protocol servers at the edge; Core remains frame‑native; integrates with *mkolbol* stream‑kernel

---

> **Non‑normative note (Friday):**  
> This document is both a *spec* and a *rationale*. The normative parts are labeled **MUST/SHOULD/MAY**. The commentary (“why this is useful vs. cosplay”) is included inline so reviewers can see the trade‑offs without surfing elsewhere.

## 0. Summary

The **Proto‑DSL** is a tiny, declarative configuration that tells a **Protocol Server (Conduit)** how to translate *external* I/O (HTTP, WebSocket, SSE, Serial, Filesystem, Stdio) ↔ **Control Frames** (newline‑delimited JSON; the “Core contract”). The **Core** never speaks HTTP or fiddles with sockets; it speaks frames. The **mkolbol** stream‑kernel provides the pipes/backpressure/supervision beneath both.

- **Key primitives:** `bind` (attach transports), `when` (match), `map` (extract/transform), `send` (frame or transport response), `onError` (map internal codes to transport errors), plus `flow` (credit policy) and `codec` (jsonl/cbor).
- **Frames v1 (from repo):** `hello`, `ok`, `error`, `enqueue`, `subscribe`, `grant`, `ack`, `nack`, `deliver`, `stats`, `snapshot`, `metrics`.

---

## 1. Goals / Non‑Goals

**Goals**
- **G1. Declarative mapping:** External request/message → frame(s) and back, with minimal moving parts.
- **G2. Stable Core contract:** Add/bind transports without touching Core.
- **G3. Testability & replay:** All mappings operate over line‑delimited frames; record/replay is first‑class.
- **G4. Edge policy:** Auth, quotas, rate‑limits, and shape checks live in Conduit/DSL.

**Non‑Goals**
- Turing completeness. v0 is intentionally *not* a programming language.
- Fancy schema/type system. Use JSONPointer/Path + a few helpers; escape to JS/WASM only as an explicit opt‑in.
- Cryptography and sandboxing. Those live in the host/container/platform layer.

---

## 2. Layering Model (mkolbol fit)

```
[L3 Protocol/Policy]   Conduit protocol servers + Proto‑DSL
        │              (HTTP/WS/SSE/Serial/FS/Stdio/…)
        ▼
[L2 Semantics]         Control frames (JSONL): hello, enqueue, subscribe, grant/ack/nack, deliver, stats, snapshot, metrics
        │
        ▼
[L1 Mechanism]         mkolbol stream‑kernel (pipes, router, backpressure, record/replay, supervision)
```

**Normative:** Protocol servers **MUST** emit/accept frames exactly as specified in §4. Protocol servers **MAY** be implemented as mkolbol modules (e.g., via the External Server Wrapper) or as separate processes bridged by pipes.

---

## 3. Glossary

- **Binding:** A configured transport endpoint (e.g., `http: {port:9087}` or `serial: {device:…}`).
- **Rule:** A `when`/`map`/`send`/`onError` block that performs one translation.
- **Codec:** The framing/serialization used over the transport: `jsonl` (default) or `cbor` (optional for v0).

---

## 4. Control Frame Contract (v1 quick reference)

> Shapes reflect `conduit-stage2-skeleton/src/control/types.ts` and **MUST NOT** be altered by a DSL implementation.

```ts
HelloFrame    = { type: 'hello',    version?: string, features?: string[], token?: string }
OkFrame       = { type: 'ok',       reqId: string, result?: any }
ErrorFrame    = { type: 'error',    reqId: string, code: string, detail?: string }
EnqueueFrame  = { type: 'enqueue',  to: string, env: any, reqId?: string }
SubscribeFrame= { type: 'subscribe',stream: string }
GrantFrame    = { type: 'grant',    n: number }
AckFrame      = { type: 'ack',      id: string }
NackFrame     = { type: 'nack',     id: string, delayMs?: number }
DeliverFrame  = { type: 'deliver',  env: any }
StatsFrame    = { type: 'stats',    reqId: string, stream: string }
SnapshotFrame = { type: 'snapshot', reqId: string, view: string }
MetricsFrame  = { type: 'metrics',  reqId: string }
```

**Correlation:** Frames with `reqId` expect a corresponding `ok`/`error` referencing the same `reqId`. Implementations **MUST** generate unique `reqId` per request that expects a reply (e.g., `enqueue`, `stats`, `snapshot`, `metrics`, and `hello` as implemented).

---

## 5. File Format

- **Syntax:** YAML (UTF‑8).  
- **Top‑level keys:**
  - `version` (string, REQUIRED) — e.g., `"proto-dsl/v0"`
  - `bind` (object, OPTIONAL) — transport bindings
  - `codec` (object, OPTIONAL) — per‑binding codec selection
  - `flow` (object, OPTIONAL) — credit policy defaults
  - `rules` (array, REQUIRED) — ordered rule list (first match wins)
  - `defaults` (object, OPTIONAL) — default maps and error mappings

**Example skeleton**
```yaml
version: "proto-dsl/v0"

bind:
  http:   { port: 9087, pathPrefix: /v1 }
  ws:     { port: 9088, path: /v1/subscribe }
  serial: { device: /dev/ttyUSB0, baud: 115200, framing: jsonl }
  fs:     { inbox: /mnt/offline/incoming, outbox: /mnt/offline/outgoing }
  stdio:  { } # child process stdio, if used

codec:
  http:   { in: jsonl, out: jsonl }
  ws:     { in: jsonl, out: jsonl }
  serial: { in: jsonl, out: jsonl }
  fs:     { in: jsonl, out: jsonl }

flow:
  mode: credit          # "credit" only in v0
  window: 64            # default outstanding deliveries
  refill: on_ack        # refill policy: on_ack | interval

rules:
  - id: http-enqueue
    when:   { http: { method: POST, path: /enqueue } }
    map:    { to: $.to, env: $.envelope }
    send:   { frame: { type: enqueue, fields: { to: $to, env: $env } } }
    onError:
      InvalidJSON: { http: { status: 400, body: { error: "bad json" } } }
      UnknownDest: { http: { status: 404, body: { error: "unknown destination" } } }
```

---

## 6. Match / Map / Send / Errors — The Primitives

### 6.1 `when` (match)

Rules are evaluated top‑to‑bottom. The first rule whose `when` **fully matches** the incoming event is selected.

**Transport‑specific matchers (v0):**

**HTTP**
```yaml
when:
  http:
    method: POST | [GET,POST]           # exact or array
    path: /v1/enqueue                   # literal or glob (/v1/*) or regex (/^\/v1\/sub.*/)
    headers: { x-tenant: *.acme.com }   # glob or regex; case-insensitive keys
    query:   { stream: $stream }        # capture
    contentType: application/json       # optional hint for body parse
```

**WebSocket**
```yaml
when:
  ws:
    path: /v1/subscribe
    # On connection-open match uses `query` and `headers`.
    query: { stream: $stream }
    # For messages:
    message:
      type: text | binary
      json.has: credit                # assert field exists
      json.match: { credit: number }  # simple shape check (see §6.2.3)
```

**Serial**
```yaml
when:
  serial:
    line.fr: jsonl | raw            # framing (see `bind.serial.framing`)
    line.json.has: type             # for jsonl
    line.json.eq: { type: DELIVER } # exact match
    # raw mode:
    # line.raw.match: "CREDIT *"    # glob/regex for raw text
```

**Filesystem (sneakernet)**
```yaml
when:
  fs:
    event: newFile | newDir
    path.match: "*.frames.jsonl"      # glob/regex
```

**Stdio**
```yaml
when:
  stdio:
    stream: stdout | stderr
    line.json.has: type | null        # matches if JSON parse succeeds and has field
    line.raw.match: "^CREDIT "        # alternatively match raw text
```

**General combinators**
```yaml
when:
  all:       [ {http:{method:POST}}, {http:{path:/enqueue}} ]  # AND
  any:       [ {ws:{path:/v1/subscribe}}, {http:{path:/v1/sse}} ] # OR
  not:       { http: { headers: { x-debug: true } } }          # NOT
  where:     $env.to != null && $env.id ~= /^[a-z0-9-]{10,}$/  # tiny expr, see §6.2.4
```

### 6.2 `map` (extract/transform)

Builds a **context** of variables for `send`. v0 supports:

#### 6.2.1 Selectors

- **JSONPointer** (preferred): `/path/to/field`  
- **JSONPath**: `$.path.to.field`  
- **Shorthand**: if a selector starts with `$`, treat it as JSONPath; if it starts with `/`, treat as JSONPointer.

```yaml
map:
  to: $.to
  env: $.envelope
  id: /meta/id
```

#### 6.2.2 Helpers

- `coalesce($a,$b,...)` → first defined
- `default($x,42)` → 42 if $x undefined
- `pick($obj, ["a","b"])` → object with only keys
- `regex($s, "^(\\w+):", 1)` → first capture group
- `toInt($s)` / `toFloat($s)` / `toString($x)`
- `const: value` → constant

Example:
```yaml
map:
  to:        coalesce($.to, $.destination)
  env:       $.envelope
  priority:  default($.priority, 5)
  tenant:    regex($.headers.x_tenant, "^(\\w+)\\.", 1)
```

#### 6.2.3 Shape checks

Optional lightweight assertions that **MUST** fail the rule if violated:
```yaml
assert:
  env: { required: ["type","payload"] }
  to:  { type: string, minLength: 1 }
```

#### 6.2.4 Tiny expressions

Inside `where:` (boolean) and `set:` (value), v0 allows a minimal expression grammar: literals, `&&`, `||`, `!`, `==`, `!=`, `<`, `<=`, `>`, `>=`, `+`,`-`,`*`,`/`, regex `~=`, and var refs `$name`.

```yaml
where: $priority >= 0 && $priority <= 9
set:
  ttlMs: $priority > 7 ? 1000 : 5000  # ternary allowed
```

### 6.3 `send` (action)

There are two families in v0:

#### 6.3.1 Send a **frame** to Core
```yaml
send:
  frame:
    type: enqueue | subscribe | grant | ack | nack | stats | snapshot | metrics | hello
    fields: { to: $to, env: $env }     # object literal; values may use $vars or helpers
  await: ok | error | none             # default depends on frame type (see below)
  respond:                             # OPTIONAL: produce a transport response from the ok/error
    http:  { status: 202, body: $result }      # $result is ok.result; $error is error object
    ws:    { message: { ack: $result.id } }    # for WS send
    serial:{ line: { type: "OK", id: $result.id } }
```

**Default awaiting semantics (normative):**
- `enqueue`, `stats`, `snapshot`, `metrics`, `hello` → **await: ok|error** (MUST correlate by `reqId`).
- `subscribe`, `grant`, `ack`, `nack` → **await: none** (fire‑and‑forget).

Implementations **MAY** override with explicit `await:` per rule.

#### 6.3.2 Send a **transport response** directly

Used to terminate an HTTP request or push to WS/SSE/Serial without a new Core frame.

```yaml
send:
  http:   { status: 200, body: { ok: true } }
  ws:     { message: { ping: true } }
  serial: { line: { type: "PONG" } }    # or: { raw: "PONG\n" }
  fs:
    write:
      path: "outbox/%iso8601%.acks.jsonl"
      appendFrames: [ { type: "ok", reqId: $reqId } ]
```

### 6.4 `onError` (mapping)

Maps internal error codes → transport semantics. Unknown codes fall back to a default (implementation‑defined; SHOULD be 500 for HTTP).

```yaml
onError:
  InvalidJSON: { http: { status: 400, body: { error: "bad json" } } }
  UnknownOp:   { ws:   { close: { code: 1003, reason: "unknown op" } } }
  Backpressure:{ http: { status: 429, body: { error: "overloaded" } } }
  "*":         { http: { status: 500, body: { error: "internal" } } }  # wildcard
```

**Reserved error codes (initial):** `InvalidJSON`, `UnknownOp`, `Unauthorized`, `Forbidden`, `UnknownDest`, `Backpressure`, `Timeout`, `DecodeError`.

---

## 7. Bindings (v0)

### 7.1 HTTP
```yaml
bind:
  http:
    port: 9087
    host: 127.0.0.1
    pathPrefix: /v1
    headers: { x-powered-by: "conduit" }   # default response headers (OPTIONAL)
```

**Notes:** Request body **MUST** be parsed as JSON when `contentType` matches `application/json` (or missing and `body` decodes as JSON). Other types MAY be supported as extensions.

### 7.2 WebSocket
```yaml
bind:
  ws:
    port: 9088
    host: 127.0.0.1
    path: /v1/subscribe
```

**Notes:** On connect, `hello` MAY be sent automatically with negotiated features. Messages parsed as JSON by default; non‑JSON frames map via `ws.message.type: binary` + `base64` helpers where needed.

### 7.3 Serial
```yaml
bind:
  serial:
    device: /dev/ttyUSB0
    baud: 115200
    framing: jsonl        # jsonl | raw  (v0)
    newline: "\n"         # used for raw/jsonl framing
    checksum: none        # none | crc32 (v1+ idea)
```

### 7.4 Filesystem (Sneakernet)
```yaml
bind:
  fs:
    inbox:  /mnt/offline/incoming
    outbox: /mnt/offline/outgoing
    atomicWrites: true       # write .part then rename
```

### 7.5 Stdio
```yaml
bind:
  stdio: { }  # no options in v0
```

---

## 8. Flow control (`flow`)

```yaml
flow:
  mode: credit        # only supported mode in v0
  window: 64
  refill: on_ack      # on_ack | interval
  intervalMs: 250     # only if refill=interval
```

**Semantics:** Conduit **MAY** auto‑issue `grant` frames up to `window` on connection open (WS/Serial/SSE), and **SHOULD** replenish on each `ack` when `refill: on_ack`.

---

## 9. Codec selection (`codec`)

```yaml
codec:
  http:   { in: jsonl, out: jsonl }
  ws:     { in: jsonl, out: jsonl }
  serial: { in: jsonl, out: jsonl }  # v0 only jsonl; cbor optional in v1
```

**Normative:** The Core frame stream is always **JSONL** in v0. Per‑binding codecs here control the *edge transport*, not the Core stream.

---

## 10. Examples (runnable patterns)

### 10.1 HTTP → `enqueue` with `ok` response
```yaml
version: "proto-dsl/v0"
bind: { http: { port: 9087, pathPrefix: /v1 } }

rules:
  - id: http-enqueue
    when: { http: { method: POST, path: /enqueue } }
    map:
      to:  $.to
      env: $.envelope
    send:
      frame: { type: enqueue, fields: { to: $to, env: $env } }
      await: ok
      respond:
        http: { status: 202, body: { enqueued: true, result: $result } }
    onError:
      InvalidJSON: { http: { status: 400, body: { error: "bad json" } } }
      UnknownDest: { http: { status: 404, body: { error: "unknown destination" } } }
```

### 10.2 WS subscribe with credit/ack/nack
```yaml
version: "proto-dsl/v0"
bind: { ws: { port: 9088, path: /v1/subscribe } }
flow: { mode: credit, window: 64, refill: on_ack }

rules:
  - id: ws-subscribe-open
    when: { ws: { path: /v1/subscribe, query: { stream: $stream } } }
    send: { frame: { type: subscribe, fields: { stream: $stream } } }

  - id: ws-grant
    when: { ws: { message: { json.has: credit } } }
    map:  { n: $.credit }
    send: { frame: { type: grant, fields: { n: $n } } }

  - id: ws-ack
    when: { ws: { message: { json.has: ack } } }
    map:  { id: $.ack }
    send: { frame: { type: ack, fields: { id: $id } } }

  - id: ws-nack
    when: { ws: { message: { json.has: nack } } }
    map:  { id: $.nack, delayMs: $.delayMs }
    send: { frame: { type: nack, fields: { id: $id, delayMs: $delayMs } } }
```

### 10.3 Serial (JSONL) deliver & credit
```yaml
version: "proto-dsl/v0"
bind: { serial: { device: /dev/ttyUSB0, baud: 115200, framing: jsonl } }

rules:
  - id: serial-deliver
    when: { serial: { line.json.eq: { type: DELIVER } } }
    map:  { env: $.env }
    send: { frame: { type: deliver, fields: { env: $env } } }

  - id: serial-credit
    when: { serial: { line.json.has: n } }
    map:  { n: $.n }
    send: { frame: { type: grant, fields: { n: $n } } }
```

### 10.4 Filesystem (sneakernet) ingest & ack log
```yaml
version: "proto-dsl/v0"
bind: { fs: { inbox: /mnt/offline/incoming, outbox: /mnt/offline/outgoing } }

rules:
  - id: fs-ingest-frames
    when: { fs: { event: newFile, path.match: "*.frames.jsonl" } }
    send:
      frame:
        type: deliver
        fields:
          env: $file.readLinesAsFrames  # implementation provides this helper
    onError:
      BadFrame: { fs: { write: { path: "errors/%basename%.err.json",
                                 body: { reason: "BadFrame" } } } }
```

---

## 11. Observability

- **reqId**: auto‑generated for any frame expecting a reply.
- **ruleId**: each rule **MUST** carry an `id` (string). Logs and metrics tag counts/latencies by `ruleId`.
- **Metrics:** counters for rule hit/miss, errors by code, and latencies for `await`ed frames.
- **Recording:** Conduit **SHOULD** support `--record path` to dump all in/out frames as `.jsonl` for replay.

---

## 12. Security considerations

- **Auth:** `hello.token` is the standard hook. Bindings **SHOULD** validate bearer/API keys before rule evaluation.
- **Least privilege:** prefer a separate Conduit instance per trust boundary; no shared tokens across tenants.
- **PII scrubbing:** permit `map` transforms to redact fields before forwarding to Core.
- **Path traversal:** sanitize `fs` paths; enforce `outbox` sandbox and atomic writes.

---

## 13. Conformance (v0)

An implementation **conforms** if:
1. It accepts a v0 YAML and validates unknown keys as errors (opt‑in extensions under `x-` prefix are allowed).
2. It evaluates rules in order with first‑match semantics.
3. It produces/consumes frames exactly per §4, honoring `await` defaults.
4. It supports HTTP and WS bindings; Serial and FS are OPTIONAL in v0.

**Reference tests (suggested):**
- `http/enqueue/ok`: POST body → `enqueue(reqId=*)`, expect `ok(reqId=*)` and HTTP 202.
- `ws/flow/credit`: message `{credit:5}` → `grant(5)`.
- `serial/jsonl/deliver`: `{type:"DELIVER",env:{...}}` → `deliver(env)`.
- `error/catalog`: malformed JSON → `InvalidJSON` → HTTP 400 via `onError` mapping.

---

## 14. Migration & Future Work (v1+)

- Add `cbor` codec option for serial/ble.
- Add **schema blocks** (JSON Schema lite) and **compile‑time validation** of `map`.
- Add **SSE** binding and **QUIC**.
- Add **stateful rules** (finite machines) with explicit timeouts—guardrails to avoid a general‑purpose language.
- Pluggable **auth providers** and **rate‑limit** primitives.

---

## 15. Design Commentary (non‑normative)

> These are the “why/when/when‑not” notes you asked me to embed. They’re opinions, but grounded in what you have in the two repos.

### 15.1 Is this useful vs. indulgent?

**Useful** when you face **transport churn** (HTTP today; WS/SSE/Serial/FS tomorrow) and you want **Core stability**. It lets you harden the Core once, and iterate at the edge with tiny, reviewable configs. It’s also a win for **record/replay** and **forensics**—the JSONL boundary is easy to persist and inspect.

**Not indulgent** so long as the DSL stays *small*. The second you add loops and opaque state, you’ve built a worse programming language. v0 deliberately avoids that trap.

### 15.2 Where it pays off

1. **Heterogeneous front doors:** attach HTTP, WS, Serial, or Sneakernet without touching Core.  
2. **Edge policy:** auth/quotas/PII scrubbing live near the user.  
3. **Determinism:** JSONL frames make offline ingest and replay trivial (carry a thumb drive between enclaves).  
4. **Debuggability:** every hop is observable: transport log ↔ frame log.

### 15.3 Where it hurts

- **Two‑level debugging:** You’ll chase bugs in the mapping *and* the Core. Invest in `ruleId` tracing, reqId correlation, and a “dry‑run” mode that shows selected rule + produced frame.  
- **Latency tax:** There’s an extra hop and transform. For ultra‑tight loops, write a thin adapter by hand and keep DSL out of the hot path.  
- **DSL sprawl risk:** avoid Turing‑complete features. Keep `map`/`assert`/`where` minimal, with an **escape hatch** to JS/WASM clearly labeled as `unsafe`.

### 15.4 When to use DSL vs. code (smell tests)

Use **DSL** when the mapping fits in **≤ 200 lines**, needs **per‑tenant tweaks**, or benefits from **reviewable diffs** and **fixtures**.  
Drop to **code** when you need crypto/compression, fine‑grained batching, custom backpressure algorithms, or complex state machines.

### 15.5 Fit with mkolbol (Plan 9/L4/Erlang vibe)

- **Mechanism vs. policy:** mkolbol kernel = pipes/backpressure; Conduit/DSL = policy/edge; Core = domain semantics.  
- **Everything is a file:** frames are the “file‑like” interface; protocol servers are merely different dialers.  
- **Supervision & placement:** you can relocate protocol servers or cores without changing mappings—location is policy.

---

## 16. Appendix A — Minimal interpreter outline (pseudo)

```ts
for (const rule of rules) {
  if (match(rule.when, event)) {
    const ctx = evaluateMap(rule.map, event.body, event.meta);
    if (rule.assert && !checkShapes(rule.assert, ctx)) fail("ShapeError");
    const action = rule.send;
    if (action.frame) {
      const { type, fields } = materialize(action.frame, ctx);
      const reqId = needsReply(type) ? genReqId() : undefined;
      writeFrame({ type, ...fields, ...(reqId?{reqId}:{} ) });
      const outcome = action.await ?? defaultAwait(type);
      if (outcome !== 'none') {
        const reply = await waitForReply(reqId);
        const resp = selectResponse(action.respond, reply);
        if (resp) sendTransport(resp);
      }
    } else {
      sendTransport(materialize(action, ctx));
    }
    break;
  }
}
```

---

## 17. Appendix B — ABNF for path patterns (sketch)

```
path        = "/" segment *("/" segment)
segment     = 1*( ALPHA / DIGIT / "-" / "_" )
glob        = path [ "/" "*" ]
regex       = "/" 1*( %x00-2F / %x3A-7E ) "/" [ flags ]
```

---

## 18. Changelog

- **2025‑10‑19:** First v0 draft. Covers HTTP, WS, Serial, FS; defines flow/codec; embeds rationale and smell tests.
