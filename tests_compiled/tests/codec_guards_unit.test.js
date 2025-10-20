/**
 * T7120: Codec Guards Unit Test
 *
 * Tests the decoded payload size and depth measurement functions.
 */
import { measureDecodedSize, measureDepth, checkDecodedPayload, getGuardrailsFromEnv } from '../src/codec/guards.js';
console.log('='.repeat(60));
console.log('T7120: Codec Guards Unit Test');
console.log('='.repeat(60));
function createDeepObject(depth) {
    if (depth === 0)
        return 'leaf';
    return { child: createDeepObject(depth - 1) };
}
// Test 1: Measure decoded size
console.log('[Test 1] measureDecodedSize');
const smallObj = { msg: 'hello' };
const size1 = measureDecodedSize(smallObj);
console.log(`  Small object size: ${size1} bytes`);
if (size1 === JSON.stringify(smallObj).length) {
    console.log('  ✓ Size measurement correct');
}
else {
    console.log(`  ✗ Expected ${JSON.stringify(smallObj).length}, got ${size1}`);
}
// Test 2: Measure depth
console.log('[Test 2] measureDepth');
const depth3 = createDeepObject(3);
const measuredDepth = measureDepth(depth3);
console.log(`  Depth 3 object measured as: ${measuredDepth}`);
if (measuredDepth === 3) {
    console.log('  ✓ Depth measurement correct');
}
else {
    console.log(`  ✗ Expected 3, got ${measuredDepth}`);
}
// Test 3: Array depth
console.log('[Test 3] Array depth');
const nestedArray = [[[['deep']]]];
const arrayDepth = measureDepth(nestedArray);
console.log(`  Nested array depth: ${arrayDepth}`);
if (arrayDepth === 4) {
    console.log('  ✓ Array depth correct');
}
else {
    console.log(`  ✗ Expected 4, got ${arrayDepth}`);
}
// Test 4: Check valid payload
console.log('[Test 4] Valid payload check');
const guardrails = { maxDecodedSize: 1000, maxDepth: 5 };
const validPayload = { msg: 'hello', data: [1, 2, 3] };
const check1 = checkDecodedPayload(validPayload, guardrails);
if (check1.valid === true) {
    console.log('  ✓ Valid payload passes');
}
else {
    console.log(`  ✗ Valid payload failed: ${check1.reason}`);
}
// Test 5: Size exceeded
console.log('[Test 5] Size cap violation');
const largeObj = { data: [] };
for (let i = 0; i < 500; i++) {
    largeObj.data.push('x'.repeat(10));
}
const check2 = checkDecodedPayload(largeObj, guardrails);
if (check2.valid === false && check2.reason === 'decoded_size_exceeded') {
    console.log(`  ✓ Size cap violation detected (${check2.actual} > ${check2.limit})`);
}
else {
    console.log(`  ✗ Size cap not detected`);
}
// Test 6: Depth exceeded
console.log('[Test 6] Depth cap violation');
const deepObj = createDeepObject(10);
const check3 = checkDecodedPayload(deepObj, guardrails);
if (check3.valid === false && check3.reason === 'depth_exceeded') {
    console.log(`  ✓ Depth cap violation detected (${check3.actual} > ${check3.limit})`);
}
else {
    console.log(`  ✗ Depth cap not detected`);
}
// Test 7: Environment config
console.log('[Test 7] Environment configuration');
process.env.CONDUIT_CODEC_MAX_DECODED_SIZE = '2048';
process.env.CONDUIT_CODEC_MAX_DEPTH = '8';
const envGuardrails = getGuardrailsFromEnv();
if (envGuardrails.maxDecodedSize === 2048 && envGuardrails.maxDepth === 8) {
    console.log(`  ✓ Environment config loaded (size=${envGuardrails.maxDecodedSize}, depth=${envGuardrails.maxDepth})`);
}
else {
    console.log(`  ✗ Config mismatch: size=${envGuardrails.maxDecodedSize}, depth=${envGuardrails.maxDepth}`);
}
console.log('='.repeat(60));
console.log('T7120: Unit tests complete');
console.log('='.repeat(60));
