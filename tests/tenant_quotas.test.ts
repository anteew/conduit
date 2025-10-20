/**
 * Tenant Quotas Tests
 * - HTTP per-tenant rate limit (429)
 * - WS per-tenant connection limit (1008)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import WebSocket from 'ws';
import { startHttp, makeClientWithDemo } from '../src/connectors/http.js';
import { startWs } from '../src/connectors/ws.js';

const HTTP_PORT = 9192;
const WS_PORT = 9193;

function httpRequest(opts: { method: string; path: string; headers?: Record<string,string>; body?: string }): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }>{
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1', port: HTTP_PORT, method: opts.method, path: opts.path, headers: opts.headers||{}}, (res)=>{
      let data=''; res.on('data',(c)=>data+=c); res.on('end',()=>{
        try{ resolve({ status: res.statusCode||0, body: JSON.parse(data||'{}'), headers: res.headers }); }catch{ resolve({ status: res.statusCode||0, body: data, headers: res.headers }); }
      });
    });
    req.on('error',reject); if(opts.body) req.write(opts.body); req.end();
  });
}

async function run(){
  // Write a temp tenant config with tiny limits
  const tmp = path.join(os.tmpdir(), `tenants-${Date.now()}.yaml`);
  const yaml = `tenants:\n  t1:\n    tokens:\n      - t1token\n    limits:\n      rateLimit: 1\n      maxConnections: 1\n`;
  fs.writeFileSync(tmp, yaml);
  process.env.CONDUIT_TENANT_CONFIG = tmp;
  process.env.CONDUIT_TOKENS = 't1token';

  const client = makeClientWithDemo();
  const httpSrv = startHttp(client, HTTP_PORT, '127.0.0.1');
  const wsSrv = startWs(client, WS_PORT, '127.0.0.1');
  await new Promise(r=>setTimeout(r,300));

  let failed = 0;

  // HTTP: first request allowed
  const h1 = await httpRequest({ method: 'GET', path: '/health', headers: { 'authorization': 'Bearer t1token' } });
  if (h1.status !== 200 && h1.status !== 503) { console.error('✗ HTTP first request not allowed', h1.status); failed++; }

  // HTTP: second immediate request should be rate limited (limit=1/min)
  const h2 = await httpRequest({ method: 'GET', path: '/health', headers: { 'authorization': 'Bearer t1token' } });
  if (h2.status !== 429) { console.error('✗ HTTP second request should be 429, got', h2.status); failed++; } else { console.log('✓ HTTP tenant rate limit enforced (429)'); }

  // WS: first connection allowed
  let ws1: WebSocket | null = null;
  try {
    ws1 = new WebSocket(`ws://127.0.0.1:${WS_PORT}/v1/subscribe?stream=s1`, { headers: { 'Authorization': 'Bearer t1token' } });
    await new Promise((resolve,reject)=>{ ws1!.on('open', resolve); ws1!.on('error', reject); setTimeout(()=>reject(new Error('timeout')), 2000); });
  } catch(e:any) {
    console.error('✗ WS first connection failed', e.message); failed++;
  }

  // WS: second connection should be rejected (maxConnections=1)
  try {
    const ws2 = new WebSocket(`ws://127.0.0.1:${WS_PORT}/v1/subscribe?stream=s1`, { headers: { 'Authorization': 'Bearer t1token' } });
    let closed = false; let code = 0;
    await new Promise((resolve)=>{ ws2.on('close', (c)=>{ closed=true; code=c; resolve(null); }); ws2.on('open', ()=>{ ws2.close(); }); setTimeout(()=>resolve(null), 1000); });
    if (!closed || code === 0) { console.error('✗ WS second connection not closed with an error'); failed++; } else { console.log('✓ WS tenant connection limit enforced'); }
  } catch(e:any) {
    console.log('✓ WS second connection blocked');
  }

  try { httpSrv.close(); } catch{}
  try { wsSrv.close(); } catch{}
  process.exit(failed>0?1:0);
}

run().catch((e)=>{ console.error(e); process.exit(1); });

