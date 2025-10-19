import * as fs from 'fs';
const SENSITIVE_FIELDS = ['token', 'auth', 'password', 'secret'];
export class Recorder {
    stream = null;
    redactSensitive;
    constructor(path, options = {}) {
        this.redactSensitive = options.redact ?? true;
        if (path) {
            this.stream = fs.createWriteStream(path, { flags: 'a' });
        }
    }
    write(frame, dir) {
        if (!this.stream)
            return;
        const recordFrame = this.redactSensitive ? this.redact(frame) : frame;
        const rec = {
            ts: new Date().toISOString(),
            dir,
            frame: recordFrame
        };
        this.stream.write(JSON.stringify(rec) + '\n');
    }
    redact(frame) {
        const redacted = { ...frame };
        for (const field of SENSITIVE_FIELDS) {
            if (redacted[field]) {
                redacted[field] = '[REDACTED]';
            }
        }
        return redacted;
    }
    close() {
        this.stream?.end();
    }
}
