import { startServer, stopServer } from './harness.js';
import http from 'http';
import fs from 'fs';
import { Readable } from 'stream';

(async () => {
  const SINK_PATH = process.env.SINK_PATH;
  const srv = await startServer({ CONDUIT_RULES: 'config/rules.yaml', ...(SINK_PATH ? { CONDUIT_UPLOAD_FILE: SINK_PATH } : {}) });
  try {
    const SIZE_MB = parseInt(process.env.SIZE_MB || '100', 10);
    const sizeBytes = SIZE_MB * 1024 * 1024;
    const FILE_PATH = process.env.FILE_PATH;
    // In-memory zero generator stream (fallback if no FILE_PATH provided)
    class ZeroStream extends Readable {
      private remaining: number;
      private chunkSize: number;
      constructor(total: number, chunkSize=1024*1024) { super(); this.remaining = total; this.chunkSize = chunkSize; }
      _read(_n: number) {
        if (this.remaining <= 0) { this.push(null); return; }
        const toWrite = Math.min(this.chunkSize, this.remaining);
        this.remaining -= toWrite;
        this.push(Buffer.alloc(toWrite, 0));
      }
    }
    // Stream upload to a dedicated sink endpoint (rule accepts octet-stream without JSON parse)
    if (FILE_PATH) {
      try { const st = fs.statSync(FILE_PATH); console.log(`POST: using file ${FILE_PATH} (${(st.size/1024/1024).toFixed(1)}MB)`); } catch {}
    } else {
      console.log(`POST: start ${SIZE_MB}MB upload → /v1/upload`);
    }
    const t0 = Date.now();
    await new Promise<void>((resolve, reject) => {
      const req = http.request('http://127.0.0.1:9087/v1/upload', { method:'POST', headers:{'content-type':'application/octet-stream'} }, (res)=>{ res.resume(); res.on('end',()=>resolve()); });
      req.on('error', reject);
      if (FILE_PATH) fs.createReadStream(FILE_PATH).pipe(req);
      else new ZeroStream(sizeBytes).pipe(req);
    });
    const dt = (Date.now()-t0)/1000;
    console.log(`POST: done in ${dt.toFixed(3)}s`);
    if (SINK_PATH) {
      const expected = FILE_PATH ? fs.statSync(FILE_PATH).size : sizeBytes;
      const startWait = Date.now();
      while (Date.now() - startWait < 60000) { // wait up to 60s
        try {
          const st = fs.statSync(SINK_PATH);
          if (st.size === expected) { console.log(`VERIFY: sink size ok (${(st.size/1024/1024).toFixed(1)}MB)`); break; }
        } catch {}
        await new Promise(r=>setTimeout(r, 250));
      }
      const final = fs.existsSync(SINK_PATH) ? fs.statSync(SINK_PATH).size : 0;
      if (final !== expected) { throw new Error(`Sink size mismatch: got ${final}, expected ${expected}`); }
    }
  } finally {
    await stopServer(srv);
  }
})();
