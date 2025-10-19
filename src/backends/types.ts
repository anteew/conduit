import { Readable } from 'stream';

export interface BlobMetadata {
  filename?: string;
  mime?: string;
  clientIp?: string;
  uploadedBy?: string;
  tags?: Record<string, string>;
}

export interface BlobRef {
  blobId: string;
  backend: string;
  sha256: string;
  size: number;
  mime: string;
  uploadedAt: string;
  // Backend-specific fields
  bucket?: string;
  key?: string;
  path?: string;
  url?: string;
  region?: string;
}

export interface BlobSink {
  store(stream: Readable, metadata: BlobMetadata): Promise<BlobRef>;
  fetch(blobRef: BlobRef): Promise<Readable>;
  delete(blobRef: BlobRef): Promise<void>;
  exists(blobRef: BlobRef): Promise<boolean>;
}

export interface QueueOptions {
  queue: string;
  jobId?: string;
  jobName?: string;
  priority?: number;
  delayMs?: number;
  maxRetries?: number;
  timeout?: number;
  parentJobId?: string;
  parentQueue?: string;
}

export interface QueueRef {
  backend: string;
  jobId: string;
  queue: string;
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';
  timestamp: string;
  priority?: number;
  // Backend-specific fields
  offset?: number;
  partition?: number;
  messageId?: string;
  topic?: string;
}

export interface QueueStatus {
  jobId: string;
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';
  progress?: number;
  result?: any;
  error?: any;
  attemptsMade?: number;
  timestamp: string;
}

export interface QueueSink {
  send(message: any, options: QueueOptions): Promise<QueueRef>;
  getStatus(ref: QueueRef): Promise<QueueStatus>;
  cancel(ref: QueueRef): Promise<void>;
}
