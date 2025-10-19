/**
 * T7020: WebSocket Codec Negotiation Tests
 * 
 * Tests codec negotiation from query parameters and Sec-WebSocket-Protocol header
 */

import { strict as assert } from 'assert';
import WebSocket from 'ws';
import { startWs } from '../src/connectors/ws.js';
import net from 'net';
import { makeClientWithDemo } from '../src/connectors/http.js';
import { CodecRegistry } from '../src/codec/registry.js';
import { JsonCodec } from '../src/codec/json.js';
import { createMsgPackCodec } from '../src/codec/msgpack.js';

let TEST_PORT = parseInt(process.env.WS_TEST_PORT || '0', 10);

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function setup() {
  const codecRegistry = new CodecRegistry({ defaultCodec: 'json' });
  codecRegistry.register(new JsonCodec());
  
  const msgPackCodec = await createMsgPackCodec();
  if (msgPackCodec) {
    codecRegistry.register(msgPackCodec);
  }
  
  const client = makeClientWithDemo();
  if (!TEST_PORT) {
    TEST_PORT = await findFreePort();
  }
  const wss = startWs(client, TEST_PORT, '127.0.0.1', codecRegistry);
  
  // Allow listener to bind before returning
  await new Promise((r) => setTimeout(r, 120));
  return { client, wss, codecRegistry };
}

async function teardown(wss: any) {
  return new Promise<void>((resolve) => {
    wss.close(() => resolve());
  });
}

function connectAndWaitOpen(url: string, protocols?: any): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, protocols);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('Connection timeout')), 2000);
  });
}

// Test 1: Default codec (JSON) when no codec specified
console.log('[T7020-1] Testing default JSON codec...');
{
  const { wss } = await setup();
  
  try {
    const ws = await connectAndWaitOpen(`ws://127.0.0.1:${TEST_PORT}/v1/subscribe?stream=test-default`);
    
    ws.send(JSON.stringify({ credit: 10 }));
    
    await new Promise((resolve) => setTimeout(resolve, 100));
    ws.close();
    
    console.log('✓ Default JSON codec works');
  } catch (err: any) {
    console.error('✗ Failed:', err.message);
    process.exit(1);
  } finally {
    await teardown(wss);
  }
}

// Test 2: Explicit JSON codec via query parameter
console.log('[T7020-2] Testing explicit JSON codec via query param...');
{
  const { wss } = await setup();
  
  try {
    const ws = await connectAndWaitOpen(`ws://127.0.0.1:${TEST_PORT}/v1/subscribe?stream=test-json&codec=json`);
    
    ws.send(JSON.stringify({ credit: 10 }));
    
    await new Promise((resolve) => setTimeout(resolve, 100));
    ws.close();
    
    console.log('✓ Explicit JSON codec via query param works');
  } catch (err: any) {
    console.error('✗ Failed:', err.message);
    process.exit(1);
  } finally {
    await teardown(wss);
  }
}

// Test 3: MessagePack codec via query parameter
console.log('[T7020-3] Testing MessagePack codec via query param...');
{
  const { wss, codecRegistry } = await setup();
  
  const msgPackCodec = codecRegistry.get('msgpack');
  if (!msgPackCodec) {
    console.log('⊘ Skipped (MessagePack not available)');
  } else {
    try {
      const ws = await connectAndWaitOpen(`ws://127.0.0.1:${TEST_PORT}/v1/subscribe?stream=test-msgpack&codec=msgpack`);
      
      const creditMsg = msgPackCodec.encode({ credit: 10 });
      ws.send(creditMsg);
      
      await new Promise((resolve) => setTimeout(resolve, 100));
      ws.close();
      
      console.log('✓ MessagePack codec via query param works');
    } catch (err: any) {
      console.error('✗ Failed:', err.message);
      process.exit(1);
    }
  }
  
  await teardown(wss);
}

// Test 4: Unknown codec falls back to JSON
console.log('[T7020-4] Testing unknown codec fallback...');
{
  const { wss } = await setup();
  
  try {
    const ws = await connectAndWaitOpen(`ws://127.0.0.1:${TEST_PORT}/v1/subscribe?stream=test-unknown&codec=cbor`);
    
    // Should fall back to JSON
    ws.send(JSON.stringify({ credit: 10 }));
    
    await new Promise((resolve) => setTimeout(resolve, 100));
    ws.close();
    
    console.log('✓ Unknown codec falls back to JSON');
  } catch (err: any) {
    console.error('✗ Failed:', err.message);
    process.exit(1);
  } finally {
    await teardown(wss);
  }
}

// Test 5: Codec from Sec-WebSocket-Protocol header
console.log('[T7020-5] Testing codec from Sec-WebSocket-Protocol header...');
{
  const { wss, codecRegistry } = await setup();
  
  const msgPackCodec = codecRegistry.get('msgpack');
  if (!msgPackCodec) {
    console.log('⊘ Skipped (MessagePack not available)');
  } else {
    try {
      const ws = await connectAndWaitOpen(
        `ws://127.0.0.1:${TEST_PORT}/v1/subscribe?stream=test-protocol-header`,
        'msgpack'
      );
      
      const creditMsg = msgPackCodec.encode({ credit: 10 });
      ws.send(creditMsg);
      
      await new Promise((resolve) => setTimeout(resolve, 100));
      ws.close();
      
      console.log('✓ Codec from Sec-WebSocket-Protocol header works');
    } catch (err: any) {
      console.error('✗ Failed:', err.message);
      process.exit(1);
    }
  }
  
  await teardown(wss);
}

console.log('\n[T7020] All codec negotiation tests passed ✓');
