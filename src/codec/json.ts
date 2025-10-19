import { Codec } from './types.js';

export const jsonCodec: Codec = {
  name: 'json',
  contentTypes: ['application/json', 'text/json', 'application/*+json'],
  isBinary: false,
  encode(obj: any): Uint8Array {
    const s = JSON.stringify(obj);
    return Buffer.from(s, 'utf8');
  },
  decode(buf: Uint8Array | string): any {
    const s = typeof buf === 'string' ? buf : Buffer.from(buf).toString('utf8');
    return JSON.parse(s);
  }
};

