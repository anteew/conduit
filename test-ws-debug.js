import WebSocket from 'ws';

const ws = new WebSocket('ws://127.0.0.1:9088/v1/subscribe?stream=agents/Test/inbox');

ws.on('open', () => {
  console.log('Connected');
  ws.send(JSON.stringify({credit: 1}));
});

ws.on('message', (data) => {
  console.log('Message:', data.toString());
});

setTimeout(() => ws.close(), 2000);
