#!/bin/bash
# T5010 Upload Endpoint Test Example
# This script demonstrates the multipart upload functionality

echo "T5010 Multipart Upload Test"
echo "============================"
echo ""

# Create test files
echo "Creating test files..."
echo "Test file 1 content" > /tmp/test1.txt
echo "Test file 2 content" > /tmp/test2.txt
dd if=/dev/zero of=/tmp/test-large.bin bs=1M count=5 2>/dev/null

echo ""
echo "Test 1: Single file upload"
echo "--------------------------"
curl -X POST http://127.0.0.1:9087/v1/upload \
  -F "file=@/tmp/test1.txt" \
  2>/dev/null | jq '.'

echo ""
echo "Test 2: Multiple files with fields"
echo "----------------------------------"
curl -X POST http://127.0.0.1:9087/v1/upload \
  -F "file=@/tmp/test1.txt" \
  -F "file=@/tmp/test2.txt" \
  -F "description=test upload" \
  -F "author=automation" \
  2>/dev/null | jq '.'

echo ""
echo "Test 3: Large file (5MB)"
echo "-----------------------"
curl -X POST http://127.0.0.1:9087/v1/upload \
  -F "file=@/tmp/test-large.bin" \
  2>/dev/null | jq '.'

echo ""
echo "Test 4: Limits exceeded (too many files)"
echo "----------------------------------------"
curl -X POST http://127.0.0.1:9087/v1/upload \
  -F "file=@/tmp/test1.txt" \
  -F "file=@/tmp/test1.txt" \
  -F "file=@/tmp/test1.txt" \
  -F "file=@/tmp/test1.txt" \
  -F "file=@/tmp/test1.txt" \
  -F "file=@/tmp/test1.txt" \
  -F "file=@/tmp/test1.txt" \
  -F "file=@/tmp/test1.txt" \
  -F "file=@/tmp/test1.txt" \
  -F "file=@/tmp/test1.txt" \
  -F "file=@/tmp/test1.txt" \
  2>/dev/null | jq '.'

echo ""
echo "Cleanup..."
rm /tmp/test1.txt /tmp/test2.txt /tmp/test-large.bin

echo ""
echo "Tests complete. Check server logs for detailed metrics."
