import { spawn, execSync } from 'child_process';
import * as http from 'http';
import * as fs from 'fs';
export async function startServer(env = {}) {
    try {
        execSync("pkill -f 'node dist/index.js'", { stdio: 'ignore' });
    }
    catch { }
    const proc = spawn(process.execPath, ['dist/index.js'], { env: { ...process.env, ...env }, stdio: 'pipe' });
    try {
        const out = fs.createWriteStream('server.out.log', { flags: 'a' });
        const err = fs.createWriteStream('server.err.log', { flags: 'a' });
        proc.stdout?.on('data', (c) => out.write(c));
        proc.stderr?.on('data', (c) => err.write(c));
    }
    catch { }
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return proc;
}
export async function stopServer(proc) {
    try {
        proc.kill();
    }
    catch { }
    try {
        execSync("pkill -f 'node dist/index.js'", { stdio: 'ignore' });
    }
    catch { }
}
export async function httpGet(url) {
    return new Promise((resolve) => {
        const req = http.get(url, (res) => {
            let data = '';
            res.on('data', (c) => data += c);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode || 0, body: JSON.parse(data || '{}') });
                }
                catch {
                    resolve({ status: res.statusCode || 0, body: data });
                }
            });
        });
        req.on('error', () => resolve({ status: 0, body: null }));
    });
}
export async function httpPost(url, obj) {
    const data = JSON.stringify(obj);
    return new Promise((resolve) => {
        const r = http.request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
            let body = '';
            res.on('data', (c) => body += c);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode || 0, body: JSON.parse(body || '{}') });
                }
                catch {
                    resolve({ status: res.statusCode || 0, body: body });
                }
            });
        });
        r.on('error', () => resolve({ status: 0, body: null }));
        r.write(data);
        r.end();
    });
}
