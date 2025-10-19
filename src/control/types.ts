export type HelloFrame = { type: 'hello'; version?: string; features?: string[]; token?: string };
export type OkFrame = { type: 'ok'; reqId: string; result?: any };
export type ErrorFrame = { type: 'error'; reqId: string; code: string; detail?: string };
export type EnqueueFrame = { type: 'enqueue'; to: string; env: any } & Req;
export type SubscribeFrame = { type: 'subscribe'; stream: string };
export type GrantFrame = { type: 'grant'; n: number };
export type AckFrame = { type: 'ack'; id: string };
export type NackFrame = { type: 'nack'; id: string; delayMs?: number };
export type DeliverFrame = { type: 'deliver'; env: any };
export type StatsFrame = { type: 'stats'; reqId: string; stream: string };
export type SnapshotFrame = { type: 'snapshot'; reqId: string; view: string };
export type MetricsFrame = { type: 'metrics'; reqId: string };
export type ControlFrame = HelloFrame|OkFrame|ErrorFrame|EnqueueFrame|SubscribeFrame|GrantFrame|AckFrame|NackFrame|DeliverFrame|StatsFrame|SnapshotFrame|MetricsFrame;
export type Req = { reqId?: string };
export function encodeFrame(f: ControlFrame): string { return JSON.stringify(f) + '\n'; }
export function decodeLines(buf: string, onFrame: (f: ControlFrame) => void) {
  let start = 0;
  while (true) {
    const idx = buf.indexOf('\n', start);
    if (idx === -1) break;
    const line = buf.slice(start, idx);
    start = idx + 1;
    if (!line.trim()) continue;
    try { onFrame(JSON.parse(line) as ControlFrame); } catch {}
  }
  return buf.slice(start);
}
