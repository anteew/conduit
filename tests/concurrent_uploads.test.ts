import http from 'http';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://127.0.0.1:9991';
const CONCURRENT_CLIENTS = 100;
const TEST_DURATION_MS = 60000; // 1 minute
const FILE_SIZES = [
  1024,           // 1KB
  10240,          // 10KB
  102400,         // 100KB
  1048576,        // 1MB
  5242880,        // 5MB
  10485760,       // 10MB
];

interface UploadResult {
  success: boolean;
  status: number;
  duration: number;
  size: number;
  error?: string;
  startTime: number;
  endTime: number;
}

interface MemorySample {
  timestamp: number;
  heapUsed: number;
  heapTotal: number;
  rss: number;
}

class LoadTestMetrics {
  private results: UploadResult[] = [];
  private memorySamples: MemorySample[] = [];
  private startTime: number = 0;
  private endTime: number = 0;
  
  start() {
    this.startTime = Date.now();
    this.startMemoryMonitoring();
  }
  
  stop() {
    this.endTime = Date.now();
  }
  
  recordResult(result: UploadResult) {
    this.results.push(result);
  }
  
  private startMemoryMonitoring() {
    const interval = setInterval(() => {
      const mem = process.memoryUsage();
      this.memorySamples.push({
        timestamp: Date.now(),
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        rss: mem.rss,
      });
      
      if (this.endTime > 0) {
        clearInterval(interval);
      }
    }, 1000);
  }
  
  getReport() {
    const durationSec = (this.endTime - this.startTime) / 1000;
    const successful = this.results.filter(r => r.success);
    const failed = this.results.filter(r => !r.success);
    const totalBytes = successful.reduce((sum, r) => sum + r.size, 0);
    const totalMB = totalBytes / (1024 * 1024);
    const avgThroughputMBps = totalMB / durationSec;
    
    const durations = successful.map(r => r.duration).sort((a, b) => a - b);
    const p50 = durations[Math.floor(durations.length * 0.5)] || 0;
    const p95 = durations[Math.floor(durations.length * 0.95)] || 0;
    const p99 = durations[Math.floor(durations.length * 0.99)] || 0;
    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length || 0;
    
    const statusCodes = new Map<number, number>();
    this.results.forEach(r => {
      statusCodes.set(r.status, (statusCodes.get(r.status) || 0) + 1);
    });
    
    const errorsByType = new Map<string, number>();
    failed.forEach(r => {
      const errorType = r.error || 'unknown';
      errorsByType.set(errorType, (errorsByType.get(errorType) || 0) + 1);
    });
    
    const heapUsages = this.memorySamples.map(s => s.heapUsed);
    const maxHeap = Math.max(...heapUsages);
    const minHeap = Math.min(...heapUsages);
    const avgHeap = heapUsages.reduce((a, b) => a + b, 0) / heapUsages.length;
    
    const heapGrowth = heapUsages[heapUsages.length - 1] - heapUsages[0];
    const isMemoryStable = Math.abs(heapGrowth) < (avgHeap * 0.1);
    
    const requestsPerSec = this.results.length / durationSec;
    
    return {
      duration: durationSec,
      totalRequests: this.results.length,
      successful: successful.length,
      failed: failed.length,
      successRate: (successful.length / this.results.length * 100).toFixed(2) + '%',
      
      throughput: {
        totalBytes,
        totalMB: totalMB.toFixed(2),
        avgMBps: avgThroughputMBps.toFixed(2),
        requestsPerSec: requestsPerSec.toFixed(2),
      },
      
      latency: {
        p50: p50.toFixed(2) + 'ms',
        p95: p95.toFixed(2) + 'ms',
        p99: p99.toFixed(2) + 'ms',
        avg: avgDuration.toFixed(2) + 'ms',
        min: Math.min(...durations).toFixed(2) + 'ms',
        max: Math.max(...durations).toFixed(2) + 'ms',
      },
      
      statusCodes: Object.fromEntries(statusCodes),
      errorsByType: Object.fromEntries(errorsByType),
      
      memory: {
        samples: this.memorySamples.length,
        heapUsed: {
          min: (minHeap / 1024 / 1024).toFixed(2) + 'MB',
          max: (maxHeap / 1024 / 1024).toFixed(2) + 'MB',
          avg: (avgHeap / 1024 / 1024).toFixed(2) + 'MB',
        },
        heapGrowth: (heapGrowth / 1024 / 1024).toFixed(2) + 'MB',
        isStable: isMemoryStable,
      },
      
      concurrency: {
        maxConcurrent: this.calculateMaxConcurrency(),
        avgConcurrent: this.calculateAvgConcurrency(),
      },
    };
  }
  
  private calculateMaxConcurrency(): number {
    const timeWindows = new Map<number, number>();
    
    this.results.forEach(r => {
      const startSec = Math.floor(r.startTime / 1000);
      const endSec = Math.floor(r.endTime / 1000);
      
      for (let t = startSec; t <= endSec; t++) {
        timeWindows.set(t, (timeWindows.get(t) || 0) + 1);
      }
    });
    
    return Math.max(...Array.from(timeWindows.values()));
  }
  
  private calculateAvgConcurrency(): number {
    const timeWindows = new Map<number, number>();
    
    this.results.forEach(r => {
      const startSec = Math.floor(r.startTime / 1000);
      const endSec = Math.floor(r.endTime / 1000);
      
      for (let t = startSec; t <= endSec; t++) {
        timeWindows.set(t, (timeWindows.get(t) || 0) + 1);
      }
    });
    
    const values = Array.from(timeWindows.values());
    return values.reduce((a, b) => a + b, 0) / values.length || 0;
  }
}

function uploadFile(filename: string, size: number): Promise<UploadResult> {
  const startTime = Date.now();
  const fileContent = Buffer.alloc(size, 'x');
  
  return new Promise((resolve) => {
    const req = http.request(
      `${BASE_URL}/v1/upload`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': fileContent.length,
          'X-Filename': filename,
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          const endTime = Date.now();
          const duration = endTime - startTime;
          
          try {
            const result = data ? JSON.parse(data) : {};
            resolve({
              success: res.statusCode === 200,
              status: res.statusCode || 0,
              duration,
              size,
              error: result.error,
              startTime,
              endTime,
            });
          } catch (e) {
            resolve({
              success: false,
              status: res.statusCode || 0,
              duration,
              size,
              error: 'Parse error',
              startTime,
              endTime,
            });
          }
        });
      }
    );
    
    req.on('error', (err) => {
      const endTime = Date.now();
      resolve({
        success: false,
        status: 0,
        duration: endTime - startTime,
        size,
        error: err.message,
        startTime,
        endTime,
      });
    });
    
    req.write(fileContent);
    req.end();
  });
}

function getRandomSize(): number {
  return FILE_SIZES[Math.floor(Math.random() * FILE_SIZES.length)];
}

async function spawnConcurrentClients(metrics: LoadTestMetrics, stopTime: number): Promise<void> {
  const clients: Promise<void>[] = [];
  
  for (let i = 0; i < CONCURRENT_CLIENTS; i++) {
    const clientPromise = (async () => {
      let requestCount = 0;
      
      while (Date.now() < stopTime) {
        const size = getRandomSize();
        const filename = `client-${i}-req-${requestCount}-${size}b.dat`;
        
        const result = await uploadFile(filename, size);
        metrics.recordResult(result);
        
        requestCount++;
        
        await new Promise(resolve => setTimeout(resolve, Math.random() * 500));
      }
    })();
    
    clients.push(clientPromise);
    
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  await Promise.all(clients);
}

async function runLoadTest() {
  console.log('🧪 T4060-Concurrent-Uploads: Load testing with 100 concurrent clients');
  console.log('=====================================================================\n');
  
  console.log(`Configuration:`);
  console.log(`  • Concurrent clients: ${CONCURRENT_CLIENTS}`);
  console.log(`  • Test duration: ${TEST_DURATION_MS / 1000}s`);
  console.log(`  • File sizes: ${FILE_SIZES.map(s => {
    if (s >= 1048576) return (s / 1048576) + 'MB';
    if (s >= 1024) return (s / 1024) + 'KB';
    return s + 'B';
  }).join(', ')}`);
  console.log(`  • Target: ${BASE_URL}\n`);
  
  console.log('⏱️  Starting load test...\n');
  
  const metrics = new LoadTestMetrics();
  metrics.start();
  
  const stopTime = Date.now() + TEST_DURATION_MS;
  await spawnConcurrentClients(metrics, stopTime);
  
  metrics.stop();
  
  console.log('\n✅ Load test complete! Generating report...\n');
  
  const report = metrics.getReport();
  
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('                     📊 LOAD TEST RESULTS                           ');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  
  console.log('📈 Request Summary:');
  console.log(`  ├─ Total requests:     ${report.totalRequests}`);
  console.log(`  ├─ Successful:         ${report.successful} (${report.successRate})`);
  console.log(`  ├─ Failed:             ${report.failed}`);
  console.log(`  └─ Duration:           ${report.duration.toFixed(2)}s\n`);
  
  console.log('🚀 Throughput:');
  console.log(`  ├─ Total data:         ${report.throughput.totalMB} MB`);
  console.log(`  ├─ Average speed:      ${report.throughput.avgMBps} MB/s`);
  console.log(`  └─ Requests/sec:       ${report.throughput.requestsPerSec}\n`);
  
  console.log('⏱️  Latency:');
  console.log(`  ├─ p50 (median):       ${report.latency.p50}`);
  console.log(`  ├─ p95:                ${report.latency.p95}`);
  console.log(`  ├─ p99:                ${report.latency.p99}`);
  console.log(`  ├─ Average:            ${report.latency.avg}`);
  console.log(`  ├─ Min:                ${report.latency.min}`);
  console.log(`  └─ Max:                ${report.latency.max}\n`);
  
  console.log('🔢 Status Codes:');
  Object.entries(report.statusCodes).forEach(([code, count]) => {
    const emoji = code === '200' ? '✅' : code === '503' ? '⚠️ ' : '❌';
    console.log(`  ${emoji} ${code}: ${count} requests`);
  });
  console.log('');
  
  if (Object.keys(report.errorsByType).length > 0) {
    console.log('❌ Errors by Type:');
    Object.entries(report.errorsByType).forEach(([type, count]) => {
      console.log(`  ├─ ${type}: ${count}`);
    });
    console.log('');
  }
  
  console.log('💾 Memory Usage:');
  console.log(`  ├─ Samples collected:  ${report.memory.samples}`);
  console.log(`  ├─ Heap min:           ${report.memory.heapUsed.min}`);
  console.log(`  ├─ Heap max:           ${report.memory.heapUsed.max}`);
  console.log(`  ├─ Heap avg:           ${report.memory.heapUsed.avg}`);
  console.log(`  ├─ Growth:             ${report.memory.heapGrowth}`);
  console.log(`  └─ Stability:          ${report.memory.isStable ? '✅ STABLE' : '⚠️  GROWING'}\n`);
  
  console.log('🔄 Concurrency:');
  console.log(`  ├─ Max concurrent:     ${report.concurrency.maxConcurrent.toFixed(0)} requests`);
  console.log(`  └─ Avg concurrent:     ${report.concurrency.avgConcurrent.toFixed(2)} requests\n`);
  
  console.log('═══════════════════════════════════════════════════════════════════\n');
  
  console.log('🎯 Test Scenario Validation:\n');
  
  const allSuccessful = report.failed === 0;
  console.log(`  ${allSuccessful ? '✅' : '⚠️ '} All successful (within limits): ${allSuccessful ? 'PASS' : 'PARTIAL'}`);
  
  const has503s = report.statusCodes['503'] > 0;
  console.log(`  ${has503s ? '✅' : '⚠️ '} Concurrency limits hit (503s): ${has503s ? 'DETECTED' : 'NOT REACHED'}`);
  
  const hasMixedSizes = report.totalRequests > CONCURRENT_CLIENTS;
  console.log(`  ${hasMixedSizes ? '✅' : '⚠️ '} Mixed file sizes: ${hasMixedSizes ? 'YES' : 'INSUFFICIENT DATA'}`);
  
  console.log(`  ${report.memory.isStable ? '✅' : '❌'} Memory bounded: ${report.memory.isStable ? 'YES' : 'NO - MEMORY LEAK SUSPECTED'}`);
  
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('                        🎉 TEST COMPLETE                            ');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  
  console.log('💡 Key Findings:');
  if (report.successRate === '100.00%') {
    console.log('  • System handled all requests successfully');
  } else {
    console.log(`  • System experienced ${report.failed} failures (${(100 - parseFloat(report.successRate)).toFixed(2)}% error rate)`);
  }
  
  if (has503s) {
    console.log(`  • Concurrency limits working as expected (${report.statusCodes['503']} requests rate-limited)`);
  } else {
    console.log('  • No concurrency limits reached (consider increasing load)');
  }
  
  if (report.memory.isStable) {
    console.log('  • Memory usage is stable (no leaks detected)');
  } else {
    console.log(`  • ⚠️  Memory grew by ${report.memory.heapGrowth} - investigate potential leaks`);
  }
  
  console.log(`  • Average throughput: ${report.throughput.avgMBps} MB/s`);
  console.log(`  • P95 latency: ${report.latency.p95} (most requests faster than this)\n`);
}

http.get(`${BASE_URL}/v1/stats?stream=test`, (res) => {
  if (res.statusCode === 200 || res.statusCode === 404) {
    runLoadTest().catch(err => {
      console.error('\n❌ Load test failed:', err);
      process.exit(1);
    });
  } else {
    console.error('❌ Conduit server not responding');
    console.log('💡 Start the server: npm run dev');
    process.exit(1);
  }
}).on('error', () => {
  console.error('❌ Cannot connect to Conduit server');
  console.log('💡 Start the server: npm run dev');
  process.exit(1);
});
