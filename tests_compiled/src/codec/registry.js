import { jsonCodec } from './json.js';
import { msgpackCodec } from './msgpack.js';
const codecs = new Map();
export function registerCodec(codec) {
    codecs.set(codec.name, codec);
}
export function getCodecByName(name) {
    if (!name)
        return undefined;
    return codecs.get(name);
}
export function listCodecs() {
    return Array.from(codecs.values());
}
export function detectForHttp(contentType) {
    const ct = (contentType || '').split(';')[0].trim().toLowerCase();
    if (!ct)
        return undefined;
    for (const c of codecs.values()) {
        if (c.contentTypes.some(t => ct === t.toLowerCase()))
            return c;
    }
    // Support +json structured suffix
    if (ct.endsWith('+json'))
        return jsonCodec;
    return undefined;
}
export function chooseForHttpResponse(accept, def) {
    const defaultName = (def || process.env.CONDUIT_DEFAULT_CODEC || 'json').toLowerCase();
    const defaultCodec = getCodecByName(defaultName) || jsonCodec;
    const a = (accept || '').toLowerCase();
    if (!a || a === '*/*')
        return defaultCodec;
    const items = a.split(',').map(part => {
        const [type, ...params] = part.trim().split(';');
        const qParam = params.find(p => p.trim().startsWith('q='));
        const q = qParam ? parseFloat(qParam.split('=')[1]) : 1;
        return { type: type.trim(), q: isNaN(q) ? 1 : q };
    });
    items.sort((x, y) => y.q - x.q);
    for (const item of items) {
        for (const c of codecs.values()) {
            if (c.contentTypes.includes(item.type))
                return c;
        }
        if (item.type.endsWith('+json'))
            return jsonCodec;
    }
    return defaultCodec;
}
// T7110: CodecRegistry class for WS codec negotiation
export class CodecRegistry {
    codecs = new Map();
    defaultCodecName;
    constructor(options) {
        this.defaultCodecName = options.defaultCodec;
    }
    register(codec) {
        this.codecs.set(codec.name, codec);
    }
    get(name) {
        return this.codecs.get(name);
    }
    list() {
        return Array.from(this.codecs.values());
    }
    getDefault() {
        return this.codecs.get(this.defaultCodecName) || jsonCodec;
    }
}
// Bootstrap defaults
registerCodec(jsonCodec);
registerCodec(msgpackCodec);
