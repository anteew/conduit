import { startServer, stopServer, httpPost } from './harness.js';
function calculateStats(latencies) {
    const sorted = [...latencies].sort((a, b) => a - b);
    const n = sorted.length;
    const min = sorted[0];
    const max = sorted[n - 1];
    const mean = sorted.reduce((a, b) => a + b, 0) / n;
    const median = n % 2 === 0
        ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
        : sorted[Math.floor(n / 2)];
    const p95 = sorted[Math.floor(n * 0.95)];
    const p99 = sorted[Math.floor(n * 0.99)];
    const histogram = {
        '<1ms': 0, '1-5ms': 0, '5-10ms': 0, '10-20ms': 0,
        '20-50ms': 0, '50-100ms': 0, '>100ms': 0
    };
    for (const lat of latencies) {
        if (lat < 1)
            histogram['<1ms']++;
        else if (lat < 5)
            histogram['1-5ms']++;
        else if (lat < 10)
            histogram['5-10ms']++;
        else if (lat < 20)
            histogram['10-20ms']++;
        else if (lat < 50)
            histogram['20-50ms']++;
        else if (lat < 100)
            histogram['50-100ms']++;
        else
            histogram['>100ms']++;
    }
    return { min, max, mean, median, p95, p99, histogram };
}
async function runLoadTest(name, concurrency, totalRequests, durationSec) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`TEST: ${name}`);
    console.log(`Concurrency: ${concurrency}, Total Requests: ${totalRequests}`);
    console.log('='.repeat(60));
    const srv = await startServer({ CONDUIT_RULES: 'config/rules.yaml' });
    const latencies = [];
    let completed = 0;
    const startTime = Date.now();
    async function makeRequest(id) {
        const reqStart = process.hrtime.bigint();
        await httpPost('http://127.0.0.1:9087/v1/enqueue', {
            to: 'agents/Perf/inbox',
            envelope: {
                id: 'e-' + id,
                ts: new Date().toISOString(),
                type: 'notify',
                payload: { i: id }
            }
        });
        const reqEnd = process.hrtime.bigint();
        const latencyMs = Number(reqEnd - reqStart) / 1_000_000;
        latencies.push(latencyMs);
        completed++;
    }
    if (durationSec) {
        const endTime = Date.now() + durationSec * 1000;
        let reqId = 0;
        const workers = [];
        for (let w = 0; w < concurrency; w++) {
            workers.push((async () => {
                while (Date.now() < endTime) {
                    await makeRequest(reqId++);
                }
            })());
        }
        await Promise.all(workers);
    }
    else {
        for (let batch = 0; batch < totalRequests; batch += concurrency) {
            const batchSize = Math.min(concurrency, totalRequests - batch);
            const promises = [];
            for (let i = 0; i < batchSize; i++) {
                promises.push(makeRequest(batch + i));
            }
            await Promise.all(promises);
        }
    }
    const totalTime = Date.now() - startTime;
    const stats = calculateStats(latencies);
    const throughput = (completed / totalTime) * 1000;
    console.log('\n📊 LATENCY STATISTICS:');
    console.log(`  Min:       ${stats.min.toFixed(3)} ms`);
    console.log(`  Mean:      ${stats.mean.toFixed(3)} ms`);
    console.log(`  Median:    ${stats.median.toFixed(3)} ms (p50)`);
    console.log(`  p95:       ${stats.p95.toFixed(3)} ms`);
    console.log(`  p99:       ${stats.p99.toFixed(3)} ms`);
    console.log(`  Max:       ${stats.max.toFixed(3)} ms`);
    console.log('\n📈 HISTOGRAM:');
    for (const [bucket, count] of Object.entries(stats.histogram)) {
        const bar = '█'.repeat(Math.floor((count / completed) * 50));
        const pct = ((count / completed) * 100).toFixed(1);
        console.log(`  ${bucket.padEnd(10)} ${bar} ${count} (${pct}%)`);
    }
    console.log('\n⚡ THROUGHPUT:');
    console.log(`  Total:     ${completed} requests`);
    console.log(`  Duration:  ${(totalTime / 1000).toFixed(2)} sec`);
    console.log(`  Rate:      ${throughput.toFixed(2)} req/sec`);
    console.log(`  Avg/req:   ${(totalTime / completed).toFixed(3)} ms`);
    console.log('\n✅ TARGET VALIDATION:');
    const target = 10;
    const passes = stats.p95 < target;
    console.log(`  p95 < ${target}ms: ${passes ? '✓ PASS' : '✗ FAIL'} (${stats.p95.toFixed(3)} ms)`);
    await stopServer(srv);
}
async function sequentialTest() {
    console.log(`\n${'='.repeat(60)}`);
    console.log('TEST: Sequential Baseline (no concurrency)');
    console.log('='.repeat(60));
    const N = 100;
    const srv = await startServer({ CONDUIT_RULES: 'config/rules.yaml' });
    const latencies = [];
    const startTime = Date.now();
    for (let i = 0; i < N; i++) {
        const reqStart = process.hrtime.bigint();
        await httpPost('http://127.0.0.1:9087/v1/enqueue', {
            to: 'agents/Perf/inbox',
            envelope: {
                id: 'e-seq-' + i,
                ts: new Date().toISOString(),
                type: 'notify',
                payload: { i }
            }
        });
        const reqEnd = process.hrtime.bigint();
        latencies.push(Number(reqEnd - reqStart) / 1_000_000);
    }
    const totalTime = Date.now() - startTime;
    const stats = calculateStats(latencies);
    console.log('\n📊 SEQUENTIAL LATENCY:');
    console.log(`  Min:       ${stats.min.toFixed(3)} ms`);
    console.log(`  Mean:      ${stats.mean.toFixed(3)} ms`);
    console.log(`  Median:    ${stats.median.toFixed(3)} ms`);
    console.log(`  p95:       ${stats.p95.toFixed(3)} ms`);
    console.log(`  p99:       ${stats.p99.toFixed(3)} ms`);
    console.log(`  Max:       ${stats.max.toFixed(3)} ms`);
    console.log(`\n  Total:     ${N} requests`);
    console.log(`  Duration:  ${(totalTime / 1000).toFixed(2)} sec`);
    console.log(`  Rate:      ${((N / totalTime) * 1000).toFixed(2)} req/sec`);
    await stopServer(srv);
}
(async () => {
    console.log('\n🚀 COURIER LATENCY BENCHMARK SUITE');
    console.log('Target: p95 < 10ms for small messages\n');
    await sequentialTest();
    await runLoadTest('Low Load (Baseline)', 1, 1000);
    await runLoadTest('Medium Load', 10, 2000);
    await runLoadTest('High Load', 50, 5000);
    await runLoadTest('Sustained Load (60sec)', 10, Infinity, 60);
    console.log('\n' + '='.repeat(60));
    console.log('✨ BENCHMARK COMPLETE');
    console.log('='.repeat(60) + '\n');
})();
