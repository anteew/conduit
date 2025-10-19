import { startHttp, makeClientWithDemo } from './connectors/http.ts';
import { startWs } from './connectors/ws.ts';

const bind = process.env.CONDUIT_BIND || '127.0.0.1';
const httpPort = Number(process.env.CONDUIT_HTTP_PORT || 9087);
const wsPort = Number(process.env.CONDUIT_WS_PORT || 9088);

// Demo: in-process client to demo backend; later: connect to real core via terminals
const client = makeClientWithDemo();
startHttp(client, httpPort, bind);
startWs(client, wsPort, bind);

console.log(`Conduit HTTP on ${bind}:${httpPort}`);
console.log(`Conduit WS on   ${bind}:${wsPort}`);
