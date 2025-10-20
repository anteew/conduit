import { Codec } from './types.js';

let msgpack: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  msgpack = require('msgpackr');
} catch {}

export const msgpackCodec: Codec = {
  name: 'msgpack',
  contentTypes: ['application/msgpack', 'application/x-msgpack'],
  isBinary: true,
  encode(obj: any): Uint8Array {
    if (!msgpack) throw new Error('msgpackr not available');
    return msgpack.pack(obj);
  },
  decode(buf: Uint8Array | string): any {
    if (!msgpack) throw new Error('msgpackr not available');
    const b = typeof buf === 'string' ? Buffer.from(buf, 'binary') : Buffer.from(buf);
    return msgpack.unpack(b);
  }
};

// T7110: createMsgPackCodec for tests
export async function createMsgPackCodec(): Promise<Codec | null> {
  if (!msgpack) return null;
  return msgpackCodec;
}

