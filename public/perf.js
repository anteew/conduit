// Conduit Performance Dashboard
// Real-time metrics visualization

let metricsHistory = [];
const MAX_HISTORY = 60; // 60 samples = 2 minutes at 2s interval

async function fetchMetrics() {
  try {
    const res = await fetch('/v1/metrics');
    return await res.json();
  } catch (error) {
    console.error('Failed to fetch metrics:', error);
    return null;
  }
}

function updateMetrics(metrics) {
  if (!metrics) return;

  // HTTP Requests/sec (calculate from current vs previous)
  const httpTotal = (metrics.http?.endpoints || {});
  const totalRequests = Object.values(httpTotal).reduce((sum, ep) => sum + (ep.count || 0), 0);
  
  if (metricsHistory.length > 0) {
    const prev = metricsHistory[metricsHistory.length - 1];
    const reqDelta = totalRequests - (prev.totalRequests || 0);
    const timeDelta = 2; // 2 second interval
    const rps = Math.round(reqDelta / timeDelta);
    document.getElementById('http-rps').textContent = rps;
    document.getElementById('http-rps').className = 'metric ' + (rps > 100 ? 'green' : rps > 10 ? 'yellow' : '');
  }

  // WebSocket Connections
  const wsActive = metrics.ws?.connections?.active || 0;
  const wsTotal = metrics.ws?.connections?.total || 0;
  document.getElementById('ws-active').textContent = wsActive;
  document.getElementById('ws-total').textContent = wsTotal;
  document.getElementById('ws-active').className = 'metric ' + (wsActive > 50 ? 'green' : wsActive > 0 ? 'yellow' : '');

  // Latency (estimate from rule durations)
  const rules = metrics.http?.rules || {};
  const durations = Object.values(rules).map(r => r.avgMs || 0).filter(d => d > 0);
  const p50 = durations.length ? Math.round(durations.sort()[Math.floor(durations.length * 0.5)]) : 0;
  const p95 = durations.length ? Math.round(durations.sort()[Math.floor(durations.length * 0.95)]) : 0;
  document.getElementById('latency-p50').textContent = p50 + 'ms';
  document.getElementById('latency-p95').textContent = p95 + 'ms';
  document.getElementById('latency-p95').className = 'metric ' + (p95 < 10 ? 'green' : p95 < 50 ? 'yellow' : 'red');

  // Queue Depth (from streams)
  const streams = metrics.streams || [];
  const queueDepth = streams.reduce((sum, s) => sum + (s.stats?.depth || 0), 0);
  document.getElementById('queue-depth').textContent = queueDepth;
  document.getElementById('queue-depth').className = 'metric ' + (queueDepth < 100 ? 'green' : queueDepth < 1000 ? 'yellow' : 'red');

  // Blob Storage
  const uploads = metrics.http?.uploads || {};
  const blobCount = uploads.count || 0;
  const blobBytes = uploads.bytes || 0;
  document.getElementById('blob-count').textContent = blobCount;
  document.getElementById('blob-size').textContent = (blobBytes / 1048576).toFixed(1) + ' MB';

  // Error Rate
  const errors = metrics.errors || {};
  const errorCount = Object.values(errors).reduce((sum, c) => sum + c, 0);
  const errorRate = totalRequests > 0 ? ((errorCount / totalRequests) * 100).toFixed(2) : '0.00';
  document.getElementById('error-rate').textContent = errorRate + '%';
  document.getElementById('error-rate').className = 'metric ' + (parseFloat(errorRate) < 1 ? 'green' : parseFloat(errorRate) < 5 ? 'yellow' : 'red');

  // Update table
  updateEndpointsTable(httpTotal);

  // Store for history
  metricsHistory.push({ timestamp: Date.now(), totalRequests, metrics });
  if (metricsHistory.length > MAX_HISTORY) {
    metricsHistory.shift();
  }

  // Update chart
  updateChart();
}

function updateEndpointsTable(endpoints) {
  const tbody = document.querySelector('#endpoints-table tbody');
  tbody.innerHTML = '';

  Object.entries(endpoints)
    .sort(([, a], [, b]) => (b.count || 0) - (a.count || 0))
    .slice(0, 10)
    .forEach(([path, stats]) => {
      const row = tbody.insertRow();
      row.insertCell().textContent = path;
      row.insertCell().textContent = stats.count || 0;
      row.insertCell().textContent = (stats.avgMs || 0).toFixed(1) + 'ms';
      row.insertCell().textContent = stats.errors || 0;
    });
}

let chart = null;

function updateChart() {
  const canvas = document.getElementById('rps-chart');
  const ctx = canvas.getContext('2d');
  
  // Simple line chart
  const width = canvas.width = canvas.offsetWidth;
  const height = canvas.height = 200;
  
  ctx.clearRect(0, 0, width, height);
  
  if (metricsHistory.length < 2) return;
  
  // Calculate RPS for each sample
  const rpsData = [];
  for (let i = 1; i < metricsHistory.length; i++) {
    const curr = metricsHistory[i].totalRequests || 0;
    const prev = metricsHistory[i - 1].totalRequests || 0;
    const rps = (curr - prev) / 2; // 2 second interval
    rpsData.push(rps);
  }
  
  const maxRps = Math.max(...rpsData, 1);
  const step = width / (rpsData.length - 1 || 1);
  
  // Draw grid
  ctx.strokeStyle = '#1e3a5f';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = (height / 4) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  
  // Draw line
  ctx.strokeStyle = '#4a9eff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  
  rpsData.forEach((rps, i) => {
    const x = i * step;
    const y = height - (rps / maxRps) * height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  
  ctx.stroke();
  
  // Draw labels
  ctx.fillStyle = '#666';
  ctx.font = '10px sans-serif';
  ctx.fillText(`${maxRps.toFixed(0)} req/s`, 5, 10);
  ctx.fillText('0', 5, height - 5);
}

// Auto-refresh every 2 seconds
setInterval(async () => {
  const metrics = await fetchMetrics();
  updateMetrics(metrics);
}, 2000);

// Initial load
fetchMetrics().then(updateMetrics);
