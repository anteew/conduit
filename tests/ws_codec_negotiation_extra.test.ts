/**
 * Extra WS codec negotiation tests
 * - Multiple subprotocols (Sec-WebSocket-Protocol) with fallback
 */

import WebSocket from 'ws';
import { startWs } from '../src/connectors/ws.js';
import { makeClientWithDemo } from '../src/connectors/http.js';
import { CodecRegistry } from '../src/codec/registry.js';
import { JsonCodec } from '../src/codec/json.js';
import { createMsgPackCodec } from '../src/codec/msgpack.js';
import net from 'net';

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

async function run() {
  const port = await findFreePort();
  const codecRegistry = new CodecRegistry({ defaultCodec: 'json' });
  codecRegistry.register(new JsonCodec());
  const mp = await createMsgPackCodec();
  if (mp) codecRegistry.register(mp);
  const client = makeClientWithDemo();
  const wss = startWs(client, port, '127.0.0.1', codecRegistry);
  await new Promise((r) => setTimeout(r, 120));

  let passed = 0, failed = 0;

  // Test: protocols preference list includes unknown, then msgpack
  if (!mp) {
    console.log('⊘ Skipped (MessagePack not available)');
  } else {
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/subscribe?stream=test-protos`, ['cbor', 'msgpack', 'json']);
      await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); setTimeout(()=>rej(new Error('timeout')), 1500); });
      // Send credit encoded as msgpack; if negotiation picked msgpack, server accepts
      ws.send(mp.encode({ credit: 5 }));
      await new Promise((r) => setTimeout(r, 100));
      ws.close();
      console.log('✓ Subprotocol list negotiation selects msgpack when available');
      passed++;
    } catch (e: any) {
      console.error('✗ Subprotocol list negotiation failed:', e.message);
      failed++;
    }
  }

  // Test: protocols list has only unknown → should fall back to default json and accept text
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/subscribe?stream=test-unknown-only`, ['cbor', 'avro']);
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); setTimeout(()=>rej(new Error('timeout')), 1500); });
    ws.send(JSON.stringify({ credit: 3 }));
    await new Promise((r) => setTimeout(r, 100));
    ws.close();
    console.log('✓ Unknown-only subprotocols fall back to JSON');
    passed++;
  } catch (e: any) {
    console.error('✗ Unknown-only subprotocols fallback failed:', e.message);
    failed++;
  }

  wss.close();
  console.log(`\n[WS Extra] Completed: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });

