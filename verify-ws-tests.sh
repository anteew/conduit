#!/bin/bash
set -e

echo "=== Verifying T3020-WS-Bidir Tests ==="
echo ""

# Build the project
echo "Building project..."
npm run build

# Compile tests
echo "Compiling tests..."
npm run test:compile

# Run tests
echo ""
echo "Running WebSocket bidirectional tests..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
timeout 35 node tests_compiled/ws_bidir.test.js || {
  echo "⚠ Tests timed out or failed"
  exit 1
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✓ Verification complete"
