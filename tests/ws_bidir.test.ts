import { startServer, stopServer, httpPost } from './harness.js';
import WebSocket from 'ws';

(async () => {
  const srv = await startServer({ CONDUIT_RULES: 'config/rules.yaml' });
  try {
    const ws = new WebSocket('ws://127.0.0.1:9088/v1/subscribe?stream=agents/WS/inbox');
    ws.on('open', async () => {
      ws.send(JSON.stringify({ credit: 1 }));
      await httpPost('http://127.0.0.1:9087/v1/enqueue', { to:'agents/WS/inbox', envelope:{ id:'e-ws', ts:new Date().toISOString(), type:'notify', payload:{ n:1 }}});
    });
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data));
      if (msg.deliver && msg.deliver.id === 'e-ws') {
        console.log('WS DELIVER ok');
        ws.close();
      }
    });
    ws.on('close', async () => { await stopServer(srv); });
  } catch (e) { await stopServer(srv); }
})();
