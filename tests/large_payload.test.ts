import { startServer, stopServer } from './harness.js';
import http from 'http';
import fs from 'fs';

(async () => {
  const srv = await startServer({ CONDUIT_RULES: 'config/rules.yaml' });
  const path = '/tmp/large_100mb.bin';
  if (!fs.existsSync(path)) {
    await new Promise<void>((resolve)=>{
      const s = fs.createWriteStream(path);
      const size = 100*1024*1024;
      const chunk = Buffer.alloc(1024*1024, 7);
      let written=0;
      function write() { while (written < size) { if (!s.write(chunk)) { s.once('drain', write); return; } written+=chunk.length; } s.end(); }
      s.on('finish', ()=> resolve()); write();
    });
  }
  // Stream upload to a generic sink endpoint (rule should accept octet-stream without JSON body parse)
  await new Promise<void>((resolve) => {
    const req = http.request('http://127.0.0.1:9087/v1/enqueue', { method:'POST', headers:{'content-type':'application/octet-stream'} }, (res)=>{ res.resume(); res.on('end',()=>resolve()); });
    fs.createReadStream(path).pipe(req);
  });
  await stopServer(srv);
})();
