# Conduit — Protocol Server for Kernel Transports

Conduit terminates external transports (HTTP/WS/SSE) and speaks a small, pipe‑native control protocol to core services (e.g., Courier). It enables reuse, edge policies (auth/quotas), and composition without modifying core server code.

## Status
- Stage 2 skeleton: HTTP, WS, SSE connectors; in‑process demo backend; control protocol client; record/replay hook.
- Next: add TCP/Unix terminals; extract from demo backend to target a real core service.

## Quick Start
```bash
npm ci
npm run dev
# HTTP on 127.0.0.1:9087; WS on 127.0.0.1:9088
curl http://127.0.0.1:9087/health
```

## Config (env)
- CONDUIT_HTTP_PORT=9087, CONDUIT_WS_PORT=9088, CONDUIT_BIND=127.0.0.1
- CONDUIT_TOKENS=dev-local (optional edge Bearer allowlist)
- CONDUIT_RECORD=/tmp/conduit.ctrl.jsonl (optional control frame recording)

## Docs
- docs/rfcs/CONTROL-PROTOCOL-v1.md — frames used between Conduit and core.
- docs/rfcs/PROTO-DSL.md — translator DSL (draft) for mapping external protocols to frames.
