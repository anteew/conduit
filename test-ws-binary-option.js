const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 9199 });

wss.on('connection', (ws) => {
  // Test 1: Send buffer with binary: false
  const buf1 = Buffer.from(JSON.stringify({ test: 'buffer-false' }));
  ws.send(buf1, { binary: false });
  
  // Test 2: Send string (should be text)
  setTimeout(() => {
    ws.send(JSON.stringify({ test: 'string' }));
  }, 100);
  
  // Test 3: Send buffer with binary: true
  setTimeout(() => {
    const buf3 = Buffer.from(JSON.stringify({ test: 'buffer-true' }));
    ws.send(buf3, { binary: true });
  }, 200);
});

const client = new WebSocket('ws://127.0.0.1:9199');
let count = 0;

client.on('message', (data, isBinary) => {
  count++;
  console.log(`Message ${count}: isBinary=${isBinary}, data=${data}`);
  if (count === 3) {
    client.close();
    wss.close();
    process.exit(0);
  }
});

setTimeout(() => {
  console.log('Timeout');
  client.close();
  wss.close();
  process.exit(1);
}, 2000);
