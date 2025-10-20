export const jsonCodec = {
    name: 'json',
    contentTypes: ['application/json', 'text/json', 'application/*+json'],
    isBinary: false,
    encode(obj) {
        const s = JSON.stringify(obj);
        return Buffer.from(s, 'utf8');
    },
    decode(buf) {
        const s = typeof buf === 'string' ? buf : Buffer.from(buf).toString('utf8');
        return JSON.parse(s);
    }
};
// T7110: JsonCodec class for tests
export class JsonCodec {
    name = 'json';
    contentTypes = ['application/json', 'text/json', 'application/*+json'];
    isBinary = false;
    encode(obj) {
        const s = JSON.stringify(obj);
        return Buffer.from(s, 'utf8');
    }
    decode(buf) {
        const s = typeof buf === 'string' ? buf : Buffer.from(buf).toString('utf8');
        return JSON.parse(s);
    }
}
