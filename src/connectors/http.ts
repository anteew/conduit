import * as http from 'http';
import { PipeClient, makeDuplexPair } from '../control/client.js';
import { DemoPipeServer } from '../backend/demo.js';
import { DSLConfig, RuleContext } from '../dsl/types.js';
import { applyRules } from '../dsl/interpreter.js';
import { loadDSL } from '../dsl/loader.js';
import { TCPTerminal, TerminalConfig } from '../control/terminal.js';

function send(res: http.ServerResponse, code: number, body: any){ res.writeHead(code,{'content-type':'application/json'}); res.end(JSON.stringify(body)); }

let dslConfig: DSLConfig | null = null;

export function loadDSLConfig(path: string) {
  dslConfig = loadDSL(path);
  console.log(`[HTTP] Loaded DSL rules from ${path}: ${dslConfig.rules.length} rules`);
}

async function handleWithDSL(client: PipeClient, req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
  if (!dslConfig) return false;

  const url = new URL(req.url||'/', 'http://localhost');
  let body = '';
  
  for await (const chunk of req) {
    body += chunk;
  }

  let parsedBody: any = {};
  try {
    if (body) parsedBody = JSON.parse(body);
  } catch {}

  const headers: Record<string, string> = {};
  Object.entries(req.headers).forEach(([k, v]) => {
    if (typeof v === 'string') headers[k] = v;
    else if (Array.isArray(v)) headers[k] = v[0];
  });

  const queryParams: Record<string, string> = {};
  url.searchParams.forEach((val, key) => queryParams[key] = val);

  const ctx: RuleContext = {
    $method: req.method || 'GET',
    $path: url.pathname,
    $headers: headers,
    $query: queryParams,
    $body: parsedBody
  };

  const result = await applyRules(dslConfig, client, ctx);
  if (result) {
    const status = result.status || 200;
    const responseBody = result.body || result;
    send(res, status, responseBody);
    return true;
  }

  return false;
}

export function startHttp(client: PipeClient, port=9087, bind='127.0.0.1'){
  if (process.env.CONDUIT_RULES) {
    try {
      loadDSLConfig(process.env.CONDUIT_RULES);
    } catch (e: any) {
      console.error(`[HTTP] Failed to load DSL rules: ${e.message}`);
    }
  }

  const server = http.createServer(async (req,res)=>{
    try{
      if (await handleWithDSL(client, req, res)) return;

      const url = new URL(req.url||'/', 'http://localhost');
      if(req.method==='GET' && url.pathname==='/health'){ send(res,200,{ok:true,version:'v0.1',features:['http','ws','sse']}); return; }
      if(req.method==='POST' && url.pathname==='/v1/enqueue'){
        let body=''; req.on('data',c=>body+=c); req.on('end',()=>{
          try{
            const {to,envelope}=JSON.parse(body||'{}');
            client.enqueue(to,envelope).then(r=>send(res,200,r)).catch(e=>send(res,400,{error:e?.detail||e?.message||'bad request'}));
          }catch(e:any){ send(res,400,{error:e?.message||'invalid json'}); }
        });
        return;
      }
      if(req.method==='GET' && url.pathname==='/v1/stats'){
        const stream=url.searchParams.get('stream'); if(!stream){ send(res,400,{error:'missing stream'}); return; }
        client.stats(stream).then(r=>send(res,200,r)).catch(()=>send(res,500,{error:'stats failed'})); return;
      }
      if(req.method==='GET' && url.pathname==='/v1/metrics'){
        client.metrics().then(r=>send(res,200,r)).catch(()=>send(res,500,{error:'metrics failed'})); return;
      }
      // SSE demo (heartbeat only)
      if(req.method==='GET' && url.pathname==='/v1/live'){
        res.writeHead(200,{ 'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive'});
        const hb=setInterval(()=>{ res.write(': heartbeat\n\n'); },15000);
        req.on('close',()=>clearInterval(hb));
        res.write('data: {"connected":true}\n\n'); return;
      }
      res.writeHead(404).end();
    }catch{ res.writeHead(500).end(); }
  });
  server.listen(port,bind);
  return server;
}

export function makeClientWithDemo(rec?: (f:any, dir:'in'|'out')=>void){
  const [clientEnd, serverEnd] = makeDuplexPair();
  const demo = new DemoPipeServer();
  demo.attach(serverEnd);
  const client = new PipeClient(clientEnd, rec);
  client.hello().catch(()=>{});
  return client;
}

export async function makeClientWithTerminal(config: TerminalConfig, rec?: (f:any, dir:'in'|'out')=>void){
  const terminal = new TCPTerminal(config);
  const stream = await terminal.connect();
  const client = new PipeClient(stream, rec);
  await client.hello();
  return client;
}
