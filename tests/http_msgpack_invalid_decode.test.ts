/**
 * HTTP MessagePack invalid decode test
 * Ensures Content-Type: application/msgpack with invalid body returns 400 and codec=msgpack.
 */

import * as http from 'http';

const PORT = 9587;

function httpPostRaw(path: string, body: Buffer, contentType: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>{
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: PORT, method: 'POST', path, headers: { 'Content-Type': contentType, 'Content-Length': body.length } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString(), headers: res.headers }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function run(){
  // Enable codecs before importing modules
  process.env.CONDUIT_CODECS_HTTP = 'true';
  const httpMod: any = await import('../src/connectors/http.js');
  const client = httpMod.makeClientWithDemo();
  const server = httpMod.startHttp(client, PORT, '127.0.0.1');

  await new Promise((r)=>setTimeout(r, 200));

  let failed = 0; let passed = 0;

  try {
    // clearly invalid msgpack payload (truncated map header)
    const invalid = Buffer.from([0x81, 0xa1, 0x78]);
    const res = await httpPostRaw('/v1/enqueue', invalid, 'application/msgpack');
    const ct = (res.headers['content-type'] || '').toString();
    let obj: any = {};
    try { obj = JSON.parse(res.body); } catch {}
    if (res.status === 400 && ct.includes('application/json') && obj && obj.error && obj.codec === 'msgpack') {
      console.log('✓ Invalid MessagePack → 400 decode_error (codec=msgpack)');
      passed++;
    } else {
      console.error('✗ Expected 400 msgpack decode_error; got', res.status, ct, res.body);
      failed++;
    }
  } catch(e:any){
    console.error('✗ HTTP invalid msgpack test error:', e.message);
    failed++;
  }

  server.close();
  console.log(`\n[HTTP Invalid MsgPack] Completed: ${passed} passed, ${failed} failed`);
  process.exit(failed>0?1:0);
}

run().catch((e)=>{ console.error(e); process.exit(1); });

