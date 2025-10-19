export interface Codec {
  name: string; // 'json' | 'msgpack' | 'cbor' | future
  contentTypes: string[]; // e.g., ['application/json']
  isBinary: boolean;
  encode(obj: any): Uint8Array;
  decode(buf: Uint8Array | string): any;
}

export interface HttpNegotiation {
  requestCodec?: Codec;   // decode path (from Content-Type)
  responseCodec?: Codec;  // encode path (from Accept/default)
}

