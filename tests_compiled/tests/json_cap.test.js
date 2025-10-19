// T4012-JSON-Cap: JSON body size limits with 413 response
import * as http from 'http';
function post(port, path, body, contentType) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: '127.0.0.1',
            port,
            path,
            method: 'POST',
            headers: {
                'Content-Type': contentType,
                'Content-Length': Buffer.byteLength(body)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                }
                catch {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}
async function testJSONSizeCap() {
    console.log('=== T4012-JSON-Cap Test ===\n');
    const port = 9087;
    // Test 1: Small JSON (should succeed)
    console.log('Test 1: Small JSON payload (< 10MB)');
    const smallJSON = JSON.stringify({ message: 'small payload', data: 'x'.repeat(1000) });
    try {
        const res1 = await post(port, '/v1/enqueue', smallJSON, 'application/json');
        console.log(`✓ Status: ${res1.status} (expected 400 for missing fields, but not 413)`);
        console.log(`  Response: ${JSON.stringify(res1.data)}\n`);
    }
    catch (e) {
        console.log(`✗ Error: ${e.message}\n`);
    }
    // Test 2: Large JSON (should fail with 413)
    console.log('Test 2: Large JSON payload (> 10MB default limit)');
    const largeJSON = JSON.stringify({
        message: 'large payload',
        data: 'x'.repeat(11 * 1024 * 1024) // 11MB of data
    });
    console.log(`  Payload size: ${(largeJSON.length / 1_048_576).toFixed(2)} MB`);
    try {
        const res2 = await post(port, '/v1/enqueue', largeJSON, 'application/json');
        if (res2.status === 413) {
            console.log(`✓ Status: 413 (Payload Too Large)`);
            console.log(`  Response:`, res2.data);
            console.log(`  Error code: ${res2.data.code}`);
            console.log(`  Suggestion provided: ${res2.data.suggestion ? 'Yes' : 'No'}`);
        }
        else {
            console.log(`✗ Expected 413, got ${res2.status}`);
            console.log(`  Response:`, res2.data);
        }
    }
    catch (e) {
        console.log(`✗ Request error: ${e.message}`);
    }
    console.log('\n=== Test Complete ===');
}
// Check if server is running
http.get('http://127.0.0.1:9087/health', (res) => {
    if (res.statusCode === 200) {
        testJSONSizeCap().catch(console.error);
    }
    else {
        console.error('Server not responding. Start with: npm run dev');
        process.exit(1);
    }
}).on('error', () => {
    console.error('Server not running on port 9087. Start with: npm run dev');
    process.exit(1);
});
