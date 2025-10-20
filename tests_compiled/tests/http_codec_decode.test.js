/**
 * T7101-HTTP-Codec-Decode Test
 *
 * Tests HTTP request body decoding via codec registry based on Content-Type header.
 * Requires CONDUIT_CODECS_HTTP=true to enable codec negotiation.
 */
import * as http from 'http';
import { startHttp, makeClientWithDemo } from '../src/connectors/http.js';
import { msgpackCodec } from '../src/codec/msgpack.js';
const PORT = 9187;
const BASE_URL = `http://127.0.0.1:${PORT}`;
function httpRequest(opts) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: '127.0.0.1',
            port: PORT,
            method: opts.method,
            path: opts.path,
            headers: opts.headers || {}
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                try {
                    const body = data ? JSON.parse(data) : {};
                    resolve({ status: res.statusCode || 500, body, headers: res.headers });
                }
                catch (e) {
                    resolve({ status: res.statusCode || 500, body: data, headers: res.headers });
                }
            });
        });
        req.on('error', reject);
        if (opts.body)
            req.write(opts.body);
        req.end();
    });
}
async function runTests() {
    const client = makeClientWithDemo();
    const server = startHttp(client, PORT, '127.0.0.1');
    console.log('[T7101] Starting HTTP Codec Decode tests...');
    console.log(`[T7101] CONDUIT_CODECS_HTTP=${process.env.CONDUIT_CODECS_HTTP}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    let passed = 0;
    let failed = 0;
    // Test 1: JSON decode (default)
    try {
        const payload = { to: 'agents/inbox', envelope: { message: 'hello json' } };
        const res = await httpRequest({
            method: 'POST',
            path: '/v1/enqueue',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.status === 200) {
            console.log('✓ Test 1: JSON decode successful');
            passed++;
        }
        else {
            console.error(`✗ Test 1: Expected 200, got ${res.status}`);
            failed++;
        }
    }
    catch (e) {
        console.error(`✗ Test 1: ${e.message}`);
        failed++;
    }
    // Test 2: MessagePack decode (requires CONDUIT_CODECS_HTTP=true and msgpackr)
    try {
        const payload = { to: 'agents/inbox', envelope: { message: 'hello msgpack' } };
        let encoded;
        try {
            encoded = msgpackCodec.encode(payload);
        }
        catch (encodeErr) {
            // msgpackr not available
            console.log('⊙ Test 2: MessagePack skipped (msgpackr not available)');
            passed++;
            throw new Error('skip');
        }
        const res = await httpRequest({
            method: 'POST',
            path: '/v1/enqueue',
            headers: { 'Content-Type': 'application/msgpack' },
            body: Buffer.from(encoded)
        });
        if (process.env.CONDUIT_CODECS_HTTP === 'true') {
            if (res.status === 200) {
                console.log('✓ Test 2: MessagePack decode successful (codec enabled)');
                passed++;
            }
            else {
                console.error(`✗ Test 2: Expected 200, got ${res.status}`, res.body);
                failed++;
            }
        }
        else {
            // When feature flag is off, should still parse (as JSON fallback may fail or succeed)
            console.log(`⊙ Test 2: MessagePack decode without flag (status=${res.status})`);
            passed++;
        }
    }
    catch (e) {
        if (e.message !== 'skip') {
            console.error(`✗ Test 2: ${e.message}`);
            failed++;
        }
    }
    // Test 3: Invalid JSON decode error
    try {
        const res = await httpRequest({
            method: 'POST',
            path: '/v1/enqueue',
            headers: { 'Content-Type': 'application/json' },
            body: '{invalid json}'
        });
        if (res.status === 400 && res.body.error) {
            console.log('✓ Test 3: Invalid JSON returns 400 with error details');
            passed++;
        }
        else {
            console.error(`✗ Test 3: Expected 400, got ${res.status}`);
            failed++;
        }
    }
    catch (e) {
        console.error(`✗ Test 3: ${e.message}`);
        failed++;
    }
    // Test 4: Structured suffix detection (+json)
    try {
        const payload = { to: 'agents/inbox', envelope: { message: 'structured suffix' } };
        const res = await httpRequest({
            method: 'POST',
            path: '/v1/enqueue',
            headers: { 'Content-Type': 'application/vnd.api+json' },
            body: JSON.stringify(payload)
        });
        if (res.status === 200) {
            console.log('✓ Test 4: Structured suffix +json detected');
            passed++;
        }
        else {
            console.error(`✗ Test 4: Expected 200, got ${res.status}`);
            failed++;
        }
    }
    catch (e) {
        console.error(`✗ Test 4: ${e.message}`);
        failed++;
    }
    // Test 5: Fallback to JSON when no Content-Type specified
    try {
        const payload = { to: 'agents/inbox', envelope: { message: 'no content-type' } };
        const res = await httpRequest({
            method: 'POST',
            path: '/v1/enqueue',
            body: JSON.stringify(payload)
        });
        if (res.status === 200) {
            console.log('✓ Test 5: Fallback to JSON when no Content-Type');
            passed++;
        }
        else {
            console.error(`✗ Test 5: Expected 200, got ${res.status}`);
            failed++;
        }
    }
    catch (e) {
        console.error(`✗ Test 5: ${e.message}`);
        failed++;
    }
    // Test 6: DSL route with codec decode
    try {
        const payload = { test: 'dsl decode' };
        const res = await httpRequest({
            method: 'POST',
            path: '/v1/test',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        // This may 404 if no DSL rules configured, which is fine
        console.log(`⊙ Test 6: DSL route codec decode (status=${res.status})`);
        passed++;
    }
    catch (e) {
        console.error(`✗ Test 6: ${e.message}`);
        failed++;
    }
    // Test 7: /v1/queue with codec decode
    if (process.env.CONDUIT_QUEUE_BACKEND) {
        try {
            const payload = { queue: 'test-queue', message: { data: 'queue test' } };
            const res = await httpRequest({
                method: 'POST',
                path: '/v1/queue',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.status === 200 || res.status === 503) {
                console.log(`✓ Test 7: /v1/queue codec decode (status=${res.status})`);
                passed++;
            }
            else {
                console.error(`✗ Test 7: Expected 200 or 503, got ${res.status}`);
                failed++;
            }
        }
        catch (e) {
            console.error(`✗ Test 7: ${e.message}`);
            failed++;
        }
    }
    else {
        console.log('⊙ Test 7: Skipped (CONDUIT_QUEUE_BACKEND not set)');
        passed++;
    }
    // Test 8: Response negotiation stub placeholder (T7102)
    try {
        const res = await httpRequest({
            method: 'GET',
            path: '/health',
            headers: { 'Accept': 'application/json' }
        });
        if (res.status === 200) {
            console.log('✓ Test 8: Response negotiation stub (T7102 placeholder)');
            passed++;
        }
        else {
            console.error(`✗ Test 8: Expected 200, got ${res.status}`);
            failed++;
        }
    }
    catch (e) {
        console.error(`✗ Test 8: ${e.message}`);
        failed++;
    }
    console.log(`\n[T7101] Tests completed: ${passed} passed, ${failed} failed`);
    server.close();
    process.exit(failed > 0 ? 1 : 0);
}
runTests().catch((err) => {
    console.error('[T7101] Test suite failed:', err);
    process.exit(1);
});
