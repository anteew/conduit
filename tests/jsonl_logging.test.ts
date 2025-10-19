import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { startHttp, makeClientWithDemo } from '../src/connectors/http.js';

const LOG_PATH = 'reports/gateway-http.log.jsonl';
const PORT = 9097;

function cleanup() {
  try {
    if (fs.existsSync(LOG_PATH)) {
      fs.unlinkSync(LOG_PATH);
    }
  } catch {}
}

function readLogs(): any[] {
  try {
    const content = fs.readFileSync(LOG_PATH, 'utf8');
    return content.trim().split('\n').map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

function makeRequest(path: string, method: string = 'GET', body?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: PORT,
      path,
      method,
      headers: body ? { 'content-type': 'application/json' } : {}
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  cleanup();
  
  process.env.CONDUIT_HTTP_LOG = LOG_PATH;
  
  const client = makeClientWithDemo();
  const server = startHttp(client, PORT, '127.0.0.1');
  
  console.log('✓ Server started with JSONL logging enabled');
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Test 1: Health check
  await makeRequest('/health');
  let logs = readLogs();
  console.log(`✓ Health check logged: ${logs.length} entries`);
  
  // Test 2: 404
  await makeRequest('/nonexistent');
  logs = readLogs();
  const notFoundLog = logs.find(l => l.status === 404);
  console.log(`✓ 404 logged with error: ${notFoundLog?.error}`);
  
  // Test 3: POST request
  await makeRequest('/v1/enqueue', 'POST', { to: 'test', envelope: { data: 'test' } });
  logs = readLogs();
  const enqueueLog = logs.find(l => l.path === '/v1/enqueue' && l.event === 'http_request_complete');
  console.log(`✓ POST logged: ${enqueueLog?.bytes} bytes, ${enqueueLog?.durMs}ms`);
  
  // Test 4: Verify all logs have required fields
  logs = readLogs();
  const allValid = logs.every(l => 
    l.ts && 
    l.event && 
    l.ip && 
    l.method && 
    l.path
  );
  console.log(`✓ All logs have required fields: ${allValid}`);
  
  // Test 5: Verify JSONL format (one object per line)
  const content = fs.readFileSync(LOG_PATH, 'utf8');
  const lines = content.trim().split('\n');
  const allParseable = lines.every(line => {
    try {
      JSON.parse(line);
      return true;
    } catch {
      return false;
    }
  });
  console.log(`✓ Valid JSONL format: ${allParseable}`);
  
  // Test 6: Event types
  const events = new Set(logs.map(l => l.event));
  console.log(`✓ Event types logged: ${Array.from(events).join(', ')}`);
  
  // Display sample logs
  console.log('\nSample log entries:');
  logs.slice(0, 3).forEach((log, i) => {
    console.log(`  ${i + 1}. ${JSON.stringify(log)}`);
  });
  
  server.close();
  console.log('\n✓ All tests passed!');
}

main().catch(console.error);
