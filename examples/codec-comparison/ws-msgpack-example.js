#!/usr/bin/env node
/**
 * WebSocket MessagePack Example
 * 
 * Demonstrates:
 * - Connecting with ?codec=msgpack parameter
 * - Sending MessagePack binary frames (credit, ack/nack)
 * - Receiving MessagePack binary frames (deliveries)
 * 
 * Prerequisites:
 *   npm install msgpackr ws
 *   CONDUIT_CODECS_WS=true npm run dev
 */

const WebSocket = require('ws');
const { pack, unpack } = require('msgpackr');

const WS_URL = 'ws://localhost:9088';
const STREAM = 'agents/test/inbox';

function connectWithMsgpack() {
  return new Promise((resolve, reject) => {
    console.log('=== WebSocket MessagePack Example ===\n');
    console.log(`Connecting to: ${WS_URL}/v1/subscribe?stream=${STREAM}&codec=msgpack`);

    const ws = new WebSocket(`${WS_URL}/v1/subscribe?stream=${STREAM}&codec=msgpack`);
    let deliveryCount = 0;

    ws.on('open', () => {
      console.log('✓ WebSocket connected with MessagePack codec\n');

      // Send credit using binary frame
      const creditMsg = { type: 'credit', credit: 100 };
      const encoded = pack(creditMsg);
      console.log('Sending credit (binary frame):');
      console.log(`  Message:`, creditMsg);
      console.log(`  Encoded size: ${encoded.length} bytes`);
      ws.send(encoded);
      console.log('');
    });

    ws.on('message', (data) => {
      try {
        // Decode binary frame
        const msg = unpack(new Uint8Array(data));
        deliveryCount++;

        console.log(`[${deliveryCount}] Received delivery (MessagePack):`);
        console.log(`  Type: ${msg.type}`);
        console.log(`  Message ID: ${msg.msgId}`);
        console.log(`  Body:`, JSON.stringify(msg.body, null, 4));
        if (msg.blobRef) {
          console.log(`  Blob: ${msg.blobRef}`);
        }
        console.log(`  Encoded size: ${data.length} bytes`);

        // Send acknowledgment using binary frame
        const ackMsg = { type: 'ack', msgId: msg.msgId };
        const encoded = pack(ackMsg);
        console.log(`  Sending ack (${encoded.length} bytes)`);
        ws.send(encoded);
        console.log('');

        // Close after processing 3 messages
        if (deliveryCount >= 3) {
          console.log('Processed 3 messages, closing connection...');
          ws.close(1000, 'Normal closure');
        }
      } catch (error) {
        console.error('Error decoding message:', error);
        ws.close(1007, 'Invalid frame data');
        reject(error);
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`\nWebSocket closed: ${code} ${reason || '(no reason)'}`);
      
      console.log('\nKey observations:');
      console.log('  • All frames are binary (opcode 0x2)');
      console.log('  • MessagePack encoding is automatic for credit/ack/nack');
      console.log('  • Deliveries arrive as MessagePack binary frames');
      console.log('  • Codec specified once at connection time (?codec=msgpack)');
      
      if (deliveryCount > 0) {
        resolve(deliveryCount);
      } else {
        console.log('\n⚠ No messages received. Try enqueueing first:');
        console.log('  node examples/codec-comparison/http-msgpack-example.js');
        resolve(0);
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error.message);
      console.error('\nTroubleshooting:');
      console.error('  1. Ensure Conduit is running: npm run dev');
      console.error('  2. Enable WebSocket codecs: export CONDUIT_CODECS_WS=true');
      console.error('  3. Check WS port: default is 9088');
      reject(error);
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        console.log('\nTimeout waiting for messages (10s)');
        ws.close(1000, 'Timeout');
        resolve(deliveryCount);
      }
    }, 10000);
  });
}

async function demonstrateWebSocketCodec() {
  try {
    const count = await connectWithMsgpack();
    
    if (count === 0) {
      process.exit(0);
    }
    
    console.log('\n✓ Example completed successfully!');
    console.log(`  Processed ${count} message(s) using MessagePack encoding`);
  } catch (error) {
    console.error('Failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  demonstrateWebSocketCodec();
}

module.exports = { connectWithMsgpack };
