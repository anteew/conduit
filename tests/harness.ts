import { spawn, SpawnOptions } from 'child_process';
import http from 'http';

export async function startServer(env: Record<string,string|undefined> = {}) {
  const proc = spawn(process.execPath, ['--loader','ts-node/esm','src/index.ts'], { env: { ...process.env, ...env }, stdio: 'pipe' } as SpawnOptions);
  await new Promise<void>((resolve) => setTimeout(resolve, 800));
  return proc;
}

export async function stopServer(proc: any) {
  try { proc.kill(); } catch {}
}

export async function httpGet(url: string): Promise<{status: number, body: any}> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let data=''; res.on('data',(c)=>data+=c); res.on('end',()=>{
        try{ resolve({ status: res.statusCode||0, body: JSON.parse(data||'{}') }); } catch { resolve({ status: res.statusCode||0, body: data }); }
      });
    });
    req.on('error', ()=> resolve({ status: 0, body: null }));
  });
}

export async function httpPost(url: string, obj: any): Promise<{status:number, body:any}> {
  const data = JSON.stringify(obj);
  return new Promise((resolve) => {
    const r = http.request(url, {method:'POST', headers:{'content-type':'application/json','content-length':Buffer.byteLength(data)}}, (res)=>{
      let body=''; res.on('data',(c)=>body+=c); res.on('end',()=>{
        try { resolve({ status: res.statusCode||0, body: JSON.parse(body||'{}')}); } catch { resolve({ status: res.statusCode||0, body: body}); }
      });
    });
    r.on('error', ()=> resolve({ status: 0, body: null }));
    r.write(data); r.end();
  });
}
