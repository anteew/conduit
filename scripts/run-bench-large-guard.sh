#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

LOG=bench_large.log
PIDF=bench_large.pid
RCF=bench_large.rc

echo "[guard] Cleaning up any existing processes..."
cleanup_servers() {
  pkill -f "node dist/index.js" 2>/dev/null || true
  pkill -f "/srv/repos0/conduit/dist/index.js" 2>/dev/null || true
  pkill -f "/srv/repos0/conduit/src/index.ts" 2>/dev/null || true
  for port in 9087 9088; do
    for i in {1..10}; do
      PIDS=$(lsof -i :"$port" -P -n 2>/dev/null | awk 'NR>1{print $2}' | sort -u)
      if [[ -z "$PIDS" ]]; then break; fi
      echo "$PIDS" | xargs -r kill 2>/dev/null || true
      sleep 0.2
    done
  done
}
cleanup_servers
rm -f "$LOG" "$PIDF" "$RCF" server.out.log server.err.log

echo "[guard] Building dist..."
npm run -s build >/dev/null

echo "[guard] Starting bench:large in background..."
nohup bash -lc 'npm run bench:large; printf "%d" $? > bench_large.rc' > "$LOG" 2>&1 & echo $! > "$PIDF"

echo "[guard] Sleeping 40s..."
sleep 40

PID=$(cat "$PIDF" 2>/dev/null || echo "")
if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
  echo "[guard] TIMEOUT: bench still running after 40s (PID=$PID). Killing and collecting diagnostics."
  kill "$PID" 2>/dev/null || true; sleep 0.3; kill -9 "$PID" 2>/dev/null || true
  cleanup_servers
  echo "--- ps snapshot ---"; ps -ef | rg -n "conduit|dist/index.js|tests_compiled/large_payload" | rg -v rg || true
  echo "--- ports ---"; lsof -i :9087 -P -n || true; lsof -i :9088 -P -n || true
  echo "--- last 60 lines of $LOG ---"; tail -n 60 "$LOG" || true
  exit 124
fi

RC=$(cat "$RCF" 2>/dev/null || echo "1")
echo "[guard] bench finished with rc=$RC"
sed -n '1,120p' "$LOG" || true
exit "$RC"
