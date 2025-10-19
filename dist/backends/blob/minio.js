import { S3BlobSink } from './s3.js';
export class MinIOBlobSink extends S3BlobSink {
    constructor(config) {
        const s3Config = {
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
