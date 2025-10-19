import { LocalBlobSink } from './blob/local.js';
import { S3BlobSink } from './blob/s3.js';
import { MinIOBlobSink } from './blob/minio.js';
import { BullMQSink } from './queue/bullmq.js';
export function createBlobSink() {
    const backend = process.env.CONDUIT_BLOB_BACKEND || 'local';
    switch (backend) {
        case 'local':
            const dir = process.env.CONDUIT_BLOB_LOCAL_DIR || '/tmp/blobs';
            return new LocalBlobSink(dir);
        case 's3':
            return new S3BlobSink({
                region: process.env.CONDUIT_BLOB_S3_REGION || 'us-east-1',
                bucket: process.env.CONDUIT_BLOB_S3_BUCKET || 'uploads',
                accessKeyId: process.env.CONDUIT_BLOB_S3_ACCESS_KEY_ID,
                secretAccessKey: process.env.CONDUIT_BLOB_S3_SECRET_ACCESS_KEY,
                endpoint: process.env.CONDUIT_BLOB_S3_ENDPOINT
            });
        case 'minio':
            if (!process.env.CONDUIT_BLOB_MINIO_ENDPOINT) {
                throw new Error('CONDUIT_BLOB_MINIO_ENDPOINT required for MinIO backend');
            }
            return new MinIOBlobSink({
                endpoint: process.env.CONDUIT_BLOB_MINIO_ENDPOINT,
                bucket: process.env.CONDUIT_BLOB_MINIO_BUCKET || 'uploads',
                accessKey: process.env.CONDUIT_BLOB_MINIO_ACCESS_KEY || 'minioadmin',
                secretKey: process.env.CONDUIT_BLOB_MINIO_SECRET_KEY || 'minioadmin',
                useSSL: process.env.CONDUIT_BLOB_MINIO_USE_SSL === 'true'
            });
        default:
            throw new Error(`Unknown blob backend: ${backend}`);
    }
}
export function createQueueSink() {
    const backend = process.env.CONDUIT_QUEUE_BACKEND;
    if (!backend || backend === 'none') {
        return null;
    }
    switch (backend) {
        case 'bullmq':
            const redisUrl = process.env.CONDUIT_QUEUE_REDIS_URL || 'redis://localhost:6379';
            return new BullMQSink({
                redisUrl,
                defaultPrefix: process.env.CONDUIT_QUEUE_PREFIX || 'conduit'
            });
        default:
            throw new Error(`Unknown queue backend: ${backend}`);
    }
}
