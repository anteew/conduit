import { createBlobSink, createQueueSink } from '../backends/factory.js';
export class AgentHelpers {
    static blobSink = createBlobSink();
    static queueSink = createQueueSink();
    static async fetchBlob(blobRef) {
        return this.blobSink.fetch(blobRef);
    }
    static async getBlobAsBuffer(blobRef) {
        const stream = await this.fetchBlob(blobRef);
        const chunks = [];
        return new Promise((resolve, reject) => {
            stream.on('data', (chunk) => chunks.push(chunk));
            stream.on('end', () => resolve(Buffer.concat(chunks)));
            stream.on('error', reject);
        });
    }
    static async getBlobAsString(blobRef, encoding = 'utf8') {
        const buffer = await this.getBlobAsBuffer(blobRef);
        return buffer.toString(encoding);
    }
    static async getQueueStatus(queueRef) {
        if (!this.queueSink) {
            throw new Error('Queue backend not configured');
        }
        return this.queueSink.getStatus(queueRef);
    }
    static async cancelJob(queueRef) {
        if (!this.queueSink) {
            throw new Error('Queue backend not configured');
        }
        return this.queueSink.cancel(queueRef);
    }
    static async sendToQueue(queue, message, options) {
        if (!this.queueSink) {
            throw new Error('Queue backend not configured');
        }
        return this.queueSink.send(message, { queue, ...options });
    }
}
export const { fetchBlob, getBlobAsBuffer, getBlobAsString, getQueueStatus, cancelJob, sendToQueue } = AgentHelpers;
