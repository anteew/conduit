import { Duplex, PassThrough, Readable, Writable } from 'stream';
import { ControlFrame, encodeFrame, decodeLines } from './types.js';

function wrapDuplex(readable: Readable, writable: Writable): Duplex {
  const d = new (require('stream').Duplex)({
    read(_size: number) {},
    write(chunk: any, enc: any, cb: any) { (writable as any).write(chunk, enc, cb); }
  });
  (readable as any).on('data', (c: any) => d.push(c));
  (readable as any).on('end', () => d.push(null));
  (d as any).setEncoding?.('utf8');
  return d;
}

export function makeDuplexPair(): [Duplex, Duplex] {
  const aToB = new PassThrough({ encoding: 'utf8' as any });
  const bToA = new PassThrough({ encoding: 'utf8' as any });
  const A = wrapDuplex(bToA, aToB);
  const B = wrapDuplex(aToB, bToA);
  return [A, B];
}

export class PipeClient {
  private buf = '';
  private seq = 0;
  private pending = new Map<string, (res: any, err?: any) => void>();
  private onDeliver: ((env: any)=>void) | null = null;
  constructor(private stream: Duplex, private rec?: (f:any, dir:'in'|'out')=>void) {
    (stream as any).setEncoding?.('utf8');
    stream.on('data', (chunk: string) => { this.buf += chunk; this.buf = decodeLines(this.buf, (f)=>this.onFrame(f)); });
  }
  private send(f: ControlFrame) { this.rec?.(f,'out'); this.stream.write(encodeFrame(f)); }
  private onFrame(f: ControlFrame) {
    this.rec?.(f,'in');
    if (f.type === 'deliver') { this.onDeliver?.(f.env); return; }
    if (f.type === 'ok' || f.type === 'error') {
      const cb = this.pending.get(f.reqId); if (cb) { this.pending.delete(f.reqId); cb((f as any).result, f.type==='error'?f:undefined); }
    }
  }
  private reqId() { return 'r'+(++this.seq); }
  hello(features: string[] = [], token?: string) { const reqId='hello'; return new Promise((res)=>{ this.pending.set(reqId,(r)=>res(r)); this.send({ type:'hello', version:'v1', features, token }); }); }
  enqueue(to: string, env: any) { const reqId=this.reqId(); return new Promise((res,rej)=>{ this.pending.set(reqId,(r,e)=> e?rej(e):res(r)); this.send({ type:'enqueue', to, env, reqId }); }); }
  subscribe(stream: string, onDeliver: (env:any)=>void) { this.onDeliver=onDeliver; this.send({ type:'subscribe', stream }); return Promise.resolve({ subId:'local' }); }
  grant(n: number) { this.send({ type:'grant', n }); }
  ack(id: string) { this.send({ type:'ack', id }); }
  nack(id: string, delayMs?: number) { this.send({ type:'nack', id, delayMs }); }
  stats(stream: string) { const reqId=this.reqId(); return new Promise((res,rej)=>{ this.pending.set(reqId,(r,e)=> e?rej(e):res(r)); this.send({ type:'stats', reqId, stream }); }); }
  snapshot(view: string) { const reqId=this.reqId(); return new Promise((res,rej)=>{ this.pending.set(reqId,(r,e)=> e?rej(e):res(r)); this.send({ type:'snapshot', reqId, view }); }); }
  metrics() { const reqId=this.reqId(); return new Promise((res,rej)=>{ this.pending.set(reqId,(r,e)=> e?rej(e):res(r)); this.send({ type:'metrics', reqId }); }); }
}
