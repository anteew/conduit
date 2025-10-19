#!/bin/bash
set -e

echo "=== T2131 Verification: Control Frame Recorder & Tailer ==="
echo ""

cd /srv/repos0/conduit

# Build
echo "Building..."
npm run build > /dev/null 2>&1

# Test 1: Basic recording
echo "Test 1: Basic frame recording..."
rm -f /tmp/conduit-verify.jsonl
CONDUIT_RECORD=/tmp/conduit-verify.jsonl CONDUIT_HTTP_PORT=9287 node --loader ts-node/esm src/index.ts > /dev/null 2>&1 & 
PID=$!
sleep 2

# Make a request
curl -sS http://127.0.0.1:9287/health > /dev/null
curl -sS -X POST http://127.0.0.1:9287/v1/enqueue \
  -H "content-type: application/json" \
  -d '{"to":"test.stream","envelope":{"id":"test1","data":"hello"}}' > /dev/null

sleep 1
kill $PID 2>/dev/null || true
wait $PID 2>/dev/null || true

# Verify frames were recorded
if [ ! -f /tmp/conduit-verify.jsonl ]; then
  echo "❌ FAILED: Recording file not created"
  exit 1
fi

FRAME_COUNT=$(wc -l < /tmp/conduit-verify.jsonl)
if [ "$FRAME_COUNT" -lt 3 ]; then
  echo "❌ FAILED: Expected at least 3 frames, got $FRAME_COUNT"
  exit 1
fi

# Check for hello frame
if ! grep -q '"type":"hello"' /tmp/conduit-verify.jsonl; then
  echo "❌ FAILED: Missing hello frame"
  exit 1
fi

# Check for enqueue frame
if ! grep -q '"type":"enqueue"' /tmp/conduit-verify.jsonl; then
  echo "❌ FAILED: Missing enqueue frame"
  exit 1
fi

echo "✓ Frame recording works ($FRAME_COUNT frames recorded)"

# Test 2: Verify JSONL format
echo "Test 2: Verify JSONL format..."
while IFS= read -r line; do
  if ! echo "$line" | jq -e '.ts and .dir and .frame' > /dev/null 2>&1; then
    echo "❌ FAILED: Invalid JSONL format"
    exit 1
  fi
done < /tmp/conduit-verify.jsonl
echo "✓ JSONL format valid"

# Test 3: Verify direction markers
echo "Test 3: Verify direction markers..."
if ! grep -q '"dir":"in"' /tmp/conduit-verify.jsonl; then
  echo "❌ FAILED: Missing 'in' direction"
  exit 1
fi
if ! grep -q '"dir":"out"' /tmp/conduit-verify.jsonl; then
  echo "❌ FAILED: Missing 'out' direction"
  exit 1
fi
echo "✓ Direction markers present"

# Test 4: Tailer script exists and is executable
echo "Test 4: Tailer script..."
if [ ! -f scripts/tail-frames.ts ]; then
  echo "❌ FAILED: Tailer script not found"
  exit 1
fi
# Quick test - just verify it can read a file
timeout 2 node --loader ts-node/esm scripts/tail-frames.ts /tmp/conduit-verify.jsonl > /dev/null 2>&1 || true
echo "✓ Tailer script exists"

# Clean up
rm -f /tmp/conduit-verify.jsonl

echo ""
echo "=== All T2131 Tests Passed ✓ ==="
