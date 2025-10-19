import { decodeLines, encodeFrame } from '../control/types.js';
class DemoStore {
    map = new Map();
    enqueue(to, env) { const a = this.map.get(to) || []; a.push(env); this.map.set(to, a); return { id: env.id }; }
    stats(stream) { const a = this.map.get(stream) || []; return { depth: a.length, inflight: 0, rateIn: a.length, rateOut: 0, latP50: 0, latP95: 0, lastTs: a.at(-1)?.ts }; }
    metrics() { return { streams: Array.from(this.map.keys()).map(id => ({ id, stats: this.stats(id) })) }; }
}
export class DemoPipeServer {
    buf = '';
    sub = null;
    store = new DemoStore();
    attach(stream) {
        stream.setEncoding?.('utf8');
        stream.on('data', (c) => { this.buf += c; this.buf = decodeLines(this.buf, (f) => this.onFrame(stream, f)); });
    }
    send(stream, f) { stream.write(encodeFrame(f)); }
    onFrame(stream, f) {
        switch (f.type) {
            case 'hello':
                this.send(stream, { type: 'ok', reqId: 'hello', result: { version: 'v1', features: ['credit', 'views'] } });
                break;
            case 'enqueue':
                if (!f.env || typeof f.env !== 'object') {
                    this.send(stream, { type: 'error', reqId: f.reqId || 'enqueue', code: 'InvalidEnvelope', detail: 'Envelope must be an object' });
                }
                else {
                    this.send(stream, { type: 'ok', reqId: f.reqId || 'enqueue', result: this.store.enqueue(f.to, f.env) });
                }
                break;
            case 'subscribe':
                this.sub = { stream: f.stream };
                break;
            case 'grant':
                if (this.sub) {
                    const a = this.store.map.get(this.sub.stream) || [];
                    const env = a.shift();
                    if (env) {
                        this.send(stream, { type: 'deliver', env });
                    }
                }
                break;
            case 'ack': break;
            case 'nack': break;
            case 'stats':
                if (!f.stream || f.stream.startsWith('__unknown__')) {
                    this.send(stream, { type: 'error', reqId: f.reqId, code: 'UnknownStream', detail: `Stream not found: ${f.stream}` });
                }
                else {
                    this.send(stream, { type: 'ok', reqId: f.reqId, result: this.store.stats(f.stream) });
                }
                break;
            case 'snapshot':
                if (!f.view || f.view.startsWith('__unknown__')) {
                    this.send(stream, { type: 'error', reqId: f.reqId, code: 'UnknownView', detail: `View not found: ${f.view}` });
                }
                else {
                    this.send(stream, { type: 'ok', reqId: f.reqId, result: { rows: [] } });
                }
                break;
            case 'metrics':
                this.send(stream, { type: 'ok', reqId: f.reqId, result: this.store.metrics() });
                break;
            default: this.send(stream, { type: 'error', reqId: f.reqId || 'req', code: 'Unsupported', detail: f.type });
        }
    }
}
