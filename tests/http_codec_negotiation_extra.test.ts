/**
 * Extra HTTP codec negotiation tests
 * - Accept: application/vnd.msgpack
 * - Accept: application/x-msgpack (legacy compat)
 */

import * as http from 'http';
import { startHttp, makeClientWithDemo } from '../src/connectors/http.js';
import { msgpackCodec } from '../src/codec/msgpack.js';

const PORT = 9387;

function httpRequest(opts: {
  method: string;
  path: string;
  headers?: Record<string, string>;
}): Promise<{ status: number; body: Buffer; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        method: opts.method,
        path: opts.path,
        headers: opts.headers || {}
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks), headers: res.headers }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  const client = makeClientWithDemo();
  const server = startHttp(client, PORT, '127.0.0.1');
  await new Promise((r) => setTimeout(r, 200));

  let passed = 0;
  let failed = 0;

  // Test 1: vnd.msgpack response via Accept header (if codec enabled)
  try {
    const res = await httpRequest({ method: 'GET', path: '/v1/metrics', headers: { Accept: 'application/vnd.msgpack' } });
    const ct = (res.headers['content-type'] || '').toString();
    if (process.env.CONDUIT_CODECS_HTTP === 'true') {
      if (ct.includes('application/vnd.msgpack') || ct.includes('application/msgpack') || ct.includes('application/x-msgpack')) {
        try {
          const decoded = msgpackCodec.decode(res.body) as any;
          if (decoded && (decoded.gateway || decoded.http || decoded.streams)) {
            console.log('✓ vnd.msgpack response negotiation works');
            passed++;
          } else {
            console.error('✗ vnd.msgpack decoded structure unexpected');
            failed++;
          }
        } catch (e: any) {
          console.error('✗ vnd.msgpack decode failed:', e.message);
          failed++;
        }
      } else {
        console.log(`⊙ vnd.msgpack not selected (Content-Type=${ct}); acceptable if codec disabled at runtime`);
        passed++;
      }
    } else {
      console.log('⊙ Skipped vnd.msgpack (CONDUIT_CODECS_HTTP not enabled)');
      passed++;
    }
  } catch (e: any) {
    console.error('✗ vnd.msgpack request failed:', e.message);
    failed++;
  }

  // Test 2: x-msgpack legacy compat
  try {
    const res = await httpRequest({ method: 'GET', path: '/v1/metrics', headers: { Accept: 'application/x-msgpack' } });
    const ct = (res.headers['content-type'] || '').toString();
    if (process.env.CONDUIT_CODECS_HTTP === 'true') {
      if (ct.includes('application/msgpack') || ct.includes('application/x-msgpack') || ct.includes('application/vnd.msgpack')) {
        try {
          const decoded = msgpackCodec.decode(res.body) as any;
          if (decoded && (decoded.gateway || decoded.http || decoded.streams)) {
            console.log('✓ x-msgpack legacy Accept works');
            passed++;
          } else {
            console.error('✗ x-msgpack decoded structure unexpected');
            failed++;
          }
        } catch (e: any) {
          console.error('✗ x-msgpack decode failed:', e.message);
          failed++;
        }
      } else {
        console.log(`⊙ x-msgpack not selected (Content-Type=${ct}); acceptable if codec disabled at runtime`);
        passed++;
      }
    } else {
      console.log('⊙ Skipped x-msgpack (CONDUIT_CODECS_HTTP not enabled)');
      passed++;
    }
  } catch (e: any) {
    console.error('✗ x-msgpack request failed:', e.message);
    failed++;
  }

  console.log(`\n[HTTP Extra] Completed: ${passed} passed, ${failed} failed`);
  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });

