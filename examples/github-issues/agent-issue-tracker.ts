#!/usr/bin/env node
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { fetchBlob, getBlobAsBuffer } from '../../src/helpers/agent-helpers.js';

// Agent: IssueTracker
// Receives issue.created envelopes, processes issues, emits callbacks

const redis = new Redis(process.env.CONDUIT_QUEUE_REDIS_URL || 'redis://localhost:6379');

// BullMQ worker for agents/IssueTracker/inbox
const worker = new Worker(
  'agents/IssueTracker/inbox',
  async (job) => {
    console.log(`\n[IssueTracker] Processing job ${job.id}`);
    console.log(`Title: ${job.data.title}`);
    console.log(`Description: ${job.data.description}`);
    
    // If has attachment, fetch it
    if (job.data.attachments && job.data.attachments.length > 0) {
      const attachment = job.data.attachments[0];
      console.log(`\n[IssueTracker] Fetching attachment: ${attachment.filename}`);
      console.log(`  BlobId: ${attachment.blobRef.blobId}`);
      console.log(`  Size: ${(attachment.blobRef.size / 1024).toFixed(1)} KB`);
      console.log(`  SHA256: ${attachment.blobRef.sha256.substring(0, 16)}...`);
      
      try {
        const blob = await fetchBlob(attachment.blobRef);
        const buffer = await getBlobAsBuffer(attachment.blobRef);
        console.log(`  Downloaded: ${buffer.length} bytes`);
        
        // Process attachment (e.g., OCR, analysis, etc.)
        // ... your processing logic here ...
        
      } catch (error: any) {
        console.error(`  Failed to fetch blob: ${error.message}`);
        throw error;
      }
    }
    
    // Simulate issue processing
    console.log(`\n[IssueTracker] Processing issue...`);
    await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate work
    
    // Return result (BullMQ will trigger parent callback if configured)
    const result = {
      issueId: job.data.issueId,
      resolution: `Processed: ${job.data.title}`,
      completedAt: new Date().toISOString(),
      completedBy: 'IssueTracker'
    };
    
    console.log(`[IssueTracker] ✅ Issue ${job.id} complete`);
    
    return result;
  },
  {
    connection: redis,
    prefix: 'conduit'
  }
);

worker.on('completed', (job) => {
  console.log(`\n[IssueTracker] Job ${job.id} completed successfully`);
  console.log(`Result:`, job.returnvalue);
});

worker.on('failed', (job, err) => {
  console.error(`\n[IssueTracker] Job ${job?.id} failed:`, err.message);
});

worker.on('error', (err) => {
  console.error('[IssueTracker] Worker error:', err);
});

console.log('[IssueTracker] Agent started, waiting for issues...');
console.log('Queue: agents/IssueTracker/inbox');
console.log('Redis:', process.env.CONDUIT_QUEUE_REDIS_URL || 'redis://localhost:6379');
console.log('\nSend test issue:');
console.log('  curl -X POST http://localhost:9087/issues \\');
console.log('    -F "title=Add dark mode" \\');
console.log('    -F "description=Users want dark mode" \\');
console.log('    -F "assignedTo=agents/IssueTracker/inbox" \\');
console.log('    -F "attachment=@mockup.png"\n');
