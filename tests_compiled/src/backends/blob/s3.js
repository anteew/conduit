import { S3Client, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import * as crypto from 'crypto';
import * as path from 'path';
import { Readable } from 'stream';
export class S3BlobSink {
    config;
    client;
    constructor(config) {
        this.config = config;
        this.client = new S3Client({
            region: config.region,
            credentials: config.accessKeyId ? {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey
            } : undefined,
            endpoint: config.endpoint,
            forcePathStyle: config.forcePathStyle
        });
    }
    async store(stream, metadata) {
        const blobId = this.generateBlobId();
        const key = this.generateKey(blobId, metadata);
        const hash = crypto.createHash('sha256');
        let size = 0;
        const hashingStream = new Readable({
            read() { }
        });
        stream.on('data', (chunk) => {
            size += chunk.length;
            hash.update(chunk);
            hashingStream.push(chunk);
        });
        stream.on('end', () => {
            hashingStream.push(null);
        });
        const upload = new Upload({
            client: this.client,
            params: {
                Bucket: this.config.bucket,
                Key: key,
                Body: hashingStream,
                ContentType: metadata.mime || 'application/octet-stream',
                Metadata: {
                    filename: metadata.filename || '',
                    uploadedBy: metadata.uploadedBy || '',
                    clientIp: metadata.clientIp || '',
                    ...(metadata.tags || {})
                }
            }
        });
        const result = await upload.done();
        const sha256 = hash.digest('hex');
        return {
            blobId,
            backend: 's3',
            sha256,
            size,
            mime: metadata.mime || 'application/octet-stream',
            uploadedAt: new Date().toISOString(),
            bucket: this.config.bucket,
            key,
            region: this.config.region,
            url: `s3://${this.config.bucket}/${key}`
        };
    }
    async fetch(blobRef) {
        const key = blobRef.key || blobRef.blobId;
        const command = new GetObjectCommand({
            Bucket: blobRef.bucket || this.config.bucket,
            Key: key
        });
        const response = await this.client.send(command);
        if (!response.Body) {
            throw new Error(`Blob not found: ${blobRef.blobId}`);
        }
        return response.Body;
    }
    async delete(blobRef) {
        const key = blobRef.key || blobRef.blobId;
        const command = new DeleteObjectCommand({
            Bucket: blobRef.bucket || this.config.bucket,
            Key: key
        });
        await this.client.send(command);
    }
    async exists(blobRef) {
        const key = blobRef.key || blobRef.blobId;
        try {
            const command = new HeadObjectCommand({
                Bucket: blobRef.bucket || this.config.bucket,
                Key: key
            });
            await this.client.send(command);
            return true;
        }
        catch (error) {
            if (error.name === 'NotFound')
                return false;
            throw error;
        }
    }
    generateBlobId() {
        const timestamp = Date.now();
        const random = crypto.randomBytes(8).toString('hex');
        return `blob-${timestamp}-${random}`;
    }
    generateKey(blobId, metadata) {
        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const ext = metadata.filename ? path.extname(metadata.filename) : '';
        return `${year}/${month}/${day}/${blobId}${ext}`;
    }
}
