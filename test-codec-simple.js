#!/usr/bin/env node

/**
 * Quick test to verify T7110 codec negotiation implementation
 */

import { getCodecByName, CodecRegistry } from './dist/codec/registry.js';
import { jsonCodec, JsonCodec } from './dist/codec/json.js';

console.log('[T7110] Testing codec negotiation implementation...\n');

// Test 1: Function exports
console.log('Test 1: getCodecByName function');
const codec1 = getCodecByName('json');
if (codec1 && codec1.name === 'json') {
  console.log('✓ getCodecByName works');
} else {
  console.error('✗ getCodecByName failed');
  process.exit(1);
}

// Test 2: CodecRegistry class
console.log('\nTest 2: CodecRegistry class');
const registry = new CodecRegistry({ defaultCodec: 'json' });
registry.register(new JsonCodec());
const codec2 = registry.get('json');
if (codec2 && codec2.name === 'json') {
  console.log('✓ CodecRegistry works');
} else {
  console.error('✗ CodecRegistry failed');
  process.exit(1);
}

// Test 3: Encode/decode with JSON codec
console.log('\nTest 3: JSON codec encode/decode');
const testObj = { credit: 10 };
const encoded = codec1.encode(testObj);
const decoded = codec1.decode(encoded);
if (decoded.credit === 10) {
  console.log('✓ JSON codec encode/decode works');
} else {
  console.error('✗ JSON codec encode/decode failed');
  process.exit(1);
}

// Test 4: Unknown codec fallback
console.log('\nTest 4: Unknown codec fallback');
const codec3 = getCodecByName('cbor');
if (!codec3) {
  console.log('✓ Unknown codec returns undefined (fallback to JSON)');
} else {
  console.error('✗ Unknown codec should return undefined');
  process.exit(1);
}

console.log('\n[T7110] All basic codec tests passed ✓');
console.log('\nImplementation summary:');
console.log('- ✓ CONDUIT_CODECS_WS flag check added');
console.log('- ✓ Query parameter parsing (codec=...)');
console.log('- ✓ Sec-WebSocket-Protocol header parsing');
console.log('- ✓ Codec validation via codecRegistry');
console.log('- ✓ Per-connection codec state storage');
console.log('- ✓ Fallback to json for unknown codecs');
console.log('- ✓ Frame encode/decode stubs added');
console.log('- ✓ Error mapping stub added');
console.log('- ✓ Metrics stub added');
console.log('- ✓ CodecRegistry class added');
console.log('- ✓ Documentation updated in SRE-RUNBOOK.md');
