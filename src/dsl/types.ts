// Proto-DSL v0 TypeScript types
// Based on docs/rfcs/PROTO-DSL-v0.md

export interface DSLConfig {
  version: string; // "proto-dsl/v0"
  bind?: BindConfig;
  codec?: CodecConfig;
  flow?: FlowConfig;
  rules: Rule[];
  defaults?: DefaultsConfig;
}

export interface BindConfig {
  http?: HttpBinding;
  ws?: WsBinding;
  serial?: SerialBinding;
  fs?: FsBinding;
  stdio?: StdioBinding;
}

export interface HttpBinding {
  port: number;
  host?: string;
  pathPrefix?: string;
  headers?: Record<string, string>;
}

export interface WsBinding {
  port: number;
  host?: string;
  path: string;
}

export interface SerialBinding {
  device: string;
  baud: number;
  framing: 'jsonl' | 'raw';
  newline?: string;
  checksum?: 'none' | 'crc32';
}

export interface FsBinding {
  inbox: string;
  outbox: string;
  atomicWrites?: boolean;
}

export interface StdioBinding {
  // no options in v0
}

export interface CodecConfig {
  http?: { in: string; out: string };
  ws?: { in: string; out: string };
  serial?: { in: string; out: string };
  fs?: { in: string; out: string };
}

export interface FlowConfig {
  mode: 'credit';
  window?: number;
  refill?: 'on_ack' | 'interval';
  intervalMs?: number;
}

export interface DefaultsConfig {
  map?: Record<string, any>;
  onError?: Record<string, ErrorMapping>;
}

export interface Rule {
  id: string;
  when: WhenClause;
  map?: MapClause;
  send: SendClause;
  onError?: Record<string, ErrorMapping>;
  assert?: AssertClause;
}

export type WhenClause =
  | { http?: HttpWhen }
  | { ws?: WsWhen }
  | { serial?: SerialWhen }
  | { fs?: FsWhen }
  | { stdio?: StdioWhen }
  | { all?: WhenClause[] }
  | { any?: WhenClause[] }
  | { not?: WhenClause }
  | { where?: string };

export interface HttpWhen {
  method?: string | string[];
  path?: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  contentType?: string;
}

export interface WsWhen {
  path?: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  message?: {
    type?: 'text' | 'binary';
    'json.has'?: string;
    'json.match'?: Record<string, any>;
  };
}

export interface SerialWhen {
  'line.fr'?: 'jsonl' | 'raw';
  'line.json.has'?: string;
  'line.json.eq'?: Record<string, any>;
  'line.raw.match'?: string;
}

export interface FsWhen {
  event?: 'newFile' | 'newDir';
  'path.match'?: string;
}

export interface StdioWhen {
  stream?: 'stdout' | 'stderr';
  'line.json.has'?: string | null;
  'line.raw.match'?: string;
}

export type MapClause = Record<string, SelectorOrHelper>;

export type SelectorOrHelper =
  | string // selector or literal
  | { coalesce: SelectorOrHelper[] }
  | { default: [SelectorOrHelper, any] }
  | { pick: [SelectorOrHelper, string[]] }
  | { regex: [SelectorOrHelper, string, number?] }
  | { toInt: SelectorOrHelper }
  | { toFloat: SelectorOrHelper }
  | { toString: SelectorOrHelper }
  | { const: any };

export interface AssertClause {
  [field: string]: {
    required?: string[];
    type?: string;
    minLength?: number;
    maxLength?: number;
  };
}

export interface SendClause {
  frame?: FrameSend;
  http?: HttpResponse;
  ws?: WsResponse;
  serial?: SerialResponse;
  fs?: FsResponse;
}

export interface FrameSend {
  type: 'enqueue' | 'subscribe' | 'grant' | 'ack' | 'nack' | 'stats' | 'snapshot' | 'metrics' | 'hello';
  fields: Record<string, any>;
  await?: 'ok' | 'error' | 'none';
  respond?: {
    http?: HttpResponse;
    ws?: WsResponse;
    serial?: SerialResponse;
  };
}

export interface HttpResponse {
  status: number;
  body?: any;
  headers?: Record<string, string>;
}

export interface WsResponse {
  message?: any;
  close?: { code: number; reason: string };
}

export interface SerialResponse {
  line?: any;
  raw?: string;
}

export interface FsResponse {
  write?: {
    path: string;
    body?: any;
    appendFrames?: any[];
  };
}

export interface ErrorMapping {
  http?: HttpResponse;
  ws?: WsResponse;
  serial?: SerialResponse;
  fs?: FsResponse;
}

// Context for rule evaluation
export interface RuleContext {
  [key: string]: any;
  $event?: any;
  $body?: any;
  $headers?: Record<string, string>;
  $query?: Record<string, string>;
  $result?: any;
  $error?: any;
}
