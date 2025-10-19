/**
 * T7021: WebSocket Codec Frame Encoding/Decoding Tests
 * 
 * Tests frame encoding/decoding with different codecs
 */

import { strict as assert } from 'assert';
import WebSocket from 'ws';
import { startWs } from '../src/connectors/ws.js';
import { makeClientWithDemo } from '../src/connectors/http.js';
import { CodecRegistry } from '../src/codec/registry.js';
import { JsonCodec } from '../src/codec/json.js';
import { createMsgPackCodec } from '../src/codec/msgpack.js';

const TEST_PORT = 9098;

async function setup() {
  const codecRegistry = new CodecRegistry({ defaultCodec: 'json' });
  codecRegistry.register(new JsonCodec());
  
  const msgPackCodec = await createMsgPackCodec();
  if (msgPackCodec) {
    codecRegistry.register(msgPackCodec);
  }
  
  const client = makeClientWithDemo();
  const wss = startWs(client, TEST_PORT, '127.0.0.1', codecRegistry);
  await new Promise((r) => setTimeout(r, 120));
  
  return { client, wss, codecRegistry };
}

async function teardown(wss: any) {
  return new Promise<void>((resolve) => {
    wss.close(() => resolve());
  });
}

function connectAndWaitOpen(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('Connection timeout')), 2000);
  });
}

// Test 1: JSON frames (text)
console.log('[T7021-1] Testing JSON frame encoding/decoding...');
{
  const { wss, client } = await setup();
  
  try {
    const ws = await connectAndWaitOpen(`ws://127.0.0.1:${TEST_PORT}/v1/subscribe?stream=test-json&codec=json`);
    
    let messageReceived = false;
    ws.on('message', (data: any, isBinary: boolean) => {
      assert(!isBinary, 'JSON should use text frames');
      const msg = JSON.parse(data.toString());
      assert(msg.deliver || msg.error, 'Should have deliver or error field');
      messageReceived = true;
    });
    
    // Enqueue a message
    await client.enqueue('test-json', { id: 'msg1', data: { test: 'data' } });
    
    // Send credit to trigger delivery
    ws.send(JSON.stringify({ credit: 10 }));
    
    await new Promise((resolve) => setTimeout(resolve, 200));
    
    assert(messageReceived, 'Should receive message');
    ws.close();
    
    console.log('✓ JSON frame encoding/decoding works');
  } catch (err: any) {
    console.error('✗ Failed:', err.message);
    process.exit(1);
  } finally {
    await teardown(wss);
  }
}

// Test 2: MessagePack frames (binary)
console.log('[T7021-2] Testing MessagePack frame encoding/decoding...');
{
  const { wss, client, codecRegistry } = await setup();
  
  const msgPackCodec = codecRegistry.get('msgpack');
  if (!msgPackCodec) {
    console.log('⊘ Skipped (MessagePack not available)');
  } else {
    try {
      const ws = await connectAndWaitOpen(`ws://127.0.0.1:${TEST_PORT}/v1/subscribe?stream=test-msgpack&codec=msgpack`);
      
      let messageReceived = false;
      ws.on('message', (data: any, isBinary: boolean) => {
        assert(isBinary, 'MessagePack should use binary frames');
        const msg = msgPackCodec.decode(Buffer.from(data)) as any;
        assert(msg.deliver || msg.error, 'Should have deliver or error field');
        messageReceived = true;
      });
      
      // Enqueue a message
      await client.enqueue('test-msgpack', { id: 'msg2', data: { test: 'data' } });
      
      // Send credit using MessagePack
      const creditMsg = msgPackCodec.encode({ credit: 10 });
      ws.send(creditMsg);
      
      await new Promise((resolve) => setTimeout(resolve, 200));
      
      assert(messageReceived, 'Should receive message');
      ws.close();
      
      console.log('✓ MessagePack frame encoding/decoding works');
    } catch (err: any) {
      console.error('✗ Failed:', err.message);
      process.exit(1);
    }
  }
  
  await teardown(wss);
}

// Test 3: Decode error handling
console.log('[T7021-3] Testing decode error handling...');
{
  const { wss } = await setup();
  
  try {
    const ws = await connectAndWaitOpen(`ws://127.0.0.1:${TEST_PORT}/v1/subscribe?stream=test-decode-error&codec=json`);
    
    let errorReceived = false;
    ws.on('message', (data: any) => {
      const msg = JSON.parse(data.toString());
      if (msg.error) {
        assert(msg.error.code === 'InvalidJSON' || msg.error.code === 'DecodeError', 'Should get decode error');
        errorReceived = true;
      }
    });
    
    // Send malformed JSON
    ws.send('{ invalid json }');
    
    await new Promise((resolve) => setTimeout(resolve, 200));
    
    assert(errorReceived, 'Should receive decode error');
    
    console.log('✓ Decode error handling works');
  } catch (err: any) {
    console.error('✗ Failed:', err.message);
    process.exit(1);
  } finally {
    await teardown(wss);
  }
}

// Test 4: Mixed codec operations (credit, ack, nack)
console.log('[T7021-4] Testing mixed operations with codec...');
{
  const { wss, client } = await setup();
  
  try {
    const ws = await connectAndWaitOpen(`ws://127.0.0.1:${TEST_PORT}/v1/subscribe?stream=test-mixed&codec=json`);
    
    // Send credit
    ws.send(JSON.stringify({ credit: 5 }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    
    // Send ack
    ws.send(JSON.stringify({ ack: 'env-123' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    
    // Send nack
    ws.send(JSON.stringify({ nack: 'env-456', delayMs: 1000 }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    
    ws.close();
    
    console.log('✓ Mixed operations with codec work');
  } catch (err: any) {
    console.error('✗ Failed:', err.message);
    process.exit(1);
  } finally {
    await teardown(wss);
  }
}

console.log('\n[T7021] All codec frame tests passed ✓');
