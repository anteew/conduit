import { startServer, stopServer, httpGet, httpPost } from './harness.js';
(async () => {
    const srv = await startServer({ CONDUIT_RULES: 'config/rules.yaml' });
    try {
        const h = await httpGet('http://127.0.0.1:9087/health');
        console.log('HEALTH', h.status);
        const resp = await httpPost('http://127.0.0.1:9087/v1/enqueue', { to: 'agents/Test/inbox', envelope: { id: 'e-test', ts: new Date().toISOString(), type: 'notify', payload: { ok: true } } });
        console.log('ENQ', resp.status, resp.body && resp.body.id ? 'ok' : 'fail');
    }
    finally {
        await stopServer(srv);
    }
})();
