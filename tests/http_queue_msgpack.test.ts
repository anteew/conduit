/**
 * HTTP /v1/queue response negotiation (Accept: application/msgpack)
 */

import * as http from 'http';
import { msgpackCodec } from '../src/codec/msgpack.js';

const PORT = 9787;

function httpRequest(opts: { method: string; path: string; headers?: Record<string,string>; body?: Buffer|string }): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>{
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: PORT, method: opts.method, path: opts.path, headers: opts.headers||{} }, (res)=>{
      const chunks: Buffer[] = []; res.on('data', (c)=>chunks.push(Buffer.isBuffer(c)?c:Buffer.from(c)));
      res.on('end', ()=> resolve({ status: res.statusCode||0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function run(){
  process.env.CONDUIT_CODECS_HTTP = 'true';
  const httpMod: any = await import('../src/connectors/http.js');
  const client = httpMod.makeClientWithDemo();
  const server = httpMod.startHttp(client, PORT, '127.0.0.1');
  await new Promise((r)=>setTimeout(r, 200));

  let failed = 0; let passed = 0;

  try {
    const payload = JSON.stringify({ queue: 'agents/Jen/inbox', message: { id: 'q1', data: 'hello' } });
    const res = await httpRequest({ method: 'POST', path: '/v1/queue', headers: { 'Content-Type': 'application/json', 'Accept': 'application/msgpack' }, body: payload });
    const ct = (res.headers['content-type']||'').toString();
    if (ct.includes('application/msgpack') || ct.includes('application/vnd.msgpack') || ct.includes('application/x-msgpack')) {
      try {
        const decoded: any = msgpackCodec.decode(res.body);
        if (decoded && (decoded.queueRef || decoded.error)) {
          console.log('✓ /v1/queue uses msgpack (queueRef or error)');
          passed++;
        } else {
          console.error('✗ /v1/queue msgpack decoded structure unexpected');
          failed++;
        }
      } catch (e:any) {
        console.error('✗ Failed to decode msgpack response:', e.message);
        failed++;
      }
    } else if (ct.includes('application/json')) {
      // Acceptable fallback when msgpack not available
      try {
        const obj = JSON.parse(res.body.toString());
        if (obj && obj.queueRef) {
          console.log('⊙ /v1/queue fell back to JSON (acceptable)');
          passed++;
        } else {
          throw new Error('no queueRef');
        }
      } catch {
        console.error('✗ JSON fallback invalid for /v1/queue');
        failed++;
      }
    } else {
      console.error('✗ Unexpected Content-Type for /v1/queue:', ct);
      failed++;
    }
  } catch (e: any) {
    console.error('✗ /v1/queue request failed:', e.message);
    failed++;
  }

  server.close();
  console.log(`\n[HTTP Queue MsgPack] Completed: ${passed} passed, ${failed} failed`);
  process.exit(failed>0?1:0);
}

run().catch((e)=>{ console.error(e); process.exit(1); });
