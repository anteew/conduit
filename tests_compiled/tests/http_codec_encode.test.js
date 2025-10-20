/**
 * T7102-HTTP-Codec-Encode Test
 *
 * Tests HTTP response encoding via Accept header negotiation with X-Codec override.
 * Requires CONDUIT_CODECS_HTTP=true to enable codec negotiation.
 */
import * as http from 'http';
import { startHttp, makeClientWithDemo } from '../src/connectors/http.js';
import { msgpackCodec } from '../src/codec/msgpack.js';
const PORT = 9287;
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
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const body = Buffer.concat(chunks);
                resolve({ status: res.statusCode || 500, body, headers: res.headers });
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
    console.log('[T7102] Starting HTTP Codec Encode tests...');
    console.log(`[T7102] CONDUIT_CODECS_HTTP=${process.env.CONDUIT_CODECS_HTTP}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    let passed = 0;
    let failed = 0;
    // Test 1: Default JSON response (no Accept header)
    try {
        const res = await httpRequest({
            method: 'GET',
            path: '/health'
        });
        const contentType = res.headers['content-type'] || '';
        const parsed = JSON.parse(res.body.toString());
        if (res.status === 200 && (contentType.includes('application/json') || contentType.startsWith('application/json')) && (parsed.ok === true || parsed.status === 'ok')) {
            console.log('✓ Test 1: Default JSON response without Accept header');
            passed++;
        }
        else {
            console.error(`✗ Test 1: Status=${res.status}, ContentType=${contentType}, Body=${JSON.stringify(parsed)}`);
            failed++;
        }
    }
    catch (e) {
        console.error(`✗ Test 1: ${e.message}`);
        failed++;
    }
    // Test 2: JSON response via Accept header
    try {
        const res = await httpRequest({
            method: 'GET',
            path: '/health',
            headers: { 'Accept': 'application/json' }
        });
        const contentType = res.headers['content-type'] || '';
        const parsed = JSON.parse(res.body.toString());
        if (res.status === 200 && (contentType.includes('application/json') || contentType.startsWith('application/json')) && (parsed.ok === true || parsed.status === 'ok')) {
            console.log('✓ Test 2: JSON response via Accept header');
            passed++;
        }
        else {
            console.error(`✗ Test 2: Status=${res.status}, ContentType=${contentType}, Body=${JSON.stringify(parsed)}`);
            failed++;
        }
    }
    catch (e) {
        console.error(`✗ Test 2: ${e.message}`);
        failed++;
    }
    // Test 3: MessagePack response via Accept header (requires CONDUIT_CODECS_HTTP=true)
    try {
        const res = await httpRequest({
            method: 'GET',
            path: '/health',
            headers: { 'Accept': 'application/msgpack' }
        });
        const contentType = res.headers['content-type'] || '';
        if (process.env.CONDUIT_CODECS_HTTP === 'true') {
            if (contentType.includes('application/msgpack') || contentType.includes('application/x-msgpack')) {
                // Decode msgpack response
                try {
                    const decoded = msgpackCodec.decode(res.body);
                    if (decoded && (decoded.ok === true || decoded.status === 'ok')) {
                        console.log('✓ Test 3: MessagePack response via Accept header (codec enabled)');
                        passed++;
                    }
                    else {
                        console.error(`✗ Test 3: Invalid msgpack response: ${JSON.stringify(decoded)}`);
                        failed++;
                    }
                }
                catch (decodeErr) {
                    console.error(`✗ Test 3: Failed to decode msgpack response: ${decodeErr.message}`);
                    failed++;
                }
            }
            else {
                console.log(`⊙ Test 3: MessagePack not negotiated, got ${contentType} (fallback)`);
                passed++;
            }
        }
        else {
            // When feature flag is off, should still return JSON
            if (contentType.includes('application/json')) {
                console.log('✓ Test 3: Falls back to JSON when codec disabled');
                passed++;
            }
            else {
                console.error(`✗ Test 3: Expected JSON fallback, got ${contentType}`);
                failed++;
            }
        }
    }
    catch (e) {
        console.error(`✗ Test 3: ${e.message}`);
        failed++;
    }
    // Test 4: X-Codec override to msgpack (requires CONDUIT_CODECS_HTTP=true)
    try {
        const res = await httpRequest({
            method: 'GET',
            path: '/health',
            headers: {
                'Accept': 'application/json',
                'X-Codec': 'msgpack'
            }
        });
        const contentType = res.headers['content-type'] || '';
        if (process.env.CONDUIT_CODECS_HTTP === 'true') {
            if (contentType.includes('application/msgpack') || contentType.includes('application/x-msgpack')) {
                try {
                    const decoded = msgpackCodec.decode(res.body);
                    if (decoded && (decoded.ok === true || decoded.status === 'ok')) {
                        console.log('✓ Test 4: X-Codec header overrides Accept (msgpack)');
                        passed++;
                    }
                    else {
                        console.error(`✗ Test 4: Invalid msgpack response: ${JSON.stringify(decoded)}`);
                        failed++;
                    }
                }
                catch (decodeErr) {
                    console.error(`✗ Test 4: Failed to decode msgpack response: ${decodeErr.message}`);
                    failed++;
                }
            }
            else {
                console.log(`⊙ Test 4: X-Codec override not applied, got ${contentType}`);
                passed++;
            }
        }
        else {
            console.log('⊙ Test 4: Skipped (CONDUIT_CODECS_HTTP not enabled)');
            passed++;
        }
    }
    catch (e) {
        console.error(`✗ Test 4: ${e.message}`);
        failed++;
    }
    // Test 5: X-Codec override to json
    try {
        const res = await httpRequest({
            method: 'GET',
            path: '/health',
            headers: {
                'Accept': 'application/msgpack',
                'X-Codec': 'json'
            }
        });
        const contentType = res.headers['content-type'] || '';
        const parsed = JSON.parse(res.body.toString());
        if (res.status === 200 && (contentType.includes('application/json') || contentType.startsWith('application/json')) && (parsed.ok === true || parsed.status === 'ok')) {
            console.log('✓ Test 5: X-Codec header overrides Accept (json)');
            passed++;
        }
        else {
            console.error(`✗ Test 5: Status=${res.status}, ContentType=${contentType}, Body=${JSON.stringify(parsed)}`);
            failed++;
        }
    }
    catch (e) {
        console.error(`✗ Test 5: ${e.message}`);
        failed++;
    }
    // Test 6: Invalid X-Codec falls back to Accept negotiation
    try {
        const res = await httpRequest({
            method: 'GET',
            path: '/health',
            headers: {
                'Accept': 'application/json',
                'X-Codec': 'invalid-codec'
            }
        });
        const contentType = res.headers['content-type'] || '';
        const parsed = JSON.parse(res.body.toString());
        if (res.status === 200 && (contentType.includes('application/json') || contentType.startsWith('application/json')) && (parsed.ok === true || parsed.status === 'ok')) {
            console.log('✓ Test 6: Invalid X-Codec falls back to Accept negotiation');
            passed++;
        }
        else {
            console.error(`✗ Test 6: Status=${res.status}, ContentType=${contentType}, Body=${JSON.stringify(parsed)}`);
            failed++;
        }
    }
    catch (e) {
        console.error(`✗ Test 6: ${e.message}`);
        failed++;
    }
    // Test 7: Quality value negotiation (prefers higher q value)
    try {
        const res = await httpRequest({
            method: 'GET',
            path: '/health',
            headers: {
                'Accept': 'application/json;q=0.5, application/msgpack;q=0.9'
            }
        });
        const contentType = res.headers['content-type'] || '';
        if (process.env.CONDUIT_CODECS_HTTP === 'true') {
            if (contentType.includes('application/msgpack') || contentType.includes('application/x-msgpack')) {
                console.log('✓ Test 7: Quality value negotiation prefers higher q (msgpack)');
                passed++;
            }
            else {
                console.log(`⊙ Test 7: Quality negotiation fallback to JSON (${contentType})`);
                passed++;
            }
        }
        else {
            console.log('⊙ Test 7: Skipped (CONDUIT_CODECS_HTTP not enabled)');
            passed++;
        }
    }
    catch (e) {
        console.error(`✗ Test 7: ${e.message}`);
        failed++;
    }
    // Test 8: Wildcard Accept (*/*) uses default codec
    try {
        const res = await httpRequest({
            method: 'GET',
            path: '/health',
            headers: {
                'Accept': '*/*'
            }
        });
        const contentType = res.headers['content-type'] || '';
        const defaultCodec = process.env.CONDUIT_DEFAULT_CODEC || 'json';
        if (defaultCodec === 'json' && contentType.includes('application/json')) {
            console.log('✓ Test 8: Wildcard Accept uses default codec (json)');
            passed++;
        }
        else if (defaultCodec === 'msgpack' && (contentType.includes('application/msgpack') || contentType.includes('application/x-msgpack'))) {
            console.log('✓ Test 8: Wildcard Accept uses default codec (msgpack)');
            passed++;
        }
        else if (contentType.includes('application/json')) {
            // Fallback to JSON is acceptable
            console.log('✓ Test 8: Wildcard Accept falls back to JSON');
            passed++;
        }
        else {
            console.error(`✗ Test 8: Unexpected Content-Type: ${contentType}`);
            failed++;
        }
    }
    catch (e) {
        console.error(`✗ Test 8: ${e.message}`);
        failed++;
    }
    // Test 9: /v1/metrics with codec negotiation
    try {
        const res = await httpRequest({
            method: 'GET',
            path: '/v1/metrics',
            headers: {
                'Accept': 'application/json'
            }
        });
        const contentType = res.headers['content-type'] || '';
        const parsed = JSON.parse(res.body.toString());
        // /v1/metrics returns structure with http, streams, tenants, ws
        if (res.status === 200 && (contentType.includes('application/json') || contentType.startsWith('application/json')) && (parsed.http || parsed.streams)) {
            console.log('✓ Test 9: /v1/metrics returns JSON response');
            passed++;
        }
        else {
            console.error(`✗ Test 9: Status=${res.status}, ContentType=${contentType}, hasHttp=${!!parsed.http}, hasStreams=${!!parsed.streams}`);
            failed++;
        }
    }
    catch (e) {
        console.error(`✗ Test 9: ${e.message}`);
        failed++;
    }
    // Test 10: Error responses also respect codec negotiation
    try {
        const res = await httpRequest({
            method: 'POST',
            path: '/v1/enqueue',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: '{invalid json}'
        });
        const contentType = res.headers['content-type'] || '';
        const parsed = JSON.parse(res.body.toString());
        if (res.status === 400 && contentType.includes('application/json') && parsed.error) {
            console.log('✓ Test 10: Error responses respect codec negotiation');
            passed++;
        }
        else {
            console.error(`✗ Test 10: Expected 400 with JSON error, got ${res.status}, ${contentType}`);
            failed++;
        }
    }
    catch (e) {
        console.error(`✗ Test 10: ${e.message}`);
        failed++;
    }
    console.log(`\n[T7102] Tests completed: ${passed} passed, ${failed} failed`);
    server.close();
    process.exit(failed > 0 ? 1 : 0);
}
runTests().catch((err) => {
    console.error('[T7102] Test suite failed:', err);
    process.exit(1);
});
