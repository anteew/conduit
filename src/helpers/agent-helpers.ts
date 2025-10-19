import { Readable } from 'stream';
import { BlobRef, QueueRef } from '../backends/types.js';
import { createBlobSink, createQueueSink } from '../backends/factory.js';

export class AgentHelpers {
  private static blobSink = createBlobSink();
  private static queueSink = createQueueSink();

  static async fetchBlob(blobRef: BlobRef): Promise<Readable> {
    return this.blobSink.fetch(blobRef);
  }

  static async getBlobAsBuffer(blobRef: BlobRef): Promise<Buffer> {
    const stream = await this.fetchBlob(blobRef);
    const chunks: Buffer[] = [];
    
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  static async getBlobAsString(blobRef: BlobRef, encoding: BufferEncoding = 'utf8'): Promise<string> {
    const buffer = await this.getBlobAsBuffer(blobRef);
    return buffer.toString(encoding);
  }

  static async getQueueStatus(queueRef: QueueRef) {
    if (!this.queueSink) {
      throw new Error('Queue backend not configured');
    }
    return this.queueSink.getStatus(queueRef);
  }

  static async cancelJob(queueRef: QueueRef) {
    if (!this.queueSink) {
      throw new Error('Queue backend not configured');
    }
    return this.queueSink.cancel(queueRef);
  }

  static async sendToQueue(queue: string, message: any, options?: any) {
    if (!this.queueSink) {
      throw new Error('Queue backend not configured');
    }
    return this.queueSink.send(message, { queue, ...options });
  }
}

export const { fetchBlob, getBlobAsBuffer, getBlobAsString, getQueueStatus, cancelJob, sendToQueue } = AgentHelpers;
