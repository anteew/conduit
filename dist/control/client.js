import { Duplex as DuplexStream, PassThrough } from 'stream';
import { encodeFrame, decodeLines } from './types.js';
function wrapDuplex(readable, writable) {
    const d = new DuplexStream({
        read(_size) { },
        write(chunk, enc, cb) { writable.write(chunk, enc, cb); }
    });
    readable.on('data', (c) => d.push(c));
    readable.on('end', () => d.push(null));
    d.setEncoding?.('utf8');
    return d;
}
export function makeDuplexPair() {
    const aToB = new PassThrough({ encoding: 'utf8' });
    const bToA = new PassThrough({ encoding: 'utf8' });
    const A = wrapDuplex(bToA, aToB);
    const B = wrapDuplex(aToB, bToA);
    return [A, B];
}
export class PipeClient {
    stream;
    rec;
    buf = '';
    seq = 0;
    pending = new Map();
    onDeliver = null;
    constructor(stream, rec) {
        this.stream = stream;
        this.rec = rec;
        stream.setEncoding?.('utf8');
        stream.on('data', (chunk) => { this.buf += chunk; this.buf = decodeLines(this.buf, (f) => this.onFrame(f)); });
    }
    send(f) { this.rec?.(f, 'out'); this.stream.write(encodeFrame(f)); }
    onFrame(f) {
        this.rec?.(f, 'in');
        if (f.type === 'deliver') {
            this.onDeliver?.(f.env);
            return;
        }
        if (f.type === 'ok' || f.type === 'error') {
            const cb = this.pending.get(f.reqId);
            if (cb) {
                this.pending.delete(f.reqId);
                cb(f.result, f.type === 'error' ? f : undefined);
            }
        }
    }
    reqId() { return 'r' + (++this.seq); }
    hello(features = [], token) { const reqId = 'hello'; return new Promise((res) => { this.pending.set(reqId, (r) => res(r)); this.send({ type: 'hello', version: 'v1', features, token }); }); }
    enqueue(to, env) { const reqId = this.reqId(); return new Promise((res, rej) => { this.pending.set(reqId, (r, e) => e ? rej(e) : res(r)); this.send({ type: 'enqueue', to, env, reqId }); }); }
    subscribe(stream, onDeliver) { this.onDeliver = onDeliver; this.send({ type: 'subscribe', stream }); return Promise.resolve({ subId: 'local' }); }
    grant(n) { this.send({ type: 'grant', n }); }
    ack(id) { this.send({ type: 'ack', id }); }
    nack(id, delayMs) { this.send({ type: 'nack', id, delayMs }); }
    stats(stream) { const reqId = this.reqId(); return new Promise((res, rej) => { this.pending.set(reqId, (r, e) => e ? rej(e) : res(r)); this.send({ type: 'stats', reqId, stream }); }); }
    snapshot(view) { const reqId = this.reqId(); return new Promise((res, rej) => { this.pending.set(reqId, (r, e) => e ? rej(e) : res(r)); this.send({ type: 'snapshot', reqId, view }); }); }
    metrics() { const reqId = this.reqId(); return new Promise((res, rej) => { this.pending.set(reqId, (r, e) => e ? rej(e) : res(r)); this.send({ type: 'metrics', reqId }); }); }
}
