import { Queue, Job } from 'bullmq';
import Redis from 'ioredis';
import { QueueSink, QueueRef, QueueStatus, QueueOptions } from '../types.js';

export interface BullMQConfig {
  redisUrl: string;
  defaultPrefix?: string;
}

export class BullMQSink implements QueueSink {
  private redis: Redis;
  private queues = new Map<string, Queue>();
  
  constructor(private config: BullMQConfig) {
    this.redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: null
    });
  }

  async send(message: any, options: QueueOptions): Promise<QueueRef> {
    const queue = this.getQueue(options.queue);
    
    const job = await queue.add(
      options.jobName || 'task',
      message,
      {
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
      }
    );
    
    return {
      backend: 'bullmq',
      jobId: job.id!,
      queue: options.queue,
      state: 'waiting',
      timestamp: new Date().toISOString(),
      priority: options.priority
    };
  }

  async getStatus(ref: QueueRef): Promise<QueueStatus> {
    const queue = this.getQueue(ref.queue);
    const job = await queue.getJob(ref.jobId);
    
    if (!job) {
      throw new Error(`Job not found: ${ref.jobId}`);
    }
    
    const state = await job.getState();
    
    return {
      jobId: ref.jobId,
      state: this.mapState(state),
      progress: job.progress as number,
      result: job.returnvalue,
      error: job.failedReason,
      attemptsMade: job.attemptsMade,
      timestamp: new Date(job.timestamp).toISOString()
    };
  }

  async cancel(ref: QueueRef): Promise<void> {
    const queue = this.getQueue(ref.queue);
    const job = await queue.getJob(ref.jobId);
    
    if (job) {
      await job.remove();
    }
  }

  private getQueue(queueName: string): Queue {
    if (!this.queues.has(queueName)) {
      const queue = new Queue(queueName, {
        connection: this.redis,
        prefix: this.config.defaultPrefix || 'conduit'
      });
      this.queues.set(queueName, queue);
    }
    
    return this.queues.get(queueName)!;
  }

  private getQueueKey(queueName: string): string {
    const prefix = this.config.defaultPrefix || 'conduit';
    return `${prefix}:${queueName}`;
  }

  private mapState(bullState: string): QueueRef['state'] {
    const stateMap: Record<string, QueueRef['state']> = {
      'waiting': 'waiting',
      'delayed': 'delayed',
      'active': 'active',
      'completed': 'completed',
      'failed': 'failed'
    };
    return stateMap[bullState] || 'waiting';
  }

  async close(): Promise<void> {
    for (const queue of this.queues.values()) {
      await queue.close();
    }
    await this.redis.quit();
  }
}
