import * as net from 'net';
import { Duplex } from 'stream';
import { ControlFrame, encodeFrame, decodeLines } from './types.js';

export interface TerminalConfig {
  type: 'tcp' | 'unix';
  host?: string;
  port?: number;
  path?: string;
}

export class TCPTerminal {
  private socket: net.Socket | null = null;
  private buf = '';
  private onFrameCallback: ((frame: ControlFrame) => void) | null = null;

  constructor(private config: TerminalConfig) {}

  async connect(): Promise<Duplex> {
    return new Promise((resolve, reject) => {
      if (this.config.type === 'tcp') {
        if (!this.config.host || !this.config.port) {
          reject(new Error('TCP terminal requires host and port'));
          return;
        }
        this.socket = net.connect(this.config.port, this.config.host);
      } else if (this.config.type === 'unix') {
        if (!this.config.path) {
          reject(new Error('Unix terminal requires path'));
          return;
        }
        this.socket = net.connect(this.config.path);
      } else {
        reject(new Error(`Unknown terminal type: ${this.config.type}`));
        return;
      }

      this.socket.on('connect', () => {
        console.log(`Connected to ${this.config.type} terminal`);
        if (this.socket) resolve(this.socket as Duplex);
      });

      this.socket.on('error', (err: Error) => {
        console.error('Terminal connection error:', err);
        reject(err);
      });

      this.socket.on('data', (chunk: Buffer) => {
        this.buf += chunk.toString('utf8');
        this.buf = decodeLines(this.buf, (frame) => {
          if (this.onFrameCallback) this.onFrameCallback(frame);
        });
      });

      this.socket.on('close', () => {
        console.log('Terminal connection closed');
      });
    });
  }

  onFrame(callback: (frame: ControlFrame) => void) {
    this.onFrameCallback = callback;
  }

  send(frame: ControlFrame) {
    if (!this.socket) throw new Error('Terminal not connected');
    this.socket.write(encodeFrame(frame));
  }

  close() {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
  }
}

export function parseBackendURL(url: string): TerminalConfig | null {
  if (url === 'demo') return null;
  
  if (url.startsWith('tcp://')) {
    const match = url.match(/^tcp:\/\/([^:]+):(\d+)$/);
    if (!match) throw new Error(`Invalid TCP URL: ${url}`);
    return {
      type: 'tcp',
      host: match[1],
      port: parseInt(match[2], 10)
    };
  }
  
  if (url.startsWith('unix://')) {
    return {
      type: 'unix',
      path: url.replace('unix://', '')
    };
  }
  
  throw new Error(`Unknown backend URL scheme: ${url}`);
}
