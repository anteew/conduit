#!/usr/bin/env bash
set -euo pipefail

# Conduit soak script: start server, send mixed HTTP/WS traffic, capture /v1/metrics
# Usage: scripts/soak_metrics.sh [duration_seconds]

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

DUR=${1:-40}
LOG_DIR="/tmp"
TS=$(date -u +%Y%m%dT%H%M%SZ)
SERVER_LOG="$LOG_DIR/conduit_soak_server_${TS}.log"
METRICS_OUT="reports/metrics-soak-${TS}.json"

mkdir -p reports

echo "[soak] Starting Conduit server (duration=${DUR}s)" | tee -a "$SERVER_LOG"

# Ensure dependencies are installed locally (skip if node_modules exists)
if [ ! -d node_modules ]; then
  echo "[soak] Installing dependencies (npm ci)" | tee -a "$SERVER_LOG"
  npm ci >> "$SERVER_LOG" 2>&1
fi

# Try to free default ports if leftover processes exist (best-effort)
for p in 9087 9088; do
  if lsof -i :$p >/dev/null 2>&1; then
    echo "[soak] Port $p in use; attempting to kill old listener" | tee -a "$SERVER_LOG"
    OLD_PID=$(lsof -t -i :$p || true)
    if [ -n "$OLD_PID" ]; then
      kill "$OLD_PID" || true
      sleep 1
    fi
  fi
done

# Start server in background
CONDUIT_RULES=${CONDUIT_RULES:-config/rules.yaml} \
CONDUIT_CODECS_HTTP=${CONDUIT_CODECS_HTTP:-true} \
CONDUIT_CODECS_WS=${CONDUIT_CODECS_WS:-true} \
node --loader ts-node/esm src/index.ts >> "$SERVER_LOG" 2>&1 &
PID=$!
echo "[soak] PID=$PID (log: $SERVER_LOG)" | tee -a "$SERVER_LOG"

# Wait for health
echo -n "[soak] Waiting for /health" | tee -a "$SERVER_LOG"
for i in $(seq 1 30); do
  code=$(curl -fsS -o /dev/null -w '%{http_code}' http://127.0.0.1:9087/health || true)
  if [ "$code" = "200" ]; then echo " ok" | tee -a "$SERVER_LOG"; break; fi
  echo -n "." | tee -a "$SERVER_LOG"; sleep 0.5
  if [ "$i" = "30" ]; then
    echo "\n[soak] Health check failed; tailing log:" | tee -a "$SERVER_LOG"
    tail -n 200 "$SERVER_LOG" || true
    kill "$PID" 2>/dev/null || true
    exit 1
  fi
done

echo "[soak] Generating HTTP traffic" | tee -a "$SERVER_LOG"

# Repeated health checks
for i in $(seq 1 20); do curl -fsS http://127.0.0.1:9087/health >/dev/null; done

# Metrics (JSON)
for i in $(seq 1 5); do curl -fsS http://127.0.0.1:9087/v1/metrics >/dev/null; done

# Metrics (request MessagePack via Accept if enabled; ignore errors)
for i in $(seq 1 5); do curl -fsS -H 'Accept: application/msgpack;q=1.0, application/json;q=0.9' http://127.0.0.1:9087/v1/metrics -o /dev/null || true; done

# Enqueue JSON
for i in $(seq 1 10); do \
  curl -fsS -X POST http://127.0.0.1:9087/v1/enqueue \
    -H 'Content-Type: application/json' \
    --data '{"to":"agents/Jen/inbox","envelope":{"type":"notify","payload":{"i":'"$i"'}}}' >/dev/null; \
done

# Small octet-stream upload (2 MB) – synchronous mode if available
SMALL=/tmp/conduit_small_${TS}.bin
dd if=/dev/zero of="$SMALL" bs=1M count=2 status=none
curl -fsS -X POST http://127.0.0.1:9087/v1/upload \
  -H 'Content-Type: application/octet-stream' \
  -H 'X-Upload-Mode: sync' \
  --data-binary @"$SMALL" >/dev/null || true

# Multipart upload (same file)
curl -fsS -X POST http://127.0.0.1:9087/v1/upload \
  -H 'Expect:' \
  -F file=@"$SMALL" >/dev/null || true

echo "[soak] Generating WS traffic" | tee -a "$SERVER_LOG"

# WS JSON codec – send a small JSON frame and close
node - <<'NODE' || true
import WebSocket from 'ws';
const run = async () => {
  const ws = new WebSocket('ws://127.0.0.1:9088/ws?codec=json', { perMessageDeflate: false });
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  ws.send(JSON.stringify({ op: 'hello', client: 'soak-json' }));
  ws.close();
};
await run().catch(()=>{});
NODE

# WS msgpack requested – send JSON anyway (server should fallback if msgpack not available)
node - <<'NODE' || true
import WebSocket from 'ws';
const run = async () => {
  const ws = new WebSocket('ws://127.0.0.1:9088/ws?codec=msgpack', { perMessageDeflate: false });
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  ws.send(JSON.stringify({ op: 'hello', client: 'soak-msgpack-req' }));
  ws.close();
};
await run().catch(()=>{});
NODE

echo "[soak] Sleeping for ${DUR}s to let traffic settle" | tee -a "$SERVER_LOG"
sleep "$DUR"

echo "[soak] Capturing /v1/metrics -> $METRICS_OUT" | tee -a "$SERVER_LOG"
curl -fsS http://127.0.0.1:9087/v1/metrics -o "$METRICS_OUT"

echo "[soak] Stopping server (PID=$PID)" | tee -a "$SERVER_LOG"
kill "$PID" 2>/dev/null || true
sleep 1
if kill -0 "$PID" 2>/dev/null; then kill -9 "$PID" 2>/dev/null || true; fi

echo "[soak] Done. Metrics saved: $METRICS_OUT"

