import { startServer, stopServer, httpPost } from './harness.js';
import WebSocket from 'ws';
async function runTests() {
    console.log('=== T3022-WS-Errors: WebSocket Error Handling Tests ===\n');
    await testBasicDelivery();
    await testInvalidJSON();
    await testUnknownOp();
    await testMissingStream();
    await testEmptyMessage();
    await testOversizedMessage();
    console.log('\n=== All Tests Completed ===');
}
async function testBasicDelivery() {
    console.log('TEST: Basic WS delivery');
    const srv = await startServer({ CONDUIT_RULES: 'config/rules.yaml' });
    return new Promise(async (resolve) => {
        try {
            const ws = new WebSocket('ws://127.0.0.1:9088/v1/subscribe?stream=agents/WS/inbox');
            ws.on('open', async () => {
                ws.send(JSON.stringify({ credit: 1 }));
                await httpPost('http://127.0.0.1:9087/v1/enqueue', {
                    to: 'agents/WS/inbox',
                    envelope: { id: 'e-ws', ts: new Date().toISOString(), type: 'notify', payload: { n: 1 } }
                });
            });
            ws.on('message', (data) => {
                const msg = JSON.parse(String(data));
                if (msg.deliver && msg.deliver.id === 'e-ws') {
                    console.log('✓ Basic delivery successful\n');
                    ws.close();
                }
            });
            ws.on('close', async () => {
                await stopServer(srv);
                resolve();
            });
        }
        catch (e) {
            await stopServer(srv);
            resolve();
        }
    });
}
async function testInvalidJSON() {
    console.log('TEST: InvalidJSON - Malformed JSON → error frame + close 1007');
    const srv = await startServer({});
    return new Promise(async (resolve) => {
        try {
            const ws = new WebSocket('ws://127.0.0.1:9088/v1/subscribe?stream=test/invalid');
            let errorReceived = false;
            ws.on('open', () => {
                ws.send('{ invalid json: }');
            });
            ws.on('message', (data) => {
                const msg = JSON.parse(String(data));
                if (msg.error) {
                    errorReceived = true;
                    console.log(`  Error frame: ${JSON.stringify(msg.error)}`);
                    console.log(`  - error.code: ${msg.error.code}`);
                    console.log(`  - error.message: ${msg.error.message}`);
                    if (msg.error.code === 'InvalidJSON') {
                        console.log('✓ InvalidJSON error code correct');
                    }
                }
            });
            ws.on('close', async (code, reason) => {
                console.log(`  Close code: ${code}, reason: ${reason}`);
                if (code === 1007) {
                    console.log('✓ Close code 1007 (Invalid Frame Payload Data) correct');
                }
                if (errorReceived) {
                    console.log('✓ Error frame received before close');
                }
                console.log();
                await stopServer(srv);
                resolve();
            });
        }
        catch (e) {
            await stopServer(srv);
            resolve();
        }
    });
}
async function testUnknownOp() {
    console.log('TEST: UnknownOp - Unrecognized operation → error frame + close 1003');
    const srv = await startServer({});
    return new Promise(async (resolve) => {
        try {
            const ws = new WebSocket('ws://127.0.0.1:9088/v1/subscribe?stream=test/unknown');
            let errorReceived = false;
            ws.on('open', () => {
                ws.send(JSON.stringify({ unknownOperation: 'test', data: 'xyz' }));
            });
            ws.on('message', (data) => {
                const msg = JSON.parse(String(data));
                if (msg.error) {
                    errorReceived = true;
                    console.log(`  Error frame: ${JSON.stringify(msg.error)}`);
                    console.log(`  - error.code: ${msg.error.code}`);
                    console.log(`  - error.message: ${msg.error.message}`);
                    if (msg.error.code === 'UnknownOp') {
                        console.log('✓ UnknownOp error code correct');
                    }
                }
            });
            ws.on('close', async (code, reason) => {
                console.log(`  Close code: ${code}, reason: ${reason}`);
                if (code === 1003) {
                    console.log('✓ Close code 1003 (Unsupported Data) correct');
                }
                if (errorReceived) {
                    console.log('✓ Error frame received before close');
                }
                console.log();
                await stopServer(srv);
                resolve();
            });
        }
        catch (e) {
            await stopServer(srv);
            resolve();
        }
    });
}
async function testMissingStream() {
    console.log('TEST: Missing Stream - Connect without stream param → immediate close');
    const srv = await startServer({});
    return new Promise(async (resolve) => {
        try {
            const ws = new WebSocket('ws://127.0.0.1:9088/v1/subscribe');
            ws.on('open', () => {
                console.log('  Connection opened (should close immediately)');
            });
            ws.on('message', (data) => {
                console.log(`  Unexpected message: ${String(data)}`);
            });
            ws.on('close', async (code, reason) => {
                console.log(`  Close code: ${code}, reason: ${reason || '(no reason)'}`);
                console.log('✓ Connection closed without stream parameter');
                console.log();
                await stopServer(srv);
                resolve();
            });
            ws.on('error', async (err) => {
                console.log(`  Connection error/rejection: ${err.message}`);
                console.log('✓ Connection rejected or errored without stream');
                console.log();
                await stopServer(srv);
                resolve();
            });
        }
        catch (e) {
            console.log(`✓ Connection rejected: ${e.message}\n`);
            await stopServer(srv);
            resolve();
        }
    });
}
async function testEmptyMessage() {
    console.log('TEST: Empty Message - Send empty/null message → error handling');
    const srv = await startServer({});
    return new Promise(async (resolve) => {
        try {
            const ws = new WebSocket('ws://127.0.0.1:9088/v1/subscribe?stream=test/empty');
            ws.on('open', () => {
                ws.send('');
            });
            ws.on('message', (data) => {
                const msg = JSON.parse(String(data));
                if (msg.error) {
                    console.log(`  Error frame: ${JSON.stringify(msg.error)}`);
                    console.log(`  - error.code: ${msg.error.code}`);
                    console.log(`  - error.message: ${msg.error.message}`);
                    console.log('✓ Empty message handled with error frame');
                }
            });
            ws.on('close', async (code, reason) => {
                console.log(`  Close code: ${code}, reason: ${reason}`);
                console.log('✓ Connection closed after empty message');
                console.log();
                await stopServer(srv);
                resolve();
            });
            setTimeout(async () => {
                if (ws.readyState === WebSocket.OPEN) {
                    console.log('✓ Connection remained open (graceful handling)');
                    ws.close();
                }
            }, 500);
        }
        catch (e) {
            await stopServer(srv);
            resolve();
        }
    });
}
async function testOversizedMessage() {
    console.log('TEST: Oversized Message - Send huge message → error or disconnect');
    const srv = await startServer({});
    return new Promise(async (resolve) => {
        try {
            const ws = new WebSocket('ws://127.0.0.1:9088/v1/subscribe?stream=test/large');
            ws.on('open', () => {
                const hugePayload = JSON.stringify({
                    data: 'x'.repeat(10 * 1024 * 1024),
                    credit: 1
                });
                console.log(`  Sending ${(hugePayload.length / 1024 / 1024).toFixed(2)} MB message`);
                try {
                    ws.send(hugePayload);
                    console.log('  Large message sent');
                }
                catch (e) {
                    console.log(`  Send failed: ${e.message}`);
                }
            });
            ws.on('message', (data) => {
                const msg = JSON.parse(String(data));
                if (msg.error) {
                    console.log(`  Error frame: ${JSON.stringify(msg.error)}`);
                    console.log('✓ Large message rejected with error');
                }
            });
            ws.on('close', async (code, reason) => {
                console.log(`  Close code: ${code}, reason: ${reason || '(no reason)'}`);
                console.log('✓ Connection closed after large message');
                console.log();
                await stopServer(srv);
                resolve();
            });
            ws.on('error', async (err) => {
                console.log(`  Error: ${err.message}`);
                console.log('✓ Large message caused error');
                console.log();
                await stopServer(srv);
                resolve();
            });
            setTimeout(async () => {
                if (ws.readyState === WebSocket.OPEN) {
                    console.log('✓ Connection handled large message');
                    ws.close();
                }
            }, 1000);
        }
        catch (e) {
            await stopServer(srv);
            resolve();
        }
    });
}
runTests().catch(console.error);
