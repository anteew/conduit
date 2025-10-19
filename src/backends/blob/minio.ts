import { S3BlobSink, S3Config } from './s3.js';
import { BlobSink } from '../types.js';

export interface MinIOConfig {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  useSSL?: boolean;
}

export class MinIOBlobSink extends S3BlobSink implements BlobSink {
  constructor(config: MinIOConfig) {
    const s3Config: S3Config = {
      region: 'us-east-1',
      bucket: config.bucket,
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
      endpoint: config.endpoint,
      forcePathStyle: true
    };
    
    super(s3Config);
  }
}
