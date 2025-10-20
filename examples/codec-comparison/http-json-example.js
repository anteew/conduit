#!/usr/bin/env node
/**
 * HTTP JSON Example (Baseline)
 * 
 * Demonstrates standard JSON usage with Conduit HTTP API.
 * This works regardless of CONDUIT_CODECS_HTTP flag.
 * 
 * Prerequisites:
 *   npm install node-fetch
 *   npm run dev
 */

const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:9087';
const TOKEN = 'dev-token';

async function enqueueMessageWithJson() {
  const payload = {
    stream: 'agents/test/inbox',
    body: {
      type: 'task',
      priority: 'high',
      taskId: 'task-' + Date.now(),
      data: 'Process this message using standard JSON encoding',
      metadata: {
        source: 'http-json-example',
        timestamp: new Date().toISOString()
      }
    }
  };

  console.log('Sending JSON request to /v1/enqueue...');
  console.log('Payload:', JSON.stringify(payload, null, 2));

  const jsonStr = JSON.stringify(payload);
  console.log(`JSON size: ${jsonStr.length} bytes`);

  const response = await fetch(`${BASE_URL}/v1/enqueue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${TOKEN}`
    },
    body: jsonStr
  });

  if (!response.ok) {
    console.error(`Error: ${response.status} ${response.statusText}`);
    const text = await response.text();
    console.error('Response:', text);
    process.exit(1);
  }

  console.log(`✓ Response: ${response.status} ${response.statusText}`);
  console.log(`  Content-Type: ${response.headers.get('content-type')}`);

  const responseBody = await response.text();
  const decoded = JSON.parse(responseBody);
  console.log('  Response:', decoded);
  console.log('');

  return decoded;
}

async function fetchMetricsWithJson() {
  console.log('Fetching metrics with JSON...');

  const response = await fetch(`${BASE_URL}/v1/metrics`, {
    headers: {
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    console.error(`Error: ${response.status} ${response.statusText}`);
    process.exit(1);
  }

  const contentType = response.headers.get('content-type');
  console.log(`✓ Response: ${response.status} ${response.statusText}`);
  console.log(`  Content-Type: ${contentType}`);

  const responseBody = await response.text();
  const decoded = JSON.parse(responseBody);
  
  console.log('  Metrics summary:');
  console.log(`    Uptime: ${decoded.uptime}s`);
  console.log(`    Streams: ${decoded.streams.length}`);
  if (decoded.gateway?.http?.endpoints) {
    const endpoints = Object.keys(decoded.gateway.http.endpoints);
    console.log(`    HTTP endpoints: ${endpoints.join(', ')}`);
  }
  console.log('');
}

async function demonstrateJsonUsage() {
  console.log('=== HTTP JSON Example (Baseline) ===\n');

  try {
    // Send JSON request
    await enqueueMessageWithJson();

    // Fetch metrics
    await fetchMetricsWithJson();

    console.log('✓ Example completed successfully!');
    console.log('\nKey points:');
    console.log('  • JSON is the default codec, always available');
    console.log('  • Works without CONDUIT_CODECS_HTTP flag');
    console.log('  • Human-readable for debugging');
    console.log('  • Compare with http-msgpack-example.js for size/speed differences');
  } catch (error) {
    console.error('Error:', error.message);
    console.error('\nTroubleshooting:');
    console.error('  1. Ensure Conduit is running: npm run dev');
    console.error('  2. Install dependencies: npm install node-fetch');
    process.exit(1);
  }
}

if (require.main === module) {
  demonstrateJsonUsage();
}

module.exports = { enqueueMessageWithJson, fetchMetricsWithJson };
