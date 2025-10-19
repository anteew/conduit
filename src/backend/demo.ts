import { Duplex } from 'stream';
import { ControlFrame, decodeLines, encodeFrame } from '../control/types.js';

class DemoStore {
  private map = new Map<string, any[]>();
  enqueue(to: string, env: any) { const a=this.map.get(to)||[]; a.push(env); this.map.set(to,a); return {id:env.id}; }
  stats(stream: string) { const a=this.map.get(stream)||[]; return { depth:a.length, inflight:0, rateIn:a.length, rateOut:0, latP50:0, latP95:0, lastTs:a.at(-1)?.ts }; }
  metrics() { return { streams: Array.from(this.map.keys()).map(id=>({id, stats:this.stats(id)})) }; }
}

export class DemoPipeServer {
  private buf='';
  private sub: { stream: string } | null = null;
  private store = new DemoStore();
  attach(stream: Duplex) {
    (stream as any).setEncoding?.('utf8');
    stream.on('data', (c:string)=>{ this.buf+=c; this.buf=decodeLines(this.buf,(f)=>this.onFrame(stream,f)); });
  }
  private send(stream: Duplex, f: ControlFrame){ stream.write(encodeFrame(f)); }
  private onFrame(stream: Duplex, f: ControlFrame){
    switch(f.type){
      case 'hello': this.send(stream,{type:'ok',reqId:'hello',result:{version:'v1',features:['credit','views']}}); break;
      case 'enqueue': this.send(stream,{type:'ok',reqId:f.reqId||'enqueue',result:this.store.enqueue(f.to,f.env)}); break;
      case 'subscribe': this.sub={stream:f.stream}; break;
      case 'grant': if(this.sub){ const a=(this.store as any).map.get(this.sub.stream)||[]; const env=a.shift(); if(env){ this.send(stream,{type:'deliver',env}); }} break;
      case 'ack': break; case 'nack': break;
      case 'stats': this.send(stream,{type:'ok',reqId:f.reqId,result:this.store.stats(f.stream)}); break;
      case 'snapshot': this.send(stream,{type:'ok',reqId:f.reqId,result:{rows:[]}}); break;
      case 'metrics': this.send(stream,{type:'ok',reqId:f.reqId,result:this.store.metrics()}); break;
      default: this.send(stream,{type:'error',reqId:(f as any).reqId||'req',code:'Unsupported',detail:(f as any).type});
    }
  }
}
