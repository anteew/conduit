import http from 'http';
import { PipeClient, makeDuplexPair } from '../control/client.ts';
import { DemoPipeServer } from '../backend/demo.ts';

function send(res: http.ServerResponse, code: number, body: any){ res.writeHead(code,{'content-type':'application/json'}); res.end(JSON.stringify(body)); }

export function startHttp(client: PipeClient, port=9087, bind='127.0.0.1'){
  const server = http.createServer(async (req,res)=>{
    try{
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

export function makeClientWithDemo(){
  const [clientEnd, serverEnd] = makeDuplexPair();
  const demo = new DemoPipeServer();
  demo.attach(serverEnd);
  const client = new PipeClient(clientEnd);
  client.hello().catch(()=>{});
  return client;
}
