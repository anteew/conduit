// T7112: WebSocket Decode Error Mapping Tests
// Tests that codec decode errors are properly mapped to WebSocket close codes
import WebSocket from 'ws';
import assert from 'assert';
import { spawn } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const TEST_PORT = 9088;
const TEST_HOST = '127.0.0.1';
const SETUP_DELAY = 1500;
let serverProcess = null;
async function startServer() {
    return new Promise((resolve) => {
        const env = {
            ...process.env,
            CONDUIT_CODECS_WS: 'true',
            CONDUIT_WS_MAX_MESSAGE_SIZE: '1048576',
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
// Test 1: JSON decode error → 1007 Invalid Frame Payload
console.log('[T7112-1] Testing JSON decode error mapping...');
{
    await startServer();
    try {
        const ws = await connectAndWaitOpen(`ws://${TEST_HOST}:${TEST_PORT}/v1/subscribe?stream=test-json-decode&codec=json`);
        let errorReceived = false;
        let closeCode = null;
        ws.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.error) {
                console.log(`  Error frame: ${JSON.stringify(msg.error)}`);
                assert.strictEqual(msg.error.code, 'InvalidJSON', 'Should get InvalidJSON error code');
                errorReceived = true;
            }
        });
        ws.on('close', (code, reason) => {
            closeCode = code;
            console.log(`  Close code: ${code}, reason: ${reason.toString()}`);
        });
        // Send malformed JSON
        ws.send('{ invalid json ');
        await new Promise((resolve) => setTimeout(resolve, 500));
        assert(errorReceived, 'Should receive error frame');
        assert.strictEqual(closeCode, 1007, 'Should close with 1007 Invalid Frame Payload');
        console.log('✓ JSON decode error correctly mapped to 1007\n');
    }
    catch (err) {
        console.error('✗ Failed:', err.message);
        process.exit(1);
    }
    finally {
        await stopServer();
    }
}
// Test 2: MessagePack decode error → 1007 Invalid Frame Payload
console.log('[T7112-2] Testing MessagePack decode error mapping...');
{
    await startServer();
    try {
        const msgpackr = require('msgpackr');
        const ws = await connectAndWaitOpen(`ws://${TEST_HOST}:${TEST_PORT}/v1/subscribe?stream=test-msgpack-decode&codec=msgpack`);
        let errorReceived = false;
        let closeCode = null;
        ws.on('message', (data) => {
            const msg = msgpackr.unpack(Buffer.from(data));
            if (msg.error) {
                console.log(`  Error frame: ${JSON.stringify(msg.error)}`);
                assert.strictEqual(msg.error.code, 'DecodeError', 'Should get DecodeError for non-JSON codec');
                errorReceived = true;
            }
        });
        ws.on('close', (code, reason) => {
            closeCode = code;
            console.log(`  Close code: ${code}, reason: ${reason.toString()}`);
        });
        // Send invalid MessagePack data (random bytes that are not valid msgpack)
        ws.send(Buffer.from([0xFF, 0xFE, 0xFD, 0xFC, 0xFB, 0xFA]));
        await new Promise((resolve) => setTimeout(resolve, 500));
        assert(errorReceived, 'Should receive error frame');
        assert.strictEqual(closeCode, 1007, 'Should close with 1007 Invalid Frame Payload');
        console.log('✓ MessagePack decode error correctly mapped to 1007\n');
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
// Test 3: Oversize message → 1009 Message Too Big
console.log('[T7112-3] Testing oversize message mapping...');
{
    await startServer();
    try {
        const ws = await connectAndWaitOpen(`ws://${TEST_HOST}:${TEST_PORT}/v1/subscribe?stream=test-oversize&codec=json`);
        let errorReceived = false;
        let closeCode = null;
        ws.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.error) {
                console.log(`  Error frame: ${JSON.stringify(msg.error)}`);
                assert.strictEqual(msg.error.code, 'MessageTooLarge', 'Should get MessageTooLarge error code');
                errorReceived = true;
            }
        });
        ws.on('close', (code, reason) => {
            closeCode = code;
            console.log(`  Close code: ${code}, reason: ${reason.toString()}`);
        });
        // Send oversized message (> 1MB default limit)
        const hugePayload = JSON.stringify({
            data: 'x'.repeat(2 * 1024 * 1024),
            credit: 1
        });
        console.log(`  Sending ${(hugePayload.length / 1024 / 1024).toFixed(2)} MB message`);
        ws.send(hugePayload);
        await new Promise((resolve) => setTimeout(resolve, 500));
        assert(errorReceived, 'Should receive error frame');
        assert.strictEqual(closeCode, 1009, 'Should close with 1009 Message Too Big');
        console.log('✓ Oversize message correctly mapped to 1009\n');
    }
    catch (err) {
        console.error('✗ Failed:', err.message);
        process.exit(1);
    }
    finally {
        await stopServer();
    }
}
// Test 4: Multiple decode errors on same connection
console.log('[T7112-4] Testing multiple decode errors...');
{
    await startServer();
    try {
        const ws = await connectAndWaitOpen(`ws://${TEST_HOST}:${TEST_PORT}/v1/subscribe?stream=test-multi-decode&codec=json`);
        let errorCount = 0;
        let closeCode = null;
        ws.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.error) {
                console.log(`  Error frame ${errorCount + 1}: ${JSON.stringify(msg.error)}`);
                errorCount++;
            }
        });
        ws.on('close', (code, reason) => {
            closeCode = code;
            console.log(`  Close code: ${code}, reason: ${reason.toString()}`);
        });
        // Send first malformed JSON
        ws.send('{ bad json 1 }');
        await new Promise((resolve) => setTimeout(resolve, 500));
        // Connection should be closed after first error
        assert.strictEqual(errorCount, 1, 'Should receive exactly one error frame before close');
        assert.strictEqual(closeCode, 1007, 'Should close with 1007');
        console.log('✓ Connection closes after first decode error\n');
    }
    catch (err) {
        console.error('✗ Failed:', err.message);
        process.exit(1);
    }
    finally {
        await stopServer();
    }
}
// Test 5: Verify error logging with full context
console.log('[T7112-5] Testing error logging context...');
{
    await startServer();
    try {
        const ws = await connectAndWaitOpen(`ws://${TEST_HOST}:${TEST_PORT}/v1/subscribe?stream=test-log-context&codec=json`);
        let errorReceived = false;
        ws.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.error) {
                // Verify error has both code and message
                assert(msg.error.code, 'Error should have code');
                assert(msg.error.message, 'Error should have message');
                console.log(`  Error frame: code="${msg.error.code}", message="${msg.error.message}"`);
                errorReceived = true;
            }
        });
        // Send malformed JSON
        ws.send('not valid json at all');
        await new Promise((resolve) => setTimeout(resolve, 500));
        assert(errorReceived, 'Should receive error frame with full context');
        console.log('✓ Error logging includes full context\n');
    }
    catch (err) {
        console.error('✗ Failed:', err.message);
        process.exit(1);
    }
    finally {
        await stopServer();
    }
}
console.log('[T7112] All tests passed! ✓');
process.exit(0);
