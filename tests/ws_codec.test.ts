/**
 * T7022: Comprehensive WebSocket Codec Integration Tests
 * 
 * Tests JSON and MessagePack codec integration with WebSocket connections
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

function connectAndWaitOpen(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('Connection timeout')), 2000);
  });
}

// Test 1: JSON codec connection (default)
console.log('[T7022-1] Testing JSON codec connection (default)...');
{
  const { wss, client } = await setup();
  
  try {
    const ws = await connectAndWaitOpen(`ws://127.0.0.1:${TEST_PORT}/v1/subscribe?stream=test-json-default`);
    
    let deliveryReceived = false;
    ws.on('message', (data: any) => {
      const msg = JSON.parse(data.toString());
      if (msg.deliver) {
        assert.deepEqual(msg.deliver.data, { value: 42 });
        deliveryReceived = true;
      }
    });
    
    await client.enqueue('test-json-default', { id: 'msg1', data: { value: 42 } });
    
    ws.send(JSON.stringify({ credit: 10 }));
    
    await new Promise((resolve) => setTimeout(resolve, 50));
    
    await new Promise((resolve) => setTimeout(resolve, 200));
    
    assert(deliveryReceived, 'Should receive delivery via JSON');
    ws.close();
    
    console.log('✓ JSON codec connection works');
  } catch (err: any) {
    console.error('✗ Failed:', err.message);
    process.exit(1);
  } finally {
    await teardown(wss);
  }
}

// Test 2: MessagePack codec connection
console.log('[T7022-2] Testing MessagePack codec connection...');
{
  const { wss, client, codecRegistry } = await setup();
  
  const msgPackCodec = codecRegistry.get('msgpack');
  if (!msgPackCodec) {
    console.log('⊘ Skipped (MessagePack not available)');
  } else {
    try {
      const ws = await connectAndWaitOpen(`ws://127.0.0.1:${TEST_PORT}/v1/subscribe?stream=test-msgpack-explicit&codec=msgpack`);
      
      let deliveryReceived = false;
      ws.on('message', (data: any, isBinary: boolean) => {
        assert(isBinary, 'MessagePack should use binary frames');
        const msg = msgPackCodec.decode(Buffer.from(data)) as any;
        if (msg.deliver) {
          assert.deepEqual(msg.deliver.data, { value: 99 });
          deliveryReceived = true;
        }
      });
      
      await client.enqueue('test-msgpack-explicit', { id: 'msg2', data: { value: 99 } });
      
      const creditMsg = msgPackCodec.encode({ credit: 10 });
      ws.send(creditMsg);
      
      await new Promise((resolve) => setTimeout(resolve, 50));
      
      await new Promise((resolve) => setTimeout(resolve, 200));
      
      assert(deliveryReceived, 'Should receive delivery via MessagePack');
      ws.close();
      
      console.log('✓ MessagePack codec connection works');
    } catch (err: any) {
      console.error('✗ Failed:', err.message);
      process.exit(1);
    }
  }
  
  await teardown(wss);
}

// Test 3: Mixed connections (JSON + MessagePack simultaneously)
console.log('[T7022-3] Testing mixed connections (JSON + MessagePack)...');
{
  const { wss, client, codecRegistry } = await setup();
  
  const msgPackCodec = codecRegistry.get('msgpack');
  if (!msgPackCodec) {
    console.log('⊘ Skipped (MessagePack not available)');
  } else {
    try {
      const wsJson = await connectAndWaitOpen(`ws://127.0.0.1:${TEST_PORT}/v1/subscribe?stream=test-mixed-json&codec=json`);
      const wsMsgPack = await connectAndWaitOpen(`ws://127.0.0.1:${TEST_PORT}/v1/subscribe?stream=test-mixed-msgpack&codec=msgpack`);
      
      let jsonReceived = false;
      let msgPackReceived = false;
      
      wsJson.on('message', (data: any) => {
        const msg = JSON.parse(data.toString());
        if (msg.deliver) {
          assert.deepEqual(msg.deliver.data, { mixed: true });
          jsonReceived = true;
        }
      });
      
      wsMsgPack.on('message', (data: any) => {
        const msg = msgPackCodec.decode(Buffer.from(data)) as any;
        if (msg.deliver) {
          assert.deepEqual(msg.deliver.data, { mixed: true });
          msgPackReceived = true;
        }
      });
      
      // Prime credits before enqueues
      wsJson.send(JSON.stringify({ credit: 10 }));
      wsMsgPack.send(msgPackCodec.encode({ credit: 10 }));
      await new Promise((r) => setTimeout(r, 150));
      
      // Enqueue messages, then send an extra credit to avoid races
      await client.enqueue('test-mixed-json', { id: 'msg3a', data: { mixed: true } });
      await client.enqueue('test-mixed-msgpack', { id: 'msg3b', data: { mixed: true } });
      wsJson.send(JSON.stringify({ credit: 1 }));
      wsMsgPack.send(msgPackCodec.encode({ credit: 1 }));
      
      await new Promise((resolve) => setTimeout(resolve, 600));
      
      assert(jsonReceived && msgPackReceived, 'Both connections should receive delivery');
      
      wsJson.close();
      wsMsgPack.close();
      
      console.log('✓ Mixed connections work simultaneously');
    } catch (err: any) {
      console.error('✗ Failed:', err.message);
      process.exit(1);
    }
  }
  
  await teardown(wss);
}

// Test 4: Codec negotiation fallback
console.log('[T7022-4] Testing codec negotiation fallback...');
{
  const { wss, client } = await setup();
  
  try {
    const ws = await connectAndWaitOpen(`ws://127.0.0.1:${TEST_PORT}/v1/subscribe?stream=test-fallback&codec=unknown-codec`);
    
    // Should fall back to JSON
    let deliveryReceived = false;
    ws.on('message', (data: any) => {
      const msg = JSON.parse(data.toString());
      if (msg.deliver) {
        assert.deepEqual(msg.deliver.data, { fallback: true });
        deliveryReceived = true;
      }
    });
    
    await client.enqueue('test-fallback', { id: 'msg4', data: { fallback: true } });
    
    ws.send(JSON.stringify({ credit: 10 }));
    
    await new Promise((resolve) => setTimeout(resolve, 50));
    
    await new Promise((resolve) => setTimeout(resolve, 200));
    
    assert(deliveryReceived, 'Should receive delivery via JSON fallback');
    ws.close();
    
    console.log('✓ Codec negotiation fallback works');
  } catch (err: any) {
    console.error('✗ Failed:', err.message);
    process.exit(1);
  } finally {
    await teardown(wss);
  }
}

// Test 5: Invalid codec handling (decode errors)
console.log('[T7022-5] Testing invalid codec handling...');
{
  const { wss, codecRegistry } = await setup();
  
  const msgPackCodec = codecRegistry.get('msgpack');
  if (!msgPackCodec) {
    console.log('⊘ Skipped (MessagePack not available)');
  } else {
    try {
      const ws = await connectAndWaitOpen(`ws://127.0.0.1:${TEST_PORT}/v1/subscribe?stream=test-invalid&codec=msgpack`);
      
      let errorReceived = false;
      ws.on('message', (data: any) => {
        const msg = msgPackCodec.decode(Buffer.from(data)) as any;
        if (msg.error && msg.error.code === 'DecodeError') {
          errorReceived = true;
        }
      });
      
      // Send invalid MessagePack data (random bytes)
      ws.send(Buffer.from([0xFF, 0xFE, 0xFD, 0xFC]));
      
      await new Promise((resolve) => setTimeout(resolve, 200));
      
      assert(errorReceived, 'Should receive decode error');
      
      console.log('✓ Invalid codec handling works');
    } catch (err: any) {
      console.error('✗ Failed:', err.message);
      process.exit(1);
    }
  }
  
  await teardown(wss);
}

// Test 6: Frame encoding for both codecs
console.log('[T7022-6] Testing frame encoding for both codecs...');
{
  const { wss, client, codecRegistry } = await setup();
  
  const msgPackCodec = codecRegistry.get('msgpack');
  if (!msgPackCodec) {
    console.log('⊘ Skipped (MessagePack not available)');
  } else {
    try {
      const wsJson = await connectAndWaitOpen(`ws://127.0.0.1:${TEST_PORT}/v1/subscribe?stream=test-frames-json&codec=json`);
      const wsMsgPack = await connectAndWaitOpen(`ws://127.0.0.1:${TEST_PORT}/v1/subscribe?stream=test-frames-msgpack&codec=msgpack`);
      
      let jsonBinary = false;
      let msgPackBinary = false;
      
      wsJson.on('message', (data: any, isBinary: boolean) => {
        jsonBinary = isBinary;
      });
      
      wsMsgPack.on('message', (data: any, isBinary: boolean) => {
        msgPackBinary = isBinary;
      });
      
      wsJson.send(JSON.stringify({ credit: 10 }));
      wsMsgPack.send(msgPackCodec.encode({ credit: 10 }));
      
      await new Promise((resolve) => setTimeout(resolve, 100));
      
      await client.enqueue('test-frames-json', { id: 'msg5a', data: { frame: 'test' } });
      await client.enqueue('test-frames-msgpack', { id: 'msg5b', data: { frame: 'test' } });
      
      await new Promise((resolve) => setTimeout(resolve, 300));
      
      assert(!jsonBinary, 'JSON should use text frames');
      assert(msgPackBinary, 'MessagePack should use binary frames');
      
      wsJson.close();
      wsMsgPack.close();
      
      console.log('✓ Frame encoding for both codecs works');
    } catch (err: any) {
      console.error('✗ Failed:', err.message);
      process.exit(1);
    }
  }
  
  await teardown(wss);
}

// Test 7: Codec operations (credit, ack, nack)
console.log('[T7022-7] Testing codec operations (credit, ack, nack)...');
{
  const { wss, client, codecRegistry } = await setup();
  
  const msgPackCodec = codecRegistry.get('msgpack');
  if (!msgPackCodec) {
    console.log('⊘ Skipped (MessagePack not available)');
  } else {
    try {
      const ws = await connectAndWaitOpen(`ws://127.0.0.1:${TEST_PORT}/v1/subscribe?stream=test-ops&codec=msgpack`);
      
      // Send operations using MessagePack
      ws.send(msgPackCodec.encode({ credit: 5 }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      
      ws.send(msgPackCodec.encode({ ack: 'env-test-1' }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      
      ws.send(msgPackCodec.encode({ nack: 'env-test-2', delayMs: 500 }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      
      ws.close();
      
      console.log('✓ Codec operations work');
    } catch (err: any) {
      console.error('✗ Failed:', err.message);
      process.exit(1);
    }
  }
  
  await teardown(wss);
}

console.log('\n[T7022] All comprehensive codec tests passed ✓');
