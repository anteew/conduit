import { startServer, stopServer, httpPost } from './harness.js';

(async () => {
  const N = 20000; // adjust in CI
  const srv = await startServer({ CONDUIT_RULES: 'config/rules.yaml' });
  const t0 = Date.now();
  for (let i=0;i<N;i++) {
    await httpPost('http://127.0.0.1:9087/v1/enqueue', { to:'agents/Perf/inbox', envelope:{ id:'e-'+i, ts:new Date().toISOString(), type:'notify', payload:{ i }}});
  }
  const t1 = Date.now();
  console.log(JSON.stringify({ N, ms:t1-t0, per_op_ms: (t1-t0)/N }));
  await stopServer(srv);
})();
