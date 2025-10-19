import { Queue } from 'bullmq';
import Redis from 'ioredis';
export class BullMQSink {
    config;
    redis;
    queues = new Map();
    constructor(config) {
        this.config = config;
        this.redis = new Redis(config.redisUrl, {
            maxRetriesPerRequest: null
        });
    }
    async send(message, options) {
        const queue = this.getQueue(options.queue);
        const job = await queue.add(options.jobName || 'task', message, {
            jobId: options.jobId,
            priority: options.priority,
            delay: options.delayMs,
            attempts: options.maxRetries || 3,
            backoff: {
                type: 'exponential',
                delay: 1000
            },
            parent: options.parentJobId && options.parentQueue ? {
                id: options.parentJobId,
                queue: this.getQueueKey(options.parentQueue)
            } : undefined
        });
        return {
            backend: 'bullmq',
            jobId: job.id,
            queue: options.queue,
            state: 'waiting',
            timestamp: new Date().toISOString(),
            priority: options.priority
        };
    }
    async getStatus(ref) {
        const queue = this.getQueue(ref.queue);
        const job = await queue.getJob(ref.jobId);
        if (!job) {
            throw new Error(`Job not found: ${ref.jobId}`);
        }
        const state = await job.getState();
        return {
            jobId: ref.jobId,
            state: this.mapState(state),
            progress: job.progress,
            result: job.returnvalue,
            error: job.failedReason,
            attemptsMade: job.attemptsMade,
            timestamp: new Date(job.timestamp).toISOString()
        };
    }
    async cancel(ref) {
        const queue = this.getQueue(ref.queue);
        const job = await queue.getJob(ref.jobId);
        if (job) {
            await job.remove();
        }
    }
    getQueue(queueName) {
        if (!this.queues.has(queueName)) {
            const queue = new Queue(queueName, {
                connection: this.redis,
                prefix: this.config.defaultPrefix || 'conduit'
            });
            this.queues.set(queueName, queue);
        }
        return this.queues.get(queueName);
    }
    getQueueKey(queueName) {
        const prefix = this.config.defaultPrefix || 'conduit';
        return `${prefix}:${queueName}`;
    }
    mapState(bullState) {
        const stateMap = {
            'waiting': 'waiting',
            'delayed': 'delayed',
            'active': 'active',
            'completed': 'completed',
            'failed': 'failed'
        };
        return stateMap[bullState] || 'waiting';
    }
    async close() {
        for (const queue of this.queues.values()) {
            await queue.close();
        }
        await this.redis.quit();
    }
}
