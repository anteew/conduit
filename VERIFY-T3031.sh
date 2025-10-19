#!/bin/bash
# T3031: Latency Measurement Verification

set -e
cd "$(dirname "$0")"

echo "🔍 T3031: Running Latency Benchmark..."
echo ""

npm run bench:small

echo ""
echo "✅ Benchmark complete. Review T3031-LATENCY-SUMMARY.md for analysis."
