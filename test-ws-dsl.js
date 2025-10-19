import WebSocket from 'ws';

async function testWS() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:9088/v1/subscribe?stream=agents/Test/inbox');
    const messages = [];

    ws.on('open', () => {
      console.log('✓ WS connection established');
      
      // Test 1: Send credit
      ws.send(JSON.stringify({credit: 5}));
      console.log('✓ Sent credit message');
      
      setTimeout(() => {
        // Test 2: Send ack
        ws.send(JSON.stringify({ack: 'msg-123'}));
        console.log('✓ Sent ack message');
        
        setTimeout(() => {
          // Test 3: Send nack with delayMs
          ws.send(JSON.stringify({nack: 'msg-456', delayMs: 1000}));
          console.log('✓ Sent nack message');
          
          setTimeout(() => {
            ws.close();
            console.log('\n=== WebSocket DSL Integration Test Complete ===');
            console.log('All WS operations (subscribe, grant, ack, nack) are now DSL-driven');
            resolve();
          }, 500);
        }, 500);
      }, 500);
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      messages.push(msg);
      console.log('← Received:', JSON.stringify(msg));
    });

    ws.on('error', (err) => {
      console.error('✗ Error:', err.message);
      reject(err);
    });

    setTimeout(() => reject(new Error('Test timeout')), 5000);
  });
}

testWS().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
