/**
 * Codec guardrails with MessagePack
 * - HTTP: decoded size/depth caps with Content-Type: application/msgpack
 * - WS: decoded size/depth caps with ?codec=msgpack
 */

import * as http from 'http';
import WebSocket from 'ws';
import { CodecRegistry } from '../src/codec/registry.js';
import { JsonCodec } from '../src/codec/json.js';
import { createMsgPackCodec } from '../src/codec/msgpack.js';

const HTTP_PORT = 9487;
const WS_PORT = 9488;

function httpPostRaw(path: string, body: Buffer, contentType: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: HTTP_PORT, method: 'POST', path, headers: { 'Content-Type': contentType, 'Content-Length': body.length } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString(), headers: res.headers }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function deep(depth: number): any { return depth <= 0 ? 'leaf' : { child: deep(depth - 1) }; }

async function run() {
  // Guardrails
  process.env.CONDUIT_CODECS_HTTP = process.env.CONDUIT_CODECS_HTTP || 'true';
  process.env.CONDUIT_CODECS_WS = process.env.CONDUIT_CODECS_WS || 'true';
  process.env.CONDUIT_CODEC_MAX_DECODED_SIZE = '256';
  process.env.CONDUIT_CODEC_MAX_DEPTH = '4';

  // HTTP server (import after setting env so feature gates are honored)
  const httpMod: any = await import('../src/connectors/http.js');
  const httpClient = httpMod.makeClientWithDemo();
  const httpServer = httpMod.startHttp(httpClient, HTTP_PORT, '127.0.0.1');

  // WS server with registry
  const registry = new CodecRegistry({ defaultCodec: 'json' });
  registry.register(new JsonCodec());
  const mp = await createMsgPackCodec();
  if (mp) registry.register(mp);
  const wsMod: any = await import('../src/connectors/ws.js');
  const wsServer = wsMod.startWs(httpClient, WS_PORT, '127.0.0.1', registry);
  await new Promise((r) => setTimeout(r, 200));

  let passed = 0; let failed = 0;

  // Skip if no msgpack available
  if (!mp) {
    console.log('⊘ Skipping msgpack guardrail tests (msgpack not available)');
    httpServer.close(); wsServer.close();
    process.exit(0);
    return;
  }

  // HTTP size cap with msgpack body
  try {
    const body = Buffer.from(mp.encode({ to: 'test', envelope: { data: 'x'.repeat(1024) } }));
    const res = await httpPostRaw('/v1/enqueue', body, 'application/msgpack');
    const obj = (() => { try { return JSON.parse(res.body); } catch { return {}; } })();
    if (res.status === 400 && (obj.details === 'decoded_size_exceeded' || obj.code === 'DecodedSizeExceeded')) {
      console.log('✓ HTTP msgpack size cap violation → 400'); passed++; } else { console.error('✗ HTTP msgpack size cap expected 400, got', res.status, res.body); failed++; }
  } catch (e: any) { console.error('✗ HTTP msgpack size cap failed:', e.message); failed++; }

  // HTTP depth cap with msgpack body
  try {
    const body = Buffer.from(mp.encode({ to: 'test', envelope: deep(10) }));
    const res = await httpPostRaw('/v1/enqueue', body, 'application/msgpack');
    const obj = (() => { try { return JSON.parse(res.body); } catch { return {}; } })();
    if (res.status === 400 && (obj.details === 'depth_exceeded' || obj.code === 'DepthExceeded')) {
      console.log('✓ HTTP msgpack depth cap violation → 400'); passed++; } else { console.error('✗ HTTP msgpack depth cap expected 400, got', res.status, res.body); failed++; }
  } catch (e: any) { console.error('✗ HTTP msgpack depth cap failed:', e.message); failed++; }

  // WS msgpack decoded size cap
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}/v1/subscribe?stream=test&codec=msgpack`);
    let closed = false; let code = 0;
    ws.on('open', () => { ws.send(Buffer.from(mp.encode({ credit: 10, data: { v: 'x'.repeat(1024) } }))); });
    ws.on('close', (c) => { closed = true; code = c; });
    await new Promise((r) => setTimeout(r, 400));
    if (closed && code === 1007) { console.log('✓ WS msgpack size cap → 1007'); passed++; } else { console.error('✗ WS msgpack size cap expected 1007, got', code); failed++; }
  } catch (e: any) { console.error('✗ WS msgpack size cap failed:', e.message); failed++; }

  // WS msgpack decoded depth cap
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}/v1/subscribe?stream=test&codec=msgpack`);
    let closed = false; let code = 0;
    ws.on('open', () => { ws.send(Buffer.from(mp.encode({ credit: 10, data: deep(10) }))); });
    ws.on('close', (c) => { closed = true; code = c; });
    await new Promise((r) => setTimeout(r, 400));
    if (closed && code === 1007) { console.log('✓ WS msgpack depth cap → 1007'); passed++; } else { console.error('✗ WS msgpack depth cap expected 1007, got', code); failed++; }
  } catch (e: any) { console.error('✗ WS msgpack depth cap failed:', e.message); failed++; }

  console.log(`\n[MsgPack Guardrails] Completed: ${passed} passed, ${failed} failed`);
  httpServer.close(); wsServer.close();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
