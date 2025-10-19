#!/bin/bash
set -e

cd "$(dirname "$0")"

# Start Conduit with DSL rules
CONDUIT_RULES=config/rules.yaml node --loader ts-node/esm src/index.ts &
CONDUIT_PID=$!

# Wait for startup
sleep 3

echo "=== HTTP Error Mapping Tests ==="
echo ""

# Test 1: UnknownView -> 404
echo "Test 1: UnknownView (expect 404)"
STATUS=$(curl -s -o /tmp/test1.json -w '%{http_code}' 'http://127.0.0.1:9087/v1/snapshot?view=__unknown__')
echo "Status: $STATUS"
cat /tmp/test1.json
echo ""
echo ""

# Test 2: UnknownStream -> 404
echo "Test 2: UnknownStream (expect 404)"
STATUS=$(curl -s -o /tmp/test2.json -w '%{http_code}' 'http://127.0.0.1:9087/v1/stats?stream=__unknown__')
echo "Status: $STATUS"
cat /tmp/test2.json
echo ""
echo ""

# Test 3: InvalidEnvelope -> 400
echo "Test 3: InvalidEnvelope (expect 400)"
STATUS=$(curl -s -o /tmp/test3.json -w '%{http_code}' -X POST 'http://127.0.0.1:9087/v1/enqueue' -H 'Content-Type: application/json' -d '{"to":"test","envelope":null}')
echo "Status: $STATUS"
cat /tmp/test3.json
echo ""
echo ""

# Test 4: Valid request -> 200
echo "Test 4: Valid snapshot (expect 200)"
STATUS=$(curl -s -o /tmp/test4.json -w '%{http_code}' 'http://127.0.0.1:9087/v1/snapshot?view=myview')
echo "Status: $STATUS"
cat /tmp/test4.json
echo ""
echo ""

# Summary
echo "=== Summary ==="
echo "Test 1 (UnknownView): $(cat /tmp/test1.json | grep -o 'UnknownView' || echo 'FAIL')"
echo "Test 2 (UnknownStream): $(cat /tmp/test2.json | grep -o 'UnknownStream' || echo 'FAIL')"
echo "Test 3 (InvalidEnvelope): $(cat /tmp/test3.json | grep -o 'InvalidEnvelope' || echo 'FAIL')"

# Cleanup
kill $CONDUIT_PID 2>/dev/null || true
wait $CONDUIT_PID 2>/dev/null || true

echo ""
echo "✓ Tests complete"
