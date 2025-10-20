let msgpack;
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    msgpack = require('msgpackr');
}
catch { }
export const msgpackCodec = {
    name: 'msgpack',
    contentTypes: ['application/msgpack', 'application/x-msgpack'],
    isBinary: true,
    encode(obj) {
        if (!msgpack)
            throw new Error('msgpackr not available');
        return msgpack.pack(obj);
    },
    decode(buf) {
        if (!msgpack)
            throw new Error('msgpackr not available');
        const b = typeof buf === 'string' ? Buffer.from(buf, 'binary') : Buffer.from(buf);
        return msgpack.unpack(b);
    }
};
// T7110: createMsgPackCodec for tests
export async function createMsgPackCodec() {
    if (!msgpack)
        return null;
    return msgpackCodec;
}
