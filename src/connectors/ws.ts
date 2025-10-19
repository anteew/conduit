import { WebSocketServer, RawData, WebSocket } from 'ws';
import { PipeClient } from '../control/client.js';
import { DSLConfig, RuleContext } from '../dsl/types.js';
import { applyRules } from '../dsl/interpreter.js';
import { loadDSL } from '../dsl/loader.js';

function sendError(ws: WebSocket, code: string, message: string, closeCode?: number) {
  try{ ws.send(JSON.stringify({ error: { code, message } })); if(closeCode) ws.close(closeCode,message); }catch{}
}

let dslConfig: DSLConfig | null = null;

export function loadDSLConfig(path: string) {
  dslConfig = loadDSL(path);
  console.log(`[WS] Loaded DSL rules from ${path}: ${dslConfig.rules.length} rules`);
}

export function startWs(client: PipeClient, port=9088, bind='127.0.0.1'){
  if (process.env.CONDUIT_RULES) {
    try {
      loadDSLConfig(process.env.CONDUIT_RULES);
    } catch (e: any) {
      console.error(`[WS] Failed to load DSL rules: ${e.message}`);
    }
  }

  const wss = new WebSocketServer({ port, host: bind });
  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url||'', 'ws://local');
    
    const headers: Record<string, string> = {};
    Object.entries(req.headers).forEach(([k, v]) => {
      if (typeof v === 'string') headers[k] = v;
      else if (Array.isArray(v)) headers[k] = v[0];
    });

    const queryParams: Record<string, string> = {};
    url.searchParams.forEach((val, key) => queryParams[key] = val);

    if (dslConfig) {
      const ctx: RuleContext = {
        $path: url.pathname,
        $headers: headers,
        $query: queryParams
      };

      try {
        const result = await applyRules(dslConfig, client, ctx);
        if (result) {
          if (result.message) {
            ws.send(JSON.stringify(result.message));
          }
        }
        
        const stream = queryParams.stream;
        if (stream) {
          client.subscribe(stream, (env) => ws.send(JSON.stringify({ deliver: env })));
        }
      } catch (e: any) {
        sendError(ws, 'ConnectionError', e?.message || 'Connection failed', 1011);
        return;
      }
    } else {
      if(url.pathname!=='/v1/subscribe'){ ws.close(); return; }
      const stream=url.searchParams.get('stream'); if(!stream){ ws.close(); return; }
      client.subscribe(stream,(env)=> ws.send(JSON.stringify({ deliver: env })));
    }

    ws.on('message', async (data: RawData) => {
      try {
        const msg = JSON.parse(String(data));
        
        if (dslConfig) {
          const ctx: RuleContext = {
            $path: url.pathname,
            $headers: headers,
            $query: queryParams,
            $message: msg,
            $messageType: 'text'
          };

          const result = await applyRules(dslConfig, client, ctx);
          if (result && result.message) {
            ws.send(JSON.stringify(result.message));
          }
        } else {
          if(typeof msg.credit==='number') client.grant(msg.credit);
          else if(typeof msg.ack==='string') client.ack(msg.ack);
          else if(typeof msg.nack==='string') client.nack(msg.nack,msg.delayMs);
          else sendError(ws,'UnknownOp','Unknown operation',1003);
        }
      } catch(e: any) {
        sendError(ws,'InvalidJSON',e?.message||'Malformed JSON',1007);
      }
    });
  });
  return wss;
}
