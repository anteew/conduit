import { startServer, stopServer, httpPost } from './harness.js';
import { WebSocket } from 'ws';
function getMemoryUsageMB() {
    const usage = process.memoryUsage();
    return usage.heapUsed / 1024 / 1024;
}
function calculatePercentile(values, percentile) {
    if (values.length === 0)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.floor(sorted.length * percentile);
    return sorted[index];
}
async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
class ConcurrentWSTest {
    clients = [];
    deliveryLatencies = [];
    deliveryCount = 0;
    grantCount = 0;
    ackCount = 0;
    nackCount = 0;
    connectionErrors = 0;
    messageErrors = 0;
    timeouts = 0;
    memoryPeak = 0;
    memoryInitial = 0;
    memoryFinal = 0;
    async connectClient(clientId) {
        const startTime = Date.now();
        return new Promise((resolve) => {
            const stream = `test/load/${clientId}`;
            const ws = new WebSocket(`ws://127.0.0.1:9088/v1/subscribe?stream=${stream}`);
            let connected = false;
            const timeout = setTimeout(() => {
                if (!connected) {
                    this.timeouts++;
                    ws.close();
                    resolve({ success: false, time: Date.now() - startTime });
                }
            }, 5000);
            ws.on('open', () => {
                connected = true;
                clearTimeout(timeout);
                this.clients.push(ws);
                resolve({ success: true, time: Date.now() - startTime });
            });
            ws.on('error', (err) => {
                this.connectionErrors++;
                clearTimeout(timeout);
                if (!connected) {
                    resolve({ success: false, time: Date.now() - startTime });
                }
            });
            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(String(data));
                    if (msg.deliver) {
                        const latency = Date.now() - (msg.deliver.enqueueTime || Date.now());
                        this.deliveryLatencies.push(latency);
                        this.deliveryCount++;
                        // Randomly ack or nack
                        if (Math.random() > 0.1) {
                            ws.send(JSON.stringify({ ack: msg.deliver.id }));
                            this.ackCount++;
                        }
                        else {
                            ws.send(JSON.stringify({ nack: msg.deliver.id }));
                            this.nackCount++;
                        }
                    }
                }
                catch (err) {
                    this.messageErrors++;
                }
            });
        });
    }
    async enqueueMessages(count) {
        const promises = [];
        for (let i = 0; i < count; i++) {
            const clientId = Math.floor(Math.random() * 100);
            const stream = `test/load/${clientId}`;
            promises.push(httpPost('http://127.0.0.1:9087/v1/enqueue', {
                to: stream,
                envelope: {
                    id: `msg-${Date.now()}-${i}`,
                    ts: new Date().toISOString(),
                    type: 'test.load',
                    payload: { seq: i, data: 'x'.repeat(100) },
                    enqueueTime: Date.now()
                }
            }));
            // Small delay to avoid overwhelming the server
            if (i % 50 === 0) {
                await Promise.all(promises);
                promises.length = 0;
            }
        }
        if (promises.length > 0) {
            await Promise.all(promises);
        }
    }
    async grantCredits() {
        for (const ws of this.clients) {
            if (ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(JSON.stringify({ credit: 10 }));
                    this.grantCount++;
                }
                catch (err) {
                    this.messageErrors++;
                }
            }
        }
    }
    async cleanup() {
        for (const ws of this.clients) {
            try {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.close();
                }
            }
            catch (err) {
                // Ignore cleanup errors
            }
        }
        this.clients = [];
    }
    async run() {
        console.log('\n🚀 T4061: Concurrent WebSocket Load Test');
        console.log('='.repeat(70));
        console.log('Target: 100 concurrent WebSocket clients');
        console.log('Duration: ~60 seconds');
        console.log('='.repeat(70));
        this.memoryInitial = getMemoryUsageMB();
        this.memoryPeak = this.memoryInitial;
        const srv = await startServer({ CONDUIT_RULES: 'config/rules.yaml' });
        const testStartTime = Date.now();
        try {
            // Phase 1: Connect 100 clients
            console.log('\n📡 Phase 1: Establishing 100 concurrent connections...');
            const connectionStart = Date.now();
            const connectionPromises = [];
            for (let i = 0; i < 100; i++) {
                connectionPromises.push(this.connectClient(i));
                // Stagger connections slightly to be realistic
                if (i % 10 === 0) {
                    await sleep(50);
                }
            }
            const connectionResults = await Promise.all(connectionPromises);
            const connectionDuration = (Date.now() - connectionStart) / 1000;
            const successfulConnections = connectionResults.filter(r => r.success).length;
            const failedConnections = connectionResults.filter(r => !r.success).length;
            const connectionRate = successfulConnections / connectionDuration;
            console.log(`✓ Connected: ${successfulConnections}/${connectionResults.length}`);
            console.log(`✓ Connection rate: ${connectionRate.toFixed(2)} conn/sec`);
            console.log(`✗ Failed: ${failedConnections}`);
            if (successfulConnections < 90) {
                throw new Error(`Only ${successfulConnections}/100 connections succeeded`);
            }
            // Phase 2: Grant initial credits
            console.log('\n💳 Phase 2: Granting initial credits...');
            await sleep(200);
            await this.grantCredits();
            console.log('✓ Granted initial credits to all clients');
            // Phase 3: Enqueue messages
            console.log('\n📨 Phase 3: Enqueuing messages...');
            await this.enqueueMessages(500);
            console.log('✓ Enqueued 500 messages across streams');
            // Phase 4: Run for ~60 seconds
            console.log('\n⏱️  Phase 4: Running load test (60 seconds)...');
            const endTime = Date.now() + 60000;
            let iteration = 0;
            while (Date.now() < endTime) {
                // Grant credits periodically
                await this.grantCredits();
                // Enqueue more messages
                if (iteration % 5 === 0) {
                    await this.enqueueMessages(100);
                }
                // Track memory
                const currentMemory = getMemoryUsageMB();
                if (currentMemory > this.memoryPeak) {
                    this.memoryPeak = currentMemory;
                }
                // Progress indicator
                const elapsed = Date.now() - testStartTime;
                const remaining = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
                if (iteration % 10 === 0) {
                    process.stdout.write(`\r  Progress: ${Math.floor((elapsed / 60000) * 100)}% | Remaining: ${remaining}s | Deliveries: ${this.deliveryCount} | Memory: ${currentMemory.toFixed(1)}MB`);
                }
                await sleep(1000);
                iteration++;
            }
            console.log('\n');
            // Final measurements
            this.memoryFinal = getMemoryUsageMB();
            const totalDuration = (Date.now() - testStartTime) / 1000;
            // Generate report
            const report = {
                connections: {
                    connectionRate,
                    successfulConnections,
                    failedConnections,
                    totalAttempts: connectionResults.length
                },
                messages: {
                    totalDeliveries: this.deliveryCount,
                    totalGrants: this.grantCount,
                    totalAcks: this.ackCount,
                    totalNacks: this.nackCount,
                    messagesPerSec: this.deliveryCount / totalDuration,
                    avgDeliveryLatency: this.deliveryLatencies.length > 0
                        ? this.deliveryLatencies.reduce((a, b) => a + b, 0) / this.deliveryLatencies.length
                        : 0,
                    p95DeliveryLatency: calculatePercentile(this.deliveryLatencies, 0.95)
                },
                memory: {
                    initialMB: this.memoryInitial,
                    finalMB: this.memoryFinal,
                    peakMB: this.memoryPeak,
                    growthMB: this.memoryFinal - this.memoryInitial
                },
                errors: {
                    connectionErrors: this.connectionErrors,
                    messageErrors: this.messageErrors,
                    timeouts: this.timeouts,
                    errorRate: ((this.connectionErrors + this.messageErrors + this.timeouts) /
                        (successfulConnections + this.deliveryCount)) * 100
                },
                duration: totalDuration,
                passed: true
            };
            // Validation
            if (successfulConnections < 95) {
                report.passed = false;
                console.log('✗ FAIL: Less than 95% connection success rate');
            }
            if (report.messages.messagesPerSec < 5) {
                report.passed = false;
                console.log('✗ FAIL: Message throughput too low');
            }
            if (report.memory.growthMB > 200) {
                report.passed = false;
                console.log('✗ FAIL: Excessive memory growth (>200MB)');
            }
            if (report.errors.errorRate > 5) {
                report.passed = false;
                console.log('✗ FAIL: Error rate exceeds 5%');
            }
            return report;
        }
        finally {
            await this.cleanup();
            await stopServer(srv);
        }
    }
    printReport(report) {
        console.log('\n' + '='.repeat(70));
        console.log('📊 LOAD TEST REPORT');
        console.log('='.repeat(70));
        console.log('\n🔌 CONNECTION METRICS:');
        console.log(`  Successful:        ${report.connections.successfulConnections}/${report.connections.totalAttempts}`);
        console.log(`  Failed:            ${report.connections.failedConnections}`);
        console.log(`  Connection Rate:   ${report.connections.connectionRate.toFixed(2)} conn/sec`);
        console.log(`  Success Rate:      ${((report.connections.successfulConnections / report.connections.totalAttempts) * 100).toFixed(1)}%`);
        console.log('\n📬 MESSAGE METRICS:');
        console.log(`  Total Deliveries:  ${report.messages.totalDeliveries}`);
        console.log(`  Total Grants:      ${report.messages.totalGrants}`);
        console.log(`  Total Acks:        ${report.messages.totalAcks}`);
        console.log(`  Total Nacks:       ${report.messages.totalNacks}`);
        console.log(`  Throughput:        ${report.messages.messagesPerSec.toFixed(2)} msg/sec`);
        console.log(`  Avg Latency:       ${report.messages.avgDeliveryLatency.toFixed(2)} ms`);
        console.log(`  p95 Latency:       ${report.messages.p95DeliveryLatency.toFixed(2)} ms`);
        console.log('\n💾 MEMORY METRICS:');
        console.log(`  Initial:           ${report.memory.initialMB.toFixed(2)} MB`);
        console.log(`  Final:             ${report.memory.finalMB.toFixed(2)} MB`);
        console.log(`  Peak:              ${report.memory.peakMB.toFixed(2)} MB`);
        console.log(`  Growth:            ${report.memory.growthMB.toFixed(2)} MB`);
        console.log('\n⚠️  ERROR METRICS:');
        console.log(`  Connection Errors: ${report.errors.connectionErrors}`);
        console.log(`  Message Errors:    ${report.errors.messageErrors}`);
        console.log(`  Timeouts:          ${report.errors.timeouts}`);
        console.log(`  Error Rate:        ${report.errors.errorRate.toFixed(2)}%`);
        console.log('\n⏱️  DURATION:');
        console.log(`  Total:             ${report.duration.toFixed(2)} sec`);
        console.log('\n✅ VALIDATION:');
        console.log(`  Connection Rate:   ${report.connections.successfulConnections >= 95 ? '✓ PASS' : '✗ FAIL'} (${report.connections.successfulConnections}/100)`);
        console.log(`  Message Throughput: ${report.messages.messagesPerSec >= 5 ? '✓ PASS' : '✗ FAIL'} (${report.messages.messagesPerSec.toFixed(2)} msg/sec >= 5)`);
        console.log(`  Memory Bounded:    ${report.memory.growthMB <= 200 ? '✓ PASS' : '✗ FAIL'} (${report.memory.growthMB.toFixed(2)} MB <= 200 MB)`);
        console.log(`  Error Rate:        ${report.errors.errorRate <= 5 ? '✓ PASS' : '✗ FAIL'} (${report.errors.errorRate.toFixed(2)}% <= 5%)`);
        console.log('\n' + '='.repeat(70));
        if (report.passed) {
            console.log('✅ LOAD TEST PASSED');
        }
        else {
            console.log('❌ LOAD TEST FAILED');
        }
        console.log('='.repeat(70) + '\n');
    }
}
// Run the test
(async () => {
    try {
        const test = new ConcurrentWSTest();
        const report = await test.run();
        test.printReport(report);
        if (!report.passed) {
            process.exit(1);
        }
    }
    catch (err) {
        console.error('\n❌ Fatal error:', err);
        process.exit(1);
    }
})();
