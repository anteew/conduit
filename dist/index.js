import { startHttp, makeClientWithDemo, makeClientWithTerminal, setWsMetrics } from './connectors/http.js';
import { startWs, getWsMetrics } from './connectors/ws.js';
import { Recorder } from './control/record.js';
import { parseBackendURL } from './control/terminal.js';
const bind = process.env.CONDUIT_BIND || '127.0.0.1';
const httpPort = Number(process.env.CONDUIT_HTTP_PORT || 9087);
const wsPort = Number(process.env.CONDUIT_WS_PORT || 9088);
const backendURL = process.env.CONDUIT_BACKEND || 'demo';
let httpServer = null;
let wsServer = null;
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
httpServer = startHttp(client, httpPort, bind);
wsServer = startWs(client, wsPort, bind);
// T5042: Wire up WS metrics to HTTP metrics endpoint
setInterval(() => {
    setWsMetrics(getWsMetrics());
}, 1000);
console.log(`Conduit HTTP on ${bind}:${httpPort}`);
console.log(`Conduit WS on   ${bind}:${wsPort}`);
// T5060: Zero-downtime reload on SIGHUP
let isReloading = false;
process.on('SIGHUP', async () => {
    if (isReloading) {
        console.log('[Reload] Reload already in progress, ignoring SIGHUP');
        return;
    }
    isReloading = true;
    console.log('[Reload] SIGHUP received, reloading configuration...');
    try {
        let reloadedItems = [];
        // Reload DSL rules if configured
        if (process.env.CONDUIT_RULES) {
            const { reloadDSL } = require('./connectors/http.js');
            reloadDSL();
            reloadedItems.push('DSL rules');
        }
        // T5061: Reload tenant configuration
        const tenantConfigPath = process.env.CONDUIT_TENANT_CONFIG || './config/tenants.yaml';
        const fs = require('fs');
        if (fs.existsSync(tenantConfigPath)) {
            const { reloadTenants } = require('./connectors/http.js');
            reloadTenants();
            reloadedItems.push('tenant config');
        }
        // Graceful drain: allow existing requests to complete (up to 30s)
        const drainTimeout = Number(process.env.CONDUIT_RELOAD_DRAIN_TIMEOUT_MS || 30000);
        console.log(`[Reload] Waiting ${drainTimeout}ms for active requests to drain...`);
        // Mark server as draining (will reject new connections during reload if configured)
        if (httpServer) {
            const { setDrainingMode } = require('./connectors/http.js');
            setDrainingMode(true);
        }
        // Wait for drain timeout (allows in-flight requests to complete)
        await new Promise(resolve => setTimeout(resolve, drainTimeout));
        // Resume accepting new connections
        if (httpServer) {
            const { setDrainingMode } = require('./connectors/http.js');
            setDrainingMode(false);
        }
        console.log(`[Reload] Configuration reloaded successfully: ${reloadedItems.join(', ')}`);
    }
    catch (error) {
        console.error('[Reload] Failed to reload:', error.message);
    }
    finally {
        isReloading = false;
    }
});
// T5060: Graceful shutdown on SIGTERM/SIGINT
let isShuttingDown = false;
async function gracefulShutdown(signal) {
    if (isShuttingDown) {
        console.log('[Shutdown] Already shutting down...');
        return;
    }
    isShuttingDown = true;
    console.log(`[Shutdown] ${signal} received, starting graceful shutdown...`);
    try {
        const shutdownTimeout = Number(process.env.CONDUIT_SHUTDOWN_TIMEOUT_MS || 30000);
        // Stop accepting new connections
        if (httpServer) {
            const { setDrainingMode } = require('./connectors/http.js');
            setDrainingMode(true);
            console.log('[Shutdown] HTTP server draining...');
        }
        if (wsServer) {
            const { setWsDrainingMode } = require('./connectors/ws.js');
            setWsDrainingMode(true);
            console.log('[Shutdown] WebSocket server draining...');
        }
        // Wait for connections to close naturally (with timeout)
        await new Promise(resolve => setTimeout(resolve, shutdownTimeout));
        // Force close remaining connections
        if (httpServer) {
            httpServer.close(() => console.log('[Shutdown] HTTP server closed'));
        }
        if (wsServer) {
            wsServer.close(() => console.log('[Shutdown] WebSocket server closed'));
        }
        console.log('[Shutdown] Graceful shutdown complete');
        process.exit(0);
    }
    catch (error) {
        console.error('[Shutdown] Error during shutdown:', error.message);
        process.exit(1);
    }
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
