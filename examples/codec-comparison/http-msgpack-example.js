#!/usr/bin/env node
/**
 * HTTP MessagePack Example
 * 
 * Demonstrates:
 * - Sending MessagePack-encoded requests
 * - Receiving MessagePack-encoded responses
 * - Content negotiation with Accept header
 * 
 * Prerequisites:
 *   npm install msgpackr node-fetch
 *   CONDUIT_CODECS_HTTP=true npm run dev
 */

const { pack, unpack } = require('msgpackr');
const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:9087';
const TOKEN = 'dev-token';

async function enqueueMessageWithMsgpack() {
  const payload = {
    stream: 'agents/test/inbox',
    body: {
      type: 'task',
      priority: 'high',
      taskId: 'task-' + Date.now(),
      data: 'Process this message using MessagePack encoding',
      metadata: {
        source: 'http-msgpack-example',
        timestamp: new Date().toISOString()
      }
    }
  };

  console.log('Sending MessagePack request to /v1/enqueue...');
  console.log('Payload:', JSON.stringify(payload, null, 2));

  const encoded = pack(payload);
  console.log(`Encoded size: ${encoded.length} bytes (JSON would be ~${JSON.stringify(payload).length} bytes)`);

  const response = await fetch(`${BASE_URL}/v1/enqueue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/msgpack',
      'Accept': 'application/msgpack',
      'Authorization': `Bearer ${TOKEN}`
    },
    body: encoded
  });

  if (!response.ok) {
    console.error(`Error: ${response.status} ${response.statusText}`);
    const text = await response.text();
    console.error('Response:', text);
    process.exit(1);
  }

  console.log(`✓ Response: ${response.status} ${response.statusText}`);
  console.log(`  Content-Type: ${response.headers.get('content-type')}`);

  const responseBody = Buffer.from(await response.arrayBuffer());
  const decoded = unpack(responseBody);
  console.log('  Decoded response:', decoded);
  console.log('');

  return decoded;
}

async function fetchMetricsWithMsgpack() {
  console.log('Fetching metrics with MessagePack negotiation...');

  const response = await fetch(`${BASE_URL}/v1/metrics`, {
    headers: {
      'Accept': 'application/msgpack;q=0.9, application/json;q=0.5'
    }
  });

  if (!response.ok) {
    console.error(`Error: ${response.status} ${response.statusText}`);
    process.exit(1);
  }

  const contentType = response.headers.get('content-type');
  console.log(`✓ Response: ${response.status} ${response.statusText}`);
  console.log(`  Content-Type: ${contentType}`);

  const responseBody = Buffer.from(await response.arrayBuffer());
  
  if (contentType && contentType.includes('msgpack')) {
    const decoded = unpack(responseBody);
    console.log('  Decoded metrics (MessagePack):');
    console.log(`    Uptime: ${decoded.uptime}s`);
    console.log(`    Streams: ${decoded.streams.length}`);
    if (decoded.gateway?.http?.codecs) {
      console.log('    Codec stats:', JSON.stringify(decoded.gateway.http.codecs, null, 6));
    }
  } else {
    const decoded = JSON.parse(responseBody.toString('utf-8'));
    console.log('  Decoded metrics (JSON):');
    console.log(`    Uptime: ${decoded.uptime}s`);
    console.log(`    Streams: ${decoded.streams.length}`);
  }
  console.log('');
}

async function demonstrateContentNegotiation() {
  console.log('=== HTTP MessagePack Example ===\n');

  try {
    // Send MessagePack request
    await enqueueMessageWithMsgpack();

    // Fetch metrics with content negotiation
    await fetchMetricsWithMsgpack();

    console.log('✓ Example completed successfully!');
    console.log('\nKey takeaways:');
    console.log('  • MessagePack payloads are 30-50% smaller than JSON');
    console.log('  • Use Content-Type: application/msgpack for requests');
    console.log('  • Use Accept: application/msgpack for responses');
    console.log('  • Content negotiation allows gradual migration');
  } catch (error) {
    console.error('Error:', error.message);
    console.error('\nTroubleshooting:');
    console.error('  1. Ensure Conduit is running: npm run dev');
    console.error('  2. Enable codec support: export CONDUIT_CODECS_HTTP=true');
    console.error('  3. Install dependencies: npm install msgpackr node-fetch');
    process.exit(1);
  }
}

if (require.main === module) {
  demonstrateContentNegotiation();
}

module.exports = { enqueueMessageWithMsgpack, fetchMetricsWithMsgpack };
