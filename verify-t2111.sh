#!/bin/bash
# T2111 Verification Script
# Tests HTTP error mapping via DSL onError

set -e
cd "$(dirname "$0")"

echo "=== T2111: HTTP Error Mapping Verification ==="
echo ""

# Start Conduit
CONDUIT_RULES=config/rules.yaml node --loader ts-node/esm src/index.ts 2>&1 | grep -v "Experimental\|Deprecation\|trace" &
CONDUIT_PID=$!
trap "kill $CONDUIT_PID 2>/dev/null; wait $CONDUIT_PID 2>/dev/null; exit" EXIT INT TERM

sleep 3

PASS=0
FAIL=0

# Test 1: UnknownView -> 404
echo -n "Test 1: UnknownView -> 404 ... "
STATUS=$(curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:9087/v1/snapshot?view=__unknown__')
if [ "$STATUS" = "404" ]; then
  echo "✓ PASS"
  ((PASS++))
else
  echo "✗ FAIL (got $STATUS)"
  ((FAIL++))
fi

# Test 2: UnknownStream -> 404
echo -n "Test 2: UnknownStream -> 404 ... "
STATUS=$(curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:9087/v1/stats?stream=__unknown__')
if [ "$STATUS" = "404" ]; then
  echo "✓ PASS"
  ((PASS++))
else
  echo "✗ FAIL (got $STATUS)"
  ((FAIL++))
fi

# Test 3: InvalidEnvelope -> 400
echo -n "Test 3: InvalidEnvelope -> 400 ... "
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST 'http://127.0.0.1:9087/v1/enqueue' \
  -H 'Content-Type: application/json' -d '{"to":"test","envelope":null}')
if [ "$STATUS" = "400" ]; then
  echo "✓ PASS"
  ((PASS++))
else
  echo "✗ FAIL (got $STATUS)"
  ((FAIL++))
fi

# Test 4: Valid request -> 200
echo -n "Test 4: Valid request -> 200 ... "
STATUS=$(curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:9087/v1/metrics')
if [ "$STATUS" = "200" ]; then
  echo "✓ PASS"
  ((PASS++))
else
  echo "✗ FAIL (got $STATUS)"
  ((FAIL++))
fi

# Test 5: Error response structure
echo -n "Test 5: Error response format ... "
RESPONSE=$(curl -s 'http://127.0.0.1:9087/v1/snapshot?view=__unknown__')
if echo "$RESPONSE" | grep -q '"error":"UnknownView"' && echo "$RESPONSE" | grep -q '"message"'; then
  echo "✓ PASS"
  ((PASS++))
else
  echo "✗ FAIL"
  ((FAIL++))
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

if [ $FAIL -eq 0 ]; then
  echo "✓ All tests passed!"
  exit 0
else
  echo "✗ Some tests failed"
  exit 1
fi
