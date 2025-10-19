#!/usr/bin/env node
import { spawn } from 'child_process';
import { existsSync } from 'fs';

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
};

const FRAME_COLORS: Record<string, string> = {
  hello: COLORS.magenta,
  ok: COLORS.green,
  error: COLORS.red,
  enqueue: COLORS.blue,
  subscribe: COLORS.cyan,
  grant: COLORS.yellow,
  ack: COLORS.green,
  nack: COLORS.red,
  deliver: COLORS.blue,
  stats: COLORS.cyan,
  snapshot: COLORS.cyan,
  metrics: COLORS.cyan,
};

function formatFrame(line: string): string {
  try {
    const record = JSON.parse(line);
    const { ts, dir, frame } = record;
    
    const timestamp = new Date(ts).toISOString().substring(11, 23);
    const arrow = dir === 'in' ? '←' : '→';
    const frameType = frame.type || 'unknown';
    const color = FRAME_COLORS[frameType] || COLORS.reset;
    
    const dirColor = dir === 'in' ? COLORS.green : COLORS.yellow;
    
    let details = '';
    if (frame.reqId) details += ` reqId=${frame.reqId}`;
    if (frame.to) details += ` to=${frame.to}`;
    if (frame.stream) details += ` stream=${frame.stream}`;
    if (frame.id) details += ` id=${frame.id}`;
    if (frame.n) details += ` n=${frame.n}`;
    if (frame.code) details += ` code=${frame.code}`;
    
    return `${COLORS.dim}${timestamp}${COLORS.reset} ${dirColor}${arrow}${COLORS.reset} ${color}${COLORS.bold}${frameType.padEnd(10)}${COLORS.reset}${details}`;
  } catch {
    return line;
  }
}

function tailFile(path: string) {
  if (!existsSync(path)) {
    console.error(`File not found: ${path}`);
    process.exit(1);
  }

  const tail = spawn('tail', ['-f', path]);
  
  tail.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter((l: string) => l.trim());
    lines.forEach((line: string) => {
      console.log(formatFrame(line));
    });
  });
  
  tail.stderr.on('data', (data) => {
    console.error(`tail error: ${data}`);
  });
  
  tail.on('close', (code) => {
    process.exit(code || 0);
  });
  
  process.on('SIGINT', () => {
    tail.kill();
    process.exit(0);
  });
}

const args = process.argv.slice(2);
const filePath = args[0] || process.env.CONDUIT_RECORD;

if (!filePath) {
  console.error('Usage: tail-frames.ts <path-to-jsonl-file>');
  console.error('   or: CONDUIT_RECORD=/path/to/file.jsonl tail-frames.ts');
  process.exit(1);
}

console.log(`${COLORS.bold}Tailing control frames from: ${filePath}${COLORS.reset}\n`);
tailFile(filePath);
