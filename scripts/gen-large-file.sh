#!/usr/bin/env bash
set -euo pipefail
SZ=${1:-100} # MB
OUT=${2:-/tmp/large_blob.bin}
head -c "$((SZ*1024*1024))" </dev/urandom > "$OUT"
echo "$OUT"
