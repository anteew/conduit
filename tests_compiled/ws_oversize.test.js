// T7112: WebSocket Oversize Message Tests
// Tests that oversize messages are properly mapped to 1009 Message Too Big
import WebSocket from 'ws';
import assert from 'assert';
import { spawn } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const TEST_PORT = 9088;
const TEST_HOST = '127.0.0.1';
const SETUP_DELAY = 1500;
const MAX_SIZE = 1048576; // 1MB
let serverProcess = null;
async function startServer() {
    return new Promise((resolve) => {
        const env = {
            ...process.env,
            CONDUIT_CODECS_WS: 'true',
            CONDUIT_WS_MAX_MESSAGE_SIZE: MAX_SIZE.toString(),
            NODE_ENV: 'test'
        };
        serverProcess = spawn('node', ['dist/server.js'], {
            env,
            stdio: ['ignore', 'ignore', 'ignore']
        });
        setTimeout(() => resolve(serverProcess), SETUP_DELAY);
    });
}
async function stopServer() {
    if (serverProcess) {
        serverProcess.kill();
        serverProcess = null;
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
}
function connectAndWaitOpen(url) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        ws.on('open', () => resolve(ws));
        ws.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });
}
// Test 1: JSON oversize message → 1009
console.log('[T7112-Oversize-1] Testing JSON oversize message...');
{
    await startServer();
    try {
        const ws = await connectAndWaitOpen(`ws://${TEST_HOST}:${TEST_PORT}/v1/subscribe?stream=test-oversize-json&codec=json`);
        let errorReceived = false;
        let closeCode = null;
        ws.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.error) {
                console.log(`  Error code: ${msg.error.code}`);
                console.log(`  Error message: ${msg.error.message}`);
                assert.strictEqual(msg.error.code, 'MessageTooLarge', 'Should get MessageTooLarge error');
                errorReceived = true;
            }
        });
        ws.on('close', (code, reason) => {
            closeCode = code;
            console.log(`  Close code: ${code}`);
        });
        // Send oversized message (2MB > 1MB limit)
        const hugePayload = JSON.stringify({
            data: 'x'.repeat(2 * 1024 * 1024),
            credit: 1
        });
        console.log(`  Sending ${(hugePayload.length / 1024 / 1024).toFixed(2)} MB message`);
        ws.send(hugePayload);
        await new Promise((resolve) => setTimeout(resolve, 500));
        assert(errorReceived, 'Should receive MessageTooLarge error frame');
        assert.strictEqual(closeCode, 1009, 'Should close with 1009 Message Too Big');
        console.log('✓ JSON oversize correctly returns 1009\n');
    }
    catch (err) {
        console.error('✗ Failed:', err.message);
        process.exit(1);
    }
    finally {
        await stopServer();
    }
}
// Test 2: MessagePack oversize message → 1009
console.log('[T7112-Oversize-2] Testing MessagePack oversize message...');
{
    await startServer();
    try {
        const msgpackr = require('msgpackr');
        const ws = await connectAndWaitOpen(`ws://${TEST_HOST}:${TEST_PORT}/v1/subscribe?stream=test-oversize-msgpack&codec=msgpack`);
        let errorReceived = false;
        let closeCode = null;
        ws.on('message', (data) => {
            const msg = msgpackr.unpack(Buffer.from(data));
            if (msg.error) {
                console.log(`  Error code: ${msg.error.code}`);
                console.log(`  Error message: ${msg.error.message}`);
                assert.strictEqual(msg.error.code, 'MessageTooLarge', 'Should get MessageTooLarge error');
                errorReceived = true;
            }
        });
        ws.on('close', (code, reason) => {
            closeCode = code;
            console.log(`  Close code: ${code}`);
        });
        // Send oversized MessagePack message
        const hugeData = {
            data: 'x'.repeat(2 * 1024 * 1024),
            credit: 1
        };
        const encoded = msgpackr.pack(hugeData);
        console.log(`  Sending ${(encoded.length / 1024 / 1024).toFixed(2)} MB message`);
        ws.send(encoded);
        await new Promise((resolve) => setTimeout(resolve, 500));
        assert(errorReceived, 'Should receive MessageTooLarge error frame');
        assert.strictEqual(closeCode, 1009, 'Should close with 1009 Message Too Big');
        console.log('✓ MessagePack oversize correctly returns 1009\n');
    }
    catch (err) {
        if (err.message.includes('Cannot find module')) {
            console.log('⊘ Skipped (msgpackr not available)\n');
        }
        else {
            console.error('✗ Failed:', err.message);
            process.exit(1);
        }
    }
    finally {
        await stopServer();
    }
}
// Test 3: Message just under limit should succeed
console.log('[T7112-Oversize-3] Testing message just under limit...');
{
    await startServer();
    try {
        const ws = await connectAndWaitOpen(`ws://${TEST_HOST}:${TEST_PORT}/v1/subscribe?stream=test-under-limit&codec=json`);
        let errorReceived = false;
        ws.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.error) {
                console.log(`  Unexpected error: ${JSON.stringify(msg.error)}`);
                errorReceived = true;
            }
        });
        // Send message just under 1MB limit (950KB)
        const payload = JSON.stringify({
            data: 'x'.repeat(950 * 1024),
            credit: 1
        });
        console.log(`  Sending ${(payload.length / 1024).toFixed(2)} KB message`);
        ws.send(payload);
        await new Promise((resolve) => setTimeout(resolve, 500));
        assert(!errorReceived, 'Should NOT receive error for message under limit');
        ws.close();
        console.log('✓ Message under limit accepted successfully\n');
    }
    catch (err) {
        console.error('✗ Failed:', err.message);
        process.exit(1);
    }
    finally {
        await stopServer();
    }
}
console.log('[T7112-Oversize] All oversize tests passed! ✓');
process.exit(0);
