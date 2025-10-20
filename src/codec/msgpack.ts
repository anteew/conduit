import { Codec } from './types.js';
import { createRequire } from 'module';

let msgpack: any;
try {
  const req = createRequire(import.meta.url);
  msgpack = req('msgpackr');
} catch {
  // msgpackr not available; codec will be reported as unavailable
}

export const msgpackCodec: Codec = {
  name: 'msgpack',
  // Include standard + vendor media type; retain x- prefix for backward compatibility
  contentTypes: ['application/msgpack', 'application/vnd.msgpack', 'application/x-msgpack'],
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
