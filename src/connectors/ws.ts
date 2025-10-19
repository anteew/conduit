import { WebSocketServer, RawData, WebSocket } from 'ws';
import { PipeClient } from '../control/client.ts';

function sendError(ws: WebSocket, code: string, message: string, closeCode?: number) {
  try{ ws.send(JSON.stringify({ error: { code, message } })); if(closeCode) ws.close(closeCode,message); }catch{}
}

export function startWs(client: PipeClient, port=9088, bind='127.0.0.1'){
  const wss = new WebSocketServer({ port, host: bind });
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url||'', 'ws://local');
    if(url.pathname!=='/v1/subscribe'){ ws.close(); return; }
    const stream=url.searchParams.get('stream'); if(!stream){ ws.close(); return; }
    client.subscribe(stream,(env)=> ws.send(JSON.stringify({ deliver: env })));
    ws.on('message',(data:RawData)=>{
      try{
        const msg=JSON.parse(String(data));
        if(typeof msg.credit==='number') client.grant(msg.credit);
        else if(typeof msg.ack==='string') client.ack(msg.ack);
        else if(typeof msg.nack==='string') client.nack(msg.nack,msg.delayMs);
        else sendError(ws,'UnknownOp','Unknown operation',1003);
      }catch(e:any){ sendError(ws,'InvalidJSON',e?.message||'Malformed JSON',1007); }
    });
  });
  return wss;
}
