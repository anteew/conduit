#!/usr/bin/env bash
set -euo pipefail

# mkctl — Minimal control helper for Conduit
# Usage: scripts/mkctl.sh <cmd> [args]
#   cmds: health [host:port], metrics [host:port], reload [host:port]

HOSTPORT=${2:-127.0.0.1:9087}
BASE="http://$HOSTPORT"

case "${1:-}" in
  health)
    curl -fsS "$BASE/health" | jq . || curl -fsS "$BASE/health" || true
    ;;
  metrics)
    curl -fsS "$BASE/v1/metrics" | jq . || curl -fsS "$BASE/v1/metrics" || true
    ;;
  reload)
    curl -fsS -X POST "$BASE/v1/admin/reload" -H 'Content-Type: application/json' -d '{}' | jq . || true
    ;;
  *)
    echo "Usage: $0 {health|metrics|reload} [host:port]" >&2
    exit 2
    ;;
esac

