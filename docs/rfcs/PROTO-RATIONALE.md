# Rationale — Protocol Server + Proto DSL

Status: Draft
Owner: Ava (Architect)
Date: 2025-10-19

## Why a Protocol Server (Conduit)?

- Separation of concerns: Core services (e.g., Courier) stay pipe‑native and small; transports (HTTP/WS/SSE) live at the edge.
- Reuse: One gateway serves many core services that speak the same control frames.
- Safety and policy: Auth, quotas, and rate limits live at the edge without touching core logic.
- Composition: Easy to tunnel over new transports (Unix/TCP/QUIC/Serial) or record/replay traffic.

In short, Conduit is an adapter layer that lets developers expose core capabilities without re‑implementing HTTP/WS for every service.

## Why a Proto DSL?

- Declarative mapping: Express how external requests/messages map to control frames (and back) without shipping new code.
- Speed of iteration: Update a YAML/JSON mapping to add an endpoint or tweak parameters.
- Safety: Constrained operations (match → transform → send), with size/time limits and allowlists.
- Consistency: Shared mapping rules across HTTP/WS (and future connectors) keeps behavior uniform.

Not a programming language: The DSL is intentionally small. It focuses on selection and field mapping, not general computation.

## Scope (v0.1)

- Supported connectors: HTTP, WebSocket (SSE is output‑only; no inputs to map).
- Primitives:
  - when: method/path/header match; ws.message for WS inputs
  - map: JSONPointer/JSONPath‑style selectors; simple transforms (default/coalesce/pick)
  - send: toFrame(type, fields…) or toHttp(status, body)
  - onError: map frame errors (InvalidEnvelope, UnknownView, etc.) to HTTP/WS responses
- Safety & limits: allowlisted paths, body length caps, operation timeouts, deterministic rule order.

## Non‑Goals (for now)

- Arbitrary compute or user‑defined code execution.
- Heavy data processing or bulk binary transport (use blob side‑channels instead; pass refs in frames).
- Exactly‑once delivery or distributed transactions (control plane is at‑least‑once with idempotency keys).

## Alternatives Considered

- Hard‑coded connectors: Simple, but each service re‑implements the same edge logic; slow to evolve.
- gRPC gateway only: Great for typed clients, less flexible for browsers and SSE; still need mapping/routing for control frames.
- OpenAPI/JSON Schema codegen: Useful for documentation, but still requires hand‑rolled frame mapping and live routing policy.

The DSL complements these: you can still offer gRPC or generate docs, while Conduit performs the final mapping to control frames.

## Operational Story

- Transport adapters (HTTP/WS/SSE) receive requests/messages.
- DSL rules match inputs, map fields, and emit control frames over a Duplex pipe to the core.
- Responses (ok/error or deliver) are mapped back to HTTP/WS replies or pushed messages.
- Record/replay captures frame traffic for debugging and reproducibility.

## Rollout Plan

- Stage 2 (current):
  - Conduit repo scaffolding (HTTP/WS/SSE + in‑process demo backend).
  - Add TCP/Unix terminals to speak to a real core service process.
  - Implement DSL v0.1 interpreter; convert current hard‑coded mappings to DSL config.
- Stage 3:
  - Additional connectors (Unix domain socket, optional QUIC).
  - Bridges (Kafka/MQTT) only when a real integration needs them.
  - Optional CBOR encoding negotiation if payload sizes or latency justify it.

## RFC Index (Conduit)

- docs/rfcs/CONTROL-PROTOCOL-v1.md
- docs/rfcs/PROTO-DSL.md

## Related RFCs (Courier)

- docs/rfcs/CONTROL-PROTOCOL-v1.md
- docs/rfcs/CONDUIT-PROTOCOL-SERVER.md

These documents jointly define the control frames, the role of protocol servers, and the path to a small, safe DSL for external mappings.

