import * as fs from 'fs';
import * as YAML from 'yaml';
export class DSLLoader {
    load(path) {
        const content = fs.readFileSync(path, 'utf8');
        const config = YAML.parse(content);
        this.validate(config);
        return config;
    }
    validate(config) {
        if (!config.version) {
            throw new Error('DSL config missing required field: version');
        }
        if (config.version !== 'proto-dsl/v0') {
            throw new Error(`Unsupported DSL version: ${config.version}`);
        }
        if (!Array.isArray(config.rules)) {
            throw new Error('DSL config missing required field: rules (must be array)');
        }
        for (const rule of config.rules) {
            this.validateRule(rule);
        }
    }
    validateRule(rule) {
        if (!rule.id) {
            throw new Error('Rule missing required field: id');
        }
        if (!rule.when) {
            throw new Error(`Rule ${rule.id} missing required field: when`);
        }
        if (!rule.send) {
            throw new Error(`Rule ${rule.id} missing required field: send`);
        }
        // Validate frame types if present
        if (rule.send.frame) {
            const validTypes = ['enqueue', 'subscribe', 'grant', 'ack', 'nack', 'stats', 'snapshot', 'metrics', 'hello'];
            if (!validTypes.includes(rule.send.frame.type)) {
                throw new Error(`Rule ${rule.id}: invalid frame type ${rule.send.frame.type}`);
            }
        }
    }
}
export function loadDSL(path) {
    const loader = new DSLLoader();
    return loader.load(path);
}
