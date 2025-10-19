import * as fs from 'fs';
import { ControlFrame } from './types.js';

export type Dir = 'in' | 'out';

export interface RecordEntry {
  ts: string;
  dir: Dir;
  frame: ControlFrame;
}

const SENSITIVE_FIELDS = ['token', 'auth', 'password', 'secret'];

export class Recorder {
  private stream: fs.WriteStream | null = null;
  private redactSensitive: boolean;
  
  constructor(path?: string, options: { redact?: boolean } = {}) {
    this.redactSensitive = options.redact ?? true;
    if (path) {
      this.stream = fs.createWriteStream(path, { flags: 'a' });
    }
  }
  
  write(frame: ControlFrame, dir: Dir) {
    if (!this.stream) return;
    
    const recordFrame = this.redactSensitive ? this.redact(frame) : frame;
    const rec: RecordEntry = { 
      ts: new Date().toISOString(), 
      dir, 
      frame: recordFrame 
    };
    
    this.stream.write(JSON.stringify(rec) + '\n');
  }
  
  private redact(frame: ControlFrame): ControlFrame {
    const redacted = { ...frame } as any;
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
