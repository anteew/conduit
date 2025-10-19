export var DSLErrorCode;
(function (DSLErrorCode) {
    DSLErrorCode["InvalidJSON"] = "InvalidJSON";
    DSLErrorCode["UnknownView"] = "UnknownView";
    DSLErrorCode["UnknownStream"] = "UnknownStream";
    DSLErrorCode["InvalidEnvelope"] = "InvalidEnvelope";
    DSLErrorCode["Internal"] = "Internal";
})(DSLErrorCode || (DSLErrorCode = {}));
export class DSLError extends Error {
    code;
    detail;
    constructor(code, message, detail) {
        super(message);
        this.code = code;
        this.detail = detail;
        this.name = 'DSLError';
    }
}
export class DSLInterpreter {
    config;
    client;
    constructor(config, client) {
        this.config = config;
        this.client = client;
    }
    async applyRules(ctx) {
        for (const rule of this.config.rules) {
            if (this.matchWhen(rule.when, ctx)) {
                try {
                    return await this.executeRule(rule, ctx);
                }
                catch (error) {
                    return this.handleError(error, rule, ctx);
                }
            }
        }
        return null;
    }
    handleError(error, rule, ctx) {
        const dslError = this.categorizeError(error);
        ctx.$error = { code: dslError.code, message: dslError.message, detail: dslError.detail };
        const errorCode = dslError.code;
        const errorMapping = rule.onError?.[errorCode] || this.config.defaults?.onError?.[errorCode];
        if (errorMapping?.http) {
            return this.materialize(errorMapping.http, ctx);
        }
        const statusMap = {
            [DSLErrorCode.InvalidJSON]: 400,
            [DSLErrorCode.InvalidEnvelope]: 400,
            [DSLErrorCode.UnknownView]: 404,
            [DSLErrorCode.UnknownStream]: 404,
            [DSLErrorCode.Internal]: 500
        };
        return {
            status: statusMap[errorCode] || 500,
            body: { error: dslError.code, message: dslError.message, detail: dslError.detail }
        };
    }
    categorizeError(error) {
        if (error instanceof DSLError) {
            return error;
        }
        if (error?.code === 'UnknownView' || error?.detail?.includes('view')) {
            return new DSLError(DSLErrorCode.UnknownView, 'Unknown view', error?.detail);
        }
        if (error?.code === 'UnknownStream' || error?.detail?.includes('stream')) {
            return new DSLError(DSLErrorCode.UnknownStream, 'Unknown stream', error?.detail);
        }
        if (error?.code === 'InvalidEnvelope' || error?.message?.includes('envelope')) {
            return new DSLError(DSLErrorCode.InvalidEnvelope, 'Invalid envelope format', error?.detail);
        }
        if (error instanceof SyntaxError || error?.message?.includes('JSON')) {
            return new DSLError(DSLErrorCode.InvalidJSON, 'Invalid JSON', error?.message);
        }
        return new DSLError(DSLErrorCode.Internal, error?.message || 'Internal error', error);
    }
    matchWhen(when, ctx) {
        if ('http' in when && when.http) {
            return this.matchHttp(when.http, ctx);
        }
        if ('ws' in when && when.ws) {
            return this.matchWs(when.ws, ctx);
        }
        if ('all' in when && when.all) {
            return when.all.every(w => this.matchWhen(w, ctx));
        }
        if ('any' in when && when.any) {
            return when.any.some(w => this.matchWhen(w, ctx));
        }
        if ('not' in when && when.not) {
            return !this.matchWhen(when.not, ctx);
        }
        return false;
    }
    matchHttp(http, ctx) {
        if (http.method) {
            const methods = Array.isArray(http.method) ? http.method : [http.method];
            if (!methods.includes(ctx.$method))
                return false;
        }
        if (http.path) {
            if (!this.matchPath(http.path, ctx.$path))
                return false;
        }
        if (http.contentType && ctx.$headers?.['content-type'] !== http.contentType) {
            return false;
        }
        if (http.headers) {
            for (const [key, value] of Object.entries(http.headers)) {
                if (ctx.$headers?.[key.toLowerCase()] !== value)
                    return false;
            }
        }
        if (http.query) {
            for (const [key, value] of Object.entries(http.query)) {
                if (ctx.$query?.[key] !== value)
                    return false;
            }
        }
        return true;
    }
    matchPath(pattern, path) {
        if (pattern === path)
            return true;
        if (pattern.includes('*')) {
            const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
            return regex.test(path);
        }
        return false;
    }
    matchWs(ws, ctx) {
        if (ws.path) {
            if (!this.matchPath(ws.path, ctx.$path))
                return false;
        }
        if (ws.headers) {
            for (const [key, value] of Object.entries(ws.headers)) {
                if (ctx.$headers?.[key.toLowerCase()] !== value)
                    return false;
            }
        }
        if (ws.query) {
            for (const [key, value] of Object.entries(ws.query)) {
                if (ctx.$query?.[key] !== value)
                    return false;
            }
        }
        if (ws.message) {
            if (!ctx.$message)
                return false;
            if (ws.message.type) {
                if (ctx.$messageType !== ws.message.type)
                    return false;
            }
            if (ws.message['json.has']) {
                const field = ws.message['json.has'];
                if (!(field in (ctx.$message || {})))
                    return false;
            }
            if (ws.message['json.match']) {
                for (const [key, value] of Object.entries(ws.message['json.match'])) {
                    if (ctx.$message?.[key] !== value)
                        return false;
                }
            }
        }
        return true;
    }
    async executeRule(rule, ctx) {
        if (rule.map) {
            ctx = { ...ctx, ...this.evaluateMap(rule.map, ctx) };
        }
        if (rule.send.frame) {
            return await this.sendFrame(rule.send.frame, ctx);
        }
        if (rule.send.http) {
            return this.materialize(rule.send.http, ctx);
        }
        if (rule.send.ws) {
            return this.materialize(rule.send.ws, ctx);
        }
        return null;
    }
    evaluateMap(map, ctx) {
        const result = {};
        for (const [key, selector] of Object.entries(map)) {
            result[key] = this.evalSelector(selector, ctx);
        }
        return result;
    }
    evalSelector(selector, ctx) {
        if (typeof selector === 'string') {
            if (selector.startsWith('$')) {
                const parts = selector.split('.');
                let value = ctx;
                for (const part of parts) {
                    value = value?.[part];
                }
                return value;
            }
            return selector;
        }
        if (typeof selector === 'object') {
            if ('const' in selector)
                return selector.const;
            if ('coalesce' in selector) {
                for (const s of selector.coalesce) {
                    const val = this.evalSelector(s, ctx);
                    if (val !== null && val !== undefined)
                        return val;
                }
                return null;
            }
            if ('default' in selector) {
                const [s, defaultVal] = selector.default;
                const val = this.evalSelector(s, ctx);
                return val !== null && val !== undefined ? val : defaultVal;
            }
            if ('toInt' in selector) {
                return parseInt(String(this.evalSelector(selector.toInt, ctx)), 10);
            }
            if ('toString' in selector) {
                return String(this.evalSelector(selector.toString, ctx));
            }
        }
        return selector;
    }
    async sendFrame(frame, ctx) {
        const fields = this.materialize(frame.fields, ctx);
        const type = frame.type;
        let result;
        switch (type) {
            case 'enqueue':
                result = await this.client.enqueue(fields.to, fields.envelope);
                break;
            case 'subscribe':
                result = { subscribed: fields.stream };
                break;
            case 'grant':
                this.client.grant(fields.credit);
                result = { granted: fields.credit };
                break;
            case 'ack':
                this.client.ack(fields.id);
                result = { acked: fields.id };
                break;
            case 'nack':
                this.client.nack(fields.id, fields.delayMs);
                result = { nacked: fields.id, delayMs: fields.delayMs };
                break;
            case 'stats':
                result = await this.client.stats(fields.stream);
                break;
            case 'metrics':
                result = await this.client.metrics();
                break;
            case 'snapshot':
                result = await this.client.snapshot(fields.view || fields.stream);
                break;
            case 'hello':
                result = await this.client.hello();
                break;
            default:
                throw new Error(`Unsupported frame type: ${type}`);
        }
        ctx.$result = result;
        if (frame.respond?.http) {
            return this.materialize(frame.respond.http, ctx);
        }
        if (frame.respond?.ws) {
            return this.materialize(frame.respond.ws, ctx);
        }
        return { status: 200, body: result };
    }
    materialize(obj, ctx) {
        if (typeof obj === 'string') {
            return this.evalSelector(obj, ctx);
        }
        if (Array.isArray(obj)) {
            return obj.map(item => this.materialize(item, ctx));
        }
        if (typeof obj === 'object' && obj !== null) {
            const result = {};
            for (const [key, value] of Object.entries(obj)) {
                result[key] = this.materialize(value, ctx);
            }
            return result;
        }
        return obj;
    }
}
export async function applyRules(config, client, ctx) {
    const interpreter = new DSLInterpreter(config, client);
    return await interpreter.applyRules(ctx);
}
