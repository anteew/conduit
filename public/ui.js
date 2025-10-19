// Conduit UI client-side script

// 1) Text → Enqueue
document.getElementById('sendText').addEventListener('click', async () => {
  const to = document.getElementById('to').value;
  const text = document.getElementById('text').value;
  const resultSpan = document.getElementById('sendTextResult');
  
  try {
    const resp = await fetch('/v1/enqueue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to, envelope: { text } })
    });
    const data = await resp.json();
    resultSpan.textContent = resp.ok ? `✓ ${JSON.stringify(data)}` : `✗ ${data.error}`;
    resultSpan.style.color = resp.ok ? 'green' : 'red';
  } catch (e) {
    resultSpan.textContent = `✗ ${e.message}`;
    resultSpan.style.color = 'red';
  }
});

// 2) Upload (application/octet-stream) - LEGACY
const uploadLog = document.getElementById('uploadLog');

async function uploadFile(mode) {
  const fileInput = document.getElementById('file');
  if (!fileInput.files.length) {
    uploadLog.textContent = 'Select a file first';
    return;
  }
  
  const file = fileInput.files[0];
  uploadLog.textContent = `Uploading ${file.name} (${(file.size / 1048576).toFixed(2)} MB)...`;
  
  const headers = { 'content-type': 'application/octet-stream' };
  if (mode === 'sync') headers['x-upload-mode'] = 'sync';
  
  const start = performance.now();
  try {
    const resp = await fetch('/v1/upload', {
      method: 'POST',
      headers,
      body: file
    });
    const elapsed = ((performance.now() - start) / 1000).toFixed(2);
    const mbps = (file.size / 1048576 / elapsed).toFixed(2);
    const data = await resp.json();
    
    uploadLog.textContent = resp.ok 
      ? `✓ ${file.name}: ${elapsed}s, ${mbps} MB/s\n${JSON.stringify(data, null, 2)}`
      : `✗ ${data.error}`;
  } catch (e) {
    uploadLog.textContent = `✗ ${e.message}`;
  }
}

document.getElementById('uploadAsync').addEventListener('click', () => uploadFile('async'));
document.getElementById('uploadSync').addEventListener('click', () => uploadFile('sync'));

// 2b) Multipart Upload (NEW)
const multipartSection = document.getElementById('multipartSection');
if (multipartSection) {
  const multipartLog = document.getElementById('multipartLog');
  
  document.getElementById('uploadMultipart').addEventListener('click', async () => {
    const fileInput = document.getElementById('multipartFile');
    const metadata = document.getElementById('multipartMetadata').value;
    
    if (!fileInput.files.length) {
      multipartLog.textContent = 'Select at least one file';
      return;
    }
    
    const formData = new FormData();
    
    // Add metadata fields if provided
    if (metadata) {
      try {
        const metaObj = JSON.parse(metadata);
        Object.entries(metaObj).forEach(([key, value]) => {
          formData.append(key, String(value));
        });
      } catch (e) {
        multipartLog.textContent = `Invalid JSON metadata: ${e.message}`;
        return;
      }
    }
    
    // Add all files
    let totalSize = 0;
    for (const file of fileInput.files) {
      formData.append('files', file);
      totalSize += file.size;
    }
    
    multipartLog.textContent = `Uploading ${fileInput.files.length} file(s), ${(totalSize / 1048576).toFixed(2)} MB...`;
    
    const start = performance.now();
    try {
      const resp = await fetch('/v1/upload', {
        method: 'POST',
        body: formData
        // Content-Type is automatically set by FormData with boundary
      });
      
      const elapsed = ((performance.now() - start) / 1000).toFixed(2);
      const data = await resp.json();
      
      if (resp.ok) {
        const summary = `✓ Upload complete:\n` +
          `  Files: ${data.fileCount}\n` +
          `  Total: ${(data.totalBytes / 1048576).toFixed(2)} MB\n` +
          `  Duration: ${data.totalDuration}s\n` +
          `  Rate: ${data.totalMbps} MB/s\n` +
          `  Mode: ${data.mode}\n\n` +
          `Files:\n${data.files.map(f => 
            `  - ${f.filename}: ${(f.size / 1048576).toFixed(2)} MB, ${f.mbps} MB/s`
          ).join('\n')}`;
        multipartLog.textContent = summary;
      } else {
        multipartLog.textContent = `✗ ${data.error}\n${data.reason || ''}\nLimits: ${JSON.stringify(data.limits || {})}`;
      }
    } catch (e) {
      multipartLog.textContent = `✗ ${e.message}`;
    }
  });
}

// 3) WebSocket Subscribe
let ws = null;
const wsLog = document.getElementById('wsLog');

document.getElementById('wsConnect').addEventListener('click', () => {
  const stream = document.getElementById('wsStream').value;
  if (ws) {
    ws.close();
    ws = null;
    wsLog.textContent = 'Disconnected';
    return;
  }
  
  ws = new WebSocket(`ws://${location.host}/v1/subscribe?stream=${encodeURIComponent(stream)}`);
  
  ws.onopen = () => {
    wsLog.textContent = `Connected to ${stream}`;
  };
  
  ws.onmessage = (evt) => {
    wsLog.textContent += `\n${evt.data}`;
    wsLog.scrollTop = wsLog.scrollHeight;
  };
  
  ws.onerror = (err) => {
    wsLog.textContent += `\nError: ${err.message || 'Connection error'}`;
  };
  
  ws.onclose = () => {
    wsLog.textContent += '\nDisconnected';
    ws = null;
  };
});

document.getElementById('wsGrant').addEventListener('click', () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    wsLog.textContent = 'Not connected';
    return;
  }
  ws.send(JSON.stringify({ credit: 1 }));
  wsLog.textContent += '\nSent: {"credit":1}';
});

// 4) Metrics
document.getElementById('getMetrics').addEventListener('click', async () => {
  const metricsLog = document.getElementById('metricsLog');
  try {
    const resp = await fetch('/v1/metrics');
    const data = await resp.json();
    metricsLog.textContent = JSON.stringify(data, null, 2);
  } catch (e) {
    metricsLog.textContent = `✗ ${e.message}`;
  }
});

// 5) Performance Dashboard (T5083)
let perfInterval = null;
let lastRequestsTotal = 0;
let lastUpdateTime = null;

async function updatePerfPanel() {
  try {
    const resp = await fetch('/v1/metrics');
    const data = await resp.json();
    
    // Calculate requests per minute
    const currentRequestsTotal = data.http?.counters?.requestsTotal || 0;
    let requestsPerMin = 0;
    
    if (lastUpdateTime && lastRequestsTotal > 0) {
      const elapsedMin = (Date.now() - lastUpdateTime) / 60000;
      const requestsDelta = currentRequestsTotal - lastRequestsTotal;
      requestsPerMin = elapsedMin > 0 ? Math.round(requestsDelta / elapsedMin) : 0;
    }
    
    lastRequestsTotal = currentRequestsTotal;
    lastUpdateTime = Date.now();
    
    // Update display
    document.getElementById('perfHttpRate').textContent = requestsPerMin;
    document.getElementById('perfWsActive').textContent = data.websocket?.counters?.activeConnections || 0;
    document.getElementById('perfLatencyP50').textContent = 
      (data.http?.latency?.p50 || 0).toFixed(1);
    document.getElementById('perfLatencyP95').textContent = 
      (data.http?.latency?.p95 || 0).toFixed(1);
    document.getElementById('perfUpdateTime').textContent = 
      `Updated ${new Date().toLocaleTimeString()}`;
  } catch (e) {
    console.error('Perf panel update failed:', e);
  }
}

document.getElementById('perfToggle').addEventListener('click', () => {
  const btn = document.getElementById('perfToggle');
  if (perfInterval) {
    clearInterval(perfInterval);
    perfInterval = null;
    btn.textContent = 'Start Auto-Update';
    document.getElementById('perfUpdateTime').textContent = 'Stopped';
  } else {
    updatePerfPanel(); // Immediate update
    perfInterval = setInterval(updatePerfPanel, 5000); // Every 5 seconds
    btn.textContent = 'Stop Auto-Update';
  }
});
