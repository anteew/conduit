# Prometheus json_exporter for Conduit /v1/metrics

Conduit exposes a structured JSON metrics document at `GET /v1/metrics`. To scrape it with Prometheus, use the [json_exporter](https://github.com/prometheus-community/json_exporter).

## Example json_exporter config

```yaml
modules:
  conduit:
    metrics:
    - name: conduit_http_requests_total
      path: $.http.requestsTotal
      labels: {}
      type: gauge
    - name: conduit_http_bytes_in_total
      path: $.http.bytesIn
      type: gauge
    - name: conduit_http_bytes_out_total
      path: $.http.bytesOut
      type: gauge
    - name: conduit_http_requests_by_status
      path: $.http.requestsByStatus
      labels:
        status: key
      type: gauge
    - name: conduit_http_requests_by_path
      path: $.http.requestsByPath
      labels:
        path: key
      type: gauge
    - name: conduit_http_duration_ms
      type: gauge
      help: HTTP duration percentiles in ms
      path: $.http.durations
      labels:
        quantile: key
    - name: conduit_ws_active_connections
      path: $.ws.activeConnections
      type: gauge
    - name: conduit_ws_connections_total
      path: $.ws.connectionsTotal
      type: counter
```

## Prometheus scrape job

```yaml
scrape_configs:
  - job_name: 'conduit-json'
    metrics_path: /probe
    static_configs:
      - targets:
        - http://conduit:9087/v1/metrics
    params:
      module: [conduit]
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - target_label: __address__
        replacement: json-exporter:7979
```

## Notes

- If `/v1/metrics` is protected, pass `CONDUIT_TOKENS` to Conduit and configure the exporter with the token via headers.
- For codec metrics percentiles (p50/p95/p99), extend the module with `$.http.codecs.decodeLatencyMs` and `$.ws.codecs.decodeLatencyMs` maps.

