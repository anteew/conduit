#!/bin/bash
echo "========================================="
echo "T3022-WS-Errors Verification Script"
echo "========================================="
echo ""
echo "Running WebSocket error handling tests..."
echo ""

node --loader ts-node/esm tests/T3022-ws-errors.test.ts 2>&1 | grep -v "ExperimentalWarning\|DeprecationWarning\|--import\|Use.*node"

echo ""
echo "========================================="
echo "Verification Complete"
echo "========================================="
