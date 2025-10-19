import { startHttp, makeClientWithDemo, makeClientWithTerminal } from './connectors/http.js';
import { startWs } from './connectors/ws.js';
import { Recorder } from './control/record.js';
import { parseBackendURL } from './control/terminal.js';
const bind = process.env.CONDUIT_BIND || '127.0.0.1';
const httpPort = Number(process.env.CONDUIT_HTTP_PORT || 9087);
const wsPort = Number(process.env.CONDUIT_WS_PORT || 9088);
const backendURL = process.env.CONDUIT_BACKEND || 'demo';
const recorder = process.env.CONDUIT_RECORD
    ? new Recorder(process.env.CONDUIT_RECORD, { redact: process.env.CONDUIT_RECORD_REDACT !== 'false' })
    : undefined;
if (recorder) {
    console.log(`Recording control frames to ${process.env.CONDUIT_RECORD}`);
}
// Backend selection: demo (in-process) or terminal (TCP/Unix)
const terminalConfig = parseBackendURL(backendURL);
let client;
if (terminalConfig) {
    console.log(`Connecting to ${terminalConfig.type} backend: ${backendURL}`);
    client = await makeClientWithTerminal(terminalConfig, recorder ? (f, d) => recorder.write(f, d) : undefined);
}
else {
    console.log(`Using demo backend (in-process)`);
    client = makeClientWithDemo(recorder ? (f, d) => recorder.write(f, d) : undefined);
}
startHttp(client, httpPort, bind);
startWs(client, wsPort, bind);
console.log(`Conduit HTTP on ${bind}:${httpPort}`);
console.log(`Conduit WS on   ${bind}:${wsPort}`);
