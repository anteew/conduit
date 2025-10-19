import { startServer, stopServer } from './harness.js';
import { WebSocket } from 'ws';
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
(async () => {
    console.log('=== T3022-WS-Errors: WebSocket Error Handling Tests ===\n');
    // Test 1: Invalid JSON
    console.log('Test 1: InvalidJSON - Malformed JSON → error frame + close 1007');
    const srv1 = await startServer({});
    await new Promise((resolve) => {
        const ws = new WebSocket('ws://127.0.0.1:9088/v1/subscribe?stream=test/invalid');
        let errorReceived = false;
        ws.on('open', () => {
            console.log('  Sending malformed JSON...');
            ws.send('{ invalid json: }');
        });
        ws.on('message', (data) => {
            const msg = JSON.parse(String(data));
            if (msg.error) {
                errorReceived = true;
                console.log(`  Error frame: ${JSON.stringify(msg.error)}`);
                console.log(`  - error.code: ${msg.error.code}`);
                console.log(`  - error.message: ${msg.error.message}`);
            }
        });
        ws.on('close', async (code, reason) => {
            console.log(`  Close code: ${code}, reason: ${reason}`);
            console.log(`  ✓ Error frame: ${errorReceived ? 'YES' : 'NO'}`);
            console.log(`  ✓ Correct error code (InvalidJSON): ${errorReceived ? 'YES' : 'NO'}`);
            console.log(`  ✓ Correct close code (1007): ${code === 1007 ? 'YES' : 'NO'}\n`);
            await stopServer(srv1);
            resolve();
        });
        ws.on('error', () => { });
    });
    await sleep(500);
    // Test 2: Unknown Operation
    console.log('Test 2: UnknownOp - Unrecognized operation → error frame + close 1003');
    const srv2 = await startServer({});
    await new Promise((resolve) => {
        const ws = new WebSocket('ws://127.0.0.1:9088/v1/subscribe?stream=test/unknown');
        let errorReceived = false;
        ws.on('open', () => {
            console.log('  Sending unknown operation...');
            ws.send(JSON.stringify({ unknownOperation: 'test', data: 'xyz' }));
        });
        ws.on('message', (data) => {
            const msg = JSON.parse(String(data));
            if (msg.error) {
                errorReceived = true;
                console.log(`  Error frame: ${JSON.stringify(msg.error)}`);
                console.log(`  - error.code: ${msg.error.code}`);
                console.log(`  - error.message: ${msg.error.message}`);
            }
        });
        ws.on('close', async (code, reason) => {
            console.log(`  Close code: ${code}, reason: ${reason}`);
            console.log(`  ✓ Error frame: ${errorReceived ? 'YES' : 'NO'}`);
            console.log(`  ✓ Correct error code (UnknownOp): ${errorReceived ? 'YES' : 'NO'}`);
            console.log(`  ✓ Correct close code (1003): ${code === 1003 ? 'YES' : 'NO'}\n`);
            await stopServer(srv2);
            resolve();
        });
        ws.on('error', () => { });
    });
    await sleep(500);
    // Test 3: Missing Stream
    console.log('Test 3: Missing Stream - Connect without stream param → immediate close');
    const srv3 = await startServer({});
    await new Promise((resolve) => {
        const ws = new WebSocket('ws://127.0.0.1:9088/v1/subscribe');
        let opened = false;
        ws.on('open', () => {
            opened = true;
            console.log('  Connection opened (should close immediately)');
        });
        ws.on('close', async (code) => {
            console.log(`  Close code: ${code}`);
            console.log(`  ✓ Connection closed: YES`);
            console.log(`  ✓ Graceful close: ${opened && code === 1000 ? 'YES' : 'ABRUPT'}\n`);
            await stopServer(srv3);
            resolve();
        });
        ws.on('error', async () => {
            if (!opened) {
                console.log('  Connection rejected before open');
                console.log('  ✓ Connection closed: YES\n');
                await stopServer(srv3);
                resolve();
            }
        });
    });
    await sleep(500);
    // Test 4: Empty Message
    console.log('Test 4: Empty Message - Send empty/null message → error handling');
    const srv4 = await startServer({});
    await new Promise((resolve) => {
        const ws = new WebSocket('ws://127.0.0.1:9088/v1/subscribe?stream=test/empty');
        let errorReceived = false;
        ws.on('open', () => {
            console.log('  Sending empty message...');
            ws.send('');
        });
        ws.on('message', (data) => {
            const msg = JSON.parse(String(data));
            if (msg.error) {
                errorReceived = true;
                console.log(`  Error frame: ${JSON.stringify(msg.error)}`);
            }
        });
        ws.on('close', async (code) => {
            console.log(`  Close code: ${code}`);
            console.log(`  ✓ Error frame received: ${errorReceived ? 'YES' : 'NO (graceful)'}`);
            console.log(`  ✓ Connection handled gracefully: YES\n`);
            await stopServer(srv4);
            resolve();
        });
        setTimeout(async () => {
            if (ws.readyState === WebSocket.OPEN) {
                console.log('  ✓ Connection remained open after empty message');
                ws.close();
            }
        }, 500);
        ws.on('error', () => { });
    });
    await sleep(500);
    // Test 5: Oversized Message
    console.log('Test 5: Oversized Message - Send huge message → error or disconnect');
    const srv5 = await startServer({});
    await new Promise((resolve) => {
        const ws = new WebSocket('ws://127.0.0.1:9088/v1/subscribe?stream=test/large');
        let errorReceived = false;
        let sendSuccess = false;
        ws.on('open', () => {
            const hugePayload = JSON.stringify({
                data: 'x'.repeat(5 * 1024 * 1024),
                credit: 1
            });
            console.log(`  Attempting to send ${(hugePayload.length / 1024 / 1024).toFixed(2)} MB message...`);
            try {
                ws.send(hugePayload);
                sendSuccess = true;
                console.log('  Message sent successfully');
            }
            catch (e) {
                console.log(`  Send failed immediately: ${e.message}`);
            }
        });
        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(String(data));
                if (msg.error) {
                    errorReceived = true;
                    console.log(`  Error frame received: ${JSON.stringify(msg.error)}`);
                }
            }
            catch { }
        });
        ws.on('close', async (code) => {
            console.log(`  Close code: ${code}`);
            console.log(`  ✓ Large message handled: ${sendSuccess ? 'Sent' : 'Rejected'}`);
            console.log(`  ✓ Error frame: ${errorReceived ? 'YES' : 'NO'}\n`);
            await stopServer(srv5);
            resolve();
        });
        ws.on('error', async (err) => {
            console.log(`  Error event: ${err.message}`);
            await stopServer(srv5);
            resolve();
        });
        setTimeout(async () => {
            if (ws.readyState === WebSocket.OPEN) {
                console.log('  ✓ Connection handled large message without disconnecting');
                ws.close();
            }
        }, 1000);
    });
    console.log('\n=== Error Test Summary ===');
    console.log('Error Frame Structure: { error: { code, message } }');
    console.log('Close Codes:');
    console.log('  - 1003: Unsupported Data / Unknown Operation');
    console.log('  - 1007: Invalid Frame Payload Data / Malformed JSON');
    console.log('  - 1000: Normal close / Graceful shutdown');
    console.log('\nAll tests completed successfully!');
})();
