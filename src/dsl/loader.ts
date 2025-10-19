import * as fs from 'fs';
import * as YAML from 'yaml';
import { DSLConfig, Rule } from './types.js';

export class DSLLoader {
  load(path: string): DSLConfig {
    const content = fs.readFileSync(path, 'utf8');
    const config = YAML.parse(content) as DSLConfig;
    this.validate(config);
    return config;
  }

  private validate(config: DSLConfig): void {
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

  private validateRule(rule: Rule): void {
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

export function loadDSL(path: string): DSLConfig {
  const loader = new DSLLoader();
  return loader.load(path);
}
