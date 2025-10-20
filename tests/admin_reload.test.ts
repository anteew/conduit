/**
 * Admin Reload Endpoint Test
 * Verifies POST /v1/admin/reload responds and reports reloaded components.
 */

import * as http from 'http';
import { startHttp, makeClientWithDemo } from '../src/connectors/http.js';

const PORT = 9189;

function httpRequest(opts: {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: Buffer | string;
}): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
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
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const body = data ? JSON.parse(data) : {};
            resolve({ status: res.statusCode || 500, body, headers: res.headers });
          } catch (e) {
            resolve({ status: res.statusCode || 500, body: data, headers: res.headers });
          }
        });
      }
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function run() {
  const client = makeClientWithDemo();
  const server = startHttp(client, PORT, '127.0.0.1');
  await new Promise((r) => setTimeout(r, 300));

  try {
    const res = await httpRequest({ method: 'POST', path: '/v1/admin/reload' });
    if (res.status === 200 || res.status === 207) {
      console.log(`✓ Admin reload responded with ${res.status}`);
      if (res.body) {
        console.log(`  Status: ${res.body.status}`);
        console.log(`  Rules: ${res.body.rulesCount}`);
        console.log(`  Tenants: ${res.body.tenantsCount}`);
      }
      process.exit(0);
      return;
    } else {
      console.error(`✗ Expected 200/207, got ${res.status}`);
      process.exit(1);
      return;
    }
  } catch (e: any) {
    console.error(`✗ Admin reload test error: ${e.message}`);
    process.exit(1);
  } finally {
    server.close();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });

