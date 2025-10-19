import { startServer, stopServer, httpPost, httpGet } from './harness.js';
import { WebSocket } from 'ws';
import * as http from 'http';
const DURATION_MIN = Number(process.env.CONDUIT_SOAK_DURATION_MIN || 15);
const DURATION_MS = DURATION_MIN * 60 * 1000;
const REPORT_INTERVAL_MS = 30 * 1000;
const metrics = {
    httpRequests: 0,
    wsMessages: 0,
    uploads: 0,
    activeWsConnections: 0,
    errors: {},
    startTime: Date.now(),
    lastReportTime: Date.now()
};
const memorySnapshots = [];
function recordError(type) {
    metrics.errors[type] = (metrics.errors[type] || 0) + 1;
}
function captureMemory() {
    const mem = process.memoryUsage();
    const snapshot = {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
        timestamp: Date.now()
    };
    memorySnapshots.push(snapshot);
    return snapshot;
}
function formatBytes(bytes) {
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}
function reportMetrics() {
    const now = Date.now();
    const elapsed = (now - metrics.startTime) / 1000;
    const intervalSec = (now - metrics.lastReportTime) / 1000;
    const mem = captureMemory();
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`📊 SOAK TEST REPORT — ${(elapsed / 60).toFixed(1)} min elapsed`);
    console.log('─'.repeat(70));
    console.log('\n🔄 THROUGHPUT (interval):');
    const httpRate = (metrics.httpRequests / intervalSec).toFixed(1);
    const wsRate = (metrics.wsMessages / intervalSec).toFixed(1);
    const uploadRate = (metrics.uploads / intervalSec).toFixed(1);
    console.log(`  HTTP requests:  ${httpRate.padStart(8)} req/s`);
    console.log(`  WS messages:    ${wsRate.padStart(8)} msg/s`);
    console.log(`  Uploads:        ${uploadRate.padStart(8)} upload/s`);
    console.log('\n📈 CUMULATIVE:');
    console.log(`  HTTP requests:  ${metrics.httpRequests.toString().padStart(8)}`);
    console.log(`  WS messages:    ${metrics.wsMessages.toString().padStart(8)}`);
    console.log(`  Uploads:        ${metrics.uploads.toString().padStart(8)}`);
    console.log(`  Active WS:      ${metrics.activeWsConnections.toString().padStart(8)}`);
    console.log('\n💾 MEMORY:');
    console.log(`  RSS:            ${formatBytes(mem.rss).padStart(12)}`);
    console.log(`  Heap Used:      ${formatBytes(mem.heapUsed).padStart(12)}`);
    console.log(`  Heap Total:     ${formatBytes(mem.heapTotal).padStart(12)}`);
    console.log(`  External:       ${formatBytes(mem.external).padStart(12)}`);
    if (Object.keys(metrics.errors).length > 0) {
        console.log('\n⚠️  ERRORS:');
        for (const [type, count] of Object.entries(metrics.errors)) {
            console.log(`  ${type.padEnd(20)} ${count.toString().padStart(6)}`);
        }
    }
    else {
        console.log('\n✅ No errors recorded');
    }
    metrics.lastReportTime = now;
}
function analyzeMemoryTrend() {
    if (memorySnapshots.length < 3) {
        return { trend: 'insufficient data', growth: 0, stable: true };
    }
    const first = memorySnapshots[0];
    const last = memorySnapshots[memorySnapshots.length - 1];
    const growth = ((last.heapUsed - first.heapUsed) / first.heapUsed) * 100;
    // Check for monotonic increase (potential leak)
    let increases = 0;
    for (let i = 1; i < memorySnapshots.length; i++) {
        if (memorySnapshots[i].heapUsed > memorySnapshots[i - 1].heapUsed) {
            increases++;
        }
    }
    const increaseRatio = increases / (memorySnapshots.length - 1);
    // For short tests (<5 min), be more lenient with growth as GC may not have run
    const isShortTest = DURATION_MIN < 5;
    const growthThreshold = isShortTest ? 100 : 10;
    const stable = Math.abs(growth) < growthThreshold || increaseRatio < 0.7;
    let trend = 'stable';
    if (growth > growthThreshold * 2.5)
        trend = 'leaking';
    else if (growth > growthThreshold)
        trend = 'growing';
    else if (growth < -10)
        trend = 'decreasing';
    return { trend, growth, stable };
}
async function httpClient(id, endTime) {
    let reqCount = 0;
    while (Date.now() < endTime) {
        try {
            // Alternate between enqueue and stats
            if (reqCount % 2 === 0) {
                await httpPost('http://127.0.0.1:9087/v1/enqueue', {
                    to: `agents/Soak${id}/inbox`,
                    envelope: {
                        id: `soak-http-${id}-${reqCount}`,
                        ts: new Date().toISOString(),
                        type: 'notify',
                        payload: { client: id, seq: reqCount }
                    }
                });
            }
            else {
                await httpGet('http://127.0.0.1:9087/v1/stats');
            }
            metrics.httpRequests++;
            reqCount++;
            // Small delay to avoid overwhelming
            await new Promise(r => setTimeout(r, Math.random() * 100));
        }
        catch (err) {
            recordError('http_client');
        }
    }
}
async function wsClient(id, endTime) {
    return new Promise((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:9088/v1/subscribe?stream=agents/SoakWS${id}/inbox`);
        let msgCount = 0;
        let creditTimer;
        ws.on('open', () => {
            metrics.activeWsConnections++;
            // Grant initial credit
            ws.send(JSON.stringify({ credit: 10 }));
            // Periodically grant more credit
            creditTimer = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN && Date.now() < endTime) {
                    ws.send(JSON.stringify({ credit: 5 }));
                }
                else if (Date.now() >= endTime) {
                    clearInterval(creditTimer);
                    ws.close();
                }
            }, 1000);
            // Simulate receiving messages by enqueueing to ourselves
            const enqueueLoop = async () => {
                while (Date.now() < endTime && ws.readyState === WebSocket.OPEN) {
                    try {
                        await httpPost('http://127.0.0.1:9087/v1/enqueue', {
                            to: `agents/SoakWS${id}/inbox`,
                            envelope: {
                                id: `soak-ws-${id}-${msgCount}`,
                                ts: new Date().toISOString(),
                                type: 'notify',
                                payload: { client: id, seq: msgCount }
                            }
                        });
                        msgCount++;
                        await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
                    }
                    catch {
                        recordError('ws_enqueue');
                    }
                }
            };
            enqueueLoop();
        });
        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(String(data));
                if (msg.deliver) {
                    metrics.wsMessages++;
                }
            }
            catch {
                recordError('ws_parse');
            }
        });
        ws.on('close', () => {
            if (metrics.activeWsConnections > 0) {
                metrics.activeWsConnections--;
            }
            clearInterval(creditTimer);
            resolve();
        });
        ws.on('error', (err) => {
            recordError('ws_error');
            if (metrics.activeWsConnections > 0) {
                metrics.activeWsConnections--;
            }
            clearInterval(creditTimer);
            resolve();
        });
    });
}
async function uploadClient(id, endTime) {
    let uploadCount = 0;
    while (Date.now() < endTime) {
        try {
            const size = 1024 * (10 + Math.floor(Math.random() * 90)); // 10-100 KB
            const buffer = Buffer.alloc(size, `upload-${id}-${uploadCount}-`);
            await new Promise((resolve, reject) => {
                const req = http.request({
                    hostname: '127.0.0.1',
                    port: 9087,
                    path: '/v1/upload',
                    method: 'POST',
                    headers: {
                        'content-type': 'application/octet-stream',
                        'content-length': buffer.length,
                        'x-upload-id': `soak-upload-${id}-${uploadCount}`
                    }
                }, (res) => {
                    let body = '';
                    res.on('data', (chunk) => body += chunk);
                    res.on('end', () => {
                        if (res.statusCode === 202 || res.statusCode === 200) {
                            metrics.uploads++;
                            resolve();
                        }
                        else {
                            recordError('upload_status');
                            resolve();
                        }
                    });
                });
                req.on('error', () => {
                    recordError('upload_error');
                    resolve();
                });
                req.write(buffer);
                req.end();
            });
            uploadCount++;
            // Delay between uploads
            await new Promise(r => setTimeout(r, 500 + Math.random() * 1500));
        }
        catch {
            recordError('upload_exception');
        }
    }
}
(async () => {
    console.log('\n╔════════════════════════════════════════════════════════════════════╗');
    console.log('║         T4062: 15-MINUTE SOAK TEST — MIXED LOAD                    ║');
    console.log('╚════════════════════════════════════════════════════════════════════╝\n');
    console.log('🎯 TEST CONFIGURATION:');
    console.log(`  Duration:           ${DURATION_MIN} minutes`);
    console.log(`  Report interval:    ${REPORT_INTERVAL_MS / 1000} seconds`);
    console.log(`  HTTP clients:       20 (enqueue + stats)`);
    console.log(`  WebSocket clients:  30 (subscribe + credit flow)`);
    console.log(`  Upload clients:     10 (multipart files 10-100KB)`);
    console.log('\n🚀 Starting server...\n');
    const srv = await startServer({
        CONDUIT_RULES: 'config/rules.yaml',
        CONDUIT_UPLOAD_DIR: 'uploads'
    });
    const endTime = Date.now() + DURATION_MS;
    // Initial memory baseline
    captureMemory();
    // Start periodic reporting
    const reportTimer = setInterval(() => {
        reportMetrics();
    }, REPORT_INTERVAL_MS);
    console.log('🏃 Launching clients...\n');
    // Launch all clients
    const clients = [];
    // 20 HTTP clients
    for (let i = 0; i < 20; i++) {
        clients.push(httpClient(i, endTime));
    }
    // 30 WebSocket clients
    for (let i = 0; i < 30; i++) {
        clients.push(wsClient(i, endTime));
    }
    // 10 Upload clients
    for (let i = 0; i < 10; i++) {
        clients.push(uploadClient(i, endTime));
    }
    console.log(`✅ ${clients.length} clients launched\n`);
    // Wait for all clients to complete
    await Promise.all(clients);
    clearInterval(reportTimer);
    // Final report
    reportMetrics();
    // Final summary
    const totalTime = (Date.now() - metrics.startTime) / 1000;
    const memAnalysis = analyzeMemoryTrend();
    console.log('\n╔════════════════════════════════════════════════════════════════════╗');
    console.log('║                      FINAL SUMMARY                                 ║');
    console.log('╚════════════════════════════════════════════════════════════════════╝\n');
    console.log('📊 TOTAL THROUGHPUT:');
    const totalRequests = metrics.httpRequests + metrics.wsMessages + metrics.uploads;
    console.log(`  Total requests:     ${totalRequests.toLocaleString()}`);
    console.log(`  HTTP requests:      ${metrics.httpRequests.toLocaleString()}`);
    console.log(`  WS messages:        ${metrics.wsMessages.toLocaleString()}`);
    console.log(`  Uploads:            ${metrics.uploads.toLocaleString()}`);
    console.log(`  Average rate:       ${(totalRequests / totalTime).toFixed(2)} req/s`);
    console.log('\n💾 MEMORY ANALYSIS:');
    if (memorySnapshots.length > 0) {
        const first = memorySnapshots[0];
        const last = memorySnapshots[memorySnapshots.length - 1];
        console.log(`  Initial heap:       ${formatBytes(first.heapUsed)}`);
        console.log(`  Final heap:         ${formatBytes(last.heapUsed)}`);
        console.log(`  Growth:             ${memAnalysis.growth.toFixed(1)}%`);
        console.log(`  Trend:              ${memAnalysis.trend.toUpperCase()}`);
        console.log(`  Stability:          ${memAnalysis.stable ? '✅ STABLE' : '⚠️  UNSTABLE'}`);
    }
    console.log('\n⚡ CONNECTION STABILITY:');
    console.log(`  Final active WS:    ${metrics.activeWsConnections}`);
    console.log(`  Status:             ${metrics.activeWsConnections === 0 ? '✅ Clean shutdown' : '⚠️  Lingering connections'}`);
    const totalErrors = Object.values(metrics.errors).reduce((a, b) => a + b, 0);
    const errorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
    console.log('\n🎯 ERROR SUMMARY:');
    console.log(`  Total errors:       ${totalErrors}`);
    console.log(`  Error rate:         ${errorRate.toFixed(3)}%`);
    console.log(`  Assessment:         ${errorRate < 0.1 ? '✅ EXCELLENT' : errorRate < 1 ? '✅ GOOD' : errorRate < 5 ? '⚠️  ACCEPTABLE' : '❌ POOR'}`);
    if (Object.keys(metrics.errors).length > 0) {
        console.log('\n  Error breakdown:');
        for (const [type, count] of Object.entries(metrics.errors)) {
            console.log(`    ${type.padEnd(20)} ${count.toString().padStart(6)}`);
        }
    }
    console.log('\n╔════════════════════════════════════════════════════════════════════╗');
    console.log('║                    STABILITY ASSESSMENT                            ║');
    console.log('╚════════════════════════════════════════════════════════════════════╝\n');
    let passCount = 0;
    let totalChecks = 4;
    console.log('✓ CHECKS:');
    const check1 = totalRequests > 1000;
    console.log(`  ${check1 ? '✅' : '❌'} Throughput:        ${check1 ? 'PASS' : 'FAIL'} (${totalRequests} requests, need >1000)`);
    if (check1)
        passCount++;
    const check2 = errorRate < 1;
    console.log(`  ${check2 ? '✅' : '❌'} Error rate:        ${check2 ? 'PASS' : 'FAIL'} (${errorRate.toFixed(3)}%, need <1%)`);
    if (check2)
        passCount++;
    const check3 = memAnalysis.stable;
    const memNote = DURATION_MIN < 5 ? ' (short test, lenient)' : '';
    console.log(`  ${check3 ? '✅' : '❌'} Memory stable:     ${check3 ? 'PASS' : 'FAIL'} (${memAnalysis.trend}, ${memAnalysis.growth.toFixed(1)}% growth)${memNote}`);
    if (check3)
        passCount++;
    const check4 = metrics.activeWsConnections === 0;
    console.log(`  ${check4 ? '✅' : '❌'} Clean shutdown:    ${check4 ? 'PASS' : 'FAIL'} (${metrics.activeWsConnections} lingering)`);
    if (check4)
        passCount++;
    const overallPass = passCount === totalChecks;
    console.log(`\n🏆 OVERALL RESULT: ${overallPass ? '✅ PASS' : `⚠️  PARTIAL (${passCount}/${totalChecks})`}`);
    if (!overallPass) {
        console.log('\n⚠️  RECOMMENDATIONS:');
        if (!check1)
            console.log('  • Investigate low throughput - check CPU/network constraints');
        if (!check2)
            console.log('  • Review error logs and add retry logic');
        if (!check3)
            console.log('  • Profile memory usage - possible leak detected');
        if (!check4)
            console.log('  • Check WebSocket cleanup - connections not closing properly');
    }
    console.log('\n' + '═'.repeat(70) + '\n');
    await stopServer(srv);
    process.exit(overallPass ? 0 : 1);
})();
