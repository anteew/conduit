import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { BlobSink, BlobRef, BlobMetadata } from '../types.js';

export class LocalBlobSink implements BlobSink {
  constructor(private baseDir: string) {
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
  }

  async store(stream: Readable, metadata: BlobMetadata): Promise<BlobRef> {
    const blobId = this.generateBlobId();
    const blobPath = path.join(this.baseDir, blobId);
    let size = 0;
    const hashStream = crypto.createHash('sha256');
    
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      hashStream.update(chunk);
    });
    
    await pipeline(stream, fs.createWriteStream(blobPath));
    
    const sha256 = hashStream.digest('hex');
    const uploadedAt = new Date().toISOString();
    
    const blobRef: BlobRef = {
      blobId,
      backend: 'local',
      sha256,
      size,
      mime: metadata.mime || 'application/octet-stream',
      uploadedAt,
      path: blobPath
    };
    
    const metaPath = `${blobPath}.meta.json`;
    await fs.promises.writeFile(metaPath, JSON.stringify({
      ...blobRef,
      filename: metadata.filename,
      clientIp: metadata.clientIp,
      uploadedBy: metadata.uploadedBy,
      tags: metadata.tags
    }, null, 2));
    
    return blobRef;
  }

  async fetch(blobRef: BlobRef): Promise<Readable> {
    const blobPath = blobRef.path || path.join(this.baseDir, blobRef.blobId);
    
    if (!fs.existsSync(blobPath)) {
      throw new Error(`Blob not found: ${blobRef.blobId}`);
    }
    
    return fs.createReadStream(blobPath);
  }

  async delete(blobRef: BlobRef): Promise<void> {
    const blobPath = blobRef.path || path.join(this.baseDir, blobRef.blobId);
    const metaPath = `${blobPath}.meta.json`;
    
    await Promise.all([
      fs.promises.unlink(blobPath).catch(() => {}),
      fs.promises.unlink(metaPath).catch(() => {})
    ]);
  }

  async exists(blobRef: BlobRef): Promise<boolean> {
    const blobPath = blobRef.path || path.join(this.baseDir, blobRef.blobId);
    return fs.existsSync(blobPath);
  }

  private generateBlobId(): string {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    return `blob-${timestamp}-${random}`;
  }
}
