/**
 * T7120: Codec Safety Test
 *
 * Tests decoded payload size and depth caps for both HTTP and WebSocket.
 * Requires CONDUIT_CODECS_HTTP=true and CONDUIT_CODECS_WS=true.
 */
import { spawn } from 'child_process';
import * as http from 'http';
import WebSocket from 'ws';
const PORT = 9087;
const WS_PORT = 9088;
let serverProc = null;
function startServer() {
    return new Promise((resolve, reject) => {
        console.log('[T7120] Starting server with codec flags...');
        serverProc = spawn('node', ['dist/index.js'], {
            env: {
                ...process.env,
                CONDUIT_CODECS_HTTP: 'true',
                CONDUIT_CODECS_WS: 'true',
                CONDUIT_CODEC_MAX_DECODED_SIZE: '1024',
                CONDUIT_CODEC_MAX_DEPTH: '5',
                PORT: String(PORT),
                WS_PORT: String(WS_PORT)
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let output = '';
        serverProc.stdout?.on('data', (data) => {
            output += data.toString();
            if (output.includes('HTTP server listening') && output.includes('WebSocket server listening')) {
                setTimeout(() => resolve(), 500);
            }
        });
        serverProc.stderr?.on('data', (data) => {
            console.error('[Server]', data.toString());
        });
        serverProc.on('error', reject);
        setTimeout(() => reject(new Error('Server start timeout')), 10000);
    });
}
function stopServer() {
    return new Promise((resolve) => {
        if (!serverProc) {
            resolve();
            return;
        }
        serverProc.on('exit', () => {
            serverProc = null;
            resolve();
        });
        serverProc.kill('SIGTERM');
        setTimeout(() => {
            if (serverProc) {
                serverProc.kill('SIGKILL');
            }
        }, 2000);
    });
}
function httpPost(path, payload, contentType = 'application/json') {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(payload);
        const options = {
            hostname: '127.0.0.1',
            port: PORT,
            path,
            method: 'POST',
            headers: {
                'Content-Type': contentType,
                'Content-Length': Buffer.byteLength(data)
            }
        };
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode || 0, body: JSON.parse(body) });
                }
                catch {
                    resolve({ status: res.statusCode || 0, body });
                }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}
function createDeepObject(depth) {
    if (depth === 0)
        return 'leaf';
    return { child: createDeepObject(depth - 1) };
}
function createLargeObject(sizeBytes) {
    const baseObj = { data: [] };
    const targetSize = Math.floor(sizeBytes / 10);
    for (let i = 0; i < targetSize; i++) {
        baseObj.data.push('x');
    }
    return baseObj;
}
async function testHttpSizeCap() {
    console.log('[T7120:HTTP] Test 1: Decoded size cap violation');
    const largePayload = createLargeObject(2048);
    const result = await httpPost('/v1/enqueue', { to: 'test', envelope: largePayload });
    if (result.status === 400 && result.body.details === 'decoded_size_exceeded') {
        console.log('✓ HTTP size cap violation returns 400');
    }
    else {
        console.log(`✗ Expected 400 with decoded_size_exceeded, got ${result.status}: ${JSON.stringify(result.body)}`);
    }
}
async function testHttpDepthCap() {
    console.log('[T7120:HTTP] Test 2: Decoded depth cap violation');
    const deepPayload = { to: 'test', envelope: createDeepObject(8) };
    const result = await httpPost('/v1/enqueue', deepPayload);
    if (result.status === 400 && result.body.details === 'depth_exceeded') {
        console.log('✓ HTTP depth cap violation returns 400');
    }
    else {
        console.log(`✗ Expected 400 with depth_exceeded, got ${result.status}: ${JSON.stringify(result.body)}`);
    }
}
async function testHttpValidPayload() {
    console.log('[T7120:HTTP] Test 3: Valid payload within limits');
    const validPayload = { to: 'test/inbox', envelope: { msg: 'hello' } };
    const result = await httpPost('/v1/enqueue', validPayload);
    if (result.status === 200) {
        console.log('✓ Valid HTTP payload succeeds');
    }
    else {
        console.log(`✗ Expected 200 for valid payload, got ${result.status}: ${JSON.stringify(result.body)}`);
    }
}
async function testWsSizeCap() {
    return new Promise((resolve) => {
        console.log('[T7120:WS] Test 4: WebSocket decoded size cap violation');
        const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}/v1/subscribe?stream=test&codec=json`);
        let closeReceived = false;
        ws.on('open', () => {
            const largePayload = createLargeObject(2048);
            ws.send(JSON.stringify({ credit: 10, data: largePayload }));
        });
        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.error && msg.error.code === 'DecodedSizeExceeded') {
                    console.log('✓ WS size cap violation sends error frame');
                }
            }
            catch { }
        });
        ws.on('close', (code, reason) => {
            closeReceived = true;
            if (code === 1007) {
                console.log('✓ WS size cap violation closes with 1007');
            }
            else {
                console.log(`✗ Expected close code 1007, got ${code}: ${reason}`);
            }
            resolve();
        });
        setTimeout(() => {
            if (!closeReceived) {
                console.log('✗ WS did not close for size cap violation');
                ws.close();
            }
            resolve();
        }, 2000);
    });
}
async function testWsDepthCap() {
    return new Promise((resolve) => {
        console.log('[T7120:WS] Test 5: WebSocket decoded depth cap violation');
        const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}/v1/subscribe?stream=test&codec=json`);
        let closeReceived = false;
        ws.on('open', () => {
            const deepPayload = createDeepObject(8);
            ws.send(JSON.stringify({ credit: 10, data: deepPayload }));
        });
        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.error && msg.error.code === 'DepthExceeded') {
                    console.log('✓ WS depth cap violation sends error frame');
                }
            }
            catch { }
        });
        ws.on('close', (code, reason) => {
            closeReceived = true;
            if (code === 1007) {
                console.log('✓ WS depth cap violation closes with 1007');
            }
            else {
                console.log(`✗ Expected close code 1007, got ${code}: ${reason}`);
            }
            resolve();
        });
        setTimeout(() => {
            if (!closeReceived) {
                console.log('✗ WS did not close for depth cap violation');
                ws.close();
            }
            resolve();
        }, 2000);
    });
}
async function testWsValidPayload() {
    return new Promise((resolve) => {
        console.log('[T7120:WS] Test 6: Valid WebSocket payload within limits');
        const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}/v1/subscribe?stream=test&codec=json`);
        let creditReceived = false;
        ws.on('open', () => {
            ws.send(JSON.stringify({ credit: 5 }));
        });
        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.deliver) {
                    creditReceived = true;
                }
            }
            catch { }
        });
        setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
                console.log('✓ Valid WS payload accepted');
            }
            else {
                console.log('✗ WS closed unexpectedly for valid payload');
            }
            ws.close();
            resolve();
        }, 1000);
    });
}
async function testMetrics() {
    console.log('[T7120] Test 7: Check metrics for cap violations');
    return new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${PORT}/v1/metrics`, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    const metrics = JSON.parse(body);
                    if (metrics.http?.codecs?.sizeCapViolations) {
                        console.log('✓ HTTP sizeCapViolations metric present');
                    }
                    else {
                        console.log('✗ HTTP sizeCapViolations metric missing');
                    }
                    if (metrics.http?.codecs?.depthCapViolations) {
                        console.log('✓ HTTP depthCapViolations metric present');
                    }
                    else {
                        console.log('✗ HTTP depthCapViolations metric missing');
                    }
                    if (metrics.ws?.sizeCapViolations) {
                        console.log('✓ WS sizeCapViolations metric present');
                    }
                    else {
                        console.log('✗ WS sizeCapViolations metric missing');
                    }
                    if (metrics.ws?.depthCapViolations) {
                        console.log('✓ WS depthCapViolations metric present');
                    }
                    else {
                        console.log('✗ WS depthCapViolations metric missing');
                    }
                    resolve(null);
                }
                catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
    });
}
async function run() {
    try {
        console.log('='.repeat(60));
        console.log('T7120: Decoded Size and Depth Caps Safety Test');
        console.log('='.repeat(60));
        await startServer();
        await testHttpSizeCap();
        await testHttpDepthCap();
        await testHttpValidPayload();
        await testWsSizeCap();
        await testWsDepthCap();
        await testWsValidPayload();
        await testMetrics();
        console.log('='.repeat(60));
        console.log('T7120: All safety tests complete');
        console.log('='.repeat(60));
    }
    catch (err) {
        console.error('Test failed:', err.message);
        process.exit(1);
    }
    finally {
        await stopServer();
    }
}
run();
